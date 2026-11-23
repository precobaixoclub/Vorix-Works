"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Globe, Headphones, LineChart, Megaphone, UsersRound } from "lucide-react";
import {
  Area,
  AreaChart,
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
import { DetailLinks, MeetingsResults, NoPermission, SiteResults, useSiteSummary } from "@/components/results/ToolResults";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker, userLabel } from "@/components/UserPicker";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { acknowledgeAnalyticsAlert, resolveAnalyticsAlert } from "@/features/analytics/api";
import { useAnalyticsAlerts, useAnalyticsPublication, useAnalyticsProviders } from "@/features/analytics/hooks";
import type { AnalyticsAlertOccurrence, AnalyticsQueryResult } from "@/features/analytics/types";
import { useCommercialMetrics, usePipelines } from "@/features/crm/hooks";
import type { CommercialMetricsReport } from "@/features/crm/types";
import { useInboxMembers, useInboxMetrics } from "@/features/inbox/hooks";
import type { InboxMetricsReport } from "@/features/inbox/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { PERIODS, SECTION_FILTERS, marketingPeriod, periodRange, resolveResultsSection, resultsSectionsFor, sitePeriod, localDate, type PeriodChoice, type ResultsSectionKey, type VisibleResultsSection } from "@/features/results/model";
import { useSolutions } from "@/features/solutions/hooks";
import { derivePublicationStatus, type PublicationNetwork, type UnifiedPublication } from "@/features/publication-history/types";

type ChannelFilter = PublicationNetwork | "all";

