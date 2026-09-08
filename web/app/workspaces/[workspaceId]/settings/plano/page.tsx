"use client";

import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { formatPlanPrice, fetchPublicPlans, type PublicPlan } from "@/features/platform-plans/api";
import {
  cancelSubscription,
  changePlan,
  fetchDowngradePreview,
  openBillingPortal,
  purchaseAddon,
  reactivateSubscription,
  removeAddon,
  startCheckout,
} from "@/features/billing/api";
import { useBillingOverview } from "@/features/billing/hooks";
import { RESOURCE_LABELS, type BillingOverviewAvailableAddon, type PlatformPlanCode } from "@/features/billing/types";

/**
 * "Plano e Cobrança" (`/workspaces/:workspaceId/settings/plano`) — SaaS Commercialization, Fase 4.
 * Uma tela só, de propósito (não-negociável do pedido original): plano atual + consumo + trocar
 * plano + add-ons + pagamento + faturas. Escopada ao TENANT (não ao workspace do path) — o backend
 * resolve isso via o JWT, nunca por um parâmetro de rota.
 */
export default function BillingSettingsPage() {
  const { data, error, isLoading, mutate } = useBillingOverview();
  const { data: plans } = useSWR("platform-plans", () => fetchPublicPlans());
  const [busy, setBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmRemoveAddon, setConfirmRemoveAddon] = useState<{ subscriptionItemId: string; name: string } | null>(null);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      await mutate();
      toast.success(successMessage);
    } catch (err) {
      toast.error("Não foi possível concluir a ação", { description: err instanceof Error ? err.message : "Falhou." });
    } finally {
      setBusy(false);
    }
  }

  async function handleChoosePlan(planCode: PlatformPlanCode) {
    if (!data) return;
    if (data.virtual) {
      setBusy(true);
      try {
        const { checkoutUrl } = await startCheckout({ planCode, billingInterval: "monthly" });
        window.location.href = checkoutUrl;
      } catch (err) {
        toast.error("Não foi possível iniciar o checkout", { description: err instanceof Error ? err.message : "Falhou." });
        setBusy(false);
      }
      return;
    }

    try {
      const preview = await fetchDowngradePreview(planCode);
      if (!preview.safeToChange) {
        toast.error("Uso atual excede o novo plano", {
          description: `Reduza antes de trocar: ${preview.overages.map((o) => `${RESOURCE_LABELS[o.resource]} (${o.used}/${o.newMax})`).join(", ")}.`,
        });
        return;
      }
    } catch {
      // segue — o backend reforça a mesma checagem em `changePlan`.
    }
    await run(() => changePlan({ newPlanCode: planCode, billingInterval: data.billingInterval ?? "monthly" }), "Plano alterado.");
  }

  async function handleOpenPortal() {
    setBusy(true);
    try {
      const { portalUrl } = await openBillingPortal();
      window.location.href = portalUrl;
    } catch (err) {
      toast.error("Não foi possível abrir o portal de pagamento", { description: err instanceof Error ? err.message : "Falhou." });
      setBusy(false);
    }
  }

  async function confirmCancel() {
    await run(() => cancelSubscription(), "Cancelamento agendado para o fim do período atual.");
    setConfirmCancelOpen(false);
  }

  async function confirmRemoveAddonAction() {
    if (!confirmRemoveAddon) return;
    await run(() => removeAddon(confirmRemoveAddon.subscriptionItemId), "Add-on removido.");
    setConfirmRemoveAddon(null);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-10 text-sm text-muted-foreground sm:px-6 sm:py-14">
        <Spinner className="h-4 w-4" /> Carregando plano e cobrança…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
        <ErrorState error={error} onRetry={() => mutate()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Plano e Cobrança"
        description="Seu plano atual, consumo do mês e as ações de assinatura — tudo nesta única tela."
        actions={
          data.status && !data.virtual ? (
            <Button variant="secondary" disabled={busy} onClick={handleOpenPortal}>
              Gerenciar forma de pagamento
            </Button>
          ) : undefined
        }
      />

      {data.readOnly ? (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardBody className="text-sm">
            <p className="font-semibold text-foreground">Pagamento pendente</p>
            <p className="mt-1 text-muted-foreground">
              Não conseguimos confirmar seu último pagamento. Seus dados estão preservados, mas novas ações estão bloqueadas até a
              cobrança ser regularizada.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {data.cancelAtPeriodEnd ? (
        <Card className="mb-6 border-warning/50 bg-warning/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-foreground">Assinatura agendada para cancelamento</p>
              <p className="mt-1 text-muted-foreground">
                Você mantém acesso ao plano {data.planName} até {formatDate(data.currentPeriodEnd ?? undefined)}.
              </p>
            </div>
            <Button variant="primary" disabled={busy} onClick={() => run(() => reactivateSubscription(), "Assinatura reativada.")}>
              Reativar assinatura
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">Plano atual</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.virtual ? "Nenhuma assinatura paga ativa." : `Cobrança ${data.billingInterval === "yearly" ? "anual" : "mensal"}.`}
              </p>
            </div>
            {data.status ? <StatusBadge status={data.status} /> : null}
          </CardHeader>
          <CardBody>
            <p className="text-2xl font-semibold text-foreground">{data.planName}</p>
            {data.currentPeriodEnd && !data.cancelAtPeriodEnd ? (
              <p className="mt-1 text-sm text-muted-foreground">Renova em {formatDate(data.currentPeriodEnd)}.</p>
            ) : null}
            {!data.virtual && !data.cancelAtPeriodEnd ? (
              <Button variant="ghost" className="mt-3 text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmCancelOpen(true)}>
                Cancelar assinatura
              </Button>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-sm font-semibold text-foreground">Forma de pagamento</div>
          </CardHeader>
          <CardBody>
            {data.paymentMethod ? (
              <p className="text-sm text-foreground">
                {data.paymentMethod.brand?.toUpperCase() ?? "Cartão"} •••• {data.paymentMethod.last4}
                <span className="mt-1 block text-xs text-muted-foreground">
                  Vence {data.paymentMethod.expMonth}/{data.paymentMethod.expYear}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma forma de pagamento cadastrada.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-foreground">Consumo do mês</p>
            <p className="mt-1 text-xs text-muted-foreground">O que já foi usado em relação ao limite do plano atual.</p>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.consumption.map((item) => (
            <ConsumptionBar key={item.resource} label={RESOURCE_LABELS[item.resource]} used={item.used} max={item.max} />
          ))}
        </CardBody>
      </Card>

      {!data.virtual ? (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">Add-ons</p>
              <p className="mt-1 text-xs text-muted-foreground">Aumente limites específicos sem trocar de plano.</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {data.addons.length > 0 ? (
              <ul className="space-y-2">
                {data.addons.map((addon) => (
                  <li key={addon.subscriptionItemId} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <span>
                      {addon.name} {addon.quantity > 1 ? `× ${addon.quantity}` : null}
                    </span>
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy || data.readOnly}
                      onClick={() => setConfirmRemoveAddon({ subscriptionItemId: addon.subscriptionItemId, name: addon.name })}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum add-on contratado.</p>
            )}

            {data.availableAddons.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-4">
                {data.availableAddons.map((addon) => (
                  <AddonRow
                    key={addon.code}
                    addon={addon}
                    busy={busy || data.readOnly}
                    billingInterval={data.billingInterval ?? "monthly"}
                    onPurchase={() =>
                      run(() => purchaseAddon({ addonCode: addon.code, quantity: 1, billingInterval: data.billingInterval ?? "monthly" }), "Add-on adicionado.")
                    }
                  />
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-foreground">Trocar de plano</p>
            <p className="mt-1 text-xs text-muted-foreground">Downgrades só são aplicados quando o uso atual cabe no novo limite.</p>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(plans ?? []).map((plan) => (
            <PlanCard key={plan.code} plan={plan} isCurrent={plan.code === data.planCode} busy={busy} onChoose={() => handleChoosePlan(plan.code)} />
          ))}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="text-sm font-semibold text-foreground">Faturas recentes</div>
        </CardHeader>
        <CardBody className="p-0">
          {data.recentInvoices.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Nenhuma fatura ainda.</div>
          ) : (
            <ul className="divide-y divide-border">
              {data.recentInvoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                  <span className="text-muted-foreground">{formatDate(invoice.createdAt)}</span>
                  <span className="font-medium tabular-nums">{formatCurrencyCents(invoice.amountCents, invoice.currency)}</span>
                  <StatusBadge status={invoice.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancelar assinatura?"
        description={`Você continua com acesso completo ao plano ${data.planName} até o fim do período já pago. Nenhum dado é apagado — você pode reativar a qualquer momento antes disso.`}
        confirmLabel="Cancelar assinatura"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={confirmCancel}
      />

      <ConfirmDialog
        open={confirmRemoveAddon !== null}
        title="Remover add-on?"
        description={`"${confirmRemoveAddon?.name}" deixará de valer imediatamente — os limites voltam ao do plano base.`}
        confirmLabel="Remover add-on"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmRemoveAddon(null)}
        onConfirm={confirmRemoveAddonAction}
      />
    </div>
  );
}

function ConsumptionBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const percent = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  const nearLimit = max !== null && used / Math.max(max, 1) >= 0.9;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used.toLocaleString("pt-BR")} / {max === null ? "Ilimitado" : max.toLocaleString("pt-BR")}
        </span>
      </div>
      {max !== null ? (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${nearLimit ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function AddonRow({
  addon,
  busy,
  billingInterval,
  onPurchase,
}: {
  addon: BillingOverviewAvailableAddon;
  busy: boolean;
  billingInterval: "monthly" | "yearly";
  onPurchase: () => void;
}) {
  const priceUsd = billingInterval === "yearly" ? addon.yearlyPriceUsd : addon.monthlyPriceUsd;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{addon.name}</p>
        <p className="truncate text-xs text-muted-foreground">{addon.description}</p>
      </div>
      <Button variant="secondary" disabled={busy} onClick={onPurchase}>
        Adicionar · US$ {priceUsd}
      </Button>
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  busy,
  onChoose,
}: {
  plan: PublicPlan;
  isCurrent: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  return (
    <div className={`flex flex-col rounded-xl border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}>
      <p className="text-sm font-semibold text-foreground">{plan.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
      <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">{formatPlanPrice(plan)}</p>
      <Button variant={isCurrent ? "secondary" : "primary"} className="mt-4" disabled={busy || isCurrent} onClick={onChoose}>
        {isCurrent ? "Plano atual" : "Selecionar"}
      </Button>
    </div>
  );
}
