import type { ExecutionGraph, ExecutionTask } from "../../domain/planning/planning.model.js";
import { computeFingerprint } from "../../domain/runtime/fingerprint.js";
import type { RuntimeTranslationCandidate } from "./translator.js";

/**
 * Fingerprints — Sprint 10 (decisões obrigatórias 8/33/34). Nunca incluem `id`/`createdAt`/
 * `planningId`/`runtimePlanId` — só a ESTRUTURA lógica (tipos de tarefa, capabilities, formas de
 * porta, topologia de bindings). Como cada `TaskType` aparece no máximo uma vez por Planning neste
 * template, `type` funciona como chave estável de ordenação sem precisar de IDs.
 */
export function computeSourceGraphFingerprint(executionTasks: readonly ExecutionTask[], graph: Pick<ExecutionGraph, "nodes" | "edges">): string {
  const tasks = [...executionTasks]
    .map((task) => ({
      type: task.type,
      capability: task.capability,
      expectedArtifactType: task.expectedArtifactType,
      inputContract: task.inputContract,
      outputContract: task.outputContract,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));

  const taskTypeByExecutionTaskId = new Map(executionTasks.map((task) => [task.id, task.type]));
  const taskTypeByNodeId = new Map(graph.nodes.map((node) => [node.id, taskTypeByExecutionTaskId.get(node.executionTaskId)]));
  const edges = [...graph.edges].map((edge) => `${taskTypeByNodeId.get(edge.fromNodeId)}->${taskTypeByNodeId.get(edge.toNodeId)}`).sort();

  return computeFingerprint({ tasks, edges });
}

export function computeRuntimeFingerprint(candidate: RuntimeTranslationCandidate): string {
  const taskTypeById = new Map(candidate.tasks.map((task) => [task.id, task.type]));

  const tasks = [...candidate.tasks].map((task) => ({ type: task.type, capability: task.capability })).sort((a, b) => a.type.localeCompare(b.type));

  const outputs = [...candidate.outputPorts]
    .map((port) => ({ task: taskTypeById.get(port.runtimeTaskId), portKey: port.portKey, artifactType: port.artifactType }))
    .sort((a, b) => `${a.task}.${a.portKey}`.localeCompare(`${b.task}.${b.portKey}`));

  const inputs = [...candidate.inputPorts]
    .map((port) => ({ task: taskTypeById.get(port.runtimeTaskId), portKey: port.portKey, acceptedArtifactTypes: [...port.acceptedArtifactTypes].sort(), required: port.required }))
    .sort((a, b) => `${a.task}.${a.portKey}`.localeCompare(`${b.task}.${b.portKey}`));

  const bindings = [...candidate.bindings].map((binding) => `${binding.fromTaskType}.${binding.fromOutputPort}->${binding.toTaskType}.${binding.toInputPort}`).sort();

  return computeFingerprint({ translationTemplate: candidate.translationTemplate, tasks, outputs, inputs, bindings });
}
