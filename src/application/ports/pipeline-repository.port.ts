import type { Pipeline, PipelineStage } from "../../domain/crm/crm.model.js";

export type CreatePipelineInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  teamId?: string;
  isDefault?: boolean;
};

export type CreateStageInput = {
  pipelineId: string;
  name: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
  probability?: number | null;
  staleAfterDays?: number | null;
  requiredFields?: readonly string[];
};

export type UpdateStageInput = Partial<Omit<CreateStageInput, "pipelineId">>;

export type PipelineRepositoryPort = {
  create(input: CreatePipelineInput, initialStages?: readonly Omit<CreateStageInput, "pipelineId">[]): Promise<Pipeline>;
  getById(id: string): Promise<Pipeline | undefined>;
  listByWorkspace(tenantId: string, workspaceId: string): Promise<Pipeline[]>;
  getDefaultForWorkspace(tenantId: string, workspaceId: string): Promise<Pipeline | undefined>;
};

export type PipelineStageRepositoryPort = {
  create(input: CreateStageInput): Promise<PipelineStage>;
  getById(id: string): Promise<PipelineStage | undefined>;
  listByPipeline(pipelineId: string): Promise<PipelineStage[]>;
  update(id: string, input: UpdateStageInput): Promise<PipelineStage>;
  delete(id: string): Promise<void>;
  reorder(pipelineId: string, stageIds: readonly string[]): Promise<void>;
};
