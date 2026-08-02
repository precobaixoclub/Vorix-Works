import { projectExecutionGraph } from "../../domain/planning/graph-projection.js";
import type { Planning } from "../../domain/planning/planning.model.js";
import type { RuntimePlan, RuntimeValidationReport } from "../../domain/runtime/runtime.model.js";
import type { ExecutionGraphRepositoryPort } from "../ports/execution-graph-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../ports/execution-task-repository.port.js";
import type { PlanningArtifactRepositoryPort } from "../ports/planning-artifact-repository.port.js";
import type { RuntimeRepositoryPort } from "../ports/runtime-repository.port.js";
import { computeRuntimeFingerprint, computeSourceGraphFingerprint } from "./fingerprints.js";
import { RUNTIME_SCHEMA_VERSION, TRANSLATOR_STRATEGY, TRANSLATOR_VERSION } from "./translation-template.js";
import { translatePlanningToRuntime } from "./translator.js";
import { validateRuntimeTranslation } from "./validation.js";

/**
 * `ensureRuntimeForPlanning` — Sprint 10 (Fase 3, decisão obrigatória 6). Único ponto que recebe
 * um `Planning` "ready" e produz um `RuntimePlan` persistido — nunca executa nada, nunca chama
 * Caio/Helena/Skill/AI Gateway. `Planning -> ValidationReport (Runtime) -> RuntimePlan +
 * RuntimeTask[] + portas + RuntimeBinding[] + RuntimeArtifact[]`.
 */
export type RuntimeEngineDeps = {
  runtimeRepository: RuntimeRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  artifactRepository: PlanningArtifactRepositoryPort;
  idGenerator: () => string;
  now?: () => Date;
};

/** Idempotente (decisão obrigatória 6/7): chamar de novo para o mesmo `planningId` devolve o
 * RuntimePlan já existente, nunca duplica — e nunca re-traduz um que já existe, mesmo que tenha
 * nascido `validation_failed` (imutabilidade, decisão 13). */
export async function ensureRuntimeForPlanning(deps: RuntimeEngineDeps, planning: Planning): Promise<RuntimePlan> {
  const existing = await deps.runtimeRepository.getByPlanningId(planning.id);
  if (existing) return existing;

  const now = deps.now ?? (() => new Date());
  const runtimePlanId = deps.idGenerator();
  const sourceContext = {
    tenantId: planning.tenantId,
    workspaceId: planning.workspaceId,
    conversationId: planning.conversationId,
    briefingId: planning.briefingId,
    preparedCommandId: planning.preparedCommandId,
    planningId: planning.id,
  };

  const [executionTasks, rawGraph, planningArtifacts] = await Promise.all([
    deps.executionTaskRepository.listByPlanning(planning.id),
    deps.executionGraphRepository.getGraph(planning.id),
    deps.artifactRepository.listByPlanning(planning.id),
  ]);
  const graph = projectExecutionGraph(planning, rawGraph.nodes, rawGraph.edges);
  const sourceGraphFingerprint = computeSourceGraphFingerprint(executionTasks, graph);

  const candidate = translatePlanningToRuntime(planning, executionTasks, planningArtifacts, runtimePlanId, { idGenerator: deps.idGenerator, now });

  if (!candidate) {
    const validationReport: RuntimeValidationReport = {
      valid: false,
      issues: [
        {
          code: "no_translation_template_registered",
          message: `Nenhum translation template registrado para planningTemplate="${planning.planningTemplate}".`,
          severity: "error",
        },
      ],
      validatedAt: now().toISOString(),
    };
    return persistFailure(deps, runtimePlanId, sourceContext, planning.planningTemplate, sourceGraphFingerprint, validationReport);
  }

  const validationReport = validateRuntimeTranslation(candidate, graph, now);

  if (!validationReport.valid) {
    return persistFailure(deps, runtimePlanId, sourceContext, candidate.translationTemplate, sourceGraphFingerprint, validationReport);
  }

  const runtimeFingerprint = computeRuntimeFingerprint(candidate);
  const bindings = candidate.bindings.map((binding) => ({
    id: binding.id,
    runtimePlanId,
    fromRuntimeTaskId: binding.fromRuntimeTaskId as string,
    fromOutputPort: binding.fromOutputPort,
    toRuntimeTaskId: binding.toRuntimeTaskId as string,
    toInputPort: binding.toInputPort,
  }));

  return deps.runtimeRepository.persist({
    plan: {
      id: runtimePlanId,
      sourceContext,
      status: "validated",
      runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
      translatorVersion: TRANSLATOR_VERSION,
      translatorStrategy: TRANSLATOR_STRATEGY,
      translationTemplate: candidate.translationTemplate,
      sourceGraphFingerprint,
      runtimeFingerprint,
      validationReport,
    },
    tasks: candidate.tasks,
    outputs: candidate.outputPorts,
    inputs: candidate.inputPorts,
    bindings,
    artifacts: candidate.artifacts,
    issues: validationReport.issues,
  });
}

function persistFailure(
  deps: RuntimeEngineDeps,
  runtimePlanId: string,
  sourceContext: { tenantId: string; workspaceId: string; conversationId: string; briefingId: string; preparedCommandId: string; planningId: string },
  translationTemplate: string,
  sourceGraphFingerprint: string,
  validationReport: RuntimeValidationReport,
): Promise<RuntimePlan> {
  return deps.runtimeRepository.persist({
    plan: {
      id: runtimePlanId,
      sourceContext,
      status: "validation_failed",
      runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
      translatorVersion: TRANSLATOR_VERSION,
      translatorStrategy: TRANSLATOR_STRATEGY,
      translationTemplate,
      sourceGraphFingerprint,
      runtimeFingerprint: undefined,
      validationReport,
    },
    tasks: [],
    outputs: [],
    inputs: [],
    bindings: [],
    artifacts: [],
    issues: validationReport.issues,
  });
}

/** Chamado quando o `Planning` de origem é superado (Sprint 09) — o RuntimePlan correspondente
 * acompanha (decisão obrigatória 9), nunca fica `validated` apontando para um Planning que não
 * vale mais. Sem efeito se não houver RuntimePlan para este Planning. */
export async function supersedeRuntimeForPlanning(deps: Pick<RuntimeEngineDeps, "runtimeRepository">, planningId: string): Promise<void> {
  const existing = await deps.runtimeRepository.getByPlanningId(planningId);
  if (existing && existing.status !== "superseded") {
    await deps.runtimeRepository.updateStatus(existing.id, "superseded");
  }
}
