import { createHash, randomBytes } from "node:crypto";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { ProposalRepositoryPort, UpdateProposalInput } from "../ports/proposal-repository.port.js";
import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { evaluateAutomationTrigger, type AutomationUseCaseDeps } from "./automation-use-cases.js";
import type { Proposal, ProposalEventType, ProposalItem } from "../../domain/crm/crm.model.js";
import { recordFirstEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";

export type ProposalBuyerEvent = { type: "first_view" | "hot_view" | "accepted" | "declined"; proposal: Proposal };

export type ProposalUseCaseDeps = {
  proposalRepository: ProposalRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  contactRepository?: ContactRepositoryPort;
  dealRepository?: DealRepositoryPort;
  /** Fase 6 — opcional de propósito, mesmo racional de `DealUseCaseDeps.automation`. Dispara
   * `proposal_accepted`/`proposal_rejected` a partir de `respondToPublicProposal`. */
  automation?: AutomationUseCaseDeps;
  /** Trial + Product Analytics — integração MÍNIMA (`first_proposal_created`,
   * `first_proposal_sent`, `first_proposal_accepted`). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  /** Sales Engine — bloqueia o PRIMEIRO envio quando os termos estão fora da política comercial e
   * não há aprovação válida para eles (lança `COMMERCIAL_APPROVAL_REQUIRED`). Sem bypass: o gate
   * roda no backend em todo caminho de envio (manual ou WhatsApp). */
  approvalGate?: (proposal: Proposal) => Promise<void>;
  /** Sales Engine — efeitos de eventos do comprador (alertas ao vendedor, ganho automático
   * configurável). Nunca derruba o fluxo do cliente: falhas são engolidas por quem chama. */
  onBuyerEvent?: (event: ProposalBuyerEvent) => Promise<void>;
};

/** Deps do lado "negócio ganho ao aceitar a proposta" — bounded context ainda `crm`, então
 * importar `deal-repository.port`/`pipeline-repository.port` aqui não viola isolamento (ver
 * `scripts/check-crm-isolation.mjs`, que só separa `crm` de `inbox`/`instagram-dm`). */
export type ProposalDealLinkDeps = {
  dealRepository: DealRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** Trial + Product Analytics — integração MÍNIMA (`first_deal_won`, mesmo evento que
   * `moveDealStage` dispara — este é o SEGUNDO caminho pra um negócio ser ganho, que não passa
   * por `moveDealStage` nenhuma vez, ver `applyProposalAcceptanceToDeal`). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  /** Sales Engine — quando presente, decide sozinho o que o aceite faz com a oportunidade (padrão:
   * só sinaliza "aceita"; ganho automático só se o tenant configurar). */
  acceptanceHandler?: (proposal: Proposal) => Promise<void>;
};

const OPEN_FOR_EDIT: readonly Proposal["status"][] = ["draft", "pending_approval", "approved"];
const SENDABLE: readonly Proposal["status"][] = ["draft", "pending_approval", "approved", "sent", "viewed"];
const CLOSED: readonly Proposal["status"][] = ["accepted", "rejected", "expired", "cancelled", "superseded"];

export function generateProposalToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashProposalToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function normalizeItem(item: ProposalItem): ProposalItem {
  const subtotalCents = Math.round(item.quantity * item.unitPriceCents);
  const listPriceCents = item.listPriceCents;
  return {
    productId: item.productId,
    variantId: item.variantId,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    subtotalCents,
    billingType: item.billingType,
    listPriceCents,
    minimumPriceCents: item.minimumPriceCents,
    unitCostCents: item.unitCostCents,
    discountCents: listPriceCents !== undefined ? Math.max(0, Math.round(item.quantity * listPriceCents) - subtotalCents) : item.discountCents,
  };
}

/** Total determinístico: soma dos itens − desconto global (limitado ao subtotal; nunca duplo). */
export function computeItemsAndTotal(items: readonly ProposalItem[], discountCents: number): { items: ProposalItem[]; totalCents: number; listTotalCents: number } {
  const normalized = items.map(normalizeItem);
  const subtotal = normalized.reduce((sum, item) => sum + item.subtotalCents, 0);
  const listTotalCents = normalized.reduce((sum, item) => sum + (item.listPriceCents !== undefined ? Math.round(item.quantity * item.listPriceCents) : item.subtotalCents), 0);
  const totalCents = Math.max(0, subtotal - Math.max(0, discountCents));
  return { items: normalized, totalCents, listTotalCents };
}

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustProposalBelongToTenantAndWorkspace(deps: ProposalUseCaseDeps, proposalId: string, tenantId: string, workspaceId: string): Promise<Proposal> {
  const proposal = await deps.proposalRepository.getById(proposalId);
  if (!proposal || proposal.tenantId !== tenantId || proposal.workspaceId !== workspaceId) {
    throw new Error(`PROPOSAL_NOT_FOUND: proposta "${proposalId}" não existe.`);
  }
  return proposal;
}

async function appendEvent(deps: ProposalUseCaseDeps, proposal: Proposal, eventType: ProposalEventType, payload?: Record<string, unknown>, recipientId?: string) {
  return deps.proposalRepository.appendEvent({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, eventType, payload, recipientId });
}

export type CreateProposalUseCaseInput = {
  tenantId: string;
  workspaceId: string;
  dealId?: string;
  contactId?: string;
  title: string;
  items: readonly ProposalItem[];
  discountCents?: number;
  currency?: string;
  validUntil?: string;
  conditions?: string;
  introduction?: string;
  notes?: string;
  terms?: string;
  createdByUserId?: string;
  initialStatus?: "draft" | "pending_approval" | "approved";
};

export async function createProposal(deps: ProposalUseCaseDeps, input: CreateProposalUseCaseInput): Promise<{ proposal: Proposal; rawToken: string }> {
  let contactId = input.contactId;
  if (contactId && deps.contactRepository) {
    const contact = await deps.contactRepository.getById(contactId);
    if (!contact || contact.tenantId !== input.tenantId || contact.workspaceId !== input.workspaceId) {
      throw new Error("PROPOSAL_CONTEXT_INVALID: contato não pertence a este workspace.");
    }
  }
  if (input.dealId && deps.dealRepository) {
    const deal = await deps.dealRepository.getById(input.dealId);
    if (!deal || deal.tenantId !== input.tenantId || deal.workspaceId !== input.workspaceId) {
      throw new Error("PROPOSAL_CONTEXT_INVALID: oportunidade não pertence a este workspace.");
    }
    if (contactId && deal.contactId && deal.contactId !== contactId) {
      throw new Error("PROPOSAL_CONTEXT_INVALID: oportunidade e contato não correspondem.");
    }
    contactId ??= deal.contactId;
  }
  const discountCents = input.discountCents ?? 0;
  const { items, totalCents, listTotalCents } = computeItemsAndTotal(input.items, discountCents);
  const rawToken = generateProposalToken();
  const number = await deps.proposalRepository.nextNumber(input.workspaceId, new Date().getUTCFullYear());
  const { initialStatus, ...rest } = input;
  const proposal = await deps.proposalRepository.create({
    ...rest, contactId, items, discountCents, totalCents, listTotalCents, publicTokenHash: hashProposalToken(rawToken), number, version: 1, status: initialStatus ?? "draft",
  });
  await deps.timelineEventRepository.record({
    tenantId: proposal.tenantId,
    workspaceId: proposal.workspaceId,
    entityType: "proposal",
    entityId: proposal.id,
    eventType: "proposal_created",
    actorType: "user",
    actorId: input.createdByUserId,
    payload: { dealId: proposal.dealId, totalCents: proposal.totalCents, number: proposal.number },
  });
  await appendEvent(deps, proposal, "created", { totalCents: proposal.totalCents, version: proposal.version });
  if (deps.productAnalytics) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_proposal_created", source: "server", tenantId: proposal.tenantId, workspaceId: proposal.workspaceId });
  }
  return { proposal, rawToken };
}

