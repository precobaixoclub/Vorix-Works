import type { ExecutionGraph } from "./types";

/** Layout do grafo — calculado inteiramente no cliente, a partir só de `nodes`+`edges`. O backend
 * nunca guarda posição/x/y (decisão obrigatória da Sprint 09), então isto roda a cada render:
 * cada nó fica na coluna igual à sua profundidade no DAG (maior caminho desde uma raiz) e as
 * colunas empilham os nós de cima para baixo na ordem em que aparecem no grafo. */

export type NodePosition = { nodeId: string; column: number; row: number };
export type GraphLayout = { positions: readonly NodePosition[]; columns: number; rows: number };

export function computeLayeredLayout(graph: ExecutionGraph): GraphLayout {
  const depthByNode = new Map<string, number>();
  const incomingByNode = new Map<string, string[]>();
  for (const node of graph.nodes) incomingByNode.set(node.id, []);
  for (const edge of graph.edges) incomingByNode.get(edge.toNodeId)?.push(edge.fromNodeId);

  function depthOf(nodeId: string, visiting: Set<string>): number {
    const cached = depthByNode.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 0; // ciclo inesperado — o backend só produz DAGs; não trava o layout.
    visiting.add(nodeId);
    const incoming = incomingByNode.get(nodeId) ?? [];
    const depth = incoming.length === 0 ? 0 : 1 + Math.max(...incoming.map((from) => depthOf(from, visiting)));
    visiting.delete(nodeId);
    depthByNode.set(nodeId, depth);
    return depth;
  }

  for (const node of graph.nodes) depthOf(node.id, new Set());

  const rowCountByColumn = new Map<number, number>();
  const positions: NodePosition[] = graph.nodes.map((node) => {
    const column = depthByNode.get(node.id) ?? 0;
    const row = rowCountByColumn.get(column) ?? 0;
    rowCountByColumn.set(column, row + 1);
    return { nodeId: node.id, column, row };
  });

  const columns = positions.reduce((max, position) => Math.max(max, position.column + 1), 0);
  const rows = [...rowCountByColumn.values()].reduce((max, count) => Math.max(max, count), 0);
  return { positions, columns, rows };
}
