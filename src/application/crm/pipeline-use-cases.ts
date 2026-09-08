import type { PipelineRepositoryPort, PipelineStageRepositoryPort, UpdateStageInput } from "../ports/pipeline-repository.port.js";
import type { Pipeline, PipelineStage } from "../../domain/crm/crm.model.js";

export type PipelineUseCaseDeps = {
  pipelineRepository: PipelineRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
};

/** Etapas padrão de um pipeline recém-criado — vocabulário comum de vendas em português, editável
 * depois pelo usuário (nunca hardcoded na leitura, só no bootstrap inicial). */
const DEFAULT_STAGE_NAMES: ReadonlyArray<{ name: string; isWon: boolean; isLost: boolean }> = [
  { name: "Novo", isWon: false, isLost: false },
  { name: "Contato Feito", isWon: false, isLost: false },
  { name: "Proposta Enviada", isWon: false, isLost: false },
  { name: "Negociação", isWon: false, isLost: false },
  { name: "Ganho", isWon: true, isLost: false },
  { name: "Perdido", isWon: false, isLost: true },
];

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

/**
 * Cria (ou retorna) o pipeline padrão do workspace, sob demanda — nunca semeado por migration
 * (multi-tenant). O índice único parcial em `pipelines` protege contra dois pipelines padrão sob
 * concorrência; se a criação colidir com uma já concluída em paralelo, apenas relemos a existente.
 */
export async function ensureDefaultPipeline(deps: PipelineUseCaseDeps, tenantId: string, workspaceId: string): Promise<{ pipeline: Pipeline; stages: PipelineStage[] }> {
  const existing = await deps.pipelineRepository.getDefaultForWorkspace(tenantId, workspaceId);
  if (existing) {
    return { pipeline: existing, stages: await deps.pipelineStageRepository.listByPipeline(existing.id) };
  }
  let pipeline: Pipeline;
  try {
    pipeline = await deps.pipelineRepository.create({ tenantId, workspaceId, name: "Pipeline Padrão", isDefault: true });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raceWinner = await deps.pipelineRepository.getDefaultForWorkspace(tenantId, workspaceId);
    if (!raceWinner) throw error;
    return { pipeline: raceWinner, stages: await deps.pipelineStageRepository.listByPipeline(raceWinner.id) };
  }
  const stages: PipelineStage[] = [];
  for (const [position, def] of DEFAULT_STAGE_NAMES.entries()) {
    stages.push(await deps.pipelineStageRepository.create({ pipelineId: pipeline.id, name: def.name, position, isWon: def.isWon, isLost: def.isLost }));
  }
  return { pipeline, stages };
}

export async function listPipelines(deps: PipelineUseCaseDeps, tenantId: string, workspaceId: string): Promise<Pipeline[]> {
  await ensureDefaultPipeline(deps, tenantId, workspaceId);
  return deps.pipelineRepository.listByWorkspace(tenantId, workspaceId);
}

/** Guard de tenant/workspace — nunca 403, sempre 404 (mesmo padrão de `mustContactBelongTo...`). */
export async function mustPipelineBelongToTenantAndWorkspace(deps: PipelineUseCaseDeps, pipelineId: string, tenantId: string, workspaceId: string): Promise<Pipeline> {
  const pipeline = await deps.pipelineRepository.getById(pipelineId);
  if (!pipeline || pipeline.tenantId !== tenantId || pipeline.workspaceId !== workspaceId) {
    throw new Error(`PIPELINE_NOT_FOUND: pipeline "${pipelineId}" não existe.`);
  }
  return pipeline;
}

export async function mustStageBelongToPipeline(deps: PipelineUseCaseDeps, stageId: string, pipelineId: string): Promise<PipelineStage> {
  const stage = await deps.pipelineStageRepository.getById(stageId);
  if (!stage || stage.pipelineId !== pipelineId) {
    throw new Error(`PIPELINE_STAGE_NOT_FOUND: etapa "${stageId}" não existe neste pipeline.`);
  }
  return stage;
}

export async function createPipeline(deps: PipelineUseCaseDeps, input: { tenantId: string; workspaceId: string; name: string }): Promise<Pipeline> {
  return deps.pipelineRepository.create(input);
}

export async function listStages(deps: PipelineUseCaseDeps, input: { pipelineId: string; tenantId: string; workspaceId: string }): Promise<PipelineStage[]> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  return deps.pipelineStageRepository.listByPipeline(input.pipelineId);
}

export async function createStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; tenantId: string; workspaceId: string; name: string; position: number; isWon?: boolean; isLost?: boolean }): Promise<PipelineStage> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  return deps.pipelineStageRepository.create(input);
}

export async function updateStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; stageId: string; tenantId: string; workspaceId: string; patch: UpdateStageInput }): Promise<PipelineStage> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  await mustStageBelongToPipeline(deps, input.stageId, input.pipelineId);
  return deps.pipelineStageRepository.update(input.stageId, input.patch);
}

export async function deleteStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; stageId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  await mustStageBelongToPipeline(deps, input.stageId, input.pipelineId);
  await deps.pipelineStageRepository.delete(input.stageId);
}
