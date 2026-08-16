"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { getAnalyticsExport, requestAnalyticsExport } from "@/features/analytics/api";
import { useAnalyticsAlerts, useAnalyticsCampaigns, useAnalyticsDataQuality, useAnalyticsExecution, useAnalyticsFunnel, useAnalyticsHealth, useAnalyticsInsights, useAnalyticsMetrics, useAnalyticsOverview, useAnalyticsProviders, useAnalyticsPublication, useAnalyticsScheduling } from "@/features/analytics/hooks";
import type { AnalyticsExportDetail, AnalyticsQueryResult } from "@/features/analytics/types";

const TABS = ["Visão Geral", "Publicações", "Calendário", "Campanhas", "Provedores", "Execução", "Funil", "Insights", "Alertas", "Qualidade", "Exportações"] as const;

export default function AnalyticsPage() {
  const workspace = useCurrentWorkspace();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Visão Geral");
  const [period, setPeriod] = useState("last_30_days");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const overview = useAnalyticsOverview(workspace.id, period, timezone);
  const publication = useAnalyticsPublication(workspace.id, period, timezone);
  const scheduling = useAnalyticsScheduling(workspace.id, period, timezone);
  const campaigns = useAnalyticsCampaigns(workspace.id, period, timezone);
  const providers = useAnalyticsProviders(workspace.id, period, timezone);
  const execution = useAnalyticsExecution(workspace.id, period, timezone);
  const funnel = useAnalyticsFunnel(workspace.id, period, timezone);
  const insights = useAnalyticsInsights(workspace.id, period, timezone);
  const alerts = useAnalyticsAlerts(workspace.id, period, timezone);
  const quality = useAnalyticsDataQuality(workspace.id);
  const health = useAnalyticsHealth(workspace.id);
  const metrics = useAnalyticsMetrics();
  const [exportDetail, setExportDetail] = useState<AnalyticsExportDetail | undefined>();
  const [exportError, setExportError] = useState<string | undefined>();

  const activeQuery = tab === "Publicações" ? publication : tab === "Calendário" ? scheduling : tab === "Campanhas" ? campaigns : tab === "Provedores" ? providers : tab === "Execução" ? execution : tab === "Funil" ? funnel : overview;
  const activeResult = activeQuery.data;
  const activeLoading = [overview, publication, scheduling, campaigns, providers, execution, funnel].some((item) => item.isLoading) && !activeResult;
  const activeError = activeQuery.error;

  async function exportFormat(format: "csv" | "json") {
    setExportError(undefined);
    try {
      const job = await requestAnalyticsExport(workspace.id, format, { metrics: ["publication_requested_total", "publication_completed_total", "publication_failed_total"], timezone, period: { preset: period, timezone } });
      setExportDetail(await getAnalyticsExport(workspace.id, job.id));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Exportação falhou.");
    }
  }

  return (
    <main className="px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Análises" description="Veja resultados, gargalos e alertas das publicações sem precisar abrir relatórios técnicos." />

      <ScreenGuide
        title="Como ler esta tela"
        description="Comece pela Visão Geral. Use as outras abas só quando quiser investigar um ponto específico."
        items={[
          "Escolha o período no topo.",
          "Use Visão Geral para entender o resultado rápido.",
          "Abra Publicações, Calendário ou Execução quando houver queda ou falha.",
          "Use Alertas e Qualidade para saber o que precisa de ação.",
        ]}
        aside={<p>CSV e JSON são exportações. Se você só quer acompanhar desempenho, não precisa mexer neles.</p>}
      />

      <div className="mb-5 grid gap-3 md:grid-cols-[220px_220px_1fr]">
        <div>
          <Label htmlFor="period">Período</Label>
          <select id="period" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="last_7_days">Últimos 7 dias</option>
            <option value="last_30_days">Últimos 30 dias</option>
            <option value="current_week">Semana atual</option>
            <option value="previous_week">Semana anterior</option>
            <option value="current_month">Mês atual</option>
            <option value="previous_month">Mês anterior</option>
          </select>
        </div>
        <div>
          <Label htmlFor="timezone">Fuso horário</Label>
          <Input id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </div>
        <div className="flex flex-wrap items-end justify-start gap-2 md:justify-end">
          <Button variant="secondary" onClick={() => exportFormat("csv")}>CSV</Button>
          <Button variant="secondary" onClick={() => exportFormat("json")}>JSON</Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === item ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:bg-surface-sunken"}`}>
            {item}
          </button>
        ))}
      </div>

      {tab === "Insights" ? <InsightPanel isLoading={insights.isLoading} error={insights.error} onRetry={() => insights.mutate()} items={insights.data ?? []} /> : null}
      {tab === "Alertas" ? <AlertPanel isLoading={alerts.isLoading} error={alerts.error} onRetry={() => alerts.mutate()} items={alerts.data ?? []} /> : null}
      {tab === "Qualidade" ? <QualityPanel isLoading={quality.isLoading} error={quality.error} onRetry={() => quality.mutate()} report={quality.data} health={health.data} /> : null}
      {tab === "Exportações" ? <ExportPanel detail={exportDetail} error={exportError} /> : null}
      {!["Insights", "Alertas", "Qualidade", "Exportações"].includes(tab) ? (
        <ResultPanel isLoading={activeLoading} error={activeError} onRetry={() => activeQuery.mutate()} result={activeResult} metricCount={metrics.data?.length ?? 0} />
      ) : null}
    </main>
  );
}

