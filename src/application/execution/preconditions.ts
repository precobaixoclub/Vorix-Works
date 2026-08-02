import { projectExecutionGraph } from "../../domain/planning/graph-projection.js";
import type { Planning } from "../../domain/planning/planning.model.js";
import type { RuntimeDetails, RuntimeRepositoryPort } from "../ports/runtime-repository.port.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../ports/execution-task-repository.port.js";
import type { ExecutionGraphRepositoryPort } from "../ports/execution-graph-repository.port.js";
import type { PlanningArtifactRepositoryPort } from "../ports/planning-artifact-repository.port.js";
import { computeRuntimeFingerprint, computeSourceGraphFingerprint } from "../runtime/fingerprints.js";
import type { RuntimePlan } from "../../domain/runtime/runtime.model.js";

export type ExecutionPreconditionDeps = {
  runtimeRepository: RuntimeRepositoryPort;
  planningRepository: PlanningRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  artifactRepository: PlanningArtifactRepositoryPort;
};

export type ValidatedRuntimeForExecution = {
  runtimePlan: RuntimePlan;
  runtimeDetails: RuntimeDetails;
  planning: Planning;
};

export async function assertRuntimeExecutable(
  deps: ExecutionPreconditionDeps,
  input: { runtimePlanId: string; tenantId: string; workspaceId: string },
): Promise<ValidatedRuntimeForExecution> {
  const runtimePlan = await deps.runtimeRepository.getById(input.runtimePlanId);
  if (!runtimePlan || runtimePlan.sourceContext.tenantId !== input.tenantId || runtimePlan.sourceContext.workspaceId !== input.workspaceId) {
    throw new Error(`EXECUTION_PRECONDITION_FAILED: RuntimePlan "${input.runtimePlanId}" não existe.`);
  }
  if (runtimePlan.status !== "validated") {
    throw new Error(`EXECUTION_PRECONDITION_FAILED: RuntimePlan precisa estar validated; estado atual "${runtimePlan.status}".`);
  }
  if (runtimePlan.supersededAt) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: RuntimePlan está superseded.");
  }

  const planning = await deps.planningRepository.getById(runtimePlan.sourceContext.planningId);
  if (!planning) throw new Error(`EXECUTION_PRECONDITION_FAILED: Planning "${runtimePlan.sourceContext.planningId}" não existe.`);
  if (planning.status === "superseded") throw new Error("EXECUTION_PRECONDITION_FAILED: Planning de origem está superseded.");
  if (planning.tenantId !== input.tenantId || planning.workspaceId !== input.workspaceId) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: Tenant/Workspace divergentes entre RuntimePlan e Planning.");
  }

  const executionTasks = await deps.executionTaskRepository.listByPlanning(planning.id);
  const rawGraph = await deps.executionGraphRepository.getGraph(planning.id);
  const planningArtifacts = await deps.artifactRepository.listByPlanning(planning.id);
  const runtimeDetails = await deps.runtimeRepository.getDetails(runtimePlan.id);

  if (runtimeDetails.tasks.length !== executionTasks.length) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: Há RuntimeTask ausente em relação ao Planning de origem.");
  }
  if (runtimeDetails.artifacts.length !== planningArtifacts.length) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: Há RuntimeArtifact esperado ausente.");
  }

  const graph = projectExecutionGraph(planning, rawGraph.nodes, rawGraph.edges);
  const sourceGraphFingerprint = computeSourceGraphFingerprint(executionTasks, graph);
  if (sourceGraphFingerprint !== runtimePlan.sourceGraphFingerprint) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: sourceGraphFingerprint diverge do Planning persistido.");
  }

  const runtimeFingerprint = computePersistedRuntimeFingerprint(runtimePlan, runtimeDetails);
  if (runtimeFingerprint !== runtimePlan.runtimeFingerprint) {
    throw new Error("EXECUTION_PRECONDITION_FAILED: runtimeFingerprint diverge do conteúdo persistido.");
  }

  const bindingsByInput = new Set(runtimeDetails.bindings.map((binding) => `${binding.toRuntimeTaskId}:${binding.toInputPort}`));
  for (const inputPort of runtimeDetails.inputs) {
    if (inputPort.required && !bindingsByInput.has(`${inputPort.runtimeTaskId}:${inputPort.portKey}`)) {
      throw new Error(`EXECUTION_PRECONDITION_FAILED: Porta obrigatória desconectada "${inputPort.runtimeTaskId}.${inputPort.portKey}".`);
    }
  }

  return { runtimePlan, runtimeDetails, planning };
}

function computePersistedRuntimeFingerprint(runtimePlan: RuntimePlan, details: RuntimeDetails): string {
  const taskById = new Map(details.tasks.map((task) => [task.id, task]));
  const bindings = details.bindings.map((binding) => {
    const fromTaskType = taskById.get(binding.fromRuntimeTaskId)?.type;
    const toTaskType = taskById.get(binding.toRuntimeTaskId)?.type;
    if (!fromTaskType || !toTaskType) {
      throw new Error("EXECUTION_PRECONDITION_FAILED: RuntimeBinding referencia RuntimeTask ausente.");
    }
    return {
      ...binding,
      fromTaskType,
      toTaskType,
      fromRuntimeTaskId: binding.fromRuntimeTaskId,
      toRuntimeTaskId: binding.toRuntimeTaskId,
    };
  });
  return computeRuntimeFingerprint({
    translationTemplate: runtimePlan.translationTemplate,
    tasks: details.tasks,
    inputPorts: details.inputs,
    outputPorts: details.outputs,
    artifacts: details.artifacts,
    bindings,
  });
}
