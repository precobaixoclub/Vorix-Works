"use client";

import { useMemo, useState } from "react";
import { CopyCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/Card";
import { DetailBlock } from "@/components/DetailModal";
import { Input, Label, MoneyInput } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import { deleteGoal, setMonthlyGoals, upsertGoal } from "@/features/sales/api";
import { useCommercialSettings, useGoals } from "@/features/sales/hooks";
import { GOAL_METRIC_LABEL, formatBp } from "@/features/sales/presentation";
import type { GoalMetric, GoalScope, SalesGoal } from "@/features/sales/types";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const isMoney = (metric: GoalMetric) => metric !== "won_opportunities";

/**
 * Metas comerciais: cada mês tem a sua meta (sazonalidade). A meta trimestral e a anual são SEMPRE
 * a soma dos meses — calculadas pela API, nunca digitadas. "Repetir nos demais meses" copia o valor
 * de um mês para o ano todo.
 */
export default function GoalsSettingsPage() {
  const workspace = useCurrentWorkspace();
  const { data: settings } = useCommercialSettings(workspace.id);
  const [year, setYear] = useState(new Date().getFullYear());
  const [scopeType, setScopeType] = useState<GoalScope>("user");
  const [scopeId, setScopeId] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("sales_revenue");
  const [applying, setApplying] = useState(false);
  const { data: goals, isLoading, mutate } = useGoals(workspace.id, { year });
  const canManage = settings?.visibility.isManager ?? false;

  const relevant = useMemo(() => (goals ?? []).filter((goal) => goal.scopeType === scopeType && (scopeType === "company" || goal.scopeId === scopeId) && goal.metric === metric), [goals, scopeType, scopeId, metric]);
  const byMonth = new Map(relevant.filter((goal) => goal.periodType === "monthly").map((goal) => [Number(goal.periodStart.slice(5, 7)) - 1, goal]));
  const annual = relevant.find((goal) => goal.periodType === "annual");
  const quarters = relevant.filter((goal) => goal.periodType === "quarterly").sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const ready = scopeType === "company" || Boolean(scopeId);
  const money = isMoney(metric);
  const parse = (raw: string) => (money ? centsFromCurrencyInput(raw) : Math.round(Number(raw.replace(/\./g, "").replace(",", ".")) || 0));
  const scope = { workspaceId: workspace.id, scopeType, scopeId: scopeType === "company" ? undefined : scopeId, metric };

  async function saveMonth(monthIndex: number, raw: string, existing?: SalesGoal) {
    const value = parse(raw);
    if ((existing?.targetValue ?? 0) === (value > 0 ? value : 0)) return;
    try {
      if (!raw.trim() || value <= 0) {
        if (existing) await deleteGoal(existing.id, workspace.id);
      } else {
        await upsertGoal({ ...scope, periodType: "monthly", periodStart: `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`, targetValue: value });
      }
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível salvar a meta", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    }
  }

  async function applyToAllMonths(raw: string) {
    const value = parse(raw);
    if (!(value > 0)) {
      toast.error("Informe um valor no mês antes de repetir.");
      return;
    }
    setApplying(true);
    try {
      await setMonthlyGoals({ ...scope, year, months: Array(12).fill(value) });
      await mutate();
      toast.success(`Meta de ${display(value)} aplicada aos 12 meses — anual: ${display(value * 12)}.`);
    } catch (cause) {
      toast.error("Não foi possível aplicar a meta", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setApplying(false);
    }
  }

  const display = (value: number) => (money ? formatCurrencyCents(value) : value.toLocaleString("pt-BR"));
  const monthlySum = [...byMonth.values()].reduce((sum, goal) => sum + goal.targetValue, 0);
  const cellKey = (suffix: string | number) => `${scopeType}-${scopeId}-${metric}-${year}-${suffix}-${byMonth.size}-${monthlySum}`;

  return (
    <SettingsShell active="goals" title="Metas comerciais" description="Defina a meta de cada mês — a meta trimestral e a anual são calculadas automaticamente pela soma dos meses.">
      <Card>
        <CardBody className="space-y-6">
          {!canManage ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Você pode ver as metas; só gestores as definem.</p> : null}
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label>Ano</Label>
              <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[year - 1, year, year + 1].map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Meta de</Label>
              <Select value={scopeType} onValueChange={(value) => { setScopeType(value as GoalScope); setScopeId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="user">Vendedor</SelectItem><SelectItem value="team">Equipe</SelectItem><SelectItem value="company">Empresa</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>{scopeType === "team" ? "Equipe" : scopeType === "user" ? "Vendedor" : "—"}</Label>
              {scopeType === "user" ? <UserPicker workspaceId={workspace.id} value={scopeId} onValueChange={setScopeId} /> : scopeType === "team" ? <TeamPicker workspaceId={workspace.id} value={scopeId} onValueChange={setScopeId} /> : <Input value="Toda a empresa" disabled />}
            </div>
            <div>
              <Label>Indicador</Label>
              <Select value={metric} onValueChange={(value) => setMetric(value as GoalMetric)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(GOAL_METRIC_LABEL) as GoalMetric[]).map((key) => <SelectItem key={key} value={key}>{GOAL_METRIC_LABEL[key]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !ready ? <p className="text-sm text-muted-foreground">Escolha {scopeType === "team" ? "a equipe" : "o vendedor"}.</p> : (
            <>
              <DetailBlock label={`Metas mensais ${year}`} action={<span className="text-xs text-muted-foreground">Preencha um mês e use <CopyCheck className="inline h-3.5 w-3.5 align-[-2px]" /> para repetir nos demais</span>}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {MONTHS.map((label, index) => {
                    const goal = byMonth.get(index);
                    return (
                      <GoalCell
                        key={cellKey(index)}
                        label={label}
                        goal={goal}
                        money={money}
                        disabled={!canManage || applying}
                        onSave={(raw) => saveMonth(index, raw, goal)}
                        onApplyAll={canManage ? applyToAllMonths : undefined}
                        display={display}
                      />
                    );
                  })}
                </div>
              </DetailBlock>
              <DetailBlock label="Meta anual (soma dos meses)">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_1fr]">
                  <div className="rounded-xl border border-solution/30 bg-solution/[0.06] p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{year}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{monthlySum > 0 ? display(monthlySum) : "—"}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{byMonth.size === 0 ? "Sem metas mensais ainda." : `${byMonth.size} de 12 meses com meta · calculada automaticamente`}</p>
                    {annual ? <Progress goal={annual} display={display} /> : null}
                  </div>
                  {quarters.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {quarters.map((quarter) => (
                        <div key={quarter.id} className="rounded-xl border border-border/60 p-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{Math.floor((Number(quarter.periodStart.slice(5, 7)) - 1) / 3) + 1}º trimestre</p>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{display(quarter.targetValue)}</p>
                          <Progress goal={quarter} display={display} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {annual?.pace ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Realizado no ano {display(annual.progress.realizedValue)} ({formatBp(annual.progress.attainmentBp)}) · ritmo necessário {display(annual.pace.requiredPerRemainingMonth)}/mês · projeção linear {display(annual.pace.projectedValue)}
                  </p>
                ) : null}
              </DetailBlock>
            </>
          )}
        </CardBody>
      </Card>
    </SettingsShell>
  );
}

function Progress({ goal, display }: { goal: SalesGoal; display: (value: number) => string }) {
  const attainment = goal.progress.attainmentBp;
  return (
    <div className="mt-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", goal.progress.reached ? "bg-success" : "bg-primary")} style={{ width: `${Math.min(100, (attainment ?? 0) / 100)}%` }} /></div>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{display(goal.progress.realizedValue)} · {formatBp(attainment)}</p>
    </div>
  );
}

function GoalCell({ label, goal, money, disabled, onSave, onApplyAll, display }: { label: string; goal?: SalesGoal; money: boolean; disabled: boolean; onSave: (raw: string) => void; onApplyAll?: (raw: string) => void; display: (value: number) => string }) {
  const [value, setValue] = useState(goal ? (money ? currencyInputFromCents(goal.targetValue) : goal.targetValue.toLocaleString("pt-BR")) : "");
  return (
    <div className="rounded-xl border border-border/60 p-2.5">
      <div className="flex items-center justify-between gap-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {onApplyAll ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled || !value.trim()}
                onClick={() => onApplyAll(value)}
                aria-label={`Repetir a meta de ${label} nos demais meses`}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <CopyCheck className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Repetir este valor em todos os meses</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {money ? (
        <MoneyInput value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} onBlur={() => onSave(value)} placeholder="Sem meta" className="mt-1" aria-label={`Meta de ${label}`} />
      ) : (
        <Input value={value} disabled={disabled} onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))} onBlur={() => onSave(value)} placeholder="Sem meta" inputMode="numeric" className="mt-1" aria-label={`Meta de ${label}`} />
      )}
      {goal ? <Progress goal={goal} display={display} /> : null}
    </div>
  );
}
