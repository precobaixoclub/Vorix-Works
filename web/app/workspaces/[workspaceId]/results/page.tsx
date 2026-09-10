"use client";

import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Headphones, LineChart, Megaphone, UsersRound } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/Button";
import { ChannelIcon, channelLabel } from "@/components/ChannelIcon";
import { axisProps, brl, CHART_COLORS, ChartCard, horas, KpiCard, num, pct, ProportionBar, tooltipStyle } from "@/components/DashboardKit";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker, userLabel } from "@/components/UserPicker";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { acknowledgeAnalyticsAlert, resolveAnalyticsAlert } from "@/features/analytics/api";
import { useAnalyticsAlerts, useAnalyticsPublication, useAnalyticsProviders } from "@/features/analytics/hooks";
import type { AnalyticsAlertOccurrence, AnalyticsQueryResult } from "@/features/analytics/types";
import { useCommercialMetrics, usePipelines } from "@/features/crm/hooks";
import type { CommercialMetricsReport } from "@/features/crm/types";
import { useInboxMembers, useInboxMetrics } from "@/features/inbox/hooks";
import type { InboxMetricsReport } from "@/features/inbox/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { derivePublicationStatus, type PublicationNetwork, type UnifiedPublication } from "@/features/publication-history/types";

type ResultsSection = "overview" | "marketing" | "attendance" | "commercial";
type PeriodChoice = "last_7_days" | "last_30_days" | "last_90_days" | "custom";
type ChannelFilter = PublicationNetwork | "all";

const PERIODS: readonly { value: PeriodChoice; label: string }[] = [
  { value: "last_7_days", label: "7 dias" },
  { value: "last_30_days", label: "30 dias" },
  { value: "last_90_days", label: "90 dias" },
  { value: "custom", label: "Personalizado" },
];

