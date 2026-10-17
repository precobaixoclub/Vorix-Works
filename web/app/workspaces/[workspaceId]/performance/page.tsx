"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, CheckSquare, LineChart, Trophy, User, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { KpiCard } from "@/components/DashboardKit";
import { DetailBlock } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { UserPicker, userLabel } from "@/components/UserPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useInboxMembers } from "@/features/inbox/hooks";
import { decideApproval } from "@/features/sales/api";
import { useApprovals, useCommercialSettings, useForecast, usePerformance, useSalesReports, useTeamPerformance } from "@/features/sales/hooks";
import { APPROVAL_REASON_LABEL, GOAL_METRIC_LABEL, formatBp } from "@/features/sales/presentation";
import type { CommercialApprovalRequest, GoalPeriod, PerformanceReport, SalesReports } from "@/features/sales/types";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Section = "mine" | "team" | "forecast" | "reports" | "approvals";

const monthStart = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
const PERIOD_LABEL: Record<GoalPeriod, string> = { monthly: "Mês", quarterly: "Trimestre", annual: "Ano" };

/** Desempenho comercial — tudo agregado no backend a partir de oportunidades GANHAS (snapshot). */
export default function PerformancePage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: settings } = useCommercialSettings(workspace.id);
  const isManager = settings?.visibility.isManager ?? false;
  const section = (searchParams.get("view") as Section | null) ?? "mine";
  const setSection = (value: Section) => router.replace(`?view=${value}`, { scroll: false });
  const [periodType, setPeriodType] = useState<GoalPeriod>("monthly");
  const [periodStart, setPeriodStart] = useState(monthStart());
  const [subjectUserId, setSubjectUserId] = useState("");
  const { data: memberData } = useInboxMembers(workspace.id);
  const members = memberData?.members;

  const items = [
    { value: "mine", label: "Performance", icon: User },
    ...(isManager ? [{ value: "team", label: "Equipe", icon: Users }] : []),
    { value: "forecast", label: "Forecast", icon: LineChart },
    { value: "reports", label: "Relatórios", icon: BarChart3 },
    { value: "approvals", label: "Aprovações", icon: CheckSquare },
  ];

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Desempenho comercial" description="Metas, realizado, forecast e relatórios — vendido é só o que foi ganho." />
      <FilterBar summary={`${PERIOD_LABEL[periodType]} de ${periodStart.split("-").reverse().slice(1).join("/")}`}>
        <div className="min-w-[140px]">
          <Label>Período</Label>
          <Select value={periodType} onValueChange={(value) => setPeriodType(value as GoalPeriod)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="monthly">Mês</SelectItem><SelectItem value="quarterly">Trimestre</SelectItem><SelectItem value="annual">Ano</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label>Início</Label>
          <Input type="month" value={periodStart.slice(0, 7)} onChange={(event) => event.target.value && setPeriodStart(`${event.target.value}-01`)} className="w-[160px]" />
        </div>
        {isManager && section !== "team" && section !== "approvals" ? (
          <div className="min-w-[220px]">
            <Label>Vendedor</Label>
            <UserPicker workspaceId={workspace.id} value={subjectUserId} onValueChange={setSubjectUserId} extraOption={{ value: "", label: section === "mine" ? "Eu" : "Toda a empresa" }} />
          </div>
        ) : null}
      </FilterBar>

      <PageSubnav items={items} value={section} onValueChange={(value) => setSection(value as Section)}>
        {section === "mine" ? <MyPerformance workspaceId={workspace.id} periodType={periodType} periodStart={periodStart} userId={subjectUserId || undefined} /> : null}
        {section === "team" && isManager ? <TeamSection workspaceId={workspace.id} periodType={periodType} periodStart={periodStart} members={members} onOpenSeller={(userId) => { setSubjectUserId(userId); setSection("mine"); }} /> : null}
        {section === "forecast" ? <ForecastSection workspaceId={workspace.id} periodType={periodType === "monthly" ? "quarterly" : periodType} periodStart={periodStart} userId={subjectUserId || undefined} /> : null}
        {section === "reports" ? <ReportsSection workspaceId={workspace.id} periodType={periodType} periodStart={periodStart} userId={subjectUserId || undefined} members={members} /> : null}
        {section === "approvals" ? <ApprovalsSection workspaceId={workspace.id} isManager={isManager} members={members} /> : null}
      </PageSubnav>
    </main>
  );
}

