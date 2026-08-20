"use client";

import Link from "next/link";
import { useExecutionRuns } from "@/features/execution/hooks";

/**
 * Redesign "SaaS moderno + IA-first", decisão 5 (proposta) — "nasce só com 'aguardando
 * aprovação' (recomendado: zero backend novo)". Reusa exatamente os mesmos dados que a página
 * de Revisão já busca (`useExecutionRuns`) — nenhuma rota/tabela nova. Sempre linka para
 * `/review`, nunca abre um painel próprio.
 */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const { data: runs } = useExecutionRuns(workspaceId);
  const pendingCount = (runs ?? []).filter((run) => run.mode === "real" && run.state === "waiting_for_approval").length;

  return (
    <Link
      href={`/workspaces/${workspaceId}/review`}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-sunken hover:text-ink"
      aria-label={pendingCount > 0 ? `${pendingCount} peças aguardando aprovação` : "Nenhuma peça aguardando aprovação"}
      title={pendingCount > 0 ? `${pendingCount} aguardando aprovação` : "Revisão"}
    >
      <span aria-hidden="true">🔔</span>
      {pendingCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
        >
          {pendingCount > 9 ? "9+" : pendingCount}
        </span>
      ) : null}
    </Link>
  );
}