async function expireIfNeeded(deps: ProposalUseCaseDeps, proposal: Proposal): Promise<Proposal> {
  if (!isExpired(proposal) || CLOSED.includes(proposal.status)) return proposal;
  const expired = await deps.proposalRepository.setStatus(proposal.id, { status: "expired" });
  await appendEvent(deps, expired, "expired");
  return expired;
}

export async function listProposals(deps: ProposalUseCaseDeps, input: { tenantId: string; workspaceId: string; dealId?: string; contactId?: string; status?: Proposal["status"] }): Promise<Proposal[]> {
  const proposals = await deps.proposalRepository.listByWorkspace(input);
  return Promise.all(proposals.map((proposal) => expireIfNeeded(deps, proposal)));
}

export async function getProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<Proposal> {
  return expireIfNeeded(deps, await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId));
}

/** Só é possível editar uma proposta ainda não enviada — depois de enviada (ou aceita) o conteúdo
 * já pode ter sido visto pelo cliente; mudanças exigem uma NOVA VERSÃO (`createProposalVersion`).
 * Editar uma proposta aguardando/aprovada a devolve para rascunho (a aprovação vale para termos). */
export async function updateProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; patch: Omit<UpdateProposalInput, "items" | "discountCents" | "totalCents" | "listTotalCents"> & { items?: readonly ProposalItem[]; discountCents?: number } }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (!OPEN_FOR_EDIT.includes(existing.status)) {
    throw new Error("PROPOSAL_NOT_EDITABLE: proposta já enviada não é alterada — crie uma nova versão.");
  }
  const items = input.patch.items ?? existing.items;
  const discountCents = input.patch.discountCents ?? existing.discountCents;
  const { items: normalizedItems, totalCents, listTotalCents } = computeItemsAndTotal(items, discountCents);
  const updated = await deps.proposalRepository.update(input.proposalId, { ...input.patch, items: normalizedItems, discountCents, totalCents, listTotalCents });
  const termsChanged = input.patch.items !== undefined || input.patch.discountCents !== undefined;
  return termsChanged && existing.status !== "draft" ? deps.proposalRepository.setStatus(updated.id, { status: "draft" }) : updated;
}

