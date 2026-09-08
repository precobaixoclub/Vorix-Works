import type { DealRepositoryPort, ListDealsFilter, UpdateDealInput } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { evaluateAutomationTrigger, type AutomationUseCaseDeps } from "./automation-use-cases.js";
import type { Deal, DealStageSummary, TimelineEvent } from "../../domain/crm/crm.model.js";

export type DealUseCaseDeps = {
  dealRepository: DealRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** Fase 6 — opcional de propósito: quando ausente, `moveDealStage` funciona 100% normalmente
   * sem disparar nenhuma automação (mesmo racional de `InboxUseCaseDeps.aiResponder`). */
  automation?: AutomationUseCaseDeps;
};

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustDealBelongToTenantAndWorkspace(deps: DealUseCaseDeps, dealId: string, tenantId: string, workspaceId: string): Promise<Deal> {
  const deal = await deps.dealRepository.getById(dealId);
  if (!deal || deal.tenantId !== tenantId || deal.workspaceId !== workspaceId) {
    throw new Error(`DEAL_NOT_FOUND: negócio "${dealId}" não existe.`);
  }
  return deal;
}

export async function createDeal(deps: DealUseCaseDeps, input: { tenantId: string; workspaceId: string; pipelineId: string; stageId: string; contactId?: string; title: string; valueCents?: number; currency?: string; ownerUserId?: string; teamId?: string; origin?: string; expectedCloseDate?: string }): Promise<Deal> {
  const stage = await deps.pipelineStageRepository.getById(input.stageId);
  if (!stage || stage.pipelineId !== input.pipelineId) {
    throw new Error(`DEAL_STAGE_PIPELINE_MISMATCH: etapa "${input.stageId}" não pertence ao pipeline "${input.pipelineId}".`);
  }
  const deal = await deps.dealRepository.create(input);
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_created",
    actorType: "user",
    payload: { pipelineId: deal.pipelineId, stageId: deal.stageId, origin: deal.origin },
  });
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

export async function updateDeal(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; patch: UpdateDealInput }): Promise<Deal> {
  await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  return deps.dealRepository.update(input.dealId, input.patch);
}

/**
 * Move um negócio de etapa — ÚNICO caminho pra mudar `stageId` (nunca via `updateDeal`), o que
 * mantém a Timeline (`deal_stage_changed`) como registro completo de todo movimento no Kanban.
 * Mover pra uma etapa `isLost` exige `lossReason` (auditoria, seção "nunca perdido silenciosamente");
 * mover pra uma etapa aberta comum limpa `wonAt`/`lostAt`/`lossReason` — reabrir é permitido.
 */
export async function moveDealStage(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; targetStageId: string; lossReason?: string }): Promise<Deal> {
  const deal = await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  const targetStage = await deps.pipelineStageRepository.getById(input.targetStageId);
  if (!targetStage || targetStage.pipelineId !== deal.pipelineId) {
    throw new Error(`DEAL_STAGE_PIPELINE_MISMATCH: etapa "${input.targetStageId}" não pertence ao pipeline deste negócio.`);
  }
  if (targetStage.isLost && !input.lossReason?.trim()) {
    throw new Error("DEAL_LOSS_REASON_REQUIRED: informe o motivo da perda para mover um negócio para uma etapa de perda.");
  }
  const now = new Date().toISOString();
  const updated = await deps.dealRepository.moveStage(input.dealId, {
    stageId: input.targetStageId,
    lossReason: targetStage.isLost ? (input.lossReason as string).trim() : null,
    wonAt: targetStage.isWon ? now : null,
    lostAt: targetStage.isLost ? now : null,
  });
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_stage_changed",
    actorType: "user",
    payload: { fromStageId: deal.stageId, toStageId: input.targetStageId, lossReason: targetStage.isLost ? input.lossReason : undefined, isWon: targetStage.isWon, isLost: targetStage.isLost },
  });
  if (deps.automation) {
    const contact = deal.contactId ? await deps.automation.contactRepository.getById(deal.contactId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, trigger: "deal_stage_changed", deal: updated, contact });
  }
  return updated;
}

export async function getDealTimeline(deps: DealUseCaseDeps, input: { dealId: string; tenantId: string; workspaceId: string; limit?: number }): Promise<TimelineEvent[]> {
  await mustDealBelongToTenantAndWorkspace(deps, input.dealId, input.tenantId, input.workspaceId);
  return deps.timelineEventRepository.listByEntity({ entityType: "deal", entityId: input.dealId, limit: input.limit });
}
