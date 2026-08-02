import { computeLayeredLayout } from "../layout";
import type { ExecutionGraph, ExecutionTask, TaskType } from "../types";

/** Visualização só-leitura do grafo — decisão obrigatória da Sprint 09: sem botão de execução,
 * sem ação nenhuma nos nós, só a estrutura (o quê depende do quê). */

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  research: "Pesquisa",
  campaign_structure: "Estrutura da campanha",
  copy_generation: "Geração de copy",
  visual_generation: "Geração visual",
  approval: "Aprovação",
  publication: "Publicação",
};

const TASK_TYPE_COLOR: Record<TaskType, string> = {
  research: "border-l-sky-500",
  campaign_structure: "border-l-violet-500",
  copy_generation: "border-l-amber-500",
  visual_generation: "border-l-amber-500",
  approval: "border-l-rose-500",
  publication: "border-l-emerald-500",
};

const COLUMN_WIDTH = 232;
const ROW_HEIGHT = 92;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 68;
const PADDING = 24;

export function PlanningGraph({ graph, tasksById }: { graph: ExecutionGraph; tasksById: ReadonlyMap<string, ExecutionTask> }) {
  const layout = computeLayeredLayout(graph);
  const width = PADDING * 2 + Math.max(layout.columns, 1) * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH);
  const height = PADDING * 2 + Math.max(layout.rows, 1) * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT);

  const positionByNodeId = new Map(layout.positions.map((position) => [position.nodeId, position]));

  function centerOf(nodeId: string) {
    const position = positionByNodeId.get(nodeId);
    if (!position) return { x: PADDING, y: PADDING };
    return {
      x: PADDING + position.column * COLUMN_WIDTH,
      y: PADDING + position.row * ROW_HEIGHT,
    };
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="min-w-full" role="img" aria-label="Grafo de execução do plano">
        <g>
          {graph.edges.map((edge) => {
            const from = centerOf(edge.fromNodeId);
            const to = centerOf(edge.toNodeId);
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                className="stroke-border"
                strokeWidth={1.5}
                markerEnd="url(#planning-graph-arrow)"
              />
            );
          })}
        </g>

        <defs>
          <marker id="planning-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-ink-faint" />
          </marker>
        </defs>

        {graph.nodes.map((node) => {
          const position = centerOf(node.id);
          const task = tasksById.get(node.executionTaskId);
          return (
            <foreignObject key={node.id} x={position.x} y={position.y} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div
                className={`flex h-full flex-col justify-center gap-0.5 rounded-lg border border-border border-l-4 bg-surface-raised px-3 py-1.5 shadow-sm ${task ? TASK_TYPE_COLOR[task.type] : "border-l-border"}`}
              >
                <p className="truncate text-xs font-medium text-ink" title={node.label}>
                  {node.label}
                </p>
                <p className="truncate text-[11px] text-ink-muted">{task ? TASK_TYPE_LABEL[task.type] : ""}</p>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
