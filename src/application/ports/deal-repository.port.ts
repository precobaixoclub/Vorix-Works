import type { Deal, DealStageSummary, DealStatus, DealValueMode, ForecastCategory } from "../../domain/crm/crm.model.js";
import type { RecordTimelineEventInput } from "./timeline-event-repository.port.js";

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
  valueMode?: DealValueMode;
  probability?: number;
  forecastCategory?: ForecastCategory;
  priceBookId?: string;
  discountCents?: number;
  contractMonths?: number;
  customFields?: Record<string, unknown>;
};

/** Campos "normais" (título/valor/dono/...). Mudança de etapa é sempre via `moveStage`, nunca por
 * aqui — mantém a auditoria da Timeline (`deal_stage_changed`) como única fonte de verdade. */
export type UpdateDealInput = Partial<Omit<CreateDealInput, "tenantId" | "workspaceId" | "pipelineId" | "stageId" | "probability" | "priceBookId" | "contractMonths" | "expectedCloseDate" | "ownerUserId" | "teamId" | "contactId">> & {
  /** `null` limpa o campo (volta ao padrão da etapa / sem tabela / sem contrato). */
  probability?: number | null;
  priceBookId?: string | null;
  contractMonths?: number | null;
  expectedCloseDate?: string | null;
  ownerUserId?: string | null;
  teamId?: string | null;
  contactId?: string | null;
};

/** Fechamento (ganho/perda/cancelamento) ou reabertura — `null` limpa o snapshot. */
export type DealClosureInput = {
  /** Compare-and-set prevents concurrent requests from closing/crediting a sale twice. */
  expectedStatus?: DealStatus;
  expectedUpdatedAt?: string;
  auditEvents?: readonly Pick<RecordTimelineEventInput, "eventType" | "actorType" | "actorId" | "payload">[];
  stageId?: string;
  closureSource?: string;
  lossReasonId?: string | null;
  reopenedByUserId?: string;
  status: DealStatus;
  forecastCategory: ForecastCategory;
  closedAt: string | null;
  closedByUserId: string | null;
  creditedOwnerUserId: string | null;
  creditedTeamId: string | null;
  wonReason: string | null;
  lossReason: string | null;
  closeComment: string | null;
  competitorId: string | null;
  wonProposalId: string | null;
  finalValueCents: number | null;
  finalCostCents: number | null;
  finalGrossProfitCents: number | null;
  finalMarginBp: number | null;
  finalMrrCents: number | null;
  finalArrCents: number | null;
  finalTcvCents: number | null;
  finalSnapshot: Record<string, unknown> | null;
};

export type MoveDealStageInput = {
  expectedStatus?: DealStatus;
  expectedUpdatedAt?: string;
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
  status?: DealStatus;
  boardView?: "operational" | "open" | "won" | "lost" | "closed" | "archived" | "all";
  /** Visibilidade (`own`/`team`): restringe a estes responsáveis. Lista vazia = nenhum resultado. */
  ownUserId?: string;
  ownerUserIdsIn?: readonly string[];
  teamIdsIn?: readonly string[];
};

export type ContactOpenDealsSummary = { contactId: string; currency: string; count: number; valueCentsSum: number };
export type ContactOpenDealsFilter = Pick<ListDealsFilter, "tenantId" | "workspaceId" | "ownUserId" | "ownerUserIdsIn" | "teamIdsIn">;

export type DealRepositoryPort = {
  create(input: CreateDealInput): Promise<Deal>;
  getById(id: string): Promise<Deal | undefined>;
  listByWorkspace(filter: ListDealsFilter): Promise<Deal[]>;
  /** Agrega todas as oportunidades abertas, sem o limite de paginação da listagem. */
  summarizeOpenByContact(filter: ContactOpenDealsFilter): Promise<ContactOpenDealsSummary[]>;
  update(id: string, input: UpdateDealInput): Promise<Deal>;
  moveStage(id: string, input: MoveDealStageInput): Promise<Deal>;
  /** Valor recalculado pelos itens (modo `calculated`) — nunca usado para valor manual. */
  setValue(id: string, valueCents: number): Promise<Deal>;
  setClosure(id: string, input: DealClosureInput): Promise<Deal>;
  setArchived(input: { id: string; tenantId: string; workspaceId: string; archived: boolean; actorUserId: string }): Promise<Deal>;
  archiveDueClosedDeals(scope?: { tenantId: string; workspaceId: string }): Promise<number>;
  /** Oportunidades abertas do mesmo contato/pipeline — aviso de duplicidade (nunca bloqueio). */
  findOpenSimilar(input: { tenantId: string; workspaceId: string; contactId?: string; pipelineId: string; title: string; limit?: number }): Promise<Deal[]>;
  summaryByPipeline(filter: Omit<ListDealsFilter, "cursor" | "limit" | "stageId"> & { pipelineId: string }): Promise<DealStageSummary[]>;
};
