import type { Pipeline, PipelineStage } from "../../domain/crm/crm.model.js";

export type CreatePipelineInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  isDefault?: boolean;
};

export type CreateStageInput = {
  pipelineId: string;
  name: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
};

export type UpdateStageInput = Partial<Omit<CreateStageInput, "pipelineId">>;

export type PipelineRepositoryPort = {
  create(input: CreatePipelineInput): Promise<Pipeline>;
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
};
