import { createHash, randomBytes } from "node:crypto";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { ProposalRepositoryPort, UpdateProposalInput } from "../ports/proposal-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { evaluateAutomationTrigger, type AutomationUseCaseDeps } from "./automation-use-cases.js";
import type { Proposal, ProposalItem } from "../../domain/crm/crm.model.js";

export type ProposalUseCaseDeps = {
  proposalRepository: ProposalRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** Fase 6 — opcional de propósito, mesmo racional de `DealUseCaseDeps.automation`. Dispara
   * `proposal_accepted`/`proposal_rejected` a partir de `respondToPublicProposal`. */
  automation?: AutomationUseCaseDeps;
};

/** Deps do lado "negócio ganho ao aceitar a proposta" — bounded context ainda `crm`, então
 * importar `deal-repository.port`/`pipeline-repository.port` aqui não viola isolamento (ver
 * `scripts/check-crm-isolation.mjs`, que só separa `crm` de `inbox`/`instagram-dm`). */
export type ProposalDealLinkDeps = {
  dealRepository: DealRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
};

function generateProposalToken(): string {
  return randomBytes(32).toString("hex");
}

function hashProposalToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function computeItemsAndTotal(items: readonly ProposalItem[], discountCents: number): { items: ProposalItem[]; totalCents: number } {
  const normalized = items.map((item) => ({
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    subtotalCents: item.quantity * item.unitPriceCents,
  }));
  const subtotal = normalized.reduce((sum, item) => sum + item.subtotalCents, 0);
  const totalCents = Math.max(0, subtotal - discountCents);
  return { items: normalized, totalCents };
}

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustProposalBelongToTenantAndWorkspace(deps: ProposalUseCaseDeps, proposalId: string, tenantId: string, workspaceId: string): Promise<Proposal> {
  const proposal = await deps.proposalRepository.getById(proposalId);
  if (!proposal || proposal.tenantId !== tenantId || proposal.workspaceId !== workspaceId) {
    throw new Error(`PROPOSAL_NOT_FOUND: proposta "${proposalId}" não existe.`);
  }
  return proposal;
}

export async function createProposal(deps: ProposalUseCaseDeps, input: { tenantId: string; workspaceId: string; dealId?: string; contactId?: string; title: string; items: readonly ProposalItem[]; discountCents?: number; currency?: string; validUntil?: string; conditions?: string }): Promise<{ proposal: Proposal; rawToken: string }> {
  const discountCents = input.discountCents ?? 0;
  const { items, totalCents } = computeItemsAndTotal(input.items, discountCents);
  const rawToken = generateProposalToken();
  const proposal = await deps.proposalRepository.create({ ...input, items, discountCents, totalCents, publicTokenHash: hashProposalToken(rawToken) });
  await deps.timelineEventRepository.record({
    tenantId: proposal.tenantId,
    workspaceId: proposal.workspaceId,
    entityType: "proposal",
    entityId: proposal.id,
    eventType: "proposal_created",
    actorType: "user",
    payload: { dealId: proposal.dealId, totalCents: proposal.totalCents },
  });
  return { proposal, rawToken };
}

export async function listProposals(deps: ProposalUseCaseDeps, input: { tenantId: string; workspaceId: string; dealId?: string; contactId?: string }): Promise<Proposal[]> {
  return deps.proposalRepository.listByWorkspace(input);
}

export async function getProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<Proposal> {
  return mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
}

/** Só é possível editar uma proposta ainda em rascunho — depois de enviada, o conteúdo já pode
 * ter sido visto pelo lead; mudar silenciosamente quebraria a confiança do link público. */
export async function updateProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string; patch: Omit<UpdateProposalInput, "items" | "discountCents" | "totalCents"> & { items?: readonly ProposalItem[]; discountCents?: number } }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (existing.status !== "draft") {
    throw new Error("PROPOSAL_NOT_EDITABLE: só é possível editar uma proposta em rascunho.");
  }
  const items = input.patch.items ?? existing.items;
  const discountCents = input.patch.discountCents ?? existing.discountCents;
  const { items: normalizedItems, totalCents } = computeItemsAndTotal(items, discountCents);
  return deps.proposalRepository.update(input.proposalId, { ...input.patch, items: normalizedItems, discountCents, totalCents });
}

