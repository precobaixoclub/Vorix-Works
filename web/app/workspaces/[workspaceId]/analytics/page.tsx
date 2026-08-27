"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/Card";
import { axisProps, CHART_COLORS, ChartCard, KpiCard, tooltipStyle } from "@/components/DashboardKit";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { getAnalyticsExport, requestAnalyticsExport } from "@/features/analytics/api";
import {
  useAnalyticsAlerts,
  useAnalyticsCampaigns,
  useAnalyticsDataQuality,
  useAnalyticsExecution,
  useAnalyticsFunnel,
  useAnalyticsInsights,
  useAnalyticsOverview,
  useAnalyticsProviders,
  useAnalyticsPublication,
} from "@/features/analytics/hooks";
import type { AnalyticsAlertOccurrence, AnalyticsDataQualityReport, AnalyticsExportDetail, AnalyticsInsight, AnalyticsPeriod, AnalyticsQueryResult } from "@/features/analytics/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { contentTypeOf, derivePublicationStatus, type PublicationNetwork, type UnifiedPublication } from "@/features/publication-history/types";
import { formatDateTime } from "@/lib/format";

type AnalyticsArea = "overview" | "content" | "networks" | "ai" | "health";
type PeriodChoice = "last_7_days" | "last_30_days" | "last_90_days" | "custom";

const AREAS: readonly { id: AnalyticsArea; label: string }[] = [
  { id: "overview", label: "Visão geral" },
  { id: "content", label: "Conteúdo" },
  { id: "networks", label: "Redes" },
  { id: "ai", label: "IA" },
  { id: "health", label: "Saúde" },
];

const PERIODS: readonly { id: PeriodChoice; label: string }[] = [
  { id: "last_7_days", label: "7 dias" },
  { id: "last_30_days", label: "30 dias" },
  { id: "last_90_days", label: "90 dias" },
  { id: "custom", label: "Personalizado" },
];

const NETWORK_LABEL: Record<PublicationNetwork, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
};

const NETWORK_ICON: Record<PublicationNetwork, string> = {
  tiktok: "♪",
  instagram: "◎",
  facebook: "f",
  youtube: "▶",
};

