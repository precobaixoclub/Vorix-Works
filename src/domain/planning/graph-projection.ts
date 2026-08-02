import type { ExecutionGraph, Planning, PlanningEdge, PlanningNode } from "./planning.model.js";

/**
 * Projeção do grafo — Sprint 09 (decisão obrigatória: `ExecutionGraph` nunca é persistido como
 * tabela própria; é sempre reconstruído a partir de `PlanningNode[]`/`PlanningEdge[]` já
 * persistidos). Função pura, sem I/O — o Port de persistência (`ExecutionGraphRepositoryPort`)
 * devolve `{nodes, edges}` brutos; esta função monta o tipo composto final.
 */
export function projectExecutionGraph(planning: Planning, nodes: readonly PlanningNode[], edges: readonly PlanningEdge[]): ExecutionGraph {
  return {
    planningId: planning.id,
    graphVersion: planning.graphVersion,
    graphType: planning.graphType,
    nodes,
    edges,
  };
}

export type TopologicalSortResult = { ok: true; orderedNodeIds: readonly string[] } | { ok: false; reason: "cycle_detected"; involvedNodeIds: readonly string[] };

/**
 * Ordem lógica de verdade do grafo — a ÚNICA fonte de "o que vem antes do quê" (decisão
 * obrigatória: `sequenceHint` em `ExecutionTask` é só sugestão visual, nunca usado para decidir
 * precedência). Kahn's algorithm — determinístico, sem dependência de nenhuma lib externa.
 * Detecta ciclo em vez de lançar: o Arthur Planner desta sprint nunca deveria produzir um, mas a
 * projeção é a última linha de defesa antes de expor o grafo para o resto do sistema.
 */
export function topologicalSort(graph: Pick<ExecutionGraph, "nodes" | "edges">): TopologicalSortResult {
  const inDegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));

  for (const edge of graph.edges) {
    if (!inDegree.has(edge.fromNodeId) || !inDegree.has(edge.toNodeId)) continue;
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const ordered: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    ordered.push(nodeId);
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, nextDegree);
      if (nextDegree === 0) queue.push(neighborId);
    }
  }

  if (ordered.length !== graph.nodes.length) {
    const involvedNodeIds = graph.nodes.map((node) => node.id).filter((id) => !ordered.includes(id));
    return { ok: false, reason: "cycle_detected", involvedNodeIds };
  }

  return { ok: true, orderedNodeIds: ordered };
}