export async function sendProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; actorUserId?: string; channel?: string; conversationId?: string; messageId?: string }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (!SENDABLE.includes(existing.status)) {
    throw new Error(`PROPOSAL_NOT_SENDABLE: proposta com status "${existing.status}" não pode ser enviada.`);
  }
  if (isExpired(existing)) throw new Error("PROPOSAL_NOT_SENDABLE: proposta vencida — crie uma nova versão com nova validade.");
  const isResend = existing.status === "sent" || existing.status === "viewed";
  if (!isResend) await deps.approvalGate?.(existing);
  const now = new Date().toISOString();
  const proposal = await deps.proposalRepository.markSent(input.proposalId, { sentAt: now, sentByUserId: input.actorUserId, channel: input.channel, conversationId: input.conversationId, messageId: input.messageId });
  await deps.timelineEventRepository.record({
    tenantId: proposal.tenantId,
    workspaceId: proposal.workspaceId,
    entityType: "proposal",
    entityId: proposal.id,
    eventType: isResend ? "proposal_resent" : "proposal_sent",
    actorType: "user",
    actorId: input.actorUserId,
    payload: { channel: input.channel, conversationId: input.conversationId },
  });
  await appendEvent(deps, proposal, isResend ? "reminder_sent" : "sent", { channel: input.channel ?? "manual", conversationId: input.conversationId, messageId: input.messageId, byUserId: input.actorUserId });
  if (!isResend) {
    // Nova versão efetivamente enviada SUBSTITUI as anteriores ainda vigentes (aceitas nunca).
    for (const sibling of await deps.proposalRepository.listVersions(proposal.rootProposalId)) {
      if (sibling.id === proposal.id) continue;
      const superseded = await deps.proposalRepository.markSuperseded(sibling.id, { supersededByProposalId: proposal.id, at: now });
      if (superseded) await appendEvent(deps, superseded, "superseded", { byProposalId: proposal.id, byVersion: proposal.version });
    }
    if (deps.automation) {
      const contact = proposal.contactId ? await deps.automation.contactRepository.getById(proposal.contactId) : undefined;
      const deal = proposal.dealId ? await deps.automation.dealRepository.getById(proposal.dealId) : undefined;
      await evaluateAutomationTrigger(deps.automation, { tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, trigger: "proposal_sent", contact, deal });
    }
  }
  if (deps.productAnalytics) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_proposal_sent", source: "server", tenantId: proposal.tenantId, workspaceId: proposal.workspaceId });
  }
  return proposal;
}