function money(cents: number | undefined) {
  return cents === undefined ? "—" : formatCurrencyCents(cents);
}

function MyPerformance({ workspaceId, periodType, periodStart, userId }: { workspaceId: string; periodType: GoalPeriod; periodStart: string; userId?: string }) {
  const { data, error, isLoading, mutate } = usePerformance(workspaceId, { userId, periodType, periodStart });
  if (isLoading) return <div className="flex justify-center py-14"><Spinner /></div>;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const revenueGoal = data.goals.find((goal) => goal.metric === "sales_revenue");
  return (
    <div className="space-y-6">
      <StatsGrid>
        <KpiCard label="Meta" value={money(revenueGoal?.targetValue)} hint={revenueGoal ? undefined : "sem meta de receita"} />
        <KpiCard label="Vendido" value={money(data.won.revenueCents)} accent="positive" hint={`${data.won.count} negócio(s) ganho(s)`} />
        <KpiCard label="Atingido" value={revenueGoal ? formatBp(revenueGoal.progress.attainmentBp) : "—"} hint={revenueGoal ? `faltam ${money(revenueGoal.progress.remainingValue)}` : undefined} />
        <KpiCard label="Ticket médio" value={money(data.won.averageTicketCents)} hint={data.won.averageMarginBp !== undefined ? `margem média ${formatBp(data.won.averageMarginBp)}` : undefined} />
      </StatsGrid>

      <Card><CardBody className="space-y-7">
        <DetailBlock label="Projeção (nunca somada como vendido)">
          <ProjectionBars report={data} goal={revenueGoal?.targetValue} />
        </DetailBlock>
        {data.goals.length > 1 ? (
          <DetailBlock label="Outras metas do período">
            <div className="grid gap-2 sm:grid-cols-3">
              {data.goals.filter((goal) => goal.metric !== "sales_revenue").map((goal) => (
                <div key={goal.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <p className="text-[11px] text-muted-foreground">{GOAL_METRIC_LABEL[goal.metric]}</p>
                  <p className="tabular-nums">{goal.metric === "won_opportunities" ? goal.progress.realizedValue : money(goal.progress.realizedValue)} de {goal.metric === "won_opportunities" ? goal.targetValue : money(goal.targetValue)} · {formatBp(goal.progress.attainmentBp)}</p>
                </div>
              ))}
            </div>
          </DetailBlock>
        ) : null}
        <DetailBlock label="Pipeline e conversão">
          <div className="grid gap-2 sm:grid-cols-4">
            <Mini label="Pipeline aberto" value={money(data.pipeline.openValueCents)} hint={`${data.pipeline.openCount} oportunidades`} />
            <Mini label="Pipeline ponderado" value={money(data.pipeline.weightedValueCents)} />
            <Mini label="Conversão" value={formatBp(data.conversionBp)} hint={`${data.won.count} ganhas · ${data.lost.count} perdidas`} />
            <Mini label="Ciclo médio" value={data.averageCycleDays !== undefined ? `${data.averageCycleDays.toLocaleString("pt-BR")} dias` : "—"} />
            {data.won.mrrCents > 0 ? <Mini label="MRR vendido" value={money(data.won.mrrCents)} hint={`ARR ${money(data.won.arrCents)}`} /> : null}
            <Mini label="Período anterior" value={data.comparison.available ? money(data.comparison.previousRevenueCents) : "—"} hint={data.comparison.available ? `${data.comparison.previousWonCount} ganhas` : "sem histórico suficiente"} />
          </div>
        </DetailBlock>
        <DetailBlock label="Qualidade dos dados">
          <div className="grid gap-2 sm:grid-cols-5">
            <Mini label="Sem próxima atividade" value={String(data.dataQuality.withoutNextActivity)} warn={data.dataQuality.withoutNextActivity > 0} />
            <Mini label="Paradas" value={String(data.dataQuality.stale)} warn={data.dataQuality.stale > 0} />
            <Mini label="Previsão vencida" value={String(data.dataQuality.overdueExpectedClose)} warn={data.dataQuality.overdueExpectedClose > 0} />
            <Mini label="Sem valor" value={String(data.dataQuality.withoutValue)} />
            <Mini label="Sem responsável" value={String(data.dataQuality.withoutOwner)} />
          </div>
        </DetailBlock>
      </CardBody></Card>
    </div>
  );
}

function ProjectionBars({ report, goal }: { report: PerformanceReport; goal?: number }) {
  const rows = [
    { label: "Realizado (ganho)", value: report.forecast.wonCents, className: "bg-emerald-500" },
    { label: "Commit", value: report.forecast.commitCents, className: "bg-sky-500" },
    { label: "Best case", value: report.forecast.bestCaseCents, className: "bg-violet-500" },
    { label: "Pipeline ponderado", value: report.forecast.weightedCents, className: "bg-amber-500" },
  ];
  const max = Math.max(goal ?? 0, ...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[140px_1fr_110px] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", row.className)} style={{ width: `${(row.value / max) * 100}%` }} />
            {goal ? <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${(goal / max) * 100}%` }} /> : null}
          </div>
          <span className="text-right tabular-nums">{formatCurrencyCents(row.value)}</span>
        </div>
      ))}
      {goal ? <p className="text-xs text-muted-foreground">Linha vertical = meta ({formatCurrencyCents(goal)}). Com o commit, chegaria a {formatBp(Math.round(((report.forecast.wonCents + report.forecast.commitCents) * 10000) / goal))} da meta.</p> : null}
    </div>
  );
}

function Mini({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-medium tabular-nums", warn && "text-amber-700 dark:text-amber-300")}>{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TeamSection({ workspaceId, periodType, periodStart, members, onOpenSeller }: { workspaceId: string; periodType: GoalPeriod; periodStart: string; members?: readonly { userId: string; name: string; email: string }[]; onOpenSeller: (userId: string) => void }) {
  const { data, error, isLoading, mutate } = useTeamPerformance(workspaceId, { periodType, periodStart });
  const [rankBy, setRankBy] = useState<"soldCents" | "attainmentBp" | "averageMarginBp" | "wonCount">("soldCents");
  const rows = useMemo(() => [...(data?.sellers ?? [])].sort((a, b) => (b[rankBy] ?? -1) - (a[rankBy] ?? -1)), [data, rankBy]);
  if (isLoading) return <div className="flex justify-center py-14"><Spinner /></div>;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const team = data.team;
  const goal = team.goals.find((item) => item.metric === "sales_revenue");
  return (
    <div className="space-y-6">
      <StatsGrid>
        <KpiCard label="Meta da empresa" value={money(goal?.targetValue)} />
        <KpiCard label="Realizado" value={money(team.won.revenueCents)} accent="positive" hint={goal ? formatBp(goal.progress.attainmentBp) : undefined} />
        <KpiCard label="Pipeline / ponderado" value={money(team.pipeline.openValueCents)} hint={`ponderado ${money(team.pipeline.weightedValueCents)}`} />
        <KpiCard label="Conversão" value={formatBp(team.conversionBp)} hint={`ticket ${money(team.won.averageTicketCents)} · ciclo ${team.averageCycleDays ?? "—"} d`} />
      </StatsGrid>
      <Card><CardBody className="p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-sm font-medium">{data.rankingEnabled ? <span className="inline-flex items-center gap-1.5"><Trophy className="h-4 w-4 text-amber-500" />Ranking</span> : "Vendedores"}</p>
          <Select value={rankBy} onValueChange={(value) => setRankBy(value as typeof rankBy)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="soldCents">Por valor vendido</SelectItem><SelectItem value="attainmentBp">Por % da meta</SelectItem><SelectItem value="averageMarginBp">Por margem</SelectItem><SelectItem value="wonCount">Por negócios</SelectItem></SelectContent>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {data.rankingEnabled ? <TableHead className="w-10">#</TableHead> : null}
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Vendido</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Margem</TableHead>
              <TableHead className="text-right">Ganhos</TableHead>
              <TableHead className="text-right">Pipeline</TableHead>
              <TableHead className="text-right">Ponderado</TableHead>
              <TableHead className="text-right">Conversão</TableHead>
              <TableHead className="text-right">Ticket</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Nenhum vendedor com atividade no período.</TableCell></TableRow> : rows.map((row, index) => (
              <TableRow key={row.userId} className="cursor-pointer" onClick={() => onOpenSeller(row.userId)}>
                {data.rankingEnabled ? <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell> : null}
                <TableCell className="font-medium">{userLabel(row.userId, members)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.goalCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.soldCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBp(row.attainmentBp)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBp(row.averageMarginBp)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.wonCount}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.pipelineCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.weightedCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBp(row.conversionBp)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.averageTicketCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody></Card>
    </div>
  );
}

function ForecastSection({ workspaceId, periodType, periodStart, userId }: { workspaceId: string; periodType: GoalPeriod; periodStart: string; userId?: string }) {
  const { data, error, isLoading, mutate } = useForecast(workspaceId, { userId, periodType, periodStart });
  if (isLoading) return <div className="flex justify-center py-14"><Spinner /></div>;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  return (
    <Card><CardBody className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês</TableHead>
            <TableHead className="text-right">Ganho</TableHead>
            <TableHead className="text-right">Commit</TableHead>
            <TableHead className="text-right">Best case</TableHead>
            <TableHead className="text-right">Pipeline</TableHead>
            <TableHead className="text-right">Ponderado</TableHead>
            <TableHead className="text-right">Meta</TableHead>
            <TableHead className="text-right">Gap</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data.months.map((row) => ({ ...row, label: row.month.split("-").reverse().slice(1).join("/") })), { ...data.totals, label: "Total", month: "total" }].map((row) => (
            <TableRow key={row.month} className={row.month === "total" ? "font-semibold" : undefined}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.wonCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.commitCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.bestCaseCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.pipelineCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.weightedCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.goalCents)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", (row.gapCents ?? 0) > 0 && "text-rose-600 dark:text-rose-300")}>{money(row.gapCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-4 py-3 text-xs text-muted-foreground">Commit, best case e pipeline consideram oportunidades abertas com previsão de fechamento no mês. Gap = meta − ganho.</p>
    </CardBody></Card>
  );
}

function rangeOf(periodType: GoalPeriod, periodStart: string) {
  const [year, month] = periodStart.split("-").map(Number);
  const months = periodType === "annual" ? 12 : periodType === "quarterly" ? 3 : 1;
  const startMonth = periodType === "annual" ? 1 : periodType === "quarterly" ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  const from = new Date(Date.UTC(year, startMonth - 1, 1));
  const to = new Date(Date.UTC(year, startMonth - 1 + months, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function ReportsSection({ workspaceId, periodType, periodStart, userId, members }: { workspaceId: string; periodType: GoalPeriod; periodStart: string; userId?: string; members?: readonly { userId: string; name: string; email: string }[] }) {
  const range = rangeOf(periodType, periodStart);
  const { data, error, isLoading, mutate } = useSalesReports(workspaceId, { ...range, userId });
  if (isLoading) return <div className="flex justify-center py-14"><Spinner /></div>;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  return <ReportsView data={data} members={members} />;
}

function ReportsView({ data, members }: { data: SalesReports; members?: readonly { userId: string; name: string; email: string }[] }) {
  return (
    <div className="space-y-6">
      <StatsGrid>
        <KpiCard label="Conversão" value={formatBp(data.conversion.conversionBp)} hint={`${data.conversion.won} ganhas · ${data.conversion.lost} perdidas`} />
        <KpiCard label="Valor perdido" value={money(data.losses.valueCents)} accent="negative" hint={`${data.losses.count} perdas`} />
        <KpiCard label="Propostas aceitas" value={formatBp(data.proposals.sentToAcceptedBp)} hint={`${data.proposals.accepted} de ${data.proposals.sent} enviadas`} />
        <KpiCard label="Ciclo médio (ganhas)" value={data.cycle.averageDaysWon !== undefined ? `${data.cycle.averageDaysWon} dias` : "—"} />
      </StatsGrid>
      <Card><CardBody className="space-y-8">
        <DetailBlock label="Produtos mais vendidos">
          <SimpleTable headers={["Produto", "Qtd.", "Receita", "Margem", "Ganhos", "Perdidos", "Conversão"]} rows={data.products.map((row) => [row.name, String(row.quantity).replace(".", ","), money(row.revenueCents), formatBp(row.grossMarginBp), String(row.wonDeals), String(row.lostDeals), formatBp(row.conversionBp)])} empty="Nenhum produto vendido no período." />
        </DetailBlock>
        <DetailBlock label="Perdas">
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleTable headers={["Motivo", "Perdas"]} rows={data.losses.byReason.map((row) => [row.reason, String(row.count)])} empty="Sem perdas no período." />
            <SimpleTable headers={["Vendedor", "Perdas"]} rows={data.losses.bySeller.map((row) => [userLabel(row.userId === "—" ? undefined : row.userId, members), String(row.count)])} empty="—" />
          </div>
        </DetailBlock>
        <DetailBlock label="Funil (entradas no período)">
          {data.funnel.length === 0 ? <p className="text-sm text-muted-foreground">Sem movimentação no período.</p> : data.funnel.map((pipeline) => (
            <SimpleTable key={pipeline.pipelineId} headers={["Etapa", "Entraram", "Avanço", "Tempo médio"]} rows={pipeline.stages.map((stage) => [stage.name, String(stage.entered), formatBp(stage.advanceRateBp), stage.averageDays !== undefined ? `${stage.averageDays} d` : "—"])} empty="—" />
          ))}
        </DetailBlock>
        <DetailBlock label="Propostas">
          <div className="grid gap-2 sm:grid-cols-4">
            <Mini label="Criadas / enviadas" value={`${data.proposals.created} / ${data.proposals.sent}`} />
            <Mini label="Enviada → aberta" value={formatBp(data.proposals.sentToViewedBp)} hint={data.proposals.averageHoursSentToViewed !== undefined ? `em média ${data.proposals.averageHoursSentToViewed} h` : undefined} />
            <Mini label="Aberta → aceita" value={formatBp(data.proposals.viewedToAcceptedBp)} hint={data.proposals.averageHoursViewedToAccepted !== undefined ? `em média ${data.proposals.averageHoursViewedToAccepted} h` : undefined} />
            <Mini label="Recusadas / expiradas" value={`${data.proposals.declined} / ${data.proposals.expired}`} />
          </div>
        </DetailBlock>
        {data.margin ? (
          <DetailBlock label="Margem">
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <Mini label="Receita" value={money(data.margin.revenueCents)} />
              <Mini label="Custo" value={money(data.margin.costCents)} />
              <Mini label="Lucro bruto" value={money(data.margin.grossProfitCents)} />
              <Mini label="Margem" value={formatBp(data.margin.grossMarginBp)} />
            </div>
            <SimpleTable headers={["Vendedor", "Receita", "Lucro", "Margem"]} rows={data.margin.bySeller.map((row) => [userLabel(row.userId === "—" ? undefined : row.userId, members), money(row.revenueCents), money(row.grossProfitCents), formatBp(row.grossMarginBp)])} empty="—" />
          </DetailBlock>
        ) : null}
        <DetailBlock label="Descontos e aprovações">
          <div className="grid gap-2 sm:grid-cols-4">
            <Mini label="Desconto médio (ganhas)" value={formatBp(data.discounts.averageDiscountBp)} />
            <Mini label="Total concedido" value={money(data.discounts.totalDiscountCents)} />
            <Mini label="Vendas abaixo da tabela" value={String(data.discounts.wonWithDiscount)} />
            <Mini label="Aprovações" value={`${data.discounts.approvalsApproved} aprovadas · ${data.discounts.approvalsRejected} recusadas`} hint={`${data.discounts.approvalsRequested} pedidas`} />
          </div>
        </DetailBlock>
        <DetailBlock label="Conversão por vendedor e origem">
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleTable headers={["Vendedor", "Ganhas", "Perdidas", "Conversão"]} rows={data.conversion.bySeller.map((row) => [userLabel(row.id === "—" ? undefined : row.id, members), String(row.won), String(row.lost), formatBp(row.conversionBp)])} empty="—" />
            <SimpleTable headers={["Origem", "Ganhas", "Perdidas", "Conversão"]} rows={data.conversion.byOrigin.map((row) => [row.id, String(row.won), String(row.lost), formatBp(row.conversionBp)])} empty="—" />
          </div>
        </DetailBlock>
      </CardBody></Card>
    </div>
  );
}

function SimpleTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  return (
    <Table>
      <TableHeader><TableRow>{headers.map((header, index) => <TableHead key={header} className={index > 0 ? "text-right" : undefined}>{header}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableRow><TableCell colSpan={headers.length} className="py-6 text-center text-muted-foreground">{empty}</TableCell></TableRow> : rows.map((row, index) => (
          <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex} className={cellIndex > 0 ? "text-right tabular-nums" : "font-medium"}>{cell}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ApprovalsSection({ workspaceId, isManager, members }: { workspaceId: string; isManager: boolean; members?: readonly { userId: string; name: string; email: string }[] }) {
  const [status, setStatus] = useState<CommercialApprovalRequest["status"]>("pending");
  const { data, error, isLoading, mutate } = useApprovals(workspaceId, { status });
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((value) => <Button key={value} size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>{value === "pending" ? "Pendentes" : value === "approved" ? "Aprovadas" : "Recusadas"}</Button>)}
      </div>
      {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : error ? <ErrorState error={error} onRetry={() => mutate()} /> : (data ?? []).length === 0 ? (
        <Card><CardBody><p className="py-6 text-center text-sm text-muted-foreground">{status === "pending" ? "Nenhum pedido aguardando decisão." : "Nada por aqui."}</p></CardBody></Card>
      ) : (data ?? []).map((request) => <ApprovalCard key={request.id} workspaceId={workspaceId} request={request} isManager={isManager} members={members} onDecided={() => mutate()} />)}
    </div>
  );
}

function ApprovalCard({ workspaceId, request, isManager, members, onDecided }: { workspaceId: string; request: CommercialApprovalRequest; isManager: boolean; members?: readonly { userId: string; name: string; email: string }[]; onDecided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected">();
  const snapshot = request.snapshot;
  const currency = snapshot.currency ?? "BRL";
  async function decide(decision: "approved" | "rejected") {
    setBusy(decision);
    try {
      await decideApproval(request.id, { workspaceId, decision, reason: reason.trim() || undefined });
      toast.success(decision === "approved" ? "Condição aprovada." : "Condição recusada.");
      onDecided();
    } catch (cause) {
      toast.error("Não foi possível decidir", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Card><CardBody className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{snapshot.dealTitle ?? "Oportunidade"}{snapshot.contactName ? <span className="text-muted-foreground"> · {snapshot.contactName}</span> : null}</p>
          <p className="text-xs text-muted-foreground">Vendedor: {userLabel(request.requestedByUserId, members)} · {formatDateTime(request.createdAt)}</p>
        </div>
        <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{request.reasons.map((item) => APPROVAL_REASON_LABEL[item]).join(" · ")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Mini label="Tabela" value={formatCurrencyCents(snapshot.listTotalCents ?? 0, currency)} />
        <Mini label="Mínimo" value={snapshot.minimumTotalCents !== undefined ? formatCurrencyCents(snapshot.minimumTotalCents, currency) : "—"} />
        <Mini label="Solicitado" value={formatCurrencyCents(snapshot.requestedTotalCents ?? 0, currency)} hint={`desconto ${formatBp(snapshot.discountBp)}`} />
        <Mini label="Margem" value={snapshot.proposedMarginBp !== undefined ? `${formatBp(snapshot.originalMarginBp)} → ${formatBp(snapshot.proposedMarginBp)}` : "—"} hint={snapshot.costCents !== undefined ? `custo ${formatCurrencyCents(snapshot.costCents, currency)}` : undefined} />
      </div>
      {request.justification ? <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">“{request.justification}”</p> : null}
      {request.status !== "pending" ? <p className="text-sm text-muted-foreground">{request.status === "approved" ? "Aprovado" : "Recusado"} por {userLabel(request.decidedByUserId, members)} em {formatDateTime(request.decidedAt)}{request.decisionReason ? ` — ${request.decisionReason}` : ""}</p> : isManager ? (
        <div className="space-y-2">
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo (obrigatório para recusar)" />
          <div className="flex gap-2">
            <Button size="sm" loading={busy === "approved"} disabled={Boolean(busy)} onClick={() => decide("approved")}>Aprovar</Button>
            <Button size="sm" variant="danger" loading={busy === "rejected"} disabled={Boolean(busy) || !reason.trim()} onClick={() => decide("rejected")}>Recusar</Button>
          </div>
        </div>
      ) : <p className="text-sm text-amber-700 dark:text-amber-300">Aguardando decisão do gestor.</p>}
    </CardBody></Card>
  );
}
