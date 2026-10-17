"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/Card";
import { DetailBlock } from "@/components/DetailModal";
import { Input, Label } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import { deleteGoal, upsertGoal } from "@/features/sales/api";
import { useCommercialSettings, useGoals } from "@/features/sales/hooks";
import { GOAL_METRIC_LABEL, formatBp } from "@/features/sales/presentation";
import type { GoalMetric, GoalScope, SalesGoal } from "@/features/sales/types";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const isMoney = (metric: GoalMetric) => metric !== "won_opportunities";

/** Metas comerciais: cada mês com a sua meta (sazonalidade — nunca "anual ÷ 12") + meta anual. */
export default function GoalsSettingsPage() {
  const workspace = useCurrentWorkspace();
  const { data: settings } = useCommercialSettings(workspace.id);
  const [year, setYear] = useState(new Date().getFullYear());
  const [scopeType, setScopeType] = useState<GoalScope>("user");
  const [scopeId, setScopeId] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("sales_revenue");
  const { data: goals, isLoading, mutate } = useGoals(workspace.id, { year });
  const canManage = settings?.visibility.isManager ?? false;

  const relevant = useMemo(() => (goals ?? []).filter((goal) => goal.scopeType === scopeType && (scopeType === "company" || goal.scopeId === scopeId) && goal.metric === metric), [goals, scopeType, scopeId, metric]);
  const byMonth = new Map(relevant.filter((goal) => goal.periodType === "monthly").map((goal) => [Number(goal.periodStart.slice(5, 7)) - 1, goal]));
  const annual = relevant.find((goal) => goal.periodType === "annual");
  const ready = scopeType === "company" || Boolean(scopeId);

  async function save(periodType: "monthly" | "annual", monthIndex: number, raw: string, existing?: SalesGoal) {
    const value = isMoney(metric) ? centsFromCurrencyInput(raw) : Math.round(Number(raw.replace(",", ".")) || 0);
    try {
      if (!raw.trim() || value <= 0) {
        if (existing) await deleteGoal(existing.id, workspace.id);
      } else if (!existing || existing.targetValue !== value) {
        await upsertGoal({ workspaceId: workspace.id, scopeType, scopeId: scopeType === "company" ? undefined : scopeId, metric, periodType, periodStart: `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`, targetValue: value });
      }
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível salvar a meta", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    }
  }

  const display = (value: number) => (isMoney(metric) ? formatCurrencyCents(value) : String(value));
  const monthlySum = [...byMonth.values()].reduce((sum, goal) => sum + goal.targetValue, 0);

  return (
    <SettingsShell active="goals" title="Metas comerciais" description="Metas por vendedor, equipe ou empresa — realizado vem só de oportunidades ganhas.">
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
              <DetailBlock label={`Metas mensais ${year}`} action={<span className="text-xs tabular-nums text-muted-foreground">Soma dos meses: {display(monthlySum)}</span>}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {MONTHS.map((label, index) => {
                    const goal = byMonth.get(index);
                    return <GoalCell key={`${scopeType}-${scopeId}-${metric}-${year}-${index}`} label={label} goal={goal} money={isMoney(metric)} disabled={!canManage} onSave={(raw) => save("monthly", index, raw, goal)} display={display} />;
                  })}
                </div>
              </DetailBlock>
              <DetailBlock label="Meta anual">
                <div className="max-w-xs">
                  <GoalCell key={`${scopeType}-${scopeId}-${metric}-${year}-annual`} label={String(year)} goal={annual} money={isMoney(metric)} disabled={!canManage} onSave={(raw) => save("annual", 0, raw, annual)} display={display} />
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

function GoalCell({ label, goal, money, disabled, onSave, display }: { label: string; goal?: SalesGoal; money: boolean; disabled: boolean; onSave: (raw: string) => void; display: (value: number) => string }) {
  const [value, setValue] = useState(goal ? (money ? currencyInputFromCents(goal.targetValue) : String(goal.targetValue)) : "");
  const attainment = goal?.progress.attainmentBp;
  return (
    <div className="rounded-xl border border-border/60 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <Input value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} onBlur={() => onSave(value)} placeholder="Sem meta" inputMode="decimal" className="mt-1" />
      {goal ? (
        <div className="mt-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", goal.progress.reached ? "bg-emerald-500" : "bg-primary dark:bg-primary-glow")} style={{ width: `${Math.min(100, (attainment ?? 0) / 100)}%` }} /></div>
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{display(goal.progress.realizedValue)} · {formatBp(attainment)}</p>
        </div>
      ) : null}
    </div>
  );
}
