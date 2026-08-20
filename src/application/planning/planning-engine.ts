import type { PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { Planning } from "../../domain/planning/planning.model.js";
import type { ExecutionGraphRepositoryPort } from "../ports/execution-graph-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../ports/execution-task-repository.port.js";
import type { PlanningArtifactRepositoryPort } from "../ports/planning-artifact-repository.port.js";
import type { PlanningDecisionRepositoryPort } from "../ports/planning-decision-repository.port.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";
import { GRAPH_VERSION, PLANNER_STRATEGY, PLANNER_VERSION, planFromPreparedCommand } from "./arthur-planner.js";
import { validatePreparedCommandForPlanning } from "./validation.js";
import type { CreativeEngineMode } from "../creative-engine/creative-engine-mode.js";

/**
 * Ponto de composição opcional com o Runtime (Sprint 10) — mesmo padrão de `BriefingPlanningHook`
 * em `briefing-use-cases.ts` (Sprint 09): interface local, nunca importa nada de
 * `application/runtime/*`, para que este arquivo continue podendo ser lido/testado sem nenhum
 * conhecimento do domínio Runtime. `undefined` reproduz o comportamento da Sprint 09 exatamente.
 */
export type PlanningRuntimeHook = {
  ensureForPlanning(planning: Planning): Promise<void>;
  supersedeForPlanning(planningId: string): Promise<void>;
};

/**
 * Planning Engine — Sprint 09 (Fase 3). Único ponto que recebe um `PreparedCommand` e produz um
 * `Planning` persistido — nunca executa nada, nunca chama Caio/Helena/Skill/AI Gateway.
 * `PreparedCommand → ValidationReport → (Arthur Planner) → Planning + ExecutionTask[] +
 * PlanningNode[]/PlanningEdge[] + PlanningArtifact[] + PlanningDecision[]`.
 */
export type PlanningEngineDeps = {
  planningRepository: PlanningRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  artifactRepository: PlanningArtifactRepositoryPort;
  decisionRepository: PlanningDecisionRepositoryPort;
  idGenerator: () => string;
  now?: () => Date;
  /** Sprint 10 — chamado só quando um Planning novo nasce `"ready"` (nunca `"failed"`), e na
   * supersessão. Ausente reproduz a Sprint 09 sem nenhuma mudança. */
  runtimeEngine?: PlanningRuntimeHook;
  /** Migração "GPT como motor criativo único" (PR 6/9) — decidido uma única vez no boot
   * (`container.ts`), nunca por execução. Ausente reproduz o comportamento anterior a esta
   * migração (`"legacy"`, default de `planFromPreparedCommand`). */
  creativeEngine?: CreativeEngineMode;
};

/** Idempotente (decisão obrigatória — unicidade lógica por `preparedCommandId` +
 * `preparedCommandRevision`): chamar de novo para o mesmo par devolve o Planning já existente,
 * nunca duplica. */
export async function createPlanningFromPreparedCommand(deps: PlanningEngineDeps, preparedCommand: PreparedCommand): Promise<Planning> {
  const existing = await deps.planningRepository.getByPreparedCommand(preparedCommand.id, preparedCommand.briefingRevision);
  if (existing) return existing;

  const now = deps.now ?? (() => new Date());
  const validationReport = validatePreparedCommandForPlanning(preparedCommand, now);
  const planningId = deps.idGenerator();

  if (!validationReport.valid) {
    return deps.planningRepository.create({
      id: planningId,
      tenantId: preparedCommand.tenantId,
      workspaceId: preparedCommand.workspaceId,
      conversationId: preparedCommand.conversationId,
      briefingId: preparedCommand.briefingId,
      preparedCommandId: preparedCommand.id,
      preparedCommandRevision: preparedCommand.briefingRevision,
      status: "failed",
      plannerVersion: PLANNER_VERSION,
      plannerStrategy: PLANNER_STRATEGY,
      planningTemplate: "none",
      graphVersion: GRAPH_VERSION,
      graphType: "dag",
      validationReport,
    });
  }

  const result = planFromPreparedCommand(preparedCommand, planningId, { idGenerator: deps.idGenerator, now, creativeEngine: deps.creativeEngine });

  const planning = await deps.planningRepository.create({
    id: planningId,
    tenantId: preparedCommand.tenantId,
    workspaceId: preparedCommand.workspaceId,
    conversationId: preparedCommand.conversationId,
    briefingId: preparedCommand.briefingId,
    preparedCommandId: preparedCommand.id,
    preparedCommandRevision: preparedCommand.briefingRevision,
    status: "ready",
    plannerVersion: PLANNER_VERSION,
    plannerStrategy: PLANNER_STRATEGY,
    planningTemplate: result.planningTemplate,
    graphVersion: GRAPH_VERSION,
    graphType: "dag",
    validationReport,
  });

  await deps.executionTaskRepository.createMany(result.tasks);

  const nodes = result.tasks.map((task) => ({ id: deps.idGenerator(), planningId, executionTaskId: task.id, label: task.name }));
  const nodeIdByTaskId = new Map(nodes.map((node) => [node.executionTaskId, node.id] as const));
  const edges = result.edges.map((edge) => ({
    id: deps.idGenerator(),
    planningId,
    fromNodeId: nodeIdByTaskId.get(edge.fromTaskId) as string,
    toNodeId: nodeIdByTaskId.get(edge.toTaskId) as string,
    kind: "depends_on" as const,
  }));
  await deps.executionGraphRepository.saveGraph(planningId, nodes, edges);

  await deps.artifactRepository.createMany(result.artifacts);
  await deps.decisionRepository.createMany(result.decisions);

  if (deps.runtimeEngine) {
    await deps.runtimeEngine.ensureForPlanning(planning);
  }

  return planning;
}

/** Chamado quando o `PreparedCommand` de origem é superado por uma correção (Sprint 07) — o
 * Planning correspondente acompanha (decisão obrigatória), nunca fica "ready" apontando para um
 * comando que não vale mais. Sem efeito se não houver Planning ativo para este comando (ex.:
 * PreparedCommand de um tipo sem template, cujo Planning já nasceu `failed`). Sprint 10: propaga
 * também para o RuntimePlan correspondente, quando o hook estiver presente. */
export async function supersedePlanningForPreparedCommand(
  deps: Pick<PlanningEngineDeps, "planningRepository" | "runtimeEngine">,
  preparedCommandId: string,
): Promise<void> {
  const existing = await deps.planningRepository.getActiveByPreparedCommandId(preparedCommandId);
  if (existing && existing.status !== "superseded") {
    await deps.planningRepository.updateStatus(existing.id, "superseded");
    if (deps.runtimeEngine) {
      await deps.runtimeEngine.supersedeForPlanning(existing.id);
    }
  }
}