/** Nova versão (v2, v3...) a partir de qualquer versão: copia conteúdo (ou usa os itens passados),
 * mantém o número, nasce em rascunho com link novo. A anterior só vira `superseded` quando ESTA
 * for efetivamente enviada — até lá o cliente continua vendo a versão que recebeu. */
export async function createProposalVersion(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; actorUserId?: string; overrides?: Partial<Pick<Proposal, "title" | "validUntil" | "conditions" | "introduction" | "notes" | "terms" | "discountCents">> & { items?: readonly ProposalItem[] } }): Promise<{ proposal: Proposal; rawToken: string }> {
  const base = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (base.status === "cancelled") throw new Error("PROPOSAL_NOT_EDITABLE: proposta cancelada não gera nova versão.");
  const versions = await deps.proposalRepository.listVersions(base.rootProposalId);
  const nextVersion = Math.max(...versions.map((version) => version.version), base.version) + 1;
  const overrides = input.overrides ?? {};
  const discountCents = overrides.discountCents ?? base.discountCents;
  const { items, totalCents, listTotalCents } = computeItemsAndTotal(overrides.items ?? base.items, discountCents);
  const rawToken = generateProposalToken();
  const proposal = await deps.proposalRepository.create({
    tenantId: base.tenantId, workspaceId: base.workspaceId, dealId: base.dealId, contactId: base.contactId, title: overrides.title ?? base.title, items,
    discountCents, totalCents, listTotalCents, currency: base.currency, validUntil: overrides.validUntil ?? base.validUntil, conditions: overrides.conditions ?? base.conditions,
    introduction: overrides.introduction ?? base.introduction, notes: overrides.notes ?? base.notes, terms: overrides.terms ?? base.terms,
    publicTokenHash: hashProposalToken(rawToken), number: base.number, version: nextVersion, rootProposalId: base.rootProposalId, supersedesProposalId: base.id,
    createdByUserId: input.actorUserId,
  });
  await deps.timelineEventRepository.record({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, entityType: "proposal", entityId: proposal.id, eventType: "proposal_version_created", actorType: "user", actorId: input.actorUserId, payload: { fromProposalId: base.id, version: nextVersion } });
  await appendEvent(deps, proposal, "created", { totalCents, version: nextVersion, fromVersion: base.version });
  return { proposal, rawToken };
}

export async function cancelProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; actorUserId?: string }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (existing.status === "cancelled") return existing;
  const cancelled = await deps.proposalRepository.markCancelled(existing.id, new Date().toISOString());
  if (!cancelled) throw new Error(`PROPOSAL_NOT_EDITABLE: proposta "${existing.status}" não pode ser cancelada.`);
  await deps.proposalRepository.revokePublicToken(cancelled.id, new Date().toISOString());
  await appendEvent(deps, cancelled, "cancelled", { byUserId: input.actorUserId });
  return cancelled;
}

