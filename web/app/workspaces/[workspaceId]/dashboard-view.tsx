"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Gauge, Headset, MessageSquareHeart, Target, Timer, WalletCards } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardError, DashboardLoading, KpiCard, ProportionBar, brl, num } from "@/components/DashboardKit";
import { Input } from "@/components/Field";
import { formatDuration } from "@/features/inbox/attendance-labels";
import { useInboxConnections, useInboxMembers } from "@/features/inbox/hooks";
import { useDashboard, type Average, type DashboardAttendance, type DashboardCommercial, type DashboardGoals, type DashboardPeriod } from "@/features/dashboard/api";
import { cn } from "@/lib/utils";

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_month", label: "Mês atual" },
  { value: "last_month", label: "Mês anterior" },
  { value: "custom", label: "Personalizado" },
];

const pctBp = (bp: number | undefined) => (bp === undefined ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(bp / 100)}%`);
const brlCents = (cents: number | undefined) => (cents === undefined ? "—" : brl(cents / 100));
const avgTime = (average: Average) => (average.value === undefined ? "—" : formatDuration(average.value));
/** Média sempre acompanhada da amostra (uma nota 5,0 de 1 avaliação não é uma nota 5,0 de 200). */
const sample = (average: Average, noun: string) => (average.sample ? `${num(average.sample)} ${noun}` : "Sem amostra no período");
const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20";

/**
 * Dashboard principal — Atendimento, SLA, CSAT, Comercial e Metas. Os recortes ("Visualizando")
 * vêm do backend conforme o escopo de quem está logado; nada aqui recalcula indicador.
 */
export function DashboardView({ workspaceId, inboxEnabled }: { workspaceId: string; inboxEnabled: boolean }) {
  const [viewing, setViewing] = useState("me");
  const [period, setPeriod] = useState<DashboardPeriod>("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const { data, error, isLoading, mutate } = useDashboard(workspaceId, { viewing, period, from, to, connectionId: connectionId || undefined });
  const { data: membersData } = useInboxMembers(workspaceId);
  const { data: connectionsData } = useInboxConnections(workspaceId);
  const nameOf = useMemo(() => {
    const names = new Map((membersData?.members ?? []).map((member) => [member.userId, member.name] as const));
    return (userId: string) => names.get(userId) ?? "Usuário";
  }, [membersData]);
  const teamName = (teamId: string) => data?.options?.teams.find((team) => team.id === teamId)?.name ?? "Equipe";

  const attendance = data?.attendance?.available ? data.attendance : undefined;
  const commercial = data?.commercial?.available ? data.commercial : undefined;
  const goals = data?.goals?.available ? data.goals : undefined;

  return (
    <section className="space-y-5" aria-label="Dashboard">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Visualizando
          <select className={cn(selectClass, "block min-w-40")} value={viewing} onChange={(event) => setViewing(event.target.value)}>
            {(data?.options?.viewings ?? [{ value: "me", label: "Eu" }]).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Período
          <select className={cn(selectClass, "block")} value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}>
            {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {period === "custom" ? (
          <>
            <label className="space-y-1 text-xs text-muted-foreground">De<Input type="date" className="h-9" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Até<Input type="date" className="h-9" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </>
        ) : null}
        {inboxEnabled && (connectionsData?.connections.length ?? 0) > 1 ? (
          <label className="space-y-1 text-xs text-muted-foreground">
            Canal
            <select className={cn(selectClass, "block")} value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              <option value="">Todos</option>
              {connectionsData?.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}
            </select>
          </label>
        ) : null}
        {data?.period?.timeZone ? <p className="ml-auto text-[11px] text-muted-foreground">Horário: {data.period.timeZone.replace("America/", "").replace("_", " ")}</p> : null}
      </div>

      {error ? <DashboardError message={error instanceof Error ? error.message : "Não foi possível carregar a dashboard."} onRetry={() => void mutate()} /> : null}
      {isLoading && !data ? <DashboardLoading height={180} /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="FRT médio" value={attendance ? avgTime(attendance.frt) : "—"} hint={attendance ? sample(attendance.frt, "respostas") : "Sem acesso a atendimento"} icon={<Timer className="h-4 w-4" />} />
            <KpiCard label="TMR" value={attendance ? avgTime(attendance.tmr) : "—"} hint={attendance ? sample(attendance.tmr, "finalizados") : undefined} icon={<Clock className="h-4 w-4" />} />
            <KpiCard label="SLA 1ª resposta" value={attendance?.sla.configured ? pctBp(attendance.sla.firstResponse.rateBp) : "—"} hint={attendance ? (attendance.sla.configured ? `${num(attendance.sla.openBreached)} vencidos agora · ${num(attendance.sla.openNear)} perto de vencer` : "SLA não configurado") : undefined} accent={attendance && attendance.sla.openBreached > 0 ? "negative" : "default"} icon={<Gauge className="h-4 w-4" />} />
            <KpiCard label="CSAT" value={attendance?.csat.average.value !== undefined ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(attendance.csat.average.value) : "—"} hint={attendance ? sample(attendance.csat.average, "avaliações") : undefined} icon={<MessageSquareHeart className="h-4 w-4" />} />
            <KpiCard label="Finalizados" value={attendance ? num(attendance.volume.finalized) : "—"} hint={attendance ? `${num(attendance.volume.opened)} abertos no período` : undefined} icon={<CheckCircle2 className="h-4 w-4" />} />
          </div>

          {attendance ? <AttendanceSection attendance={attendance} nameOf={nameOf} teamName={teamName} /> : null}
          {commercial ? <CommercialSection commercial={commercial} nameOf={nameOf} /> : null}
          {goals ? <GoalsSection goals={goals} /> : null}
          {!attendance && !commercial && !goals ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum indicador disponível para este recorte com as suas permissões.</p> : null}
        </>
      ) : null}
    </section>
  );
}

function Block({ title, icon: Icon, description, children }: { title: string; icon: typeof Headset; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary dark:text-primary-glow" /> {title}</CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "danger" }) {
  return (
    <div className={cn("rounded-xl border border-border/60 px-3 py-2", tone === "danger" && "border-destructive/30 bg-destructive/5", tone === "warning" && "border-warning/40 bg-warning/5")}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function BarList({ rows, emptyText }: { rows: { label: string; value: number; detail: string }[]; emptyText: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex justify-between gap-2 text-xs"><span className="truncate text-foreground">{row.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{row.detail}</span></div>
          <ProportionBar value={row.value} max={max} />
        </li>
      ))}
    </ul>
  );
}

function AttendanceSection({ attendance, nameOf, teamName }: { attendance: DashboardAttendance; nameOf: (userId: string) => string; teamName: (teamId: string) => string }) {
  const { backlog } = attendance;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Block title="Atendimento" icon={Headset} description="FRT por ciclo de responsabilidade: o relógio de cada pessoa começa quando ela recebe o atendimento.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Abertos" value={num(attendance.volume.opened)} />
          <Stat label="Finalizados" value={num(attendance.volume.finalized)} hint="Cada atendimento conta uma vez" />
          <Stat label="Backlog agora" value={num(backlog.total)} tone={backlog.slaBreached ? "danger" : backlog.total ? "warning" : undefined} hint={backlog.slaBreached ? `${num(backlog.slaBreached)} com SLA vencido` : undefined} />
          <Stat label="FRT do atendimento" value={avgTime(attendance.frtAttendance)} hint={`Abertura → 1ª resposta · ${sample(attendance.frtAttendance, "atendimentos")}`} />
          <Stat label="Tempo de posse" value={avgTime(attendance.holding)} hint={`Por responsável · ${sample(attendance.holding, "ciclos")}`} />
          <Stat label="Transferências" value={num(attendance.transfers.count)} hint={`${pctBp(attendance.transfers.rateBp)} dos finalizados · média ${attendance.transfers.averagePerAttendance ?? "—"}`} />
          <Stat label="Reabertos" value={num(attendance.volume.reopened)} hint={`${pctBp(attendance.volume.reopenRateBp)} dos finalizados`} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Backlog atual</p>
          <BarList emptyText="Nenhum atendimento aberto." rows={[
            { label: "Na fila (sem responsável)", value: backlog.queue, detail: num(backlog.queue) },
            { label: "Sem 1ª resposta do responsável", value: backlog.awaitingFirstResponse, detail: num(backlog.awaitingFirstResponse) },
            { label: "Aguardando atendente", value: backlog.awaitingAgent, detail: num(backlog.awaitingAgent) },
            { label: "Aguardando cliente", value: backlog.awaitingCustomer, detail: num(backlog.awaitingCustomer) },
          ].filter((row) => backlog.total > 0)} />
        </div>
      </Block>

      <Block title="SLA e satisfação" icon={Gauge} description="SLA é prazo operacional; CSAT é a avaliação do cliente na pesquisa ao finalizar.">
        {attendance.sla.configured ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="1ª resposta no prazo" value={pctBp(attendance.sla.firstResponse.rateBp)} hint={`${num(attendance.sla.firstResponse.met)} no prazo · ${num(attendance.sla.firstResponse.breached)} fora`} />
            <Stat label="Resolução no prazo" value={pctBp(attendance.sla.resolution.rateBp)} hint={`${num(attendance.sla.resolution.met)} no prazo · ${num(attendance.sla.resolution.breached)} fora`} />
            <Stat label="Vencidos agora" value={num(attendance.sla.openBreached)} tone={attendance.sla.openBreached ? "danger" : undefined} />
            <Stat label="Perto de vencer" value={num(attendance.sla.openNear)} tone={attendance.sla.openNear ? "warning" : undefined} />
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> Nenhum prazo de SLA configurado. Configure em Configurações &gt; Atendimento.</p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="CSAT médio" value={attendance.csat.average.value !== undefined ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(attendance.csat.average.value)}/5` : "—"} hint={sample(attendance.csat.average, "avaliações")} />
          <Stat label="Pesquisas" value={`${num(attendance.csat.answered)}/${num(attendance.csat.sent)}`} hint={`Respondidas/enviadas · ${pctBp(attendance.csat.responseRateBp)}`} />
          <Stat label="Não enviadas" value={num(attendance.csat.waived + attendance.csat.disabledByChannel)} hint={`${num(attendance.csat.waived)} dispensadas · ${num(attendance.csat.disabledByChannel)} desligadas no canal`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Finalizações</p>
            <BarList emptyText="Sem finalizações no período." rows={attendance.closures.slice(0, 6).map((row) => ({ label: row.subtypeName ? `${row.typeName} > ${row.subtypeName}` : row.typeName, value: row.count, detail: `${num(row.count)} · ${pctBp(row.shareBp)}` }))} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Tempo médio por fase</p>
            <BarList emptyText="Sem movimentação no kanban no período." rows={attendance.phases.slice(0, 6).map((row) => ({ label: row.phaseName, value: row.average.value ?? 0, detail: `${avgTime(row.average)} · ${num(row.average.sample)}` }))} />
          </div>
        </div>
      </Block>

      {attendance.agents.length ? (
        <Block title="Comparativo por pessoa" icon={Headset} description="Participou = recebeu o atendimento em algum momento; finalizou = quem encerrou.">
          <ComparisonTable headers={["Pessoa", "Participou", "Finalizou", "FRT", "Posse", "CSAT", "Transferiu"]} rows={attendance.agents.map((row) => [nameOf(row.userId), num(row.participated), num(row.finalized), avgTime(row.frt), avgTime(row.holding), row.csat.value !== undefined ? `${row.csat.value} (${row.csat.sample})` : "—", num(row.transfersOut)])} />
        </Block>
      ) : null}
      {attendance.teams.length ? (
        <Block title="Comparativo por equipe" icon={Headset}>
          <ComparisonTable headers={["Equipe", "Finalizados", "TMR", "FRT", "CSAT", "Backlog"]} rows={attendance.teams.map((row) => [teamName(row.teamId), num(row.finalized), avgTime(row.tmr), avgTime(row.frt), row.csat.value !== undefined ? `${row.csat.value} (${row.csat.sample})` : "—", num(row.backlog)])} />
        </Block>
      ) : null}
    </div>
  );
}

