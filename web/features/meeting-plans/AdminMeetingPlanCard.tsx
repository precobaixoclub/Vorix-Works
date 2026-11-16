"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatRecordingTime, MEETING_PLAN_STATUS_LABEL, type MeetingPlanCode, type MeetingPlanOverview } from "./api";

type AdminAction = "activate" | "change" | "cancel" | "revert_cancel" | "payment_failed" | "payment_recovered" | "advance";
type AdminOverview = MeetingPlanOverview & { events: { id: string; kind: string; planCode: string; status: string; actorUserId?: string; occurredAt: string }[] };

const ACTION_LABEL: Record<AdminAction, string> = {
  activate: "Ativar",
  change: "Trocar para",
  cancel: "Cancelar no fim do ciclo",
  revert_cancel: "Desfazer cancelamento",
  payment_failed: "Registrar falha de pagamento",
  payment_recovered: "Registrar pagamento regularizado",
  advance: "Processar vencimentos agora",
};

/** Admin da plataforma: concessão manual do plano de gravação (cobrança ainda fechada) — auditado. */
export function AdminMeetingPlanCard({ tenantId }: { tenantId: string }) {
  const key = `/v1/admin/meeting-plans/${encodeURIComponent(tenantId)}`;
  const { data, error, isLoading, mutate } = useSWR<AdminOverview>(key, () => apiClient.get<AdminOverview>(key));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ action: AdminAction; planCode?: MeetingPlanCode } | null>(null);

  async function run(action: AdminAction, planCode?: MeetingPlanCode) {
    setBusy(true);
    try {
      await apiClient.post(key, { action, ...(planCode ? { planCode } : {}) });
      await mutate();
      toast.success("Plano de gravação atualizado");
    } catch (err) {
      toast.error("Não foi possível concluir a ação", { description: err instanceof Error ? err.message : "Tente novamente." });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (isLoading) return <Card><CardBody><Skeleton className="h-24 w-full" /></CardBody></Card>;
  if (error || !data) return <ErrorState error={error} onRetry={() => void mutate()} />;

  const subscription = data.subscription;
  const live = subscription && ["trial", "active", "past_due"].includes(subscription.status);
  const paid = subscription && (subscription.status === "active" || subscription.status === "past_due") && subscription.planCode !== "trial";
  const planName = (code?: string) => (code === "trial" ? data.catalog.trial.name : data.catalog.plans.find((plan) => plan.code === code)?.name ?? "—");

  return (
    <Card>
      <CardHeader><div className="text-base font-semibold text-foreground">Plano de gravação do Meetings</div></CardHeader>
      <CardBody className="space-y-4 text-sm">
        {subscription ? (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Plano</dt><dd className="text-foreground">{planName(subscription.planCode)} · {MEETING_PLAN_STATUS_LABEL[subscription.status]}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Ciclo</dt><dd className="tabular-nums text-foreground">{formatDate(subscription.currentPeriodStart)} a {formatDate(subscription.currentPeriodEnd)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Uso</dt><dd className="tabular-nums text-foreground">{data.usage ? `${formatRecordingTime(data.usage.usedSeconds)} de ${formatRecordingTime(data.usage.limitSeconds)}` : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Na renovação</dt><dd className="text-foreground">{subscription.cancelAtPeriodEnd ? "Cancela" : subscription.pendingPlanCode ? planName(subscription.pendingPlanCode) : "Renova"}</dd></div>
            {subscription.exportUntil ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Exportação até</dt><dd className="tabular-nums text-foreground">{formatDate(subscription.exportUntil)}</dd></div> : null}
          </dl>
        ) : <p className="text-muted-foreground">Sem plano de gravação (regra antiga de gravações simultâneas, se houver).</p>}

        <div className="flex flex-wrap gap-2">
          {data.catalog.plans.map((plan) => {
            const action: AdminAction = paid ? "change" : "activate";
            if (paid && subscription?.planCode === plan.code) return null;
            return <Button key={plan.code} variant="secondary" disabled={busy} onClick={() => setPending({ action, planCode: plan.code as MeetingPlanCode })}>{ACTION_LABEL[action]} {plan.name}</Button>;
          })}
          {paid && !subscription?.cancelAtPeriodEnd ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ action: "cancel" })}>{ACTION_LABEL.cancel}</Button> : null}
          {live && subscription?.cancelAtPeriodEnd ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ action: "revert_cancel" })}>{ACTION_LABEL.revert_cancel}</Button> : null}
          {subscription?.status === "active" && paid ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ action: "payment_failed" })}>{ACTION_LABEL.payment_failed}</Button> : null}
          {subscription?.status === "past_due" ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ action: "payment_recovered" })}>{ACTION_LABEL.payment_recovered}</Button> : null}
          {subscription ? <Button variant="ghost" disabled={busy} onClick={() => void run("advance")}>{ACTION_LABEL.advance}</Button> : null}
        </div>
        <p className="text-xs text-muted-foreground">Contratação self-service fechada até a liberação da cobrança: ativações aqui não geram cobrança e ficam no histórico.</p>

        {data.events.length ? (
          <ul className="divide-y divide-border/60 rounded-md border border-border">
            {data.events.slice(0, 10).map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-foreground">{event.kind} · {planName(event.planCode)}</span><span className="tabular-nums text-muted-foreground">{formatDateTime(event.occurredAt)}</span></li>)}
          </ul>
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? `${ACTION_LABEL[pending.action]}${pending.planCode ? ` ${planName(pending.planCode)}` : ""}?` : ""}
        description="A mudança vale na hora para este cliente, sem cobrança, e fica registrada no histórico do plano."
        confirmLabel="Confirmar"
        busy={busy}
        variant={pending?.action === "cancel" || pending?.action === "payment_failed" ? "danger" : "primary"}
        onCancel={() => setPending(null)}
        onConfirm={() => { if (pending) void run(pending.action, pending.planCode); }}
      />
    </Card>
  );
}
