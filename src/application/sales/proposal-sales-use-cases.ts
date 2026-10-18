import type { Proposal, ProposalItem } from "../../domain/crm/crm.model.js";
import { computeCommercialTotals, evaluateCommercialTerms, type PricingLineInput } from "../../domain/sales/pricing.js";
import { DEFAULT_PROPOSAL_REMINDER_TEMPLATE, DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE } from "../../domain/sales/sales.model.js";
import type { ProposalRepositoryPort } from "../ports/proposal-repository.port.js";
import type { ProposalTemplateRepositoryPort } from "../ports/proposal-template-repository.port.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import { createProposal, type ProposalBuyerEvent, type ProposalUseCaseDeps } from "../crm/proposal-use-cases.js";
import { assertTermsApproved, itemsToPricingLines, requestCommercialApproval, termsFingerprint, winDeal } from "./deal-commercial-use-cases.js";
import { loadCommercialSettings, mustDealInWorkspace, resolveEffectivePolicy, type SalesActor, type SalesEngineDeps } from "./sales-context.js";

export type SalesProposalDeps = SalesEngineDeps & {
  proposalRepository: ProposalRepositoryPort;
  proposalTemplateRepository?: ProposalTemplateRepositoryPort;
  proposal: ProposalUseCaseDeps;
};

export function proposalItemsToLines(items: readonly ProposalItem[]): (PricingLineInput & { productId?: string; variantId?: string })[] {
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    unitCostCents: item.unitCostCents,
    listPriceCents: item.listPriceCents ?? item.unitPriceCents,
    minimumPriceCents: item.minimumPriceCents,
    proposedUnitPriceCents: item.unitPriceCents,
    billingType: item.billingType ?? "one_time",
  }));
}

function addDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Gera a proposta a partir da oportunidade: cliente, itens com snapshot, descontos e totais vêm
 * da negociação (nunca redigitados). Termos fora da política nascem `pending_approval` e já abrem
 * o pedido de aprovação; termos já aprovados nascem `approved`. */
export async function createProposalFromDeal(deps: SalesProposalDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; templateId?: string; title?: string; introduction?: string; validUntil?: string; conditions?: string; notes?: string; terms?: string; justification?: string }): Promise<{ proposal: Proposal; rawToken: string; approvalRequired: boolean }> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  if (deal.status !== "open") throw new Error("DEAL_CLOSED: gere propostas apenas para oportunidades abertas.");
  const template = input.templateId && deps.proposalTemplateRepository ? await deps.proposalTemplateRepository.getById(input.templateId) : undefined;
  if (input.templateId && (!template || template.tenantId !== actor.tenantId || template.workspaceId !== input.workspaceId)) throw new Error(`PROPOSAL_TEMPLATE_NOT_FOUND: modelo "${input.templateId}" não existe.`);
  const dealItems = await deps.dealItemRepository.listByDeal(deal.id);
  const items: ProposalItem[] = dealItems.length > 0
    ? dealItems.map((item) => ({
      productId: item.productId, variantId: item.variantId, description:Object.entries({...item.productContextSnapshot?.options,...item.productContextSnapshot?.attributes}).map(([key,value])=>`${item.productContextSnapshot?.optionLabels?.[key]??key}: ${value}`).join(" · ")||undefined, name: item.productNameSnapshot, quantity: item.quantity, unitPriceCents: item.proposedUnitPriceCents,
      subtotalCents: item.subtotalProposedCents, billingType: item.billingTypeSnapshot, listPriceCents: item.listPriceCentsSnapshot,
      minimumPriceCents: item.minimumPriceCentsSnapshot, unitCostCents: item.unitCostCentsSnapshot,
    }))
    : template?.defaultItems.length ? [...template.defaultItems]
      : deal.valueCents > 0 ? [{ name: deal.title, quantity: 1, unitPriceCents: deal.valueCents, subtotalCents: deal.valueCents }] : [];
  if (items.length === 0) throw new Error("PROPOSAL_CONTEXT_INVALID: adicione produtos ou um valor à oportunidade antes de gerar a proposta.");
  const discountCents = dealItems.length > 0 ? deal.discountCents : 0;
  const lines = proposalItemsToLines(items);
  const policy = await resolveEffectivePolicy(deps, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, userId: deal.ownerUserId ?? actor.userId });
  const evaluation = evaluateCommercialTerms(computeCommercialTotals(lines, { globalDiscountCents: discountCents }), policy);
  const approved = evaluation.requiresApproval ? await deps.approvalRepository.findApproved(deal.id, termsFingerprint(deal.id, lines, discountCents)) : undefined;
  const { proposal, rawToken } = await createProposal(deps.proposal, {
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    dealId: deal.id,
    contactId: deal.contactId,
    title: input.title?.trim() || template?.defaultTitle || deal.title,
    items,
    discountCents,
    currency: deal.currency,
    validUntil: input.validUntil ?? addDays(template?.defaultValidDays ?? 7),
    conditions: input.conditions ?? template?.defaultConditions,
    introduction: input.introduction ?? template?.defaultIntroduction,
    notes: input.notes,
    terms: input.terms ?? template?.defaultTerms,
    createdByUserId: actor.userId,
    initialStatus: !evaluation.requiresApproval ? "draft" : approved ? "approved" : "pending_approval",
  });
  if (evaluation.requiresApproval && !approved && dealItems.length > 0) {
    const request = await requestCommercialApproval(deps, actor, { workspaceId: input.workspaceId, dealId: deal.id, justification: input.justification, proposalId: proposal.id });
    await deps.proposalRepository.appendEvent({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, eventType: "approval_requested", payload: { approvalId: request.id, reasons: request.reasons } });
  }
  return { proposal, rawToken, approvalRequired: evaluation.requiresApproval && !approved };
}

