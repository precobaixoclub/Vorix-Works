import type { ExecutionGraph } from "../../domain/planning/planning.model.js";
import type { RuntimeValidationIssue, RuntimeValidationReport } from "../../domain/runtime/runtime.model.js";
import type { RuntimeBindingCandidate, RuntimeTranslationCandidate } from "./translator.js";

/**
 * `RuntimeValidationReport` — Sprint 10 (Fase 4, decisões obrigatórias 20/25/26/27/28/29). Roda
 * DEPOIS do `PlanningExecutionTranslator` produzir um `RuntimeTranslationCandidate`, e ANTES de
 * qualquer coisa (além do próprio `RuntimePlan`) ser persistida. Função pura, sem I/O. Valida os
 * DOIS lados de cada binding (porta de origem e porta de destino), tipos, cardinalidade,
 * duplicidade, referências e ciclos — e, crucialmente, que cada binding proposto pelo template
 * corresponda a uma dependência REAL já declarada no `ExecutionGraph` de origem (nunca uma
 * dependência inventada pelo Runtime).
 */
export function validateRuntimeTranslation(candidate: RuntimeTranslationCandidate, graph: ExecutionGraph, now: () => Date = () => new Date()): RuntimeValidationReport {
  const issues: RuntimeValidationIssue[] = [];

  const taskById = new Map(candidate.tasks.map((task) => [task.id, task]));
  const outputPortsByTask = groupByRuntimeTaskId(candidate.outputPorts);
  const inputPortsByTask = groupByRuntimeTaskId(candidate.inputPorts);
  const nodeIdByExecutionTaskId = new Map(graph.nodes.map((node) => [node.executionTaskId, node.id]));

  function planningEdgeExists(fromRuntimeTaskId: string, toRuntimeTaskId: string): boolean {
    const fromExecutionTaskId = taskById.get(fromRuntimeTaskId)?.executionTaskId;
    const toExecutionTaskId = taskById.get(toRuntimeTaskId)?.executionTaskId;
    const fromNodeId = fromExecutionTaskId ? nodeIdByExecutionTaskId.get(fromExecutionTaskId) : undefined;
    const toNodeId = toExecutionTaskId ? nodeIdByExecutionTaskId.get(toExecutionTaskId) : undefined;
    if (!fromNodeId || !toNodeId) return false;
    return graph.edges.some((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId);
  }

  const validBindings: RuntimeBindingCandidate[] = [];
  const bindingCountByInputPort = new Map<string, number>();

  for (const binding of candidate.bindings) {
    const field = `${binding.fromTaskType}.${binding.fromOutputPort} -> ${binding.toTaskType}.${binding.toInputPort}`;

    if (!binding.fromRuntimeTaskId) {
      issues.push({ code: "unknown_source_task", message: `Nenhuma RuntimeTask traduzida do tipo "${binding.fromTaskType}" (binding "${field}").`, field, severity: "error" });
      continue;
    }
    if (!binding.toRuntimeTaskId) {
      issues.push({ code: "unknown_target_task", message: `Nenhuma RuntimeTask traduzida do tipo "${binding.toTaskType}" (binding "${field}").`, field, severity: "error" });
      continue;
    }

    const outputPort = (outputPortsByTask.get(binding.fromRuntimeTaskId) ?? []).find((port) => port.portKey === binding.fromOutputPort);
    if (!outputPort) {
      issues.push({ code: "unknown_output_port", message: `A tarefa "${binding.fromTaskType}" não declara a porta de saída "${binding.fromOutputPort}" (binding "${field}").`, field, severity: "error" });
      continue;
    }

    const inputPort = (inputPortsByTask.get(binding.toRuntimeTaskId) ?? []).find((port) => port.portKey === binding.toInputPort);
    if (!inputPort) {
      issues.push({ code: "unknown_input_port", message: `A tarefa "${binding.toTaskType}" não declara a porta de entrada "${binding.toInputPort}" (binding "${field}").`, field, severity: "error" });
      continue;
    }

    if (!inputPort.acceptedArtifactTypes.includes(outputPort.artifactType)) {
      issues.push({
        code: "incompatible_artifact_type",
        message: `A porta "${binding.toTaskType}.${binding.toInputPort}" aceita [${inputPort.acceptedArtifactTypes.join(", ")}], mas "${binding.fromTaskType}.${binding.fromOutputPort}" produz "${outputPort.artifactType}".`,
        field,
        severity: "error",
      });
      continue;
    }

    if (!planningEdgeExists(binding.fromRuntimeTaskId, binding.toRuntimeTaskId)) {
      issues.push({
        code: "binding_not_backed_by_planning_edge",
        message: `O translation template propõe conectar "${binding.fromTaskType}" -> "${binding.toTaskType}", mas o ExecutionGraph de origem não declara essa dependência — nenhum binding pode inventar uma dependência que o Planning não tem.`,
        field,
        severity: "error",
      });
      continue;
    }

    const cardinalityKey = `${binding.toRuntimeTaskId}:${binding.toInputPort}`;
    const count = (bindingCountByInputPort.get(cardinalityKey) ?? 0) + 1;
    bindingCountByInputPort.set(cardinalityKey, count);
    if (count > 1) {
      issues.push({ code: "duplicate_binding", message: `Mais de um binding aponta para a porta de entrada "${binding.toTaskType}.${binding.toInputPort}".`, field, severity: "error" });
      continue;
    }

    validBindings.push(binding);
  }

  for (const [runtimeTaskId, ports] of inputPortsByTask) {
    const task = taskById.get(runtimeTaskId);
    for (const port of ports) {
      if (!port.required) continue;
      const satisfied = validBindings.some((binding) => binding.toRuntimeTaskId === runtimeTaskId && binding.toInputPort === port.portKey);
      if (!satisfied) {
        issues.push({
          code: "missing_required_input",
          message: `A porta de entrada obrigatória "${task?.type}.${port.portKey}" não tem nenhum binding que a satisfaça.`,
          field: `${task?.type}.${port.portKey}`,
          severity: "error",
        });
      }
    }
  }

  if (detectCycle(candidate.tasks.map((task) => task.id), validBindings.map((binding) => ({ from: binding.fromRuntimeTaskId as string, to: binding.toRuntimeTaskId as string })))) {
    issues.push({ code: "cycle_detected", message: "O grafo de bindings traduzido contém um ciclo.", severity: "error" });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    validatedAt: now().toISOString(),
  };
}

function groupByRuntimeTaskId<T extends { runtimeTaskId: string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.runtimeTaskId) ?? [];
    list.push(item);
    grouped.set(item.runtimeTaskId, list);
  }
  return grouped;
}

/** Kahn's algorithm, independente do `topologicalSort` do domínio Planning (que opera sobre
 * `PlanningNode`/`PlanningEdge`, não sobre bindings de Runtime) — mesma técnica, aplicada aqui ao
 * grafo de `RuntimeBinding`s já validados. */
function detectCycle(nodeIds: readonly string[], edges: readonly { from: string; to: string }[]): boolean {
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !inDegree.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visitedCount = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    visitedCount += 1;
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, nextDegree);
      if (nextDegree === 0) queue.push(neighborId);
    }
  }
  return visitedCount !== nodeIds.length;
}