export default function AnalyticsPage() {
  const workspace = useCurrentWorkspace();
  const [area, setArea] = useState<AnalyticsArea>("overview");
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("last_30_days");
  const [customFrom, setCustomFrom] = useState(() => dateInput(addDays(new Date(), -29)));
  const [customTo, setCustomTo] = useState(() => dateInput(addDays(new Date(), 1)));
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [exportDetail, setExportDetail] = useState<AnalyticsExportDetail | undefined>();
  const [exportError, setExportError] = useState<string | undefined>();

  const period = useMemo(() => periodString(periodChoice, customFrom, customTo), [periodChoice, customFrom, customTo]);
  const periodForExport = useMemo(() => periodObject(periodChoice, customFrom, customTo, timezone), [periodChoice, customFrom, customTo, timezone]);
  const overview = useAnalyticsOverview(workspace.id, period, timezone);
  const publication = useAnalyticsPublication(workspace.id, period, timezone);
  const campaigns = useAnalyticsCampaigns(workspace.id, period, timezone);
  const providers = useAnalyticsProviders(workspace.id, period, timezone);
  const execution = useAnalyticsExecution(workspace.id, period, timezone);
  const funnel = useAnalyticsFunnel(workspace.id, period, timezone);
  const insights = useAnalyticsInsights(workspace.id, period, timezone);
  const alerts = useAnalyticsAlerts(workspace.id, period, timezone);
  const quality = useAnalyticsDataQuality(workspace.id);
  const publications = useUnifiedPublications(workspace.id);

  async function exportFormat(format: "csv" | "json") {
    setExportError(undefined);
    try {
      const job = await requestAnalyticsExport(workspace.id, format, {
        metrics: ["publication_requested_total", "publication_completed_total", "publication_failed_total", "publication_success_rate"],
        timezone,
        period: periodForExport,
      });
      setExportDetail(await getAnalyticsExport(workspace.id, job.id));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Exportação falhou.");
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Analytics"
        description="Entenda o que aconteceu, o que funcionou e onde vale agir agora."
        actions={
          <>
            <div>
              <Label htmlFor="period">Período</Label>
              <select id="period" value={periodChoice} onChange={(event) => setPeriodChoice(event.target.value as PeriodChoice)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink sm:w-36">
                {PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            {periodChoice === "custom" ? (
              <>
                <div>
                  <Label htmlFor="period-from">Início</Label>
                  <Input id="period-from" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="period-to">Fim</Label>
                  <Input id="period-to" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                </div>
              </>
            ) : null}
            <div>
              <Label htmlFor="timezone">Fuso</Label>
              <Input id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="sm:w-44" />
            </div>
            <details className="relative">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-sunken">Exportar</summary>
              <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-border bg-surface-raised p-1 shadow-xl">
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken" onClick={() => exportFormat("csv")}>CSV</button>
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken" onClick={() => exportFormat("json")}>JSON</button>
              </div>
            </details>
          </>
        }
      />

      {exportError ? <Card className="mb-4 border-red-200 bg-red-50 p-3 text-sm text-red-700">{exportError}</Card> : null}
      {exportDetail ? <Card className="mb-4 p-3 text-sm text-ink-muted">Exportação {exportDetail.job.status}. {exportDetail.artifact ? "Arquivo gerado para download via API." : "Arquivo ainda em processamento."}</Card> : null}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {AREAS.map((item) => (
          <button key={item.id} type="button" onClick={() => setArea(item.id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${area === item.id ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:bg-surface-sunken hover:text-ink"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {area === "overview" ? (
        <OverviewPanel result={overview.data} isLoading={overview.isLoading} error={overview.error} onRetry={() => overview.mutate()} insights={insights.data ?? []} publications={publications.data ?? []} workspaceId={workspace.id} />
      ) : null}
      {area === "content" ? (
        <ContentPanel campaigns={campaigns.data} publication={publication.data} funnel={funnel.data} publications={publications.data ?? []} isLoading={campaigns.isLoading || publication.isLoading || funnel.isLoading || publications.isLoading} error={campaigns.error ?? publication.error ?? funnel.error ?? publications.error} onRetry={() => { campaigns.mutate(); publication.mutate(); funnel.mutate(); publications.mutate(); }} workspaceId={workspace.id} />
      ) : null}
      {area === "networks" ? (
        <NetworksPanel providers={providers.data} publications={publications.data ?? []} isLoading={providers.isLoading || publications.isLoading} error={providers.error ?? publications.error} onRetry={() => { providers.mutate(); publications.mutate(); }} />
      ) : null}
      {area === "ai" ? (
        <AiPanel campaigns={campaigns.data} execution={execution.data} isLoading={campaigns.isLoading || execution.isLoading} error={campaigns.error ?? execution.error} onRetry={() => { campaigns.mutate(); execution.mutate(); }} />
      ) : null}
      {area === "health" ? (
        <HealthPanel publication={publication.data} quality={quality.data} alerts={alerts.data ?? []} isLoading={publication.isLoading || quality.isLoading || alerts.isLoading} error={publication.error ?? quality.error ?? alerts.error} onRetry={() => { publication.mutate(); quality.mutate(); alerts.mutate(); }} />
      ) : null}
    </main>
  );
}

function OverviewPanel({ result, isLoading, error, onRetry, insights, publications, workspaceId }: { result?: AnalyticsQueryResult; isLoading: boolean; error?: unknown; onRetry: () => void; insights: readonly AnalyticsInsight[]; publications: readonly UnifiedPublication[]; workspaceId: string }) {
  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!result || !hasResultData(result, publications)) return <NoData />;

  const requested = metricCard(result, "publication_requested_total", "Publicações");
  const completed = metricCard(result, "publication_completed_total", "Publicadas");
  const successRate = metricCard(result, "publication_success_rate", "Taxa de sucesso");
  const failed = metricCard(result, "publication_failed_total", "Falhas");

  return (
    <div className="space-y-4">
      <StatsGrid>
        <KpiCard label={requested.label} value={requested.value} hint={metricHint(requested.comparison)} />
        <KpiCard label={completed.label} value={completed.value} hint={metricHint(completed.comparison)} />
        <KpiCard label={successRate.label} value={successRate.value} hint={metricHint(successRate.comparison)} accent="positive" />
        <KpiCard label={failed.label} value={failed.value} hint={metricHint(failed.comparison)} accent="negative" />
      </StatsGrid>
      <Freshness result={result} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <TimeSeriesChart
          result={result}
          metricId="publication_completed_total"
          title="Publicações ao longo do tempo"
          description="Publicações concluídas por dia no período selecionado."
        />
        <InsightSummary insights={insights} />
      </div>
      <BestContents publications={publications} workspaceId={workspaceId} />
    </div>
  );
}

function ContentPanel({ campaigns, publication, funnel, publications, isLoading, error, onRetry, workspaceId }: { campaigns?: AnalyticsQueryResult; publication?: AnalyticsQueryResult; funnel?: AnalyticsQueryResult; publications: readonly UnifiedPublication[]; isLoading: boolean; error?: unknown; onRetry: () => void; workspaceId: string }) {
  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!campaigns && !publication && publications.length === 0) return <NoData />;

  const formatRows = formatDistribution(publications);
  const generated = metricCard(campaigns, "content_items_generated_total", "Gerados");
  const approved = metricCard(campaigns, "content_items_approved_total", "Aprovados");
  const published = metricCard(publication, "publication_completed_total", "Publicados");
  const withFailure = metricCard(publication, "publication_failed_total", "Com falha");
  return (
    <div className="space-y-4">
      <StatsGrid>
        <KpiCard label={generated.label} value={generated.value} hint={metricHint(generated.comparison)} />
        <KpiCard label={approved.label} value={approved.value} hint={metricHint(approved.comparison)} accent="positive" />
        <KpiCard label={published.label} value={published.value} hint={metricHint(published.comparison)} />
        <KpiCard label={withFailure.label} value={withFailure.value} hint={metricHint(withFailure.comparison)} accent="negative" />
      </StatsGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <RankingChart title="Desempenho por formato" description="Publicações por tipo de conteúdo no período." rows={formatRows} />
        {funnel?.funnel ? <EditorialFunnelChart stages={funnel.funnel} /> : <EmptyCard title="Funil editorial" description="Ainda não há dados suficientes para montar o funil." />}
      </div>
      <BestContents publications={publications} workspaceId={workspaceId} />
    </div>
  );
}

function NetworksPanel({ providers, publications, isLoading, error, onRetry }: { providers?: AnalyticsQueryResult; publications: readonly UnifiedPublication[]; isLoading: boolean; error?: unknown; onRetry: () => void }) {
  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const rows = providerRows(providers, publications);
  if (rows.length === 0) return <NoData />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((row) => (
        <Card key={row.id} className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{row.label}</p>
              <p className="mt-1 text-xs text-ink-muted">Publicações comparáveis desta rede no período.</p>
            </div>
            <StatusBadge status={row.failed > 0 ? "needs_attention" : "connected"} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SmallNumber label="Publicadas" value={row.completed} />
            <SmallNumber label="Falhas" value={row.failed} />
            <SmallNumber label="Sucesso" value={`${formatNumber(row.successRate)}%`} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function AiPanel({ campaigns, execution, isLoading, error, onRetry }: { campaigns?: AnalyticsQueryResult; execution?: AnalyticsQueryResult; isLoading: boolean; error?: unknown; onRetry: () => void }) {
  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const generated = metricCard(campaigns, "content_items_generated_total", "Conteúdos gerados");
  const approved = metricCard(campaigns, "content_items_approved_total", "Aprovados");
  const rejected = metricCard(campaigns, "content_items_rejected_total", "Rejeições/alterações");
  const duration = metricCard(execution, "execution_duration_ms", "Tempo médio");
  const cards = [generated, approved, rejected, duration];
  const hasData = cards.some((card) => Number(card.rawValue ?? 0) > 0);
  if (!hasData) return <NoData message="Ainda não há dados de IA suficientes para leitura executiva." />;
  return (
    <div className="space-y-4">
      <StatsGrid>
        <KpiCard label={generated.label} value={generated.value} hint={metricHint(generated.comparison)} />
        <KpiCard label={approved.label} value={approved.value} hint={metricHint(approved.comparison)} accent="positive" />
        <KpiCard label={rejected.label} value={rejected.value} hint={metricHint(rejected.comparison)} accent="negative" />
        <KpiCard label={duration.label} value={duration.value} hint={metricHint(duration.comparison)} />
      </StatsGrid>
      <RankingChart
        title="Fluxo de conteúdo"
        description="Comparação entre volume gerado, aprovado e com ajuste."
        rows={[
          { label: "Gerados", value: metricNumber(campaigns, "content_items_generated_total") },
          { label: "Aprovados", value: metricNumber(campaigns, "content_items_approved_total") },
          { label: "Rejeições/alterações", value: metricNumber(campaigns, "content_items_rejected_total") },
        ]}
      />
    </div>
  );
}

function HealthPanel({ publication, quality, alerts, isLoading, error, onRetry }: { publication?: AnalyticsQueryResult; quality?: AnalyticsDataQualityReport; alerts: readonly AnalyticsAlertOccurrence[]; isLoading: boolean; error?: unknown; onRetry: () => void }) {
  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const failureRate = metricNumber(publication, "publication_failure_rate");
  const failures = metricNumber(publication, "publication_failed_total");
  const successRate = metricCard(publication, "publication_success_rate", "Taxa de sucesso");
  const failed = metricCard(publication, "publication_failed_total", "Falhas");
  return (
    <div className="space-y-4">
      <StatsGrid>
        <KpiCard label={successRate.label} value={successRate.value} hint={metricHint(successRate.comparison)} accent="positive" />
        <KpiCard label={failed.label} value={failed.value} hint={metricHint(failed.comparison)} accent="negative" />
        <KpiCard label="Alertas" value={String(alerts.length)} accent={alerts.length > 0 ? "negative" : "default"} />
        <KpiCard
          label="Qualidade"
          value={quality ? qualityLabel(quality.status) : "Pendente"}
          accent={quality?.status === "critical" ? "negative" : quality?.status === "healthy" ? "positive" : "default"}
        />
      </StatsGrid>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Saúde de publicação</h2>
            <p className="mt-1 text-xs text-ink-muted">Taxa de falha e alertas respeitam o período selecionado. Qualidade de dados é um estado atual.</p>
          </div>
          <StatusBadge status={failureRate > 0 || failures > 0 || alerts.length > 0 ? "needs_attention" : "connected"} />
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum alerta ativo para este período.</p>
        ) : (
          <div className="grid gap-2">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 flex flex-wrap gap-2"><StatusBadge status={alert.severity} /><StatusBadge status={alert.status} /></div>
                <p className="text-sm font-semibold text-ink">{alert.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{alert.description}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      {quality ? <QualityCard report={quality} /> : null}
    </div>
  );
}

function BestContents({ publications, workspaceId }: { publications: readonly UnifiedPublication[]; workspaceId: string }) {
  const items = [...publications]
    .filter((post) => derivePublicationStatus(post) !== "draft")
    .sort((a, b) => scorePublication(b) - scorePublication(a))
    .slice(0, 5);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Melhores conteúdos</h2>
        <Link href={`/workspaces/${workspaceId}/campaigns`} className="text-xs font-medium text-accent hover:underline">Abrir conteúdos</Link>
      </div>
      {items.length === 0 ? (
        <EmptyState title="Ainda não há dados suficientes" description="Publique conteúdos para começar a acompanhar os resultados." />
      ) : (
        <div className="grid gap-2">
          {items.map((post) => {
            const status = derivePublicationStatus(post);
            return (
              <Link key={`${post.network}-${post.id}`} href={`/workspaces/${workspaceId}/campaigns`} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface p-3 transition hover:border-accent hover:bg-accent-soft/25">
                <PublicationThumb post={post} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{titleOf(post)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{NETWORK_LABEL[post.network]} · {formatDateTime((post.publishedAt ?? post.scheduledAt ?? post.createdAt))}</p>
                </div>
                <StatusBadge status={status} />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Vira o `hint` do KpiCard — "—" some, o card só mostra o número quando não há comparação. */
function metricHint(comparison?: string) {
  return comparison ? `${comparison} vs. período anterior` : undefined;
}

function TimeSeriesChart({ result, metricId, title, description }: { result: AnalyticsQueryResult; metricId: string; title: string; description?: string }) {
  const points = useMemo(
    () =>
      result.series.points
        .map((point) => ({ label: formatAxisDate(point.from), value: Number(point.values[metricId] ?? 0) }))
        .filter((point) => Number.isFinite(point.value)),
    [result, metricId],
  );
  const empty = points.length < 2 || points.every((point) => point.value === 0);
  return (
    <ChartCard title={title} description={description} empty={empty} emptyText="Ainda não há pontos suficientes para mostrar evolução.">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip {...tooltipStyle} formatter={(value) => formatNumber(Number(value ?? 0))} />
          <Area type="monotone" dataKey="value" name="Publicações" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.25} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RankingChart({ title, description, rows }: { title: string; description?: string; rows: readonly { label: string; value: number }[] }) {
  const cleanRows = useMemo(() => rows.filter((row) => row.value > 0).slice(0, 6), [rows]);
  return (
    <ChartCard title={title} description={description} empty={cleanRows.length === 0} emptyText="Ainda não há dados suficientes para esta leitura.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={cleanRows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...axisProps} />
          <YAxis type="category" dataKey="label" width={120} {...axisProps} />
          <Tooltip {...tooltipStyle} formatter={(value) => formatNumber(Number(value ?? 0))} />
          <Bar dataKey="value" name="Quantidade" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function EditorialFunnelChart({ stages }: { stages: NonNullable<AnalyticsQueryResult["funnel"]> }) {
  const data = useMemo(
    () => stages.map((stage) => ({ name: `${stageLabel(stage.stage)} · ${formatNumber(stage.conversionRate)}%`, value: stage.input })),
    [stages],
  );
  const empty = data.length === 0 || data.every((point) => point.value === 0);
  return (
    <ChartCard title="Funil editorial" description="Volume de itens em cada etapa da produção." empty={empty} emptyText="Ainda não há dados suficientes para montar o funil.">
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip {...tooltipStyle} formatter={(value) => formatNumber(Number(value ?? 0))} />
          <Funnel dataKey="value" data={data} nameKey="name" isAnimationActive={false}>
            <LabelList position="right" dataKey="name" fill="hsl(var(--foreground))" stroke="none" fontSize={12} />
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function InsightSummary({ insights }: { insights: readonly AnalyticsInsight[] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Leituras do período</h2>
      {insights.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhum insight relevante encontrado neste período.</p>
      ) : (
        <div className="space-y-3">
          {insights.slice(0, 3).map((insight) => (
            <div key={insight.insightId} className="rounded-xl border border-border bg-surface p-3">
              <StatusBadge status={insight.severity} />
              <p className="mt-2 text-sm font-semibold text-ink">{insight.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{insight.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QualityCard({ report }: { report: AnalyticsDataQualityReport }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Qualidade dos dados</h2>
        <StatusBadge status={report.status} />
      </div>
      {report.issues.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhum problema de qualidade detectado.</p>
      ) : (
        <div className="space-y-2">
          {report.issues.slice(0, 5).map((issue) => (
            <div key={`${issue.code}-${issue.safeMessage}`} className="rounded-xl border border-border bg-surface p-3">
              <StatusBadge status={issue.severity} />
              <p className="mt-2 text-sm text-ink-muted">{issue.safeMessage}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SmallNumber({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return <Card className="p-4"><EmptyState title={title} description={description} /></Card>;
}

function NoData({ message = "Publique conteúdos para começar a acompanhar os resultados." }: { message?: string }) {
  return <EmptyState title="Ainda não há dados suficientes" description={message} />;
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-surface-sunken" />)}</div>
      <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-surface-sunken" />)}</div>
    </div>
  );
}

function Freshness({ result }: { result: AnalyticsQueryResult }) {
  if (!result.dataFreshness.partialData && !result.dataFreshness.staleData) return null;
  return (
    <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      Alguns dados podem estar parciais neste período. Métricas indisponíveis foram ocultadas quando não havia fonte confiável.
    </Card>
  );
}

function PublicationThumb({ post }: { post: UnifiedPublication }) {
  const image = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  return (
    <span className="flex h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-sunken">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm text-ink-muted">{contentTypeOf(post) === "video" ? "▶" : "▧"}</span>
      )}
    </span>
  );
}

function metricCard(result: AnalyticsQueryResult | undefined, metricId: string, label: string) {
  const value = metricNumber(result, metricId);
  const unit = result?.metrics.find((metric) => metric.metricId === metricId)?.unit ?? "count";
  const comparison = comparisonLabel(result, metricId);
  return { id: metricId, label, value: formatMetric(value, unit), rawValue: value, comparison };
}

function metricNumber(result: AnalyticsQueryResult | undefined, metricId: string): number {
  if (!result) return 0;
  return result.rows.reduce((sum, row) => sum + Number(row.values[metricId] ?? 0), 0);
}

function comparisonLabel(result: AnalyticsQueryResult | undefined, metricId: string): string | undefined {
  const comparison = result?.comparisons.find((item) => item.metricId === metricId);
  if (!comparison || comparison.percentageDifference === null) return undefined;
  const value = Math.round(comparison.percentageDifference * 10) / 10;
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function hasResultData(result: AnalyticsQueryResult, publications: readonly UnifiedPublication[]) {
  return publications.length > 0 || result.rows.some((row) => Object.values(row.values).some((value) => Number(value ?? 0) > 0));
}

function formatDistribution(publications: readonly UnifiedPublication[]) {
  const counts = new Map<string, number>();
  for (const post of publications) {
    const label = contentTypeLabel(contentTypeOf(post));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function providerRows(result: AnalyticsQueryResult | undefined, publications: readonly UnifiedPublication[]) {
  if (result && result.rows.length > 0) {
    return result.rows.map((row) => {
      const provider = row.dimensions.provider || row.key;
      const completed = Number(row.values.publication_completed_total ?? 0);
      const requested = Number(row.values.publication_requested_total ?? 0);
      const failed = Number(row.values.publication_failed_total ?? 0);
      const successRate = Number(row.values.publication_success_rate ?? (requested > 0 ? (completed / requested) * 100 : 0));
      return { id: row.key, label: providerLabel(provider), completed, failed, successRate };
    }).filter((row) => row.completed > 0 || row.failed > 0);
  }
  const map = new Map<PublicationNetwork, { completed: number; failed: number; requested: number }>();
  for (const post of publications) {
    const current = map.get(post.network) ?? { completed: 0, failed: 0, requested: 0 };
    const status = derivePublicationStatus(post);
    current.requested += 1;
    if (status === "published") current.completed += 1;
    if (status === "failed") current.failed += 1;
    map.set(post.network, current);
  }
  return [...map.entries()].map(([network, value]) => ({
    id: network,
    label: `${NETWORK_ICON[network]} ${NETWORK_LABEL[network]}`,
    completed: value.completed,
    failed: value.failed,
    successRate: value.requested > 0 ? (value.completed / value.requested) * 100 : 0,
  }));
}

function scorePublication(post: UnifiedPublication) {
  const status = derivePublicationStatus(post);
  const statusScore = status === "published" ? 100 : status === "scheduled" ? 60 : status === "publishing" ? 50 : status === "failed" ? 20 : 10;
  const date = new Date(post.publishedAt ?? post.scheduledAt ?? post.createdAt).getTime();
  return statusScore * 1_000_000_000_000 + (Number.isFinite(date) ? date : 0);
}

function titleOf(post: UnifiedPublication) {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 92) : `${NETWORK_LABEL[post.network]} · ${contentTypeLabel(contentTypeOf(post))}`;
}

function contentTypeLabel(kind: ReturnType<typeof contentTypeOf>) {
  if (kind === "video") return "Vídeo";
  if (kind === "carousel") return "Carrossel";
  if (kind === "image") return "Imagem";
  return "Texto";
}

function providerLabel(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized.includes("instagram")) return "Instagram";
  if (normalized.includes("facebook") || normalized.includes("meta")) return "Meta";
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("youtube")) return "YouTube Shorts";
  return provider;
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    Planning: "Planejado",
    Execution: "Produzido",
    Artifact: "Artefatos",
    Scheduling: "Agendado",
    Publication: "Publicado",
    "Receipt Verified": "Confirmado",
  };
  return labels[stage] ?? stage;
}

function qualityLabel(status: AnalyticsDataQualityReport["status"]) {
  if (status === "healthy") return "Boa";
  if (status === "warning") return "Atenção";
  return "Crítica";
}

function formatMetric(value: number, unit: string) {
  if (unit === "percent") return `${formatNumber(value)}%`;
  if (unit === "ms") return value > 1000 ? `${formatNumber(value / 1000)}s` : `${formatNumber(value)} ms`;
  if (unit === "currency") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(value);
  return formatNumber(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function formatAxisDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}

function periodString(choice: PeriodChoice, from: string, to: string) {
  if (choice === "last_90_days") return `custom:${dateInput(addDays(new Date(), -89))}:${dateInput(addDays(new Date(), 1))}`;
  if (choice === "custom") return `custom:${from}:${to}`;
  return choice;
}

function periodObject(choice: PeriodChoice, from: string, to: string, timezone: string): AnalyticsPeriod {
  if (choice === "last_90_days") return { preset: "custom", from: dateInput(addDays(new Date(), -89)), to: dateInput(addDays(new Date(), 1)), timezone };
  if (choice === "custom") return { preset: "custom", from, to, timezone };
  return { preset: choice, timezone };
}

function dateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