/** Gate de envio (sem bypass pelo frontend): termos fora da política exigem aprovação válida. */
export function proposalApprovalGate(deps: SalesEngineDeps): (proposal: Proposal) => Promise<void> {
  return async (proposal) => {
    const lines = proposalItemsToLines(proposal.items);
    if (lines.length === 0) return;
    if (!proposal.dealId) {
      const policy = await resolveEffectivePolicy(deps, { tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, userId: proposal.createdByUserId });
      if (evaluateCommercialTerms(computeCommercialTotals(lines, { globalDiscountCents: proposal.discountCents }), policy).requiresApproval) {
        throw new Error("COMMERCIAL_APPROVAL_REQUIRED: condição fora da política — vincule a proposta a uma oportunidade e peça aprovação.");
      }
      return;
    }
    const deal = await deps.dealRepository.getById(proposal.dealId);
    if (!deal) return;
    await assertTermsApproved(deps, { deal, lines, globalDiscountCents: proposal.discountCents, actorUserId: proposal.createdByUserId ?? deal.ownerUserId ?? "" });
  };
}

/** Atualiza propostas aguardando aprovação quando o gestor decide (mesmos termos apenas). */
export async function applyApprovalDecisionToProposals(deps: SalesEngineDeps & { proposalRepository?: ProposalRepositoryPort }, input: { tenantId: string; workspaceId: string; dealId: string; termsFingerprint: string; approved: boolean; approvalId: string }): Promise<void> {
  if (!deps.proposalRepository) return;
  const proposals = await deps.proposalRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId, dealId: input.dealId, status: "pending_approval" });
  for (const proposal of proposals) {
    if (termsFingerprint(input.dealId, proposalItemsToLines(proposal.items), proposal.discountCents) !== input.termsFingerprint) continue;
    const updated = await deps.proposalRepository.setStatus(proposal.id, { status: input.approved ? "approved" : "draft" });
    await deps.proposalRepository.appendEvent({ tenantId: updated.tenantId, workspaceId: updated.workspaceId, proposalId: updated.id, eventType: input.approved ? "approved" : "rejected_internally", payload: { approvalId: input.approvalId } });
  }
}

function proposalOwnerUserId(proposal: Proposal, dealOwnerUserId?: string): string | undefined {
  return dealOwnerUserId ?? proposal.sentByUserId ?? proposal.createdByUserId;
}

/** Alertas ao vendedor — só eventos relevantes (primeira abertura, sinal quente, aceite, recusa). */
export function proposalBuyerEventHandler(deps: SalesEngineDeps): (event: ProposalBuyerEvent) => Promise<void> {
  return async ({ type, proposal }) => {
    const deal = proposal.dealId ? await deps.dealRepository.getById(proposal.dealId) : undefined;
    const contact = proposal.contactId && deps.contactRepository ? await deps.contactRepository.getById(proposal.contactId) : undefined;
    const userId = proposalOwnerUserId(proposal, deal?.ownerUserId);
    if (!userId) return;
    const who = contact?.company || contact?.name || "O cliente";
    const label = `${proposal.number ?? "Proposta"}${proposal.version > 1 ? ` v${proposal.version}` : ""}`;
    const copy = {
      first_view: { title: `${who} abriu sua proposta agora`, body: `${label} · ${proposal.title}` },
      hot_view: { title: `${who} abriu a proposta ${proposal.viewCount} vezes`, body: `Sinal de interesse em ${label} — bom momento para um contato.` },
      accepted: { title: `${who} aceitou a proposta`, body: `${label} · finalize a oportunidade como ganha.` },
      declined: { title: `${who} recusou a proposta`, body: `${label}${proposal.rejectionReason ? ` · motivo: ${proposal.rejectionReason}` : ""} — crie nova versão, continue negociando ou marque como perdida.` },
    }[type];
    notifyBestEffort(deps.notification, {
      tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, userId, title: copy.title, body: copy.body,
      sourceType: `proposal_${type}`, sourceId: proposal.id, sourceUrl: deal ? `/workspaces/${proposal.workspaceId}/deals?dealId=${deal.id}` : `/workspaces/${proposal.workspaceId}/proposals`,
    });
  };
}

