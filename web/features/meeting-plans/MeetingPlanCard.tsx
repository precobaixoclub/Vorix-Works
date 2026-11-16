"use client";

import { useState } from "react";
import { Check, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cancelMeetingPlan,
  changeMeetingPlan,
  formatRecordingTime,
  MEETING_PLAN_STATUS_LABEL,
  revertMeetingPlanCancel,
  startMeetingTrial,
  useMeetingPlan,
  type MeetingPlanCode,
  type MeetingPlanEntry,
  type MeetingPlanOverview,
} from "./api";

const MANAGE_REASON = "Só o dono ou um administrador da organização pode alterar o plano de gravação.";
const CHECKOUT_REASON = "A contratação dos planos pagos abre após a liberação da cobrança. Fale com a equipe Vorix para ativar.";

/** Plano de gravação de reuniões (franquia de horas por ciclo). Regras e bloqueios vêm do backend. */
export function MeetingPlanCard({ className }: { className?: string }) {
  const { data, error, isLoading, mutate } = useMeetingPlan();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function run(action: () => Promise<MeetingPlanOverview>, success: string) {
    setBusy(true);
    try {
      await mutate(await action(), { revalidate: false });
      toast.success(success);
    } catch (err) {
      toast.error("Não foi possível concluir a ação", { description: err instanceof Error ? err.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Card className={className}><CardBody className="space-y-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-24 w-full" /></CardBody></Card>;
  if (error || !data) return <div className={className}><ErrorState error={error} onRetry={() => void mutate()} /></div>;

  const { subscription, usage, allowance, catalog } = data;
  const current = subscription ? (subscription.planCode === "trial" ? catalog.trial : catalog.plans.find((plan) => plan.code === subscription.planCode)) : undefined;
  const live = subscription && ["trial", "active", "past_due"].includes(subscription.status);
  const paidActive = subscription?.status === "active" && subscription.planCode !== "trial";
  const share = usage && usage.limitSeconds ? Math.min(1, usage.usedSeconds / usage.limitSeconds) : 0;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Video className="h-4 w-4" /> Plano de gravação de reuniões</p>
          {subscription ? <Badge variant={subscription.status === "past_due" ? "destructive" : "secondary"}>{current?.name} · {MEETING_PLAN_STATUS_LABEL[subscription.status]}</Badge> : null}
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {!subscription ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Teste grátis por {catalog.trial.days} dias</p>
              <p className="text-sm text-muted-foreground">Até {catalog.trial.recordingHours} horas de gravação, sem cartão. Um teste por organização.</p>
            </div>
            <GuardedButton allowed={data.canManage} blockedReason={MANAGE_REASON} disabled={busy || !data.trialAvailable} onClick={() => void run(startMeetingTrial, "Teste gratuito iniciado")}>Iniciar teste grátis</GuardedButton>
          </div>
        ) : null}

        {subscription && usage ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-foreground">{subscription.planCode === "trial" ? "Uso do teste" : "Uso no ciclo"} ({formatDate(usage.periodStart)} a {formatDate(usage.periodEnd)})</span>
                <span className="tabular-nums text-muted-foreground">{formatRecordingTime(usage.usedSeconds)} de {formatRecordingTime(usage.limitSeconds)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share >= 0.75 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
            </div>
            {allowance && !allowance.ok ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">{allowance.message}</p> : null}
            {subscription.pendingPlanCode ? <p className="text-sm text-muted-foreground">Muda para o plano {catalog.plans.find((plan) => plan.code === subscription.pendingPlanCode)?.name} na renovação, em {formatDate(subscription.currentPeriodEnd)}.</p> : null}
            {subscription.cancelAtPeriodEnd ? <p className="text-sm text-muted-foreground">Cancelamento agendado: você grava até {formatDate(subscription.currentPeriodEnd)} e depois tem {data.rules.exportWindowDays} dias para exportar.</p> : null}
            {!live && subscription.exportUntil && !subscription.exportClosedAt ? <p className="text-sm text-muted-foreground">Novas gravações bloqueadas. Exporte vídeos e transcrições até {formatDate(subscription.exportUntil)} — depois os vídeos são removidos.</p> : null}
            <div className="flex flex-wrap gap-2">
              {paidActive && !subscription.cancelAtPeriodEnd ? <GuardedButton variant="secondary" allowed={data.canManage} blockedReason={MANAGE_REASON} disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar assinatura</GuardedButton> : null}
              {subscription.cancelAtPeriodEnd && live ? <GuardedButton variant="secondary" allowed={data.canManage} blockedReason={MANAGE_REASON} disabled={busy} onClick={() => void run(revertMeetingPlanCancel, "Cancelamento desfeito")}>Manter assinatura</GuardedButton> : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {catalog.plans.map((plan) => (
            <PlanOption
              key={plan.code}
              plan={plan}
              current={subscription?.planCode === plan.code && live}
              pending={subscription?.pendingPlanCode === plan.code}
              highlighted={plan.code === "professional"}
              action={planAction(data, plan)}
              busy={busy}
              onChoose={() => void run(() => changeMeetingPlan(plan.code as MeetingPlanCode), "Plano atualizado")}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Consumo pela duração gravada; a franquia renova a cada ciclo e não acumula. Uma gravação que começou com saldo vai até o fim da reunião (máximo de {data.rules.maxRecordingMinutes / 60} h por gravação) — o excedente é descontado e novas gravações ficam bloqueadas até a renovação. Avisamos {data.rules.retentionNoticeDays.join(" e ")} dias antes de excluir um vídeo.
        </p>
      </CardBody>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar a assinatura de gravação?"
        description={subscription ? `Você continua gravando até ${formatDate(subscription.currentPeriodEnd)}. Depois, novas gravações ficam bloqueadas e você tem ${data.rules.exportWindowDays} dias para exportar vídeos e transcrições antes de os vídeos serem removidos.` : ""}
        confirmLabel="Cancelar assinatura"
        cancelLabel="Voltar"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); void run(cancelMeetingPlan, "Cancelamento agendado"); }}
      />
    </Card>
  );
}

type PlanAction = { label: string; allowed: boolean; reason: string } | undefined;

/** O que o botão de cada plano faz: reduzir (sem custo) é liberado; contratar/subir exige a
 * cobrança, que ainda está fechada. O backend aplica a mesma regra. */
function planAction(data: MeetingPlanOverview, plan: MeetingPlanEntry): PlanAction {
  const subscription = data.subscription;
  const paidActive = subscription?.status === "active" && subscription.planCode !== "trial";
  if (paidActive && subscription.planCode === plan.code) {
    return subscription.pendingPlanCode ? { label: "Manter este plano", allowed: data.canManage, reason: MANAGE_REASON } : undefined;
  }
  if (paidActive) {
    const currentPrice = data.catalog.plans.find((entry) => entry.code === subscription.planCode)?.priceCents ?? 0;
    if (plan.priceCents < currentPrice) {
      if (subscription.pendingPlanCode === plan.code) return undefined;
      return { label: "Mudar na renovação", allowed: data.canManage, reason: MANAGE_REASON };
    }
    return { label: "Fazer upgrade", allowed: data.canManage && data.checkoutOpen, reason: data.canManage ? CHECKOUT_REASON : MANAGE_REASON };
  }
  return { label: "Contratar", allowed: data.canManage && data.checkoutOpen, reason: data.canManage ? CHECKOUT_REASON : MANAGE_REASON };
}

function PlanOption({ plan, current, pending, highlighted, action, busy, onChoose }: { plan: MeetingPlanEntry; current: boolean | undefined; pending: boolean; highlighted: boolean; action: PlanAction; busy: boolean; onChoose: () => void }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-4", highlighted ? "border-primary/60 bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{plan.name}</p>
        {current ? <Badge>Plano atual</Badge> : pending ? <Badge variant="secondary">Na renovação</Badge> : highlighted ? <Badge variant="secondary">Mais escolhido</Badge> : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{formatCurrencyCents(plan.priceCents, plan.currency)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><span className="tabular-nums">{plan.recordingHours}</span> horas de gravação por mês{plan.code === "teams" ? ", compartilhadas" : ""}</span></li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Vídeos guardados por <span className="tabular-nums">{plan.retentionDays}</span> dias</span></li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Transcrição, reprodução e histórico</span></li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><span className="tabular-nums">{plan.maxConcurrentRecordings}</span> gravação(ões) ao mesmo tempo</span></li>
      </ul>
      {action ? <GuardedButton className="mt-auto" variant={highlighted ? "primary" : "secondary"} allowed={action.allowed} blockedReason={action.reason} disabled={busy} onClick={onChoose}>{action.label}</GuardedButton> : null}
    </div>
  );
}