function ResultPanel({ isLoading, error, onRetry, result, metricCount }: { isLoading: boolean; error?: unknown; onRetry: () => void; result?: AnalyticsQueryResult; metricCount: number }) {
  if (isLoading) return <LoadingPanel />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!result) return <UnavailablePanel />;
  const values = mergeValues(result);
  const metricCards = result.metrics.slice(0, 12).map((metric) => ({ metric, value: values[metric.metricId] }));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        {metricCards.map(({ metric, value }) => (
          <Card key={metric.metricId}>
            <CardBody>
              <p className="text-xs text-ink-muted">{metric.displayName}</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatValue(value, metric.unit, result.dataFreshness.unavailableMetrics.includes(metric.metricId))}</p>
              <p className="mt-1 text-xs text-ink-faint">{metric.category}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      {result.dataFreshness.partialData || result.dataFreshness.staleData ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardBody className="text-sm text-amber-800">Dados parciais ou indisponíveis para: {result.dataFreshness.unavailableMetrics.join(", ") || "fontes atrasadas"}.</CardBody>
        </Card>
      ) : null}
      {result.funnel ? <Funnel stages={result.funnel} /> : <Bars rows={result.rows} />}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Consulta</h2>
          <span className="text-xs text-ink-muted">{metricCount} métricas registradas</span>
        </CardHeader>
        <CardBody>
          {result.rows.length === 0 ? <EmptyState title="Sem dados no período" description="Nenhum evento analítico foi ingerido para este filtro." /> : <RowsTable result={result} />}
        </CardBody>
      </Card>
    </div>
  );
}

function InsightPanel({ isLoading, error, onRetry, items }: { isLoading: boolean; error?: unknown; onRetry: () => void; items: readonly { insightId: string; severity: string; title: string; description: string; generatedAt: string }[] }) {
  if (isLoading) return <LoadingPanel />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (items.length === 0) return <EmptyState title="Sem insights ativos" description="As regras determinísticas não encontraram sinais relevantes no período." />;
  return <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <Card key={item.insightId}><CardBody><StatusBadge status={item.severity} /><h2 className="mt-3 text-sm font-semibold text-ink">{item.title}</h2><p className="mt-1 text-sm text-ink-muted">{item.description}</p><p className="mt-3 text-xs text-ink-faint">{new Date(item.generatedAt).toLocaleString()}</p></CardBody></Card>)}</div>;
}