export async function regenerateProposalLink(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<{ proposal: Proposal; rawToken: string }> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (CLOSED.includes(existing.status)) throw new Error("PROPOSAL_LINK_NOT_AVAILABLE: esta proposta já foi encerrada.");
  const rawToken = generateProposalToken();
  const proposal = await deps.proposalRepository.rotatePublicToken(existing.id, hashProposalToken(rawToken));
  await deps.timelineEventRepository.record({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, entityType: "proposal", entityId: proposal.id, eventType: "proposal_link_regenerated", actorType: "user", payload: {} });
  return { proposal, rawToken };
}

export async function revokeProposalLink(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (existing.publicLinkRevokedAt) return existing;
  return deps.proposalRepository.revokePublicToken(existing.id, new Date().toISOString());
}

/** Link adicional para outro decisor (token próprio → rastreio por destinatário). */
export async function addProposalRecipient(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; name: string; contactId?: string }): Promise<{ recipientId: string; rawToken: string }> {
  const proposal = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (CLOSED.includes(proposal.status)) throw new Error("PROPOSAL_LINK_NOT_AVAILABLE: esta proposta já foi encerrada.");
  if (input.contactId && deps.contactRepository) {
    const contact = await deps.contactRepository.getById(input.contactId);
    if (!contact || contact.tenantId !== input.tenantId || contact.workspaceId !== input.workspaceId) throw new Error("PROPOSAL_CONTEXT_INVALID: contato não pertence a este workspace.");
  }
  const rawToken = generateProposalToken();
  const recipient = await deps.proposalRepository.createRecipient({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, contactId: input.contactId, name: input.name.trim(), tokenHash: hashProposalToken(rawToken) });
  return { recipientId: recipient.id, rawToken };
}

export async function getProposalTimeline(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }) {
  await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  return deps.timelineEventRepository.listByEntity({ entityType: "proposal", entityId: input.proposalId });
}

export async function listProposalEvents(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }) {
  await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  return deps.proposalRepository.listEvents(input.proposalId);
}

// -------------------------------------------------------------------------------------------
// Acesso público (`/p/:token`) — o token É a autenticação, nunca escopado por tenant/workspace.
// -------------------------------------------------------------------------------------------

function isExpired(proposal: Proposal): boolean {
  return Boolean(proposal.validUntil) && new Date(`${proposal.validUntil as string}T23:59:59.999Z`) < new Date();
}

/** Conteúdo exibido ao cliente — hash dele é o que fica gravado no aceite (prova do que foi aceito). */
export function publicProposalContent(proposal: Proposal) {
  return {
    number: proposal.number,
    version: proposal.version,
    title: proposal.title,
    introduction: proposal.introduction,
    items: proposal.items.map((item) => ({ name: item.name, description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents, subtotalCents: item.subtotalCents, billingType: item.billingType })),
    subtotalCents: proposal.items.reduce((sum, item) => sum + item.subtotalCents, 0),
    discountCents: proposal.discountCents,
    totalCents: proposal.totalCents,
    currency: proposal.currency,
    validUntil: proposal.validUntil,
    conditions: proposal.conditions,
    notes: proposal.notes,
    terms: proposal.terms,
  };
}

export function proposalContentHash(proposal: Proposal): string {
  return createHash("sha256").update(JSON.stringify(publicProposalContent(proposal))).digest("hex");
}

async function resolveByToken(deps: ProposalUseCaseDeps, rawToken: string): Promise<{ proposal: Proposal; recipientId?: string }> {
  const hash = hashProposalToken(rawToken);
  const direct = await deps.proposalRepository.getByTokenHash(hash);
  if (direct) return { proposal: direct };
  const recipient = await deps.proposalRepository.getRecipientByTokenHash(hash);
  const proposal = recipient ? await deps.proposalRepository.getById(recipient.proposalId) : undefined;
  if (!proposal || !recipient) throw new Error("PROPOSAL_NOT_FOUND: link inválido.");
  return { proposal, recipientId: recipient.id };
}

const HOT_VIEW_THRESHOLD = 3;

