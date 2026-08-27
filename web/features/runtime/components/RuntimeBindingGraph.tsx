import { computeLayeredLayout } from "../layout";
import type { RuntimeBinding, RuntimeTask } from "../types";

/** Visualização só-leitura dos bindings (portas de saída -> portas de entrada) — decisão
 * obrigatória da Sprint 10: sem botão de execução, sem ação nenhuma, só a estrutura. */

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 96;
const NODE_WIDTH = 208;
const NODE_HEIGHT = 68;
const PADDING = 24;

export function RuntimeBindingGraph({ tasks, bindings }: { tasks: readonly RuntimeTask[]; bindings: readonly RuntimeBinding[] }) {
  const layout = computeLayeredLayout(tasks, bindings);
  const width = PADDING * 2 + Math.max(layout.columns, 1) * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH);
  const height = PADDING * 2 + Math.max(layout.rows, 1) * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT);

  const positionByTaskId = new Map(layout.positions.map((position) => [position.taskId, position]));

  function centerOf(taskId: string) {
    const position = positionByTaskId.get(taskId);
    if (!position) return { x: PADDING, y: PADDING };
    return { x: PADDING + position.column * COLUMN_WIDTH, y: PADDING + position.row * ROW_HEIGHT };
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="min-w-full" role="img" aria-label="Grafo de bindings do Runtime">
        <g>
          {bindings.map((binding) => {
            const from = centerOf(binding.fromRuntimeTaskId);
            const to = centerOf(binding.toRuntimeTaskId);
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={binding.id}>
                <path d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`} fill="none" className="stroke-border" strokeWidth={1.5} markerEnd="url(#runtime-graph-arrow)" />
                <text x={midX} y={midY - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {binding.fromOutputPort} → {binding.toInputPort}
                </text>
              </g>
            );
          })}
        </g>

        <defs>
          <marker id="runtime-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {tasks.map((task) => {
          const position = centerOf(task.id);
          return (
            <foreignObject key={task.id} x={position.x} y={position.y} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div className="flex h-full flex-col justify-center gap-0.5 rounded-lg border border-border border-l-4 border-l-primary bg-card px-3 py-1.5 shadow-sm">
                <p className="truncate text-xs font-medium text-foreground" title={task.type}>
                  {task.type}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{task.capability}</p>
              </div>
            </foreignObject>
          );
        })}
      </svg>
      {tasks.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">Nenhuma tarefa traduzida (validação falhou antes da tradução).</p> : null}
    </div>
  );
}