function CommercialSection({ commercial, nameOf }: { commercial: DashboardCommercial; nameOf: (userId: string) => string }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Block title="Comercial" icon={WalletCards} description="Conversão = ganhas ÷ (ganhas + perdidas) fechadas no período. Ticket médio usa o valor final de fechamento.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Em andamento" value={num(commercial.open.count)} hint={brlCents(commercial.open.valueCents)} />
          <Stat label="Ganhas" value={num(commercial.won.count)} hint={brlCents(commercial.won.valueCents)} />
          <Stat label="Perdidas" value={num(commercial.lost.count)} hint={brlCents(commercial.lost.valueCents)} />
          <Stat label="Conversão" value={pctBp(commercial.conversionBp)} />
          <Stat label="Ticket médio" value={brlCents(commercial.averageTicketCents)} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Pipeline por fase</p>
          <BarList emptyText="Nenhuma oportunidade em andamento." rows={commercial.pipelineByStage.map((row) => ({ label: row.name, value: row.valueCents, detail: `${num(row.count)} · ${brlCents(row.valueCents)}` }))} />
        </div>
      </Block>
      <Block title="Perdas e propostas" icon={WalletCards} description="Proposta aceita não é venda: a conversão em venda conta só as que viraram oportunidade ganha.">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Motivos de perda</p>
          <BarList emptyText="Nenhuma perda no período." rows={commercial.lost.reasons.slice(0, 6).map((row) => ({ label: row.reason, value: row.count, detail: `${num(row.count)} · ${pctBp(row.shareBp)}` }))} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Propostas enviadas" value={num(commercial.proposals.sent)} hint={`${num(commercial.proposals.created)} criadas`} />
          <Stat label="Aceitas" value={num(commercial.proposals.accepted)} hint={`Aceite ${pctBp(commercial.proposals.acceptanceRateBp)} · ${num(commercial.proposals.declined)} recusadas`} />
          <Stat label="Viraram venda" value={num(commercial.proposals.convertedToSale)} hint={`${pctBp(commercial.proposals.saleConversionBp)} das enviadas`} />
        </div>
      </Block>
      {commercial.sellers.length ? (
        <Block title="Comparativo comercial" icon={WalletCards}>
          <ComparisonTable headers={["Vendedor", "Ganhas", "Perdidas", "Vendido", "Conversão"]} rows={commercial.sellers.map((row) => [row.userId === "—" ? "Sem responsável" : nameOf(row.userId), num(row.won), num(row.lost), brlCents(row.wonValueCents), pctBp(row.conversionBp)])} />
        </Block>
      ) : null}
    </div>
  );
}

