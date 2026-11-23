"use client";

import Link from "next/link";
import { useMyAccess } from "@/features/auth/access";
import { useDashboard, type DashboardAttendance } from "@/features/dashboard/api";
import { cn } from "@/lib/utils";

/**
 * "Agora no atendimento" (Reorganização de UX — Fase 6), no topo do Radar: responde as perguntas
 * operacionais do gestor com os números que o SERVIDOR já calcula para o painel (fila atual, SLA,
 * fila por equipe) — mesma consulta e mesmo cache do Início, nada recalculado no navegador. Cada
 * número leva à tela onde se resolve.
 */
export type OperationsTile = { key: string; label: string; value: number; hint?: string; href: string; tone?: "attention" | "critical" };

export function operationsTiles(attendance: DashboardAttendance, teamNames: ReadonlyMap<string, string>): OperationsTile[] {
  const tiles: OperationsTile[] = [];
  const waiting = attendance.backlog.awaitingFirstResponse + attendance.backlog.awaitingAgent;
  tiles.push({ key: "waiting", label: "Aguardando resposta", value: waiting, hint: `${attendance.backlog.awaitingFirstResponse} sem primeira resposta`, href: "/conversas?read=unread", tone: waiting > 0 ? "attention" : undefined });
  tiles.push({ key: "unassigned", label: "Sem responsável", value: attendance.backlog.queue, hint: "Na fila, sem atendente", href: "/conversas?owner=unassigned", tone: attendance.backlog.queue > 0 ? "attention" : undefined });
  if (attendance.sla.configured) tiles.push({ key: "sla", label: "Prazo vencido", value: attendance.sla.openBreached, hint: `${attendance.sla.openNear} perto de vencer`, href: "/conversas", tone: attendance.sla.openBreached > 0 ? "critical" : undefined });
  const busiest = [...attendance.teams].filter((team) => team.backlog > 0).sort((a, b) => b.backlog - a.backlog)[0];
  if (busiest) tiles.push({ key: "team", label: "Equipe com mais atendimentos", value: busiest.backlog, hint: teamNames.get(busiest.teamId) ?? "Equipe", href: `/kanban?team=${encodeURIComponent(busiest.teamId)}` });
  return tiles;
}

export function OperationsNow({ workspaceId }: { workspaceId: string }) {
  const { can, access } = useMyAccess();
  // Mesmo recorte do Início: a empresa inteira para quem pode ver tudo; senão, o próprio atendimento.
  const viewing = can("inbox:view_all") ? "company" : "me";
  const { data } = useDashboard(workspaceId, { viewing, period: "today" }, { enabled: access !== undefined });
  const attendance = data?.attendance?.available && data.attendance.backlog ? data.attendance : undefined;
  if (!attendance) return null;
  const names = new Map((data?.options?.teams ?? []).map((team) => [team.id, team.name] as const));
  const tiles = operationsTiles(attendance, names);
  const base = `/workspaces/${workspaceId}`;
  return (
    <section aria-label="Agora no atendimento" className="mb-5" data-testid="operations-now">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Agora no atendimento {viewing === "company" ? "· empresa" : "· seus atendimentos"}</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.key} href={`${base}${tile.href}`} data-tile={tile.key} className={cn("flex min-h-[76px] min-w-0 flex-col justify-between rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40", tile.tone === "critical" ? "border-destructive/40" : tile.tone === "attention" ? "border-warning/40" : "border-border/70")}>
            <span className="text-xs text-muted-foreground">{tile.label}</span>
            <span className="text-xl font-semibold tabular-nums text-foreground">{tile.value}</span>
            {tile.hint ? <span className="truncate text-[11px] text-muted-foreground">{tile.hint}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
