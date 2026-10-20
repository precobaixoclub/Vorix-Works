import type { ContactOpenDealsFilter, ContactOpenDealsSummary, DealRepositoryPort, ListDealsFilter, UpdateDealInput } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { evaluateAutomationTrigger, type AutomationUseCaseDeps } from "./automation-use-cases.js";
import type { Deal, DealStageSummary, TimelineEvent } from "../../domain/crm/crm.model.js";
import { recordFirstEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";
import type { SalesEngineDeps } from "../sales/sales-context.js";
import { missingStageRequirements, syncClosureWithStage, type DealClosedHook } from "../sales/deal-commercial-use-cases.js";

export type DealUseCaseDeps = {
  dealRepository: DealRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** Fase 6 — opcional de propósito: quando ausente, `moveDealStage` funciona 100% normalmente
   * sem disparar nenhuma automação (mesmo racional de `InboxUseCaseDeps.aiResponder`). */
  automation?: AutomationUseCaseDeps;
  /** Trial + Product Analytics — integração MÍNIMA (`first_deal_created`, `first_deal_won`). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  /** Sales Engine — quando presente, mover para ganho/perda grava o snapshot de fechamento e
   * etapas com campos obrigatórios são validadas. Ausente = comportamento anterior. */
  sales?: SalesEngineDeps & { onDealWon?: DealClosedHook };
};

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustDealBelongToTenantAndWorkspace(deps: DealUseCaseDeps, dealId: string, tenantId: string, workspaceId: string): Promise<Deal> {
  const deal = await deps.dealRepository.getById(dealId);
  if (!deal || deal.tenantId !== tenantId || deal.workspaceId !== workspaceId) {
    throw new Error(`DEAL_NOT_FOUND: oportunidade "${dealId}" não existe.`);
  }
  return deal;
}

export async function getContactOpenDealsSummary(deps: Pick<DealUseCaseDeps, "dealRepository">, input: ContactOpenDealsFilter): Promise<ContactOpenDealsSummary[]> {
  return deps.dealRepository.summarizeOpenByContact(input);
}

export async function createDeal(deps: DealUseCaseDeps, input: { tenantId: string; workspaceId: string; pipelineId: string; stageId: string; contactId?: string; title: string; valueCents?: number; currency?: string; ownerUserId?: string; teamId?: string; origin?: string; expectedCloseDate?: string; probability?: number; forecastCategory?: Deal["forecastCategory"]; contractMonths?: number; priceBookId?: string; actorUserId?: string }): Promise<Deal> {
  const stage = await deps.pipelineStageRepository.getById(input.stageId);
  if (!stage || stage.pipelineId !== input.pipelineId) {
    throw new Error(`DEAL_STAGE_PIPELINE_MISMATCH: etapa "${input.stageId}" não pertence ao pipeline "${input.pipelineId}".`);
  }
  const { actorUserId, ...createInput } = input;
  const deal = await deps.dealRepository.create(createInput);
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_created",
    actorType: "user",
    actorId: actorUserId,
    payload: { pipelineId: deal.pipelineId, stageId: deal.stageId, origin: deal.origin },
  });
  if (deps.productAnalytics) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_deal_created", source: "server", tenantId: deal.tenantId, workspaceId: deal.workspaceId });
  }
  if (deps.automation) {
    const contact = deal.contactId ? await deps.automation.contactRepository.getById(deal.contactId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, trigger: "deal_created", deal, contact });
  }
  return deal;
}

export async function listDeals(deps: DealUseCaseDeps, filter: ListDealsFilter): Promise<Deal[]> {
  return deps.dealRepository.listByWorkspace(filter);
}

export async function getDealsSummary(deps: DealUseCaseDeps, filter: Omit<ListDealsFilter, "cursor" | "limit" | "stageId"> & { pipelineId: string }): Promise<DealStageSummary[]> {
  return deps.dealRepository.summaryByPipeline(filter);
}

export async function getDeal(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string }): Promise<Deal> {
  return mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
}

const AUDITED_DEAL_FIELDS = ["title", "valueCents", "currency", "ownerUserId", "teamId", "contactId", "origin", "expectedCloseDate"] as const;

