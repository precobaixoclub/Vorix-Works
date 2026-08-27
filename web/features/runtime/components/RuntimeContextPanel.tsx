import { StatusBadge } from "@/components/StatusBadge";
import type { RuntimeContext } from "../types";

const ID_LABEL: Record<string, string> = {
  tenantId: "Organização",
  workspaceId: "Espaço de Trabalho",
  conversationId: "Fluxo",
  briefingId: "Briefing",
  preparedCommandId: "Comando Preparado",
  planningId: "Planejamento",
};

/** Mostra só identificadores de origem e a versão resolvida do planejamento que alimentou a execução. */
export function RuntimeContextPanel({ context }: { context: RuntimeContext }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Identificadores de origem</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {Object.entries(context.sourceContext).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{ID_LABEL[key] ?? key}</dt>
              <dd className="truncate text-xs text-foreground" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Planning de origem</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={context.planning.status} />
          <span className="text-xs text-muted-foreground">{context.planning.planningTemplate}</span>
          <span className="text-xs text-muted-foreground">· versão do planner {context.planning.plannerVersion}</span>
        </div>
      </div>
    </div>
  );
}
