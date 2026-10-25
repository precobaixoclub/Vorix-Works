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
  { name: "Ganha", isWon: true, isLost: false },
  { name: "Perdida", isWon: false, isLost: true },
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
    pipeline = await deps.pipelineRepository.create({ tenantId, workspaceId, name: "Pipeline Padrão", isDefault: true }, DEFAULT_STAGE_NAMES.map((def, position) => ({ ...def, position })));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raceWinner = await deps.pipelineRepository.getDefaultForWorkspace(tenantId, workspaceId);
    if (!raceWinner) throw error;
    return { pipeline: raceWinner, stages: await deps.pipelineStageRepository.listByPipeline(raceWinner.id) };
  }
  const stages = await deps.pipelineStageRepository.listByPipeline(pipeline.id);
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

export async function createPipeline(deps: PipelineUseCaseDeps, input: { tenantId: string; workspaceId: string; name: string; teamId?: string }): Promise<Pipeline> {
  return deps.pipelineRepository.create(input, DEFAULT_STAGE_NAMES.map((def, position) => ({ ...def, position })));
}

export async function listStages(deps: PipelineUseCaseDeps, input: { pipelineId: string; tenantId: string; workspaceId: string }): Promise<PipelineStage[]> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  return deps.pipelineStageRepository.listByPipeline(input.pipelineId);
}

export async function createStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; tenantId: string; workspaceId: string; name: string; position: number; isWon?: boolean; isLost?: boolean; probability?: number | null; staleAfterDays?: number | null; requiredFields?: readonly string[] }): Promise<PipelineStage> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  if (input.isWon || input.isLost) throw new Error("PIPELINE_STAGE_INVALID: Ganha e Perdida já são fases sistêmicas deste funil. Crie uma fase em andamento.");
  return deps.pipelineStageRepository.create(input);
}

export async function updateStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; stageId: string; tenantId: string; workspaceId: string; patch: UpdateStageInput }): Promise<PipelineStage> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  const stage = await mustStageBelongToPipeline(deps, input.stageId, input.pipelineId);
  if ((input.patch.isWon !== undefined && input.patch.isWon !== stage.isWon) || (input.patch.isLost !== undefined && input.patch.isLost !== stage.isLost)) {
    throw new Error("PIPELINE_STAGE_INVALID: o resultado comercial de uma fase sistêmica não pode ser alterado.");
  }
  if (input.patch.position !== undefined && input.patch.position !== stage.position) throw new Error("PIPELINE_STAGE_INVALID: use a reordenação de fases para alterar a posição.");
  return deps.pipelineStageRepository.update(input.stageId, input.patch);
}

export async function deleteStage(deps: PipelineUseCaseDeps, input: { pipelineId: string; stageId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  const stage = await mustStageBelongToPipeline(deps, input.stageId, input.pipelineId);
  if (stage.isWon || stage.isLost) throw new Error("PIPELINE_STAGE_INVALID: fase sistêmica de encerramento. Não pode ser removida.");
  const stages = await deps.pipelineStageRepository.listByPipeline(input.pipelineId);
  if (stages.filter(s => !s.isWon && !s.isLost).length <= 1) throw new Error("PIPELINE_STAGE_INVALID: mantenha pelo menos uma fase em andamento no funil.");
  await deps.pipelineStageRepository.delete(input.stageId);
}

export async function reorderStages(deps: PipelineUseCaseDeps, input: { pipelineId: string; tenantId: string; workspaceId: string; stageIds: readonly string[] }): Promise<void> {
  await mustPipelineBelongToTenantAndWorkspace(deps, input.pipelineId, input.tenantId, input.workspaceId);
  const stages = await deps.pipelineStageRepository.listByPipeline(input.pipelineId);
  const won = stages.find(s => s.isWon);
  const lost = stages.find(s => s.isLost);
  if (!won || !lost || input.stageIds.at(-2) !== won.id || input.stageIds.at(-1) !== lost.id) {
    throw new Error("PIPELINE_STAGE_INVALID: Ganha e Perdida devem permanecer no final do funil, nessa ordem.");
  }
  await deps.pipelineStageRepository.reorder(input.pipelineId, input.stageIds);
}