const CHANNELS: readonly { value: ChannelFilter; label: string }[] = [
  { value: "all", label: "Todos os canais" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
];

const SECTION_ITEMS = [
  { value: "overview", label: "Visão geral", icon: LineChart },
  { value: "marketing", label: "Marketing", icon: Megaphone },
  { value: "attendance", label: "Atendimento", icon: Headphones },
  { value: "commercial", label: "Comercial", icon: UsersRound },
];

const TIMEZONE = "America/Sao_Paulo";

export default function ResultsPage() {
  const workspace = useCurrentWorkspace();
  const [section, setSection] = useState<ResultsSection>("overview");
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("last_30_days");
  const [dateFrom, setDateFrom] = useState(() => dateInput(addDays(new Date(), -29)));
  const [dateTo, setDateTo] = useState(() => dateInput(new Date()));
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [pipelineId, setPipelineId] = useState("all");
  const [ownerUserId, setOwnerUserId] = useState("all");
  const [teamId, setTeamId] = useState("all");

  const period = useMemo(() => periodString(periodChoice, dateFrom, dateTo), [periodChoice, dateFrom, dateTo]);
  const range = useMemo(() => dateRange(periodChoice, dateFrom, dateTo), [periodChoice, dateFrom, dateTo]);
  const { data: pipelines } = usePipelines(workspace.id);
  const members = useInboxMembers(workspace.id);
  const publications = useUnifiedPublications(workspace.id);
  const publicationAnalytics = useAnalyticsPublication(workspace.id, period, TIMEZONE);
  const providerAnalytics = useAnalyticsProviders(workspace.id, period, TIMEZONE);
  const alerts = useAnalyticsAlerts(workspace.id, period, TIMEZONE);

  const commercialFilters = {
    dateFrom: range.from,
    dateTo: range.to,
    pipelineId: pipelineId === "all" ? undefined : pipelineId,
    ownerUserId: ownerUserId === "all" ? undefined : ownerUserId,
    teamId: teamId === "all" ? undefined : teamId,
    origin: channel === "all" ? undefined : channel,
  };
  const commercial = useCommercialMetrics(workspace.id, commercialFilters);
  const attendance = useInboxMetrics(workspace.id, { dateFrom: range.from, dateTo: range.to });

  const filteredPublications = useMemo(
    () => filterPublications(publications.data ?? [], channel, range.from, range.to),
    [publications.data, channel, range.from, range.to],
  );
  const marketingSummary = useMemo(() => summarizePublications(filteredPublications), [filteredPublications]);

  const pipelineItems = (pipelines ?? []).map((pipeline) => ({ id: pipeline.id, label: pipeline.name }));
  const loading =
    commercial.isLoading ||
    attendance.isLoading ||
    publications.isLoading ||
    publicationAnalytics.isLoading ||
    providerAnalytics.isLoading ||
    alerts.isLoading;
  const error = commercial.error ?? attendance.error ?? publications.error ?? publicationAnalytics.error ?? providerAnalytics.error ?? alerts.error;

  function retryAll() {
    void commercial.mutate();
    void attendance.mutate();
    void publications.mutate();
    void publicationAnalytics.mutate();
    void providerAnalytics.mutate();
    void alerts.mutate();
  }

  async function updateAlert(alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") {
    if (action === "acknowledge") await acknowledgeAnalyticsAlert(workspace.id, alert.id);
    else await resolveAnalyticsAlert(workspace.id, alert.id);
    await alerts.mutate();
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Resultados"
        description="Uma leitura integrada de marketing, atendimento e comercial, sempre a partir de dados reais."
      />

      <FilterBar
        summary={periodChoice === "custom" ? `${range.from || "—"} até ${range.to || "—"}` : PERIODS.find((item) => item.value === periodChoice)?.label}
      >
        <div className="min-w-[150px]">
          <Label htmlFor="results-period">Período</Label>
          <Select value={periodChoice} onValueChange={(value) => setPeriodChoice(value as PeriodChoice)}>
            <SelectTrigger id="results-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {periodChoice === "custom" ? (
          <>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Data inicial" className="w-[150px]" />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Data final" className="w-[150px]" />
          </>
        ) : null}
        <div className="min-w-[180px]">
          <Label htmlFor="results-channel">Canal</Label>
          <Select value={channel} onValueChange={(value) => setChannel(value as ChannelFilter)}>
            <SelectTrigger id="results-channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SearchableCombo
          items={pipelineItems}
          value={pipelineId}
          onValueChange={setPipelineId}
          placeholder="Pipeline"
          extraOption={{ value: "all", label: "Todos os pipelines" }}
          className="w-[190px]"
        />
        <UserPicker workspaceId={workspace.id} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "all", label: "Todos os responsáveis" }} className="w-[220px]" />
        <TeamPicker workspaceId={workspace.id} value={teamId} onValueChange={setTeamId} extraOption={{ value: "all", label: "Todas as equipes" }} className="w-[190px]" />
      </FilterBar>

      <PageSubnav items={SECTION_ITEMS} value={section} onValueChange={(value) => setSection(value as ResultsSection)}>
        {error && !loading ? <ErrorState error={error} onRetry={retryAll} /> : null}
        {section === "overview" ? (
          <OverviewSection
            loading={loading}
            attendance={attendance.data}
            commercial={commercial.data}
            marketing={marketingSummary}
            publicationAnalytics={publicationAnalytics.data}
            alerts={alerts.data ?? []}
            onAlertAction={updateAlert}
          />
        ) : null}
        {section === "marketing" ? (
          <MarketingSection
            loading={publications.isLoading || publicationAnalytics.isLoading || providerAnalytics.isLoading || alerts.isLoading}
            publications={filteredPublications}
            summary={marketingSummary}
            publicationAnalytics={publicationAnalytics.data}
            providerAnalytics={providerAnalytics.data}
            alerts={alerts.data ?? []}
            onAlertAction={updateAlert}
          />
        ) : null}
        {section === "attendance" ? (
          <AttendanceSection loading={attendance.isLoading} report={attendance.data} members={members.data?.members} />
        ) : null}
        {section === "commercial" ? (
          <CommercialSection loading={commercial.isLoading} report={commercial.data} />
        ) : null}
      </PageSubnav>
    </main>
  );
}