/** Aceite → padrão B (só sinaliza; o vendedor fecha). Ganho automático só se o tenant configurar. */
export function proposalAcceptanceHandler(deps: SalesEngineDeps & { onDealWon?: (deal: import("../../domain/crm/crm.model.js").Deal) => Promise<void> }): (proposal: Proposal) => Promise<void> {
  return async (proposal) => {
    if (!proposal.dealId) return;
    const deal = await deps.dealRepository.getById(proposal.dealId);
    if (!deal || deal.status !== "open") return;
    const settings = await loadCommercialSettings(deps, deal.tenantId, deal.workspaceId);
    if (!settings.proposalAcceptAutoWin) {
      await deps.timelineEventRepository.record({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType: "deal_proposal_accepted", actorType: "system", payload: { proposalId: proposal.id, version: proposal.version } });
      return;
    }
    const finalValueCents = proposal.totalCents;
    await winDeal(deps, { tenantId: deal.tenantId, userId: deal.ownerUserId ?? "system", role: "owner" }, { workspaceId: deal.workspaceId, dealId: deal.id, proposalId: proposal.id, finalValueCents, comment: "Ganho automático pelo aceite da proposta." });
  };
}

export function renderProposalMessage(template: string, vars: { nome?: string; valor: string; validade?: string; proposal_link: string; numero?: string; vendedor?: string; empresa?: string }): string {
  const rendered = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key];
    return value ?? "";
  });
  return rendered.includes(vars.proposal_link) ? rendered : `${rendered.trim()}\n\n${vars.proposal_link}`;
}

export async function proposalMessageTemplates(deps: SalesEngineDeps, tenantId: string, workspaceId: string): Promise<{ send: string; reminder: string }> {
  const settings = await loadCommercialSettings(deps, tenantId, workspaceId);
  return { send: settings.proposalWhatsappTemplate?.trim() || DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, reminder: settings.proposalReminderTemplate?.trim() || DEFAULT_PROPOSAL_REMINDER_TEMPLATE };
}

const HOUR = 3_600_000;

/** Follow-up automático SEM spam: nunca envia mensagem ao cliente sozinho — cria tarefa/alerta
 * para o vendedor, uma única vez por gatilho (idempotente via `claimFollowUp`). */
export async function runProposalFollowUps(deps: SalesEngineDeps & { proposalRepository: ProposalRepositoryPort }, now: Date = new Date()): Promise<{ tasks: number; reminders: number }> {
  const candidates = await deps.proposalRepository.listFollowUpCandidates({
    sentBefore: new Date(now.getTime() - 24 * HOUR).toISOString(),
    viewedBefore: new Date(now.getTime() - 48 * HOUR).toISOString(),
    expiringUntil: new Date(now.getTime() + 48 * HOUR).toISOString().slice(0, 10),
    limit: 200,
  });
  let tasks = 0;
  let reminders = 0;
  const at = now.toISOString();
  for (const proposal of candidates) {
    const deal = proposal.dealId ? await deps.dealRepository.getById(proposal.dealId) : undefined;
    const owner = proposalOwnerUserId(proposal, deal?.ownerUserId);
    const label = `${proposal.number ?? "Proposta"}${proposal.version > 1 ? ` v${proposal.version}` : ""}`;
    if (proposal.status === "sent" && proposal.sentAt && proposal.sentAt <= new Date(now.getTime() - 24 * HOUR).toISOString() && await deps.proposalRepository.claimFollowUp(proposal.id, "unviewed", at)) {
      if (deps.taskRepository) {
        await deps.taskRepository.create({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, contactId: proposal.contactId, dealId: proposal.dealId, type: "follow_up", title: `Follow-up: ${label} ainda não foi aberta`, dueAt: at, ownerUserId: owner });
        tasks++;
      }
      await deps.proposalRepository.appendEvent({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, eventType: "follow_up_task_created", payload: { kind: "unviewed_24h" } });
    }
    if (proposal.status === "viewed" && proposal.viewedAt && proposal.viewedAt <= new Date(now.getTime() - 48 * HOUR).toISOString() && await deps.proposalRepository.claimFollowUp(proposal.id, "unanswered", at)) {
      if (owner) notifyBestEffort(deps.notification, { tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, userId: owner, title: "Cliente abriu a proposta e ainda não respondeu", body: `${label} · aberta há mais de 48h`, sourceType: "proposal_unanswered", sourceId: proposal.id, sourceUrl: `/workspaces/${proposal.workspaceId}/proposals` });
      reminders++;
    }
    if (proposal.validUntil && proposal.validUntil <= new Date(now.getTime() + 48 * HOUR).toISOString().slice(0, 10) && await deps.proposalRepository.claimFollowUp(proposal.id, "expiry", at)) {
      if (owner) notifyBestEffort(deps.notification, { tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, userId: owner, title: "Proposta perto do vencimento", body: `${label} vence em ${proposal.validUntil.split("-").reverse().join("/")}`, sourceType: "proposal_expiring", sourceId: proposal.id, sourceUrl: `/workspaces/${proposal.workspaceId}/proposals` });
      reminders++;
    }
  }
  return { tasks, reminders };
}

export { itemsToPricingLines };