/** Busca por token bruto (o link público). Expira na leitura; registra visualização REAL (só o
 * acesso ao link conta como "viewed" — leitura da mensagem no WhatsApp nunca conta). Alerta o
 * vendedor só na primeira abertura e quando vira sinal quente (3ª abertura), nunca a cada refresh. */
export async function getPublicProposal(deps: ProposalUseCaseDeps, rawToken: string): Promise<Proposal> {
  const { proposal, recipientId } = await resolveByToken(deps, rawToken);
  if (proposal.publicLinkRevokedAt && proposal.status !== "superseded") throw new Error("PROPOSAL_LINK_REVOKED: este link foi revogado.");
  if (isExpired(proposal) && !CLOSED.includes(proposal.status)) return expireIfNeeded(deps, proposal);
  if (proposal.status === "sent" || proposal.status === "viewed") {
    const firstView = proposal.viewCount === 0;
    const now = new Date().toISOString();
    const viewed = await deps.proposalRepository.recordView(proposal.id, now, recipientId);
    if (recipientId) await deps.proposalRepository.recordRecipientView(recipientId, now);
    await appendEvent(deps, viewed, "viewed", { viewNumber: viewed.viewCount }, recipientId);
    if (firstView) {
      await deps.timelineEventRepository.record({ tenantId: viewed.tenantId, workspaceId: viewed.workspaceId, entityType: "proposal", entityId: viewed.id, eventType: "proposal_viewed", actorType: "system", payload: {} });
      await deps.onBuyerEvent?.({ type: "first_view", proposal: viewed }).catch(() => undefined);
      if (deps.automation) {
        const contact = viewed.contactId ? await deps.automation.contactRepository.getById(viewed.contactId) : undefined;
        const deal = viewed.dealId ? await deps.automation.dealRepository.getById(viewed.dealId) : undefined;
        await evaluateAutomationTrigger(deps.automation, { tenantId: viewed.tenantId, workspaceId: viewed.workspaceId, trigger: "proposal_viewed", contact, deal });
      }
    } else if (viewed.viewCount === HOT_VIEW_THRESHOLD) {
      await deps.onBuyerEvent?.({ type: "hot_view", proposal: viewed }).catch(() => undefined);
    }
    return viewed;
  }
  return proposal;
}

export type AcceptanceAudit = { ip?: string; userAgent?: string };

async function respondToPublicProposal(deps: ProposalUseCaseDeps, rawToken: string, decision: "accepted" | "rejected", details: { reason?: string; comment?: string; audit?: AcceptanceAudit }): Promise<Proposal> {
  const { proposal, recipientId } = await resolveByToken(deps, rawToken);
  if (proposal.publicLinkRevokedAt && proposal.status !== "superseded") throw new Error("PROPOSAL_LINK_REVOKED: este link foi revogado.");
  if (proposal.status === decision) return proposal; // idempotente: duplo clique não gera 2 eventos
  if (proposal.status === "superseded") throw new Error("PROPOSAL_SUPERSEDED: existe uma versão mais recente desta proposta.");
  if (isExpired(proposal)) throw new Error("PROPOSAL_EXPIRED: esta proposta expirou.");
  if (proposal.status !== "sent" && proposal.status !== "viewed") {
    throw new Error(`PROPOSAL_ALREADY_RESPONDED: esta proposta já está com status "${proposal.status}".`);
  }
  const updated = await deps.proposalRepository.setStatus(proposal.id, { status: decision, respondedAt: new Date().toISOString() });
  let responded = updated;
  if (decision === "rejected") {
    responded = await deps.proposalRepository.setRejection(updated.id, { reason: details.reason?.trim() || undefined, comment: details.comment?.trim() || undefined });
  } else {
    const ipHash = details.audit?.ip ? createHash("sha256").update(`${updated.tenantId}:${details.audit.ip}`).digest("hex") : undefined;
    responded = await deps.proposalRepository.setAcceptance(updated.id, { contentHash: proposalContentHash(updated), ipHash, userAgent: details.audit?.userAgent, version: updated.version });
  }
  await deps.timelineEventRepository.record({
    tenantId: responded.tenantId,
    workspaceId: responded.workspaceId,
    entityType: "proposal",
    entityId: responded.id,
    eventType: decision === "accepted" ? "proposal_accepted" : "proposal_rejected",
    actorType: "system",
    payload: decision === "rejected" ? { reason: details.reason } : { version: responded.version },
  });
  await appendEvent(deps, responded, decision === "accepted" ? "accepted" : "declined", decision === "accepted"
    ? { version: responded.version, contentHash: responded.acceptedContentHash }
    : { reason: details.reason, comment: details.comment }, recipientId);
  if (deps.automation) {
    const contact = updated.contactId ? await deps.automation.contactRepository.getById(updated.contactId) : undefined;
    const deal = updated.dealId ? await deps.automation.dealRepository.getById(updated.dealId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: updated.tenantId, workspaceId: updated.workspaceId, trigger: decision === "accepted" ? "proposal_accepted" : "proposal_rejected", contact, deal });
  }
  await deps.onBuyerEvent?.({ type: decision === "accepted" ? "accepted" : "declined", proposal: responded }).catch(() => undefined);
  if (deps.productAnalytics && decision === "accepted") {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_proposal_accepted", source: "server", tenantId: updated.tenantId, workspaceId: updated.workspaceId });
  }
  return responded;
}