function OverviewSection({
  loading,
  attendance,
  commercial,
  marketing,
  publicationAnalytics,
  alerts,
  onAlertAction,
}: {
  loading: boolean;
  attendance?: InboxMetricsReport;
  commercial?: CommercialMetricsReport;
  marketing: PublicationSummary;
  publicationAnalytics?: AnalyticsQueryResult;
  alerts: readonly AnalyticsAlertOccurrence[];
  onAlertAction: (alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") => Promise<void>;
}) {
  if (loading) return <ResultsSkeleton />;
  return (
    <div className="space-y-5">
      <StatsGrid>
        <KpiCard label="Publicações" value={metricText(publicationAnalytics, "publication_completed_total", marketing.published)} hint={`${num(marketing.scheduled)} agendadas`} icon={<Megaphone className="h-4 w-4" />} />
        <KpiCard label="Atendimentos recebidos" value={definedNum(attendance?.receivedCount)} hint={`${definedNum(attendance?.resolvedCount)} resolvidos`} icon={<Headphones className="h-4 w-4" />} />
        <KpiCard label="Receita ganha" value={moneyFromCents(commercial?.wonValueCents)} hint={`${definedNum(commercial?.wonCount)} negócios ganhos`} accent="positive" icon={<CheckCircle2 className="h-4 w-4" />} />
        <KpiCard label="Alertas ativos" value={num(alerts.filter((alert) => alert.status === "active").length)} accent={alerts.some((alert) => alert.status === "active") ? "negative" : "default"} icon={<Activity className="h-4 w-4" />} />
      </StatsGrid>

      <ChartCard title="Resultado por área" description="Comparação normalizada dos indicadores principais." empty={!attendance && !commercial && marketing.total === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[
            { name: "Marketing", value: metricNumber(publicationAnalytics, "publication_completed_total") ?? marketing.published },
            { name: "Atendimento", value: attendance?.resolvedCount ?? 0 },
            { name: "Comercial", value: commercial?.wonCount ?? 0 },
          ]}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <AlertsPanel alerts={alerts} onAlertAction={onAlertAction} />
    </div>
  );
}

function MarketingSection({
  loading,
  publications,
  summary,
  publicationAnalytics,
  providerAnalytics,
  alerts,
  onAlertAction,
}: {
  loading: boolean;
  publications: readonly UnifiedPublication[];
  summary: PublicationSummary;
  publicationAnalytics?: AnalyticsQueryResult;
  providerAnalytics?: AnalyticsQueryResult;
  alerts: readonly AnalyticsAlertOccurrence[];
  onAlertAction: (alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") => Promise<void>;
}) {
  if (loading) return <ResultsSkeleton />;
  const byChannel = providerRows(providerAnalytics, publications);
  const series = timeSeries(publicationAnalytics, "publication_completed_total", publications);

  return (
    <div className="space-y-5">
      <StatsGrid>
        <KpiCard label="Criadas" value={metricText(publicationAnalytics, "publication_requested_total", summary.total)} />
        <KpiCard label="Publicadas" value={metricText(publicationAnalytics, "publication_completed_total", summary.published)} accent="positive" />
        <KpiCard label="Agendadas" value={num(summary.scheduled)} />
        <KpiCard label="Falhas" value={metricText(publicationAnalytics, "publication_failed_total", summary.failed)} accent={summary.failed > 0 ? "negative" : "default"} />
      </StatsGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)]">
        <ChartCard title="Publicações no período" description="Série real do endpoint de analytics; quando ausente, usa publicações unificadas." empty={series.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="marketingArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Area type="monotone" dataKey="value" stroke={CHART_COLORS[0]} fill="url(#marketingArea)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Canais" description="Distribuição por rede." empty={byChannel.length === 0}>
          <div className="space-y-4">
            {byChannel.map((row) => (
              <div key={row.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <ChannelIcon channel={row.id} label={row.label} showLabel className="min-w-0 font-medium text-foreground" />
                  <span className="tabular-nums text-muted-foreground">{num(row.completed)} publicadas</span>
                </div>
                <ProportionBar value={row.completed} max={Math.max(...byChannel.map((item) => item.completed), 1)} />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <AlertsPanel alerts={alerts} onAlertAction={onAlertAction} />
    </div>
  );
}

function AttendanceSection({ loading, report, members }: { loading: boolean; report?: InboxMetricsReport; members?: readonly { userId: string; name: string; email: string }[] }) {
  if (loading) return <ResultsSkeleton />;
  if (!report) return <EmptyResults message="Sem dados de atendimento no período." />;

  const maxVolume = Math.max(...report.volumeByAgent.map((item) => item.messageCount), 1);
  return (
    <div className="space-y-5">
      <StatsGrid>
        <KpiCard label="Recebidas" value={num(report.receivedCount)} />
        <KpiCard label="Em aberto" value={num(report.openCount)} />
        <KpiCard label="Pendentes" value={num(report.pendingCount)} />
        <KpiCard label="Resolvidas" value={num(report.resolvedCount)} accent="positive" />
        <KpiCard label="Backlog" value={num(report.backlogCount)} accent={report.backlogCount > 0 ? "negative" : "default"} />
        <KpiCard label="1ª resposta média" value={seconds(report.avgFirstResponseSeconds)} />
        <KpiCard label="Tempo médio" value={seconds(report.avgHandleTimeSeconds)} hint="Quando o backend expõe carimbo de resolução." />
        <KpiCard label="Respostas por IA" value={num(report.aiResolvedMessageCount)} hint={`${num(report.humanResolvedMessageCount)} por humanos`} />
      </StatsGrid>

      <ChartCard title="Volume por responsável" description="Mensagens agrupadas por membro do atendimento." empty={report.volumeByAgent.length === 0}>
        <div className="space-y-4">
          {report.volumeByAgent.map((item) => (
            <div key={item.userId} className="space-y-1.5">
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">{userLabel(item.userId, members)}</span>
                <span className="tabular-nums text-muted-foreground">{num(item.messageCount)}</span>
              </div>
              <ProportionBar value={item.messageCount} max={maxVolume} />
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

function CommercialSection({ loading, report }: { loading: boolean; report?: CommercialMetricsReport }) {
  if (loading) return <ResultsSkeleton />;
  if (!report) return <EmptyResults message="Sem dados comerciais no período." />;

  return (
    <div className="space-y-5">
      <StatsGrid>
        <KpiCard label="Negócios criados" value={num(report.dealsCreatedCount)} />
        <KpiCard label="Valor em aberto" value={moneyFromCents(report.openPipelineValueCents)} />
        <KpiCard label="Ganhos" value={num(report.wonCount)} hint={moneyFromCents(report.wonValueCents)} accent="positive" />
        <KpiCard label="Perdidos" value={num(report.lostCount)} accent={report.lostCount > 0 ? "negative" : "default"} />
        <KpiCard label="Conversão" value={report.conversionRate === undefined ? "—" : pct(report.conversionRate * 100)} />
        <KpiCard label="Ticket médio" value={moneyFromCents(report.avgTicketCents)} />
        <KpiCard label="Ciclo médio" value={report.avgCycleDays === undefined ? "—" : `${report.avgCycleDays.toFixed(1)} dias`} />
        <KpiCard label="Sem próximo passo" value={num(report.dealsWithoutNextActionCount)} accent={report.dealsWithoutNextActionCount > 0 ? "negative" : "default"} />
      </StatsGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <RankingCard title="Tempo por etapa" rows={report.stageAging.map((stage) => ({ label: stage.stageName, value: stage.avgDaysInStage, suffix: `${num(stage.openCount)} abertos` }))} valueFormat={(value) => `${value.toFixed(1)}d`} />
        <RankingCard title="Motivos de perda" rows={report.lossReasons.map((item) => ({ label: item.reason || "Sem motivo", value: item.count }))} valueFormat={(value) => num(value)} />
        <RankingCard title="Receita por origem" rows={report.revenueByOrigin.map((item) => ({ label: item.origin || "Sem origem", value: item.wonValueCents / 100, suffix: `${num(item.wonCount)} ganhos` }))} valueFormat={(value) => brl(value)} />
      </div>
    </div>
  );
}

function AlertsPanel({ alerts, onAlertAction }: { alerts: readonly AnalyticsAlertOccurrence[]; onAlertAction: (alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") => Promise<void> }) {
  const visible = alerts.filter((alert) => alert.status !== "resolved" && alert.status !== "dismissed").slice(0, 4);
  const [busyId, setBusyId] = useState<string | undefined>();
  if (visible.length === 0) return null;

  async function act(alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") {
    setBusyId(`${action}:${alert.id}`);
    try {
      await onAlertAction(alert, action);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Alertas de analytics</h2>
          <p className="text-xs text-muted-foreground">Ações usam os endpoints existentes de reconhecer e resolver.</p>
        </div>
        <StatusBadge status={visible.some((alert) => alert.severity === "critical") ? "critical" : "warning"} />
      </div>
      <div className="space-y-3">
        {visible.map((alert) => (
          <div key={alert.id} className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/25 p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap gap-2">
                <StatusBadge status={alert.severity} />
                <StatusBadge status={alert.status} />
              </div>
              <p className="font-medium text-foreground">{alert.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {alert.status === "active" ? (
                <Button variant="secondary" disabled={busyId === `acknowledge:${alert.id}`} onClick={() => void act(alert, "acknowledge")}>Reconhecer</Button>
              ) : null}
              {alert.status !== "resolved" ? (
                <Button variant="secondary" disabled={busyId === `resolve:${alert.id}`} onClick={() => void act(alert, "resolve")}>Resolver</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RankingCard({
  title,
  rows,
  valueFormat,
}: {
  title: string;
  rows: readonly { label: string; value: number; suffix?: string }[];
  valueFormat: (value: number) => string;
}) {
  const cleanRows = rows.filter((row) => row.value > 0).slice(0, 6);
  const max = Math.max(...cleanRows.map((row) => row.value), 1);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {cleanRows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {cleanRows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-foreground">{row.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{valueFormat(row.value)}</span>
              </div>
              <ProportionBar value={row.value} max={max} />
              {row.suffix ? <p className="text-xs text-muted-foreground">{row.suffix}</p> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function EmptyResults({ message }: { message: string }) {
  return <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">{message}</div>;
}

type PublicationSummary = {
  total: number;
  published: number;
  scheduled: number;
  failed: number;
  cancelled: number;
};

function summarizePublications(publications: readonly UnifiedPublication[]): PublicationSummary {
  const statuses = publications.map((post) => derivePublicationStatus(post));
  return {
    total: publications.length,
    published: statuses.filter((status) => status === "published").length,
    scheduled: statuses.filter((status) => status === "scheduled").length,
    failed: statuses.filter((status) => status === "failed").length,
    cancelled: statuses.filter((status) => status === "cancelled").length,
  };
}

function filterPublications(publications: readonly UnifiedPublication[], channel: ChannelFilter, from?: string, to?: string) {
  return publications.filter((post) => {
    if (channel !== "all" && post.network !== channel) return false;
    const iso = post.publishedAt ?? post.scheduledAt ?? post.createdAt;
    const key = iso.slice(0, 10);
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  });
}

function providerRows(result: AnalyticsQueryResult | undefined, publications: readonly UnifiedPublication[]) {
  if (result?.rows.length) {
    return result.rows
      .map((row) => {
        const provider = row.dimensions.provider || row.dimensions.network || row.key;
        return {
          id: provider.toLowerCase(),
          label: channelLabel(provider),
          completed: Number(row.values.publication_completed_total ?? 0),
        };
      })
      .filter((row) => row.completed > 0);
  }

  const counts = new Map<PublicationNetwork, number>();
  for (const post of publications) {
    if (derivePublicationStatus(post) === "published") counts.set(post.network, (counts.get(post.network) ?? 0) + 1);
  }
  return [...counts.entries()].map(([network, completed]) => ({ id: network, label: channelLabel(network), completed }));
}

function timeSeries(result: AnalyticsQueryResult | undefined, metricId: string, publications: readonly UnifiedPublication[]) {
  const points = result?.series.points
    .map((point) => ({ label: formatAxisDate(point.from), value: Number(point.values[metricId] ?? 0) }))
    .filter((point) => point.value > 0);
  if (points?.length) return points;

  const counts = new Map<string, number>();
  for (const post of publications) {
    if (derivePublicationStatus(post) !== "published") continue;
    const day = (post.publishedAt ?? post.createdAt).slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ label: formatAxisDate(day), value }));
}

function metricNumber(result: AnalyticsQueryResult | undefined, metricId: string): number | undefined {
  if (!result) return undefined;
  return result.rows.reduce((sum, row) => sum + Number(row.values[metricId] ?? 0), 0);
}

function metricText(result: AnalyticsQueryResult | undefined, metricId: string, fallback: number): string {
  const value = metricNumber(result, metricId);
  return num(value ?? fallback);
}

function definedNum(value: number | undefined): string {
  return value === undefined ? "—" : num(value);
}

function seconds(value: number | undefined): string {
  return value === undefined ? "—" : horas(value / 3600);
}

function moneyFromCents(value: number | undefined): string {
  return value === undefined ? "—" : brl(value / 100);
}

function dateRange(period: PeriodChoice, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (period === "custom") return { from: customFrom || undefined, to: customTo || undefined };
  const days = period === "last_7_days" ? 6 : period === "last_90_days" ? 89 : 29;
  return { from: dateInput(addDays(new Date(), -days)), to: dateInput(new Date()) };
}

function periodString(period: PeriodChoice, customFrom: string, customTo: string) {
  if (period === "custom") return `custom:${customFrom || "start"}:${customTo || "end"}`;
  return period;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatAxisDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
