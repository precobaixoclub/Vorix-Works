"use client";

import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/auth-context";
import { cancelSubscription, changePlan, fetchDowngradePreview, openBillingPortal, purchaseAddon, reactivateSubscription, removeAddon, startCheckout, startTrial } from "@/features/billing/api";
import { useBillingOverview } from "@/features/billing/hooks";
import { RESOURCE_LABELS, type BillingInterval, type BillingOverviewAvailableAddon, type PlatformPlanCode } from "@/features/billing/types";
import { fetchPublicPlans, formatCreditsQuota, type PublicPlan } from "@/features/platform-plans/api";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { canManageBilling, RBAC_COPY } from "@/lib/rbac";

export default function BillingSettingsPage() {
  const { state } = useAuth();
  const canManage = canManageBilling(state.status === "authenticated" ? state.role : undefined);
  const { data, error, isLoading, mutate } = useBillingOverview();
  const { data: plans } = useSWR("platform-plans", () => fetchPublicPlans());
  const [busy, setBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmRemoveAddon, setConfirmRemoveAddon] = useState<{ subscriptionItemId: string; name: string } | null>(null);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    if (!canManage) return;
    setBusy(true);
    try {
      await action();
      await mutate();
      toast.success(successMessage);
    } catch (err) {
      toast.error("Não foi possível concluir a ação", { description: err instanceof Error ? err.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  async function goToCheckout(planCode: PlatformPlanCode, interval: BillingInterval) {
    if (!canManage) return;
    setBusy(true);
    try {
      const { checkoutUrl } = await startCheckout({ planCode, billingInterval: interval });
      window.location.href = checkoutUrl;
    } catch (err) {
      toast.error("Não foi possível iniciar o checkout", { description: err instanceof Error ? err.message : "Tente novamente." });
      setBusy(false);
    }
  }

  async function choosePlan(planCode: PlatformPlanCode) {
    if (!data || !canManage) return;
    const interval = data.billingInterval ?? "monthly";
    if (data.virtual) {
      setBusy(true);
      try {
        await startTrial(planCode);
        await mutate();
        toast.success("Período de teste iniciado.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.startsWith("TRIAL_DISABLED") || message.startsWith("TRIAL_NOT_AVAILABLE_FOR_PLAN")) {
          await goToCheckout(planCode, interval);
          return;
        }
        toast.error("Não foi possível iniciar o teste", { description: message || "Tente novamente." });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (data.status === "trial" || data.status === "trial_expired") {
      await goToCheckout(planCode, interval);
      return;
    }
    try {
      const preview = await fetchDowngradePreview(planCode);
      if (!preview.safeToChange) {
        toast.error("Uso atual excede o novo plano", {
          description: preview.overages.map((item) => `${RESOURCE_LABELS[item.resource]}: ${item.used}/${item.newMax}`).join(" · "),
        });
        return;
      }
    } catch {
      // O backend valida novamente no changePlan; esta prévia é apenas para melhorar a mensagem.
    }
    await run(() => changePlan({ newPlanCode: planCode, billingInterval: interval }), "Plano alterado.");
  }

  async function openPortal() {
    if (!canManage) return;
    setBusy(true);
    try {
      const { portalUrl } = await openBillingPortal();
      window.location.href = portalUrl;
    } catch (err) {
      toast.error("Não foi possível abrir o pagamento", { description: err instanceof Error ? err.message : "Tente novamente." });
      setBusy(false);
    }
  }

  if (isLoading) {
    return <div className="flex items-center gap-2 px-6 py-14 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando plano e cobrança...</div>;
  }
  if (error || !data) return <div className="mx-auto max-w-4xl px-3 py-8"><ErrorState error={error} onRetry={() => mutate()} /></div>;

  const currentPlan = plans?.find((plan) => plan.code === data.planCode);
  const interval = data.billingInterval ?? "monthly";

  return (
    <SettingsShell
      active="billing"
      title="Plano e cobrança"
      description="Plano atual, ciclo, uso e pagamento em uma visão clara."
      actions={data.status && !data.virtual ? <GuardedButton variant="secondary" disabled={busy} onClick={openPortal} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Gerenciar pagamento</GuardedButton> : undefined}
    >
      {data.readOnly ? (
        <Card className="mb-5 border-warning/50 bg-warning/5">
          <CardBody className="text-sm">
            <p className="font-semibold text-foreground">Pagamento pendente</p>
            <p className="mt-1 text-muted-foreground">Atualize sua forma de pagamento para evitar interrupções.</p>
          </CardBody>
        </Card>
      ) : null}

      {data.cancelAtPeriodEnd ? (
        <Card className="mb-5 border-warning/50 bg-warning/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-foreground">Cancelamento agendado</p>
              <p className="mt-1 text-muted-foreground">Seu plano continuará ativo até {formatDate(data.currentPeriodEnd ?? undefined)}.</p>
            </div>
            <GuardedButton disabled={busy} onClick={() => run(() => reactivateSubscription(), "Plano reativado.")} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Reativar plano</GuardedButton>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Card>
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">Plano atual</p>
              <p className="mt-1 text-xs text-muted-foreground">{data.virtual ? "Nenhuma assinatura paga ativa." : `Ciclo ${interval === "yearly" ? "anual" : "mensal"}.`}</p>
            </div>
            {data.status ? <StatusBadge status={data.status} /> : null}
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight text-foreground">{data.status === "trial" ? `Teste · ${data.planName}` : data.planName}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {currentPlan ? cyclePrice(currentPlan, interval) : "Valor do ciclo indisponível no catálogo atual."}
              </p>
              {data.currentPeriodEnd ? <p className="mt-1 text-sm text-muted-foreground">{data.cancelAtPeriodEnd ? "Ativo até" : "Renova em"} {formatDate(data.currentPeriodEnd)}.</p> : null}
              {data.status === "trial" && data.trialDaysRemaining !== null ? <p className="mt-1 text-sm text-muted-foreground">{data.trialDaysRemaining} dias de teste restantes.</p> : null}
            </div>
            {!data.virtual && !data.cancelAtPeriodEnd && data.status !== "trial" && data.status !== "trial_expired" ? (
              <GuardedButton variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmCancelOpen(true)} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Cancelar no fim do período</GuardedButton>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">Forma de pagamento</p></CardHeader>
          <CardBody className="space-y-3 text-sm">
            {data.paymentMethod ? (
              <p className="text-foreground">{data.paymentMethod.brand?.toUpperCase() ?? "Cartão"} final {data.paymentMethod.last4 ?? "—"}<span className="block text-xs text-muted-foreground">Vence {data.paymentMethod.expMonth}/{data.paymentMethod.expYear}</span></p>
            ) : <p className="text-muted-foreground">Nenhuma forma de pagamento cadastrada.</p>}
            <GuardedButton variant="secondary" disabled={busy || data.virtual} onClick={openPortal} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Gerenciar pagamento</GuardedButton>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-foreground">Uso do plano</p>
            <p className="mt-1 text-xs text-muted-foreground">Somente limites medidos pelo backend aparecem aqui.</p>
          </div>
        </CardHeader>
        <CardBody className="grid gap-4 md:grid-cols-2">
          {data.consumption.map((item) => <ConsumptionBar key={item.resource} label={RESOURCE_LABELS[item.resource]} used={item.used} max={item.max} />)}
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader><p className="text-sm font-semibold text-foreground">Comparar planos</p></CardHeader>
        <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(plans ?? []).map((plan) => <PlanCard key={plan.code} plan={plan} interval={interval} isCurrent={plan.code === data.planCode} busy={busy} canManage={canManage} onChoose={() => choosePlan(plan.code)} />)}
        </CardBody>
      </Card>

      {!data.virtual ? (
        <Card className="mt-5">
          <CardHeader><p className="text-sm font-semibold text-foreground">Add-ons</p></CardHeader>
          <CardBody className="space-y-3">
            {data.addons.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum add-on contratado.</p> : null}
            {data.addons.map((addon) => (
              <div key={addon.subscriptionItemId} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-foreground">{addon.name}{addon.quantity > 1 ? ` × ${addon.quantity}` : ""}</span>
                <GuardedButton variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || data.readOnly} allowed={canManage} blockedReason={RBAC_COPY.manageBilling} onClick={() => setConfirmRemoveAddon({ subscriptionItemId: addon.subscriptionItemId, name: addon.name })}>Remover</GuardedButton>
              </div>
            ))}
            {data.availableAddons.map((addon) => <AddonRow key={addon.code} addon={addon} interval={interval} busy={busy || data.readOnly} canManage={canManage} onPurchase={() => run(() => purchaseAddon({ addonCode: addon.code, quantity: 1, billingInterval: interval }), "Add-on adicionado.")} />)}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-5">
        <CardHeader><p className="text-sm font-semibold text-foreground">Faturas recentes</p></CardHeader>
        <CardBody className="space-y-2">
          {data.recentInvoices.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma fatura ainda.</p> : null}
          {data.recentInvoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{formatDate(invoice.createdAt)}</span>
              <span className="font-medium tabular-nums text-foreground">{formatCurrencyCents(invoice.amountCents, invoice.currency)}</span>
              <StatusBadge status={invoice.status} />
            </div>
          ))}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancelar assinatura?"
        description={`Seu plano continuará ativo até ${formatDate(data.currentPeriodEnd ?? undefined)}. Nenhum dado será apagado.`}
        confirmLabel="Cancelar no fim do período"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={async () => {
          await run(() => cancelSubscription(), "Cancelamento agendado.");
          setConfirmCancelOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmRemoveAddon !== null}
        title="Remover add-on?"
        description={`"${confirmRemoveAddon?.name}" deixará de valer imediatamente e os limites voltam ao plano base.`}
        confirmLabel="Remover add-on"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmRemoveAddon(null)}
        onConfirm={async () => {
          if (confirmRemoveAddon) await run(() => removeAddon(confirmRemoveAddon.subscriptionItemId), "Add-on removido.");
          setConfirmRemoveAddon(null);
        }}
      />
    </SettingsShell>
  );
}

function ConsumptionBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const percent = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  const nearLimit = max !== null && used / Math.max(max, 1) >= 0.9;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{used.toLocaleString("pt-BR")} / {max === null ? "Ilimitado" : max.toLocaleString("pt-BR")}</span>
      </div>
      {max !== null ? <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${nearLimit ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} /></div> : null}
    </div>
  );
}

function PlanCard({ plan, interval, isCurrent, busy, canManage, onChoose }: { plan: PublicPlan; interval: BillingInterval; isCurrent: boolean; busy: boolean; canManage: boolean; onChoose: () => void }) {
  return (
    <div className={`flex flex-col rounded-xl border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-sm font-semibold text-foreground">{plan.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
      <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">{cyclePrice(plan, interval)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{formatCreditsQuota(plan.monthlyCreditsQuota)}</p>
      <GuardedButton variant={isCurrent ? "secondary" : "primary"} className="mt-4" disabled={busy || isCurrent} onClick={onChoose} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>{isCurrent ? "Plano atual" : "Selecionar"}</GuardedButton>
    </div>
  );
}

function AddonRow({ addon, interval, busy, canManage, onPurchase }: { addon: BillingOverviewAvailableAddon; interval: BillingInterval; busy: boolean; canManage: boolean; onPurchase: () => void }) {
  const price = interval === "yearly" ? addon.yearlyPriceUsd : addon.monthlyPriceUsd;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{addon.name}</p>
        <p className="truncate text-xs text-muted-foreground">{addon.description}</p>
      </div>
      <GuardedButton variant="secondary" disabled={busy} onClick={onPurchase} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Adicionar · US$ {price}</GuardedButton>
    </div>
  );
}

function cyclePrice(plan: PublicPlan, interval: BillingInterval): string {
  if (plan.monthlyPriceUsd === 0) return "Grátis";
  if (interval === "monthly") return `US$ ${plan.monthlyPriceUsd}/mês`;
  return "Valor anual não informado pela API";
}