function AlertPanel({ isLoading, error, onRetry, items }: { isLoading: boolean; error?: unknown; onRetry: () => void; items: readonly { id: string; severity: string; status: string; title: string; description: string; metricId: string; value: number }[] }) {
  if (isLoading) return <LoadingPanel />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (items.length === 0) return <EmptyState title="Sem alertas" description="Nenhuma regra analítica interna está ativa no momento." />;
  return <div className="space-y-3">{items.map((item) => <Card key={item.id}><CardBody className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex gap-2"><StatusBadge status={item.status} /><StatusBadge status={item.severity} /></div><h2 className="mt-2 text-sm font-semibold text-ink">{item.title}</h2><p className="text-sm text-ink-muted">{item.description}</p></div><p className="text-sm font-medium text-ink">{item.metricId}: {item.value}</p></CardBody></Card>)}</div>;
}

function QualityPanel({
  isLoading,
  error,
  onRetry,
  report,
  health,
}: {
  isLoading: boolean;
  error?: unknown;
  onRetry: () => void;
  report?: { status: string; generatedAt: string; issues: readonly { code: string; severity: string; safeMessage: string }[] };
  health?: { status: string; checks: readonly { id: string; status: string; safeMessage: string }[] };
}) {
  if (isLoading) return <LoadingPanel />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!report) return <UnavailablePanel />;
  return (
    <div className="space-y-5">
      <Card><CardBody className="flex items-center justify-between"><div><p className="text-xs text-ink-muted">Qualidade dos dados</p><StatusBadge status={report.status} /></div><p className="text-xs text-ink-faint">{new Date(report.generatedAt).toLocaleString()}</p></CardBody></Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card><CardHeader><h2 className="text-sm font-semibold text-ink">Problemas</h2></CardHeader><CardBody>{report.issues.length === 0 ? <EmptyState title="Sem problemas" description="Nenhuma inconsistência detectada." /> : <ul className="space-y-2">{report.issues.map((issue) => <li key={`${issue.code}-${issue.safeMessage}`} className="rounded-lg bg-surface-sunken p-3 text-sm"><StatusBadge status={issue.severity} /> <span className="ml-2 text-ink">{issue.safeMessage}</span></li>)}</ul>}</CardBody></Card>
        <Card><CardHeader><h2 className="text-sm font-semibold text-ink">Saúde</h2><StatusBadge status={health?.status ?? "pending"} /></CardHeader><CardBody><ul className="space-y-2">{(health?.checks ?? []).map((check) => <li key={check.id} className="flex items-center justify-between gap-3 text-sm"><span className="text-ink-muted">{check.safeMessage}</span><StatusBadge status={check.status} /></li>)}</ul></CardBody></Card>
      </div>
    </div>
  );
}

function ExportPanel({ detail, error }: { detail?: AnalyticsExportDetail; error?: string }) {
  if (error) return <Card className="border-red-200 bg-red-50"><CardBody className="text-sm text-red-700">{error}</CardBody></Card>;
  if (!detail) return <EmptyState title="Nenhuma exportação nesta sessão" description="Use os botões CSV ou JSON acima para solicitar uma exportação temporária." />;
  return <Card><CardHeader><h2 className="text-sm font-semibold text-ink">Exportação {detail.job.id}</h2><StatusBadge status={detail.job.status} /></CardHeader><CardBody><p className="text-sm text-ink-muted">{detail.artifact?.contentType ?? "Artefato pendente"}</p><pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-sunken p-3 text-xs text-ink">{detail.artifact?.body ?? ""}</pre></CardBody></Card>;
}

function Bars({ rows }: { rows: readonly { key: string; values: Record<string, number | null>; dimensions: Record<string, string> }[] }) {
  const bars = rows.flatMap((row) => Object.entries(row.values).map(([metricId, value]) => ({ metricId, value: Number(value ?? 0), label: Object.values(row.dimensions).join(" / ") || metricId })));
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  if (bars.length === 0) return null;
  return <Card><CardHeader><h2 className="text-sm font-semibold text-ink">Distribuição</h2></CardHeader><CardBody className="space-y-3">{bars.slice(0, 12).map((bar) => <div key={`${bar.metricId}-${bar.label}`}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-ink-muted">{bar.label}</span><span className="font-medium text-ink">{formatNumber(bar.value)}</span></div><div className="h-2 rounded-full bg-surface-sunken"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }} /></div></div>)}</CardBody></Card>;
}

function Funnel({ stages }: { stages: readonly { stage: string; input: number; conversionRate: number }[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.input));
  return <Card><CardHeader><h2 className="text-sm font-semibold text-ink">Funil editorial</h2></CardHeader><CardBody className="space-y-3">{stages.map((stage) => <div key={stage.stage} className="grid gap-2 md:grid-cols-[140px_1fr_90px] md:items-center"><span className="text-sm text-ink-muted">{stage.stage}</span><div className="h-8 rounded bg-surface-sunken"><div className="flex h-8 items-center rounded bg-accent px-3 text-xs font-medium text-white" style={{ width: `${Math.max(8, (stage.input / max) * 100)}%` }}>{formatNumber(stage.input)}</div></div><span className="text-right text-xs text-ink-muted">{stage.conversionRate}%</span></div>)}</CardBody></Card>;
}

function RowsTable({ result }: { result: AnalyticsQueryResult }) {
  const metrics = result.metrics.map((metric) => metric.metricId);
  return <div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-border text-xs text-ink-muted"><th className="py-2">Dimensões</th>{metrics.map((metric) => <th key={metric} className="py-2">{metric}</th>)}</tr></thead><tbody>{result.rows.map((row) => <tr key={row.key} className="border-b border-border last:border-0"><td className="py-2 text-ink-muted">{Object.entries(row.dimensions).map(([key, value]) => `${key}: ${value}`).join(" / ") || "Total"}</td>{metrics.map((metric) => <td key={metric} className="py-2 font-medium text-ink">{formatNumber(Number(row.values[metric] ?? 0))}</td>)}</tr>)}</tbody></table></div>;
}

function LoadingPanel() {
  return <div className="flex min-h-64 items-center justify-center"><Spinner className="h-5 w-5 text-ink-muted" /></div>;
}

function UnavailablePanel() {
  return <EmptyState title="Dado indisponível" description="A API não retornou informação para esta consulta. Isso é diferente de zero real." />;
}

function mergeValues(result: AnalyticsQueryResult): Record<string, number | null> {
  return Object.assign({}, ...result.rows.map((row) => row.values));
}

function formatValue(value: number | null | undefined, unit: string, unavailable: boolean) {
  if (unavailable) return "Indisponível";
  if (value === undefined || value === null) return "Pendente";
  if (unit === "percent") return `${formatNumber(value)}%`;
  if (unit === "ms") return `${formatNumber(value)} ms`;
  return formatNumber(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}