export async function updateDeal(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; patch: UpdateDealInput; actorUserId?: string }): Promise<Deal> {
  const existing = await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  if (existing.status !== "open" && input.patch.valueCents !== undefined && input.patch.valueCents !== existing.valueCents) {
    throw new Error("DEAL_CLOSED: o valor de uma oportunidade fechada é o snapshot do fechamento — reabra para alterar.");
  }
  if (existing.valueMode === "calculated" && input.patch.valueCents !== undefined && input.patch.valueCents !== existing.valueCents) {
    throw new Error("DEAL_VALUE_CALCULATED: no modo calculado o valor vem dos produtos — mude para manual para informar o valor.");
  }
  const updated = await deps.dealRepository.update(input.dealId, input.patch);
  // Auditoria comercial: toda alteração relevante (inclusive troca de responsável) fica na timeline.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of AUDITED_DEAL_FIELDS) {
    if (existing[key] !== updated[key]) changes[key] = { from: existing[key] ?? null, to: updated[key] ?? null };
  }
  if (Object.keys(changes).length > 0) {
    await deps.timelineEventRepository.record({
      tenantId: updated.tenantId,
      workspaceId: updated.workspaceId,
      entityType: "deal",
      entityId: updated.id,
      eventType: changes.ownerUserId ? "deal_owner_changed" : "deal_updated",
      actorType: "user",
      actorId: input.actorUserId,
      payload: { changes },
    });
  }
  return updated;
}

/**
 * Move um negócio de etapa — ÚNICO caminho pra mudar `stageId` (nunca via `updateDeal`), o que
 * mantém a Timeline (`deal_stage_changed`) como registro completo de todo movimento no Kanban.
 * Mover pra uma etapa `isLost` exige `lossReason` (auditoria, seção "nunca perdido silenciosamente");
 * mover pra uma etapa aberta comum limpa `wonAt`/`lostAt`/`lossReason` — reabrir é permitido.
 */
export async function moveDealStage(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; targetStageId: string; lossReason?: string; lossComment?: string; actorUserId?: string }): Promise<Deal> {
  const deal = await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  const targetStage = await deps.pipelineStageRepository.getById(input.targetStageId);
  if (!targetStage || targetStage.pipelineId !== deal.pipelineId) {
    throw new Error(`DEAL_STAGE_PIPELINE_MISMATCH: etapa "${input.targetStageId}" não pertence ao pipeline desta oportunidade.`);
  }
  if (targetStage.isLost && !input.lossReason?.trim()) {
    throw new Error("DEAL_LOSS_REASON_REQUIRED: informe o motivo da perda para mover uma oportunidade para uma etapa de perda.");
  }
  if (deps.sales && targetStage.requiredFields.length > 0 && targetStage.id !== deal.stageId) {
    const [items, fields] = await Promise.all([
      deps.sales.dealItemRepository.listByDeal(deal.id),
      deps.sales.salesConfigRepository.listCustomFields({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, includeInactive: true }),
    ]);
    const missing = missingStageRequirements(deal, items.length, targetStage, new Map(fields.map((field) => [field.key, field.label])));
    if (missing.length > 0) throw new Error(`DEAL_STAGE_REQUIREMENTS_MISSING: para entrar em "${targetStage.name}" preencha: ${missing.join(", ")}.`);
  }
  if (deps.sales && targetStage.isWon && deal.status !== "won" && !(deal.valueCents > 0)) {
    throw new Error("DEAL_FINAL_VALUE_REQUIRED: informe o valor da oportunidade antes de marcá-la como ganha.");
  }
  const now = new Date().toISOString();
  const moved = await deps.dealRepository.moveStage(input.dealId, {
    stageId: input.targetStageId,
    lossReason: targetStage.isLost ? (input.lossReason as string).trim() : null,
    wonAt: targetStage.isWon ? now : null,
    lostAt: targetStage.isLost ? now : null,
  });
  const updated = deps.sales ? await syncClosureWithStage(deps.sales, moved, targetStage, input.actorUserId, input.lossReason?.trim(), input.lossComment?.trim()) : moved;
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_stage_changed",
    actorType: "user",
    actorId: input.actorUserId,
    payload: { fromStageId: deal.stageId, toStageId: input.targetStageId, lossReason: targetStage.isLost ? input.lossReason : undefined, isWon: targetStage.isWon, isLost: targetStage.isLost },
  });
  if (deps.automation) {
    const contact = deal.contactId ? await deps.automation.contactRepository.getById(deal.contactId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, trigger: "deal_stage_changed", deal: updated, contact });
  }
  if (deps.productAnalytics && targetStage.isWon) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_deal_won", source: "server", tenantId: deal.tenantId, workspaceId: deal.workspaceId });
  }
  return updated;
}

export async function getDealTimeline(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; limit?: number }): Promise<TimelineEvent[]> {
  await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  return deps.timelineEventRepository.listByEntity({ entityType: "deal", entityId: input.dealId, limit: input.limit });
}