export async function acceptPublicProposal(deps: ProposalUseCaseDeps, rawToken: string, audit?: AcceptanceAudit): Promise<Proposal> {
  return respondToPublicProposal(deps, rawToken, "accepted", { audit });
}

export async function rejectPublicProposal(deps: ProposalUseCaseDeps, rawToken: string, rejection?: { reason?: string; comment?: string }): Promise<Proposal> {
  return respondToPublicProposal(deps, rawToken, "rejected", rejection ?? {});
}

/** Tempo aproximado de leitura: heartbeats de no máximo 60s cada, só enquanto a proposta está em análise. */
export async function recordPublicProposalEngagement(deps: ProposalUseCaseDeps, rawToken: string, seconds: number): Promise<void> {
  const { proposal } = await resolveByToken(deps, rawToken);
  if (proposal.status !== "sent" && proposal.status !== "viewed") return;
  await deps.proposalRepository.addViewSeconds(proposal.id, seconds);
}

export async function recordPublicProposalDownload(deps: ProposalUseCaseDeps, rawToken: string): Promise<void> {
  const { proposal, recipientId } = await resolveByToken(deps, rawToken);
  await appendEvent(deps, proposal, "downloaded", {}, recipientId);
}

/**
 * Comportamento legado (sem Sales Engine): aceitar uma proposta ligada a um negócio move o negócio
 * para a etapa de Ganho do MESMO pipeline. Com Sales Engine (`acceptanceHandler`), o padrão passa a
 * ser só sinalizar o aceite — ganho automático apenas se o tenant configurar.
 */
export async function applyProposalAcceptanceToDeal(deps: ProposalDealLinkDeps, proposal: Proposal): Promise<void> {
  if (deps.acceptanceHandler) {
    await deps.acceptanceHandler(proposal);
    return;
  }
  if (!proposal.dealId) return;
  const deal = await deps.dealRepository.getById(proposal.dealId);
  if (!deal) return;
  const stages = await deps.pipelineStageRepository.listByPipeline(deal.pipelineId);
  const wonStage = stages.find((stage) => stage.isWon);
  if (!wonStage || deal.stageId === wonStage.id) return;
  await deps.dealRepository.moveStage(deal.id, { stageId: wonStage.id, wonAt: new Date().toISOString(), lostAt: null, lossReason: null });
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_stage_changed",
    actorType: "system",
    payload: { fromStageId: deal.stageId, toStageId: wonStage.id, trigger: "proposal_accepted", proposalId: proposal.id, isWon: true },
  });
  if (deps.productAnalytics) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_deal_won", source: "server", tenantId: deal.tenantId, workspaceId: deal.workspaceId });
  }
}
