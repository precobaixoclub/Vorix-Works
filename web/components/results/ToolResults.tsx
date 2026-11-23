"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight } from "lucide-react";
import { KpiCard, num } from "@/components/DashboardKit";
import { ErrorState } from "@/components/ErrorState";
import { StatsGrid } from "@/components/StatsGrid";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeetingsDashboard } from "@/features/meetings/hooks";
import { formatHours } from "@/features/meetings/presentation";
import { analyticsQuery, getSiteAnalytics, siteMetric, type SiteAnalyticsReport } from "@/features/sites/analytics";
import { formatCurrencyCents } from "@/lib/format";

/** Links para as telas completas — os relatórios detalhados continuam onde estavam. */
export function DetailLinks({ base, links }: { base: string; links?: readonly (readonly [string, string])[] }) {
  if (!links?.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="results-details">
      {links.map(([label, href]) => (
        <Link key={href} href={`${base}${href}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50">
          {label} <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      ))}
    </div>
  );
}

export function NoPermission({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-state="no-permission">Seu acesso não permite ver os números de {label}. Peça a permissão a quem administra a conta.</p>;
}

const money = (revenue: Record<string, number>) => Object.entries(revenue).map(([currency, value]) => formatCurrencyCents(value, currency)).join(" + ") || "—";

/** Site: a MESMA consulta da tela "Analytics do site", só com o período (sem filtros extras). */
export function useSiteSummary(workspaceId: string, period: { period: string; from?: string; to?: string } | undefined, enabled: boolean) {
  const query = period ? analyticsQuery(workspaceId, { ...period, from: period.from ?? "", to: period.to ?? "", timezone: "America/Sao_Paulo", limit: "1", offset: "0" }) : "";
  return useSWR<SiteAnalyticsReport>(enabled && period ? ["results-site-analytics", workspaceId, query] : null, () => getSiteAnalytics(query), { revalidateOnFocus: false });
}

export function SiteResults({ report, error, loading, onRetry, compact = false }: { report?: SiteAnalyticsReport; error?: unknown; loading: boolean; onRetry: () => void; compact?: boolean }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !report) return <Skeleton className="h-28 rounded-xl" />;
  if (report.empty) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-state="empty">Nenhuma visita registrada no site neste período.</p>;
  const hasSales = Boolean(report.metrics.SALE || report.metrics.ORDER);
  return (
    <div className="space-y-4">
      <StatsGrid>
        <KpiCard label="Visitantes" value={num(siteMetric(report, "SITE_VIEW", true))} hint="Pessoas únicas no período" />
        <KpiCard label="Intenções comerciais" value={num(siteMetric(report, "INTENT"))} hint="Contatos iniciados pelo site" />
        {report.metrics.ORDER ? <KpiCard label="Pedidos" value={num(siteMetric(report, "ORDER"))} hint="Pedidos registrados no período" /> : null}
        {hasSales ? <KpiCard label="Receita atribuída" value={money(report.revenue)} hint="Valor final conhecido, por moeda" /> : <KpiCard label="Visualizações" value={num(siteMetric(report, "SITE_VIEW"))} hint="Páginas acessadas" />}
      </StatsGrid>
      {!compact && report.conversions.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="site-conversions">
          {report.conversions.map((conversion) => (
            <li key={conversion.key} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{conversion.label}: </span>
              <span className="font-medium tabular-nums text-foreground">{conversion.rate === null ? "sem base suficiente" : `${conversion.rate.toLocaleString("pt-BR")}%`}</span>
              <span className="block text-xs text-muted-foreground">{num(conversion.numerator)} de {num(conversion.denominator)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!compact && report.notes.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    </div>
  );
}

/** Reuniões: o painel do próprio módulo (período FIXO: hoje e esta semana; totais acumulados). */
export function MeetingsResults({ workspaceId, compact = false }: { workspaceId: string; compact?: boolean }) {
  const dashboard = useMeetingsDashboard(workspaceId);
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={() => dashboard.mutate()} />;
  if (!dashboard.data) return <Skeleton className="h-28 rounded-xl" />;
  const data = dashboard.data;
  return (
    <div className="space-y-3">
      <StatsGrid>
        <KpiCard label="Reuniões hoje" value={num(data.meetingsToday)} hint={`${num(data.meetingsThisWeek)} nesta semana`} />
        <KpiCard label="Transcrições prontas" value={num(data.transcriptsAvailable)} hint="Total acumulado" />
        <KpiCard label="Horas gravadas" value={formatHours(data.recordedSeconds)} hint="Total acumulado" />
        {compact ? null : <KpiCard label="Em processamento" value={num(data.processing)} hint={`${num(data.recordingNow)} gravando agora`} />}
      </StatsGrid>
      <p className="text-xs text-muted-foreground" data-testid="meetings-fixed-period">Período fixo do painel de Reuniões: hoje e esta semana; horas e transcrições são o total acumulado. O filtro de período não se aplica aqui.</p>
    </div>
  );
}