export async function sendProposal(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<Proposal> {
  const existing = await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  if (existing.status !== "draft") {
    throw new Error("PROPOSAL_ALREADY_SENT: esta proposta já foi enviada.");
  }
  const proposal = await deps.proposalRepository.setStatus(input.proposalId, { status: "sent", sentAt: new Date().toISOString() });
  await deps.timelineEventRepository.record({
    tenantId: proposal.tenantId,
    workspaceId: proposal.workspaceId,
    entityType: "proposal",
    entityId: proposal.id,
    eventType: "proposal_sent",
    actorType: "user",
    payload: {},
  });
  return proposal;
}

export async function getProposalTimeline(deps: ProposalUseCaseDeps, input: { proposalId: string; tenantId: string; workspaceId: string }) {
  await mustProposalBelongToTenantAndWorkspace(deps, input.proposalId, input.tenantId, input.workspaceId);
  return deps.timelineEventRepository.listByEntity({ entityType: "proposal", entityId: input.proposalId });
}

// -------------------------------------------------------------------------------------------
// Acesso público (`/p/:token`) — o token É a autenticação, nunca escopado por tenant/workspace.
// -------------------------------------------------------------------------------------------

function isExpired(proposal: Proposal): boolean {
  return Boolean(proposal.validUntil) && new Date(proposal.validUntil as string) < new Date();
}

/** Busca por token bruto (o link público) — se a proposta passou da validade, transiciona pra
 * `expired` na leitura (não há job agendado nesta fase; a expiração é lida sob demanda). Marca
 * `viewed` na primeira leitura pública, sinal real de que o lead abriu o link. */
export async function getPublicProposal(deps: ProposalUseCaseDeps, rawToken: string): Promise<Proposal> {
  const proposal = await deps.proposalRepository.getByTokenHash(hashProposalToken(rawToken));
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND: link inválido.");
  if (isExpired(proposal) && proposal.status !== "expired" && proposal.status !== "accepted" && proposal.status !== "rejected") {
    return deps.proposalRepository.setStatus(proposal.id, { status: "expired" });
  }
  if (proposal.status === "sent") {
    const viewed = await deps.proposalRepository.setStatus(proposal.id, { status: "viewed", viewedAt: new Date().toISOString() });
    await deps.timelineEventRepository.record({
      tenantId: viewed.tenantId,
      workspaceId: viewed.workspaceId,
      entityType: "proposal",
      entityId: viewed.id,
      eventType: "proposal_viewed",
      actorType: "system",
      payload: {},
    });
    return viewed;
  }
  return proposal;
}

async function respondToPublicProposal(deps: ProposalUseCaseDeps, rawToken: string, decision: "accepted" | "rejected"): Promise<Proposal> {
  const proposal = await deps.proposalRepository.getByTokenHash(hashProposalToken(rawToken));
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND: link inválido.");
  if (isExpired(proposal)) throw new Error("PROPOSAL_EXPIRED: esta proposta expirou.");
  if (proposal.status !== "sent" && proposal.status !== "viewed") {
    throw new Error(`PROPOSAL_ALREADY_RESPONDED: esta proposta já está com status "${proposal.status}".`);
  }
  const updated = await deps.proposalRepository.setStatus(proposal.id, { status: decision, respondedAt: new Date().toISOString() });
  await deps.timelineEventRepository.record({
    tenantId: updated.tenantId,
    workspaceId: updated.workspaceId,
    entityType: "proposal",
    entityId: updated.id,
    eventType: decision === "accepted" ? "proposal_accepted" : "proposal_rejected",
    actorType: "system",
    payload: {},
  });
  if (deps.automation) {
    const contact = updated.contactId ? await deps.automation.contactRepository.getById(updated.contactId) : undefined;
    const deal = updated.dealId ? await deps.automation.dealRepository.getById(updated.dealId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: updated.tenantId, workspaceId: updated.workspaceId, trigger: decision === "accepted" ? "proposal_accepted" : "proposal_rejected", contact, deal });
  }
  return updated;
}

export async function acceptPublicProposal(deps: ProposalUseCaseDeps, rawToken: string): Promise<Proposal> {
  return respondToPublicProposal(deps, rawToken, "accepted");
}

export async function rejectPublicProposal(deps: ProposalUseCaseDeps, rawToken: string): Promise<Proposal> {
  return respondToPublicProposal(deps, rawToken, "rejected");
}

/**
 * Ao aceitar uma proposta ligada a um negócio, move o negócio pra etapa de Ganho do MESMO
 * pipeline (se existir uma) — reação determinística a uma ação do lead, não uma decisão de IA
 * (nunca viola "IA nunca altera operações comerciais sem autorização"). Silenciosamente não faz
 * nada se não houver negócio ligado, ou se o pipeline dele não tiver etapa de Ganho configurada,
 * ou se o negócio já estiver nela. `actorType: "system"` na Timeline distingue isso de uma
 * movimentação manual feita por um usuário.
 */
export async function applyProposalAcceptanceToDeal(deps: ProposalDealLinkDeps, proposal: Proposal): Promise<void> {
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
}
