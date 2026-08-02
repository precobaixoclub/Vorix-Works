import type { RuntimeBinding, RuntimeTask } from "./types";

/** Mesmo raciocínio de `features/planning/layout.ts` — calculado inteiramente no cliente, a
 * partir só de `tasks`+`bindings`. O backend nunca guarda posição/x/y. */

export type NodePosition = { taskId: string; column: number; row: number };
export type GraphLayout = { positions: readonly NodePosition[]; columns: number; rows: number };

export function computeLayeredLayout(tasks: readonly RuntimeTask[], bindings: readonly RuntimeBinding[]): GraphLayout {
  const depthByTask = new Map<string, number>();
  const incomingByTask = new Map<string, string[]>();
  for (const task of tasks) incomingByTask.set(task.id, []);
  for (const binding of bindings) incomingByTask.get(binding.toRuntimeTaskId)?.push(binding.fromRuntimeTaskId);

  function depthOf(taskId: string, visiting: Set<string>): number {
    const cached = depthByTask.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const incoming = incomingByTask.get(taskId) ?? [];
    const depth = incoming.length === 0 ? 0 : 1 + Math.max(...incoming.map((from) => depthOf(from, visiting)));
    visiting.delete(taskId);
    depthByTask.set(taskId, depth);
    return depth;
  }

  for (const task of tasks) depthOf(task.id, new Set());

  const rowCountByColumn = new Map<number, number>();
  const positions: NodePosition[] = tasks.map((task) => {
    const column = depthByTask.get(task.id) ?? 0;
    const row = rowCountByColumn.get(column) ?? 0;
    rowCountByColumn.set(column, row + 1);
    return { taskId: task.id, column, row };
  });

  const columns = positions.reduce((max, position) => Math.max(max, position.column + 1), 0);
  const rows = [...rowCountByColumn.values()].reduce((max, count) => Math.max(max, count), 0);
  return { positions, columns, rows };
}