function GoalsSection({ goals }: { goals: DashboardGoals }) {
  const month = new Date(`${goals.month}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return (
    <Block title={`Meta de ${month}`} icon={Target} description="Realizado = vendas ganhas creditadas no mês. Em andamento = pipeline aberto atual.">
      {goals.hasGoal ? (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            <Stat label="Meta" value={brlCents(goals.targetCents)} />
            <Stat label="Realizado" value={brlCents(goals.realizedCents)} />
            <Stat label="Em andamento" value={brlCents(goals.pipelineCents)} />
            <Stat label="Atingido" value={pctBp(goals.attainmentBp)} />
            <Stat label="Falta" value={brlCents(goals.remainingCents)} />
          </div>
          <ProportionBar value={Math.min(goals.realizedCents, goals.targetCents ?? 0)} max={Math.max(1, goals.targetCents ?? 1)} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma meta de receita definida para este recorte no mês. Realizado: {brlCents(goals.realizedCents)} · em andamento: {brlCents(goals.pipelineCents)}.</p>
      )}
    </Block>
  );
}

function ComparisonTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground">{headers.map((header) => <th key={header} className="px-2 py-1 font-medium">{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border/60">{row.map((cell, cellIndex) => <td key={cellIndex} className={cn("px-2 py-1.5 tabular-nums", cellIndex === 0 && "font-medium text-foreground")}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