const CHANNELS: readonly { value: ChannelFilter; label: string }[] = [
  { value: "all", label: "Todos os canais" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
];
const CONVERSATIONS_CHANNELS: readonly ChannelFilter[] = ["all", "instagram", "facebook"];
const SECTION_ICONS: Record<ResultsSectionKey, typeof LineChart> = { overview: LineChart, attendance: Headphones, commercial: UsersRound, marketing: Megaphone, site: Globe, meetings: CalendarDays };

const TIMEZONE = "America/Sao_Paulo";

/**
 * Resultados (Fase 12): a central ANALÍTICA — desempenho e tendências por ferramenta contratada.
 * O Início continua sendo a central operacional (o que precisa de ação agora). Cada seção consulta
 * só quando aberta; a Visão geral mostra um cartão por ferramenta, cada um com a própria fonte,
 * período e erro — sem somar nem comparar números de naturezas diferentes.
 */
export default function ResultsPage() {
  const workspace = useCurrentWorkspace();
  const base = `/workspaces/${workspace.id}`;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { available } = useSolutions();
  const { can, access, error: accessError } = useMyAccess();
  // Enquanto as permissões carregam, nada é mostrado como "sem permissão" (nem consultado).
  const accessPending = !access && !accessError;
  const sections = useMemo(() => resultsSectionsFor(available, (permission) => Boolean(access) && can(permission)), [available, access]); // eslint-disable-line react-hooks/exhaustive-deps
  const section = resolveResultsSection(params.get("secao"), sections);
  const filters = SECTION_FILTERS[section];
  const allowed = (key: ResultsSectionKey) => sections.some((item) => item.value === key && item.allowed);
  const want = (key: ResultsSectionKey) => allowed(key) && (section === "overview" || section === key);
  const hasMarketing = available.includes("marketing");
  const channelOptions = hasMarketing ? CHANNELS : CHANNELS.filter((item) => CONVERSATIONS_CHANNELS.includes(item.value));

  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("last_30_days");
  const [dateFrom, setDateFrom] = useState(() => localDate(new Date(Date.now() - 29 * 86_400_000)));
  const [dateTo, setDateTo] = useState(() => localDate(new Date()));
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [pipelineId, setPipelineId] = useState("all");
  const [ownerUserId, setOwnerUserId] = useState("all");
  const [teamId, setTeamId] = useState("all");

  const range = useMemo(() => periodRange(periodChoice, dateFrom, dateTo), [periodChoice, dateFrom, dateTo]);
  const mkPeriod = marketingPeriod(periodChoice, range);
  const sPeriod = sitePeriod(periodChoice, range);

  // Consultas por seção: nada sai para seção fechada, ferramenta não contratada ou sem permissão.
  const attendance = useInboxMetrics(workspace.id, { dateFrom: range.from, dateTo: range.to, enabled: want("attendance") });
  const commercialFilters = section === "commercial"
    ? { dateFrom: range.from, dateTo: range.to, pipelineId: pipelineId === "all" ? undefined : pipelineId, ownerUserId: ownerUserId === "all" ? undefined : ownerUserId, teamId: teamId === "all" ? undefined : teamId, origin: channel === "all" ? undefined : channel }
    : { dateFrom: range.from, dateTo: range.to };
  const commercial = useCommercialMetrics(workspace.id, commercialFilters, want("commercial"));
  const { data: pipelines } = usePipelines(workspace.id, section === "commercial" && allowed("commercial"));
  const members = useInboxMembers(section === "attendance" && allowed("attendance") ? workspace.id : "");
  const publications = useUnifiedPublications(workspace.id, want("marketing"));
  const marketingDetail = section === "marketing" && allowed("marketing") && Boolean(mkPeriod);
  const publicationAnalytics = useAnalyticsPublication(workspace.id, mkPeriod ?? "", TIMEZONE, marketingDetail);
  const providerAnalytics = useAnalyticsProviders(workspace.id, mkPeriod ?? "", TIMEZONE, marketingDetail);
  const alerts = useAnalyticsAlerts(workspace.id, mkPeriod ?? "", TIMEZONE, marketingDetail);
  const site = useSiteSummary(workspace.id, sPeriod, want("site"));

  const filteredPublications = useMemo(
    () => filterPublications(publications.data ?? [], section === "marketing" ? channel : "all", range.from, range.to),
    [publications.data, channel, section, range.from, range.to],
  );
  const marketingSummary = useMemo(() => summarizePublications(filteredPublications), [filteredPublications]);
  const pipelineItems = (pipelines ?? []).map((pipeline) => ({ id: pipeline.id, label: pipeline.name }));
  const periodLabel = periodChoice === "custom" ? `${range.from || "—"} até ${range.to || "—"}` : PERIODS.find((item) => item.value === periodChoice)?.label;

  const goTo = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "overview") next.delete("secao");
    else next.set("secao", value);
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  async function updateAlert(alert: AnalyticsAlertOccurrence, action: "acknowledge" | "resolve") {
    if (action === "acknowledge") await acknowledgeAnalyticsAlert(workspace.id, alert.id);
    else await resolveAnalyticsAlert(workspace.id, alert.id);
    await alerts.mutate();
  }

  const current = sections.find((item) => item.value === section);
  if (accessPending) {
    return (
      <main className="mx-auto max-w-7xl space-y-4 px-3 py-5 sm:px-6 sm:py-8">
        <PageHeader title="Resultados" description="Desempenho e tendências da empresa, por ferramenta. O que precisa de ação agora fica no Início." />
        <Skeleton className="h-40 rounded-xl" />
      </main>
    );
  }
  const marketingError = publications.error ?? publicationAnalytics.error ?? providerAnalytics.error ?? alerts.error;

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Resultados" description="Desempenho e tendências da empresa, por ferramenta. O que precisa de ação agora fica no Início." />

      {filters.period || filters.channel || filters.commercial ? (
        <FilterBar summary={filters.period ? periodLabel : undefined}>
          {filters.period ? (
            <div className="min-w-[150px]">
              <Label htmlFor="results-period">Período</Label>
              <Select value={periodChoice} onValueChange={(value) => setPeriodChoice(value as PeriodChoice)}>
                <SelectTrigger id="results-period"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          {filters.period && periodChoice === "custom" ? (
            <>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Data inicial" className="w-[150px]" />
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Data final" className="w-[150px]" />
            </>
          ) : null}
          {filters.channel ? (
            <div className="min-w-[180px]">
              <Label htmlFor="results-channel">{section === "commercial" ? "Origem" : "Rede"}</Label>
              <Select value={channel} onValueChange={(value) => setChannel(value as ChannelFilter)}>
                <SelectTrigger id="results-channel"><SelectValue /></SelectTrigger>
                <SelectContent>{(section === "commercial" ? channelOptions.filter((item) => CONVERSATIONS_CHANNELS.includes(item.value)) : CHANNELS).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          {filters.commercial ? (
            <>
              <SearchableCombo items={pipelineItems} value={pipelineId} onValueChange={setPipelineId} placeholder="Pipeline" extraOption={{ value: "all", label: "Todos os pipelines" }} className="w-[190px]" />
              <UserPicker workspaceId={workspace.id} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "all", label: "Todos os responsáveis" }} className="w-[220px]" />
              <TeamPicker workspaceId={workspace.id} value={teamId} onValueChange={setTeamId} extraOption={{ value: "all", label: "Todas as equipes" }} className="w-[190px]" />
            </>
          ) : null}
        </FilterBar>
      ) : null}

      <PageSubnav items={sections.map((item) => ({ value: item.value, label: item.label, icon: SECTION_ICONS[item.value] }))} value={section} onValueChange={goTo}>
        {section === "overview" ? (
          <div className="grid gap-4" data-testid="results-overview">
            {sections.filter((item) => item.value !== "overview").length === 0 ? <EmptyResults message="Nenhuma ferramenta com indicadores contratada." /> : null}
            {sections.filter((item) => item.value !== "overview").map((item) => (
              <ToolCard key={item.value} section={item} base={base} onOpen={() => goTo(item.value)} period={item.value === "meetings" ? "Hoje e esta semana" : periodLabel}>
                {!item.allowed ? <NoPermission label={item.label} /> : null}
                {item.allowed && item.value === "attendance" ? <AttendanceSummary loading={attendance.isLoading} error={attendance.error} report={attendance.data} onRetry={() => void attendance.mutate()} /> : null}
                {item.allowed && item.value === "commercial" ? <CommercialSummary loading={commercial.isLoading} error={commercial.error} report={commercial.data} onRetry={() => void commercial.mutate()} /> : null}
                {item.allowed && item.value === "marketing" ? <MarketingSummaryCard loading={publications.isLoading} error={publications.error} summary={marketingSummary} onRetry={() => void publications.mutate()} /> : null}
                {item.allowed && item.value === "site" ? <SiteResults compact report={site.data} error={site.error} loading={site.isLoading || !sPeriod} onRetry={() => void site.mutate()} /> : null}
                {item.allowed && item.value === "meetings" ? <MeetingsResults compact workspaceId={workspace.id} /> : null}
              </ToolCard>
            ))}
          </div>
        ) : null}
        {section !== "overview" && current && !current.allowed ? <NoPermission label={current.label} /> : null}
        {section !== "overview" && current?.allowed ? (
          <div className="space-y-5" data-testid={`results-section-${section}`}>
            {section === "marketing" ? (
              marketingError ? <ErrorState error={marketingError} onRetry={() => { void publications.mutate(); void publicationAnalytics.mutate(); void providerAnalytics.mutate(); void alerts.mutate(); }} /> : (
                <>
                  <p className="text-xs text-muted-foreground">Publicações orgânicas nas redes conectadas. Resultados de anúncios ficam em Anúncios.</p>
                  <MarketingSection
                    loading={publications.isLoading || publicationAnalytics.isLoading || providerAnalytics.isLoading || alerts.isLoading}
                    publications={filteredPublications}
                    summary={marketingSummary}
                    publicationAnalytics={publicationAnalytics.data}
                    providerAnalytics={providerAnalytics.data}
                    alerts={alerts.data ?? []}
                    onAlertAction={updateAlert}
                  />
                </>
              )
            ) : null}
            {section === "attendance" ? (attendance.error ? <ErrorState error={attendance.error} onRetry={() => void attendance.mutate()} /> : <AttendanceSection loading={attendance.isLoading} report={attendance.data} members={members.data?.members} />) : null}
            {section === "commercial" ? (commercial.error ? <ErrorState error={commercial.error} onRetry={() => void commercial.mutate()} /> : <CommercialSection loading={commercial.isLoading} report={commercial.data} />) : null}
            {section === "site" ? <SiteResults report={site.data} error={site.error} loading={site.isLoading || !sPeriod} onRetry={() => void site.mutate()} /> : null}
            {section === "meetings" ? <MeetingsResults workspaceId={workspace.id} /> : null}
            <DetailLinks base={base} links={current.details} />
          </div>
        ) : null}
      </PageSubnav>
    </main>
  );
}

function ToolCard({ section, base, period, onOpen, children }: { section: VisibleResultsSection; base: string; period?: string; onOpen: () => void; children: React.ReactNode }) {
  const Icon = SECTION_ICONS[section.value];
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid={`results-card-${section.value}`} aria-label={section.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{section.label}</h2>
        {period ? <span className="text-xs text-muted-foreground">{period}</span> : null}
      </div>
      {children}
      {section.allowed ? (
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          <Button size="sm" variant="secondary" onClick={onOpen}>Ver {section.label.toLowerCase()}</Button>
          {section.details?.[0] ? <Link href={`${base}${section.details[0][1]}`} className="inline-flex min-h-[32px] items-center rounded-md px-2 text-sm font-medium text-primary hover:underline dark:text-primary-glow">{section.details[0][0]}</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

function SummarySkeleton() {
  return <Skeleton className="h-24 rounded-xl" />;
}

function AttendanceSummary({ loading, error, report, onRetry }: { loading: boolean; error?: unknown; report?: InboxMetricsReport; onRetry: () => void }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !report) return <SummarySkeleton />;
  return (
    <StatsGrid>
      <KpiCard label="Atendimentos recebidos" value={num(report.receivedCount)} hint={`${num(report.resolvedCount)} resolvidos`} />
      <KpiCard label="Aguardando" value={num(report.backlogCount)} hint={`${num(report.openCount)} em aberto`} accent={report.backlogCount > 0 ? "negative" : "default"} />
      <KpiCard label="1ª resposta média" value={seconds(report.avgFirstResponseSeconds)} />
    </StatsGrid>
  );
}

function CommercialSummary({ loading, error, report, onRetry }: { loading: boolean; error?: unknown; report?: CommercialMetricsReport; onRetry: () => void }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !report) return <SummarySkeleton />;
  return (
    <>
      <StatsGrid>
        <KpiCard label="Oportunidades criadas" value={num(report.dealsCreatedCount)} />
        <KpiCard label="Oportunidades ganhas" value={num(report.wonCount)} hint={moneyFromCents(report.wonValueCents)} accent="positive" />
        <KpiCard label="Valor em negociação" value={moneyFromCents(report.openPipelineValueCents)} />
      </StatsGrid>
      <p className="text-xs text-muted-foreground">Valor ganho é o valor das oportunidades marcadas como ganhas — não é pagamento recebido.</p>
    </>
  );
}

function MarketingSummaryCard({ loading, error, summary, onRetry }: { loading: boolean; error?: unknown; summary: PublicationSummary; onRetry: () => void }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <SummarySkeleton />;
  return (
    <>
      <StatsGrid>
        <KpiCard label="Publicadas" value={num(summary.published)} accent="positive" />
        <KpiCard label="Agendadas" value={num(summary.scheduled)} />
        <KpiCard label="Falhas" value={num(summary.failed)} accent={summary.failed > 0 ? "negative" : "default"} />
      </StatsGrid>
      <p className="text-xs text-muted-foreground">Publicações orgânicas nas redes conectadas (não incluem anúncios).</p>
    </>
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
        <KpiCard
          label="Satisfação (CSAT)"
          value={report.csatAverage === undefined ? "—" : `${report.csatAverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5`}
          hint={report.csatRequested ? `${num(report.csatResponses ?? 0)} de ${num(report.csatRequested)} avaliaram` : "Ative a pesquisa em Conversas → Regras"}
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Motivos de encerramento" description="Por que os atendimentos foram finalizados no período." empty={!report.closingReasons?.length}>
          <div className="space-y-4">
            {(report.closingReasons ?? []).map((item) => (
              <div key={item.reason} className="space-y-1.5">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-foreground">{item.reason}</span>
                  <span className="tabular-nums text-muted-foreground">{num(item.count)}</span>
                </div>
                <ProportionBar value={item.count} max={Math.max(...(report.closingReasons ?? []).map((row) => row.count), 1)} />
              </div>
            ))}
          </div>
        </ChartCard>
        <ChartCard title="Satisfação por responsável" description="Nota média (1 a 5) dada pelos clientes a quem finalizou o atendimento." empty={!report.csatByAgent?.length}>
          <div className="space-y-4">
            {(report.csatByAgent ?? []).map((item) => (
              <div key={item.userId} className="space-y-1.5">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-foreground">{userLabel(item.userId, members)}</span>
                  <span className="tabular-nums text-muted-foreground">{item.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} · {num(item.responses)} {item.responses === 1 ? "avaliação" : "avaliações"}</span>
                </div>
                <ProportionBar value={item.average} max={5} />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

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
        <KpiCard label="Oportunidades criadas" value={num(report.dealsCreatedCount)} />
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
        <RankingCard title="Valor ganho por origem" rows={report.revenueByOrigin.map((item) => ({ label: item.origin || "Sem origem", value: item.wonValueCents / 100, suffix: `${num(item.wonCount)} ganhos` }))} valueFormat={(value) => brl(value)} />
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

function formatAxisDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
