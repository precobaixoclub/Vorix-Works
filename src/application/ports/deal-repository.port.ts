import type { Deal, DealStageSummary } from "../../domain/crm/crm.model.js";

export type CreateDealInput = {
  tenantId: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  title: string;
  valueCents?: number;
  currency?: string;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  expectedCloseDate?: string;
};

/** Campos "normais" (título/valor/dono/...). Mudança de etapa é sempre via `moveStage`, nunca por
 * aqui — mantém a auditoria da Timeline (`deal_stage_changed`) como única fonte de verdade. */
export type UpdateDealInput = Partial<Omit<CreateDealInput, "tenantId" | "workspaceId" | "pipelineId" | "stageId">>;

export type MoveDealStageInput = {
  stageId: string;
  lossReason?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
};

export type ListDealsFilter = {
  tenantId: string;
  workspaceId: string;
  pipelineId?: string;
  stageId?: string;
  contactId?: string;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  search?: string;
  cursor?: string;
  limit?: number;
};

export type DealRepositoryPort = {
  create(input: CreateDealInput): Promise<Deal>;
  getById(id: string): Promise<Deal | undefined>;
  listByWorkspace(filter: ListDealsFilter): Promise<Deal[]>;
  update(id: string, input: UpdateDealInput): Promise<Deal>;
  moveStage(id: string, input: MoveDealStageInput): Promise<Deal>;
  summaryByPipeline(filter: Omit<ListDealsFilter, "cursor" | "limit" | "stageId"> & { pipelineId: string }): Promise<DealStageSummary[]>;
};
