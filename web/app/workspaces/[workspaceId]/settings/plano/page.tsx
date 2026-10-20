"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Input, Label } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { VorixAiIcon } from "@/components/vorix/ai";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { applyCapacity, cancelPendingCapacityChange, cancelSubscription, changePlan, fetchDowngradePreview, openBillingPortal, previewCapacity, purchaseAddon, purchaseAiCredits, reactivateSubscription, removeAddon, startCheckout, startTrial } from "@/features/billing/api";
import { useAiCredits, useBillingOverview, useCapacityState } from "@/features/billing/hooks";
import { RESOURCE_LABELS, type BillingInterval, type BillingOverview, type BillingOverviewAvailableAddon, type CapacityPendingChange, type CapacityPreviewResult, type PlatformPlanCode } from "@/features/billing/types";
import { fetchPublicPlans, formatCreditsQuota, type PublicPlan } from "@/features/platform-plans/api";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { canManageBilling, RBAC_COPY } from "@/lib/rbac";

export default function BillingSettingsPage() {
  const { state } = useAuth();
  const canManage = canManageBilling(state.status === "authenticated" ? state.role : undefined);
  const { data, error, isLoading, mutate } = useBillingOverview();
  const { data: plans } = useSWR("platform-plans", () => fetchPublicPlans());
  const returnWorkspaceId = useParams<{ workspaceId: string }>().workspaceId;
  // Volta do checkout (Mercado Pago/Stripe): avisa o resultado uma única vez.
  const searchParams = useSearchParams();
  const checkoutNotified = useRef(false);
  useEffect(() => {
    const result = searchParams.get("checkout");
    if (!result || checkoutNotified.current) return;
    checkoutNotified.current = true;
    if (result === "sucesso") toast.success("Pagamento recebido", { description: "A assinatura é ativada assim que o gateway confirmar — em instantes." });
    else if (result === "cancelado") toast.info("Pagamento não concluído", { description: "Nada foi cobrado. Use \"Cadastrar cartão\" quando quiser contratar." });
    else if (result === "falhou") toast.error("Sua conta foi criada, mas o pagamento não abriu", { description: "Use \"Cadastrar cartão\" abaixo para concluir a contratação." });
  }, [searchParams]);
  const creditsNotified = useRef(false);
  useEffect(() => {
    const result = searchParams.get("creditos");
    if (!result || creditsNotified.current) return;
    creditsNotified.current = true;
    if (result === "ok") toast.success("Pagamento recebido", { description: "Os créditos entram assim que o pagamento for confirmado — em instantes." });
    else toast.info("Compra de créditos não concluída", { description: "Nada foi cobrado." });
    window.setTimeout(() => document.getElementById("creditos")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, [searchParams]);
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

  async function goToCheckout(planCode: PlatformPlanCode, interval: BillingInterval, capacity?: Parameters<typeof startCheckout>[0]["capacity"]) {
    if (!canManage) return;
    setBusy(true);
    try {
      const { checkoutUrl } = await startCheckout({ planCode, billingInterval: interval, capacity, successPath: `/workspaces/${returnWorkspaceId}/settings/plano?checkout=sucesso`, cancelPath: `/workspaces/${returnWorkspaceId}/settings/plano?checkout=cancelado` });
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
      actions={data.status && !data.virtual && data.status !== "trial" && data.status !== "trial_expired" ? <GuardedButton variant="secondary" disabled={busy} onClick={openPortal} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Gerenciar pagamento</GuardedButton> : undefined}
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
              {data.status === "trial" && data.trialDaysRemaining !== null ? <TrialCountdown days={data.trialDaysRemaining} trialEnd={data.trialEnd} hasCard={Boolean(data.paymentMethod)} /> : null}
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
            {data.status === "trial" || data.status === "trial_expired" ? (
              // Teste sem cartão: cadastrar o cartão AGORA mantém os dias de teste que restam.
              <GuardedButton disabled={busy} onClick={() => void goToCheckout(data.planCode as PlatformPlanCode, interval)} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>
                {data.status === "trial" ? "Cadastrar cartão" : "Cadastrar cartão e reativar"}
              </GuardedButton>
            ) : (
              <GuardedButton variant="secondary" disabled={busy || data.virtual} onClick={openPortal} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Gerenciar pagamento</GuardedButton>
            )}
            {data.status === "trial" ? <p className="text-xs text-muted-foreground">A primeira cobrança só acontece quando o teste terminar.</p> : null}
          </CardBody>
        </Card>
      </div>

      {data.status === "trial_expired" ? (
        <Card className="mb-5 mt-5 border-warning/50 bg-warning/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-foreground">Seu teste gratuito terminou</p>
              <p className="mt-1 text-muted-foreground">Cadastre uma forma de pagamento para reativar a conta. Seus dados continuam salvos.</p>
            </div>
            <GuardedButton disabled={busy} onClick={() => void goToCheckout(data.planCode as PlatformPlanCode, interval)} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Cadastrar forma de pagamento</GuardedButton>
          </CardBody>
        </Card>
      ) : null}

      <AiCreditsCard canManage={canManage} workspaceId={returnWorkspaceId} />

      <CapacityCard canManage={canManage} consumption={data.consumption} virtual={data.virtual} onNeedPaymentMethod={(capacity) => void goToCheckout(data.planCode as PlatformPlanCode, interval, capacity)} />

      <Card id="comparar-planos" className="mt-5">
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
                <a href="#quantidades-plano" className="text-sm underline">Ajustar quantidade acima</a>
              </div>
            ))}
            {data.availableAddons.filter(addon=>!["users","messaging_connections","workspaces"].includes(addon.resource)).map((addon) => <AddonRow key={addon.code} addon={addon} currency={currentPlan?.currency ?? "BRL"} interval={interval} busy={busy || data.readOnly} canManage={canManage} onPurchase={() => run(() => purchaseAddon({ addonCode: addon.code, quantity: 1, billingInterval: interval }), "Add-on adicionado.")} />)}
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

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
}

/**
 * "Sua estrutura": usuários, números de WhatsApp e gravações simultâneas do Vorix Meetings.
 * O preview mostra o novo valor mensal e a próxima cobrança ANTES de confirmar; aumentos valem na
 * hora, sem cobrança proporcional; reduções valem no fim do ciclo já pago.
 */
function CapacityCard({ canManage, consumption, virtual, onNeedPaymentMethod }: { canManage: boolean; consumption: BillingOverview["consumption"]; virtual: boolean; onNeedPaymentMethod: (capacity: Parameters<typeof startCheckout>[0]["capacity"]) => void }) {
  const { data: state, error, isLoading, mutate } = useCapacityState();
  const {mutate:refreshGlobal}=useSWRConfig();
  const [addonQuantities,setAddonQuantities]=useState<Record<string,number>>({});
  const [previewError,setPreviewError]=useState<string>();
  const [users, setUsers] = useState<number | undefined>();
  const [whatsappConnections, setWhatsappConnections] = useState<number | undefined>();
  const [workspaces, setWorkspaces] = useState<number | undefined>();
  const [recordings, setRecordings] = useState<number | undefined>();
  const [preview, setPreview] = useState<CapacityPreviewResult | undefined>();
  const [previewKey, setPreviewKey] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | undefined>();

  useEffect(() => {
    if (!state) return;
    setUsers((current) => current ?? (state.next??state.current).totalUsers ?? 0);
    setWhatsappConnections((current) => current ?? (state.next??state.current).totalWhatsappConnections ?? 0);
    setWorkspaces((current) => current ?? (state.next??state.current).totalWorkspaces ?? consumption.find(item => item.resource === "workspaces")?.max ?? 0);
    setRecordings((current) => current ?? (state.next??state.current).concurrentRecordings ?? 0);
    setAddonQuantities(current=>Object.fromEntries((state.adjustableAddons??[]).map(item=>[item.addonCode,current[item.addonCode]??item.quantity])));
  }, [state, consumption]);

  const dirty = Boolean(
    state && users !== undefined && whatsappConnections !== undefined && workspaces !== undefined && recordings !== undefined &&
    (users !== ((state.next??state.current).totalUsers ?? 0) || whatsappConnections !== ((state.next??state.current).totalWhatsappConnections ?? 0) || workspaces !== ((state.next??state.current).totalWorkspaces ?? consumption.find(item => item.resource === "workspaces")?.max ?? 0) || recordings !== (state.next??state.current).concurrentRecordings || (state.adjustableAddons??[]).some(item=>(addonQuantities[item.addonCode]??item.quantity)!==item.quantity)),
  );
  const selectionKey = JSON.stringify([users, whatsappConnections, workspaces, recordings, Object.entries(addonQuantities).sort()]);

  useEffect(() => {
    if (!dirty || users === undefined || whatsappConnections === undefined || workspaces === undefined || recordings === undefined) {
      setPreview(undefined);
      setPreviewing(false);
      setPreviewError(undefined);
      return;
    }
    let cancelled = false;
    setPreviewing(true);setPreview(undefined);setPreviewError(undefined);
    previewCapacity({ users, whatsappConnections, workspaces, concurrentRecordings: recordings,addonQuantities })
      .then((result) => { if (!cancelled) { setPreview(result); setPreviewKey(selectionKey); } })
      .catch(error => { if (!cancelled){setPreview(undefined);setPreviewError(error instanceof Error?error.message.replace(/^[A-Z_]+:\s*/,""):"Não foi possível calcular. Tente novamente.");} })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, users, whatsappConnections, workspaces, recordings,addonQuantities, selectionKey]);

  async function handleConfirm() {
    if (applying || !canManage || !state || !preview || previewKey !== selectionKey || previewing || previewError || users === undefined || whatsappConnections === undefined || workspaces === undefined || recordings === undefined) return;
    if (!state.canChangeNow) {
      onNeedPaymentMethod({ users, whatsappConnections, workspaces, concurrentRecordings: recordings });
      return;
    }
    setApplying(true);
    try {
      const result = await applyCapacity({users,whatsappConnections,workspaces,concurrentRecordings:recordings,addonQuantities});
      const fresh=await mutate();
      if(fresh){const next=fresh.next??fresh.current;setUsers(next.totalUsers??0);setWhatsappConnections(next.totalWhatsappConnections??0);setWorkspaces(next.totalWorkspaces??0);setRecordings(next.concurrentRecordings);setAddonQuantities(Object.fromEntries((fresh.adjustableAddons??[]).map(item=>[item.addonCode,item.quantity])));}
      await refreshGlobal(["billing","overview"]);
      setPreview(undefined);
      toast.success("Quantidades salvas",{description:result.nextCharge?`Próxima renovação: ${formatAmount(result.nextCharge.amount,result.nextCharge.currency)}, em ${formatDate(result.nextCharge.at)}.`:"O valor recorrente foi atualizado."});
    } catch (err) {
      toast.error("Não foi possível atualizar a estrutura", { description: err instanceof Error ? err.message.replace(/^[A-Z_]+(\([^)]*\))?:\s*/, "") : "Tente novamente." });
    } finally {
      setApplying(false);
    }
  }

  async function handleCancelPending(pendingChangeId: string) {
    if (!canManage || applying || cancellingId) return;
    setCancellingId(pendingChangeId);
    try {
      await cancelPendingCapacityChange(pendingChangeId);
      const fresh=await mutate();
      if(fresh){const next=fresh.next??fresh.current;setUsers(next.totalUsers??0);setWhatsappConnections(next.totalWhatsappConnections??0);setWorkspaces(next.totalWorkspaces??0);setRecordings(next.concurrentRecordings);setAddonQuantities(Object.fromEntries((fresh.adjustableAddons??[]).map(item=>[item.addonCode,item.quantity])));}
      await refreshGlobal(["billing", "overview"]);
      toast.success("Alteração cancelada e valor da próxima renovação atualizado.");
    } catch (err) {
      toast.error("Não foi possível cancelar", { description: err instanceof Error ? err.message : "Tente novamente." });
    } finally {
      setCancellingId(undefined);
    }
  }

  if (error) return <Card className="mt-5"><CardBody><ErrorState error={error} onRetry={() => mutate()} /></CardBody></Card>;
  if (isLoading || !state || users === undefined || whatsappConnections === undefined || workspaces === undefined || recordings === undefined) {
    return <Card className="mt-5"><CardBody><div className="flex justify-center py-6"><Spinner /></div></CardBody></Card>;
  }

  const current = state.current;
  const nextTotal = dirty ? (previewKey === selectionKey ? preview?.requestedOnCurrentPlan.totalMonthlyAmount : undefined) : (state.next ?? current).totalMonthlyAmount;
  const usage = (resource: string) => consumption.find(item => item.resource === resource);
  const workspaceUsage = usage("workspaces");
  const workspaceUnlimited = current.totalWorkspaces === null || current.totalWorkspaces === undefined && workspaceUsage?.max === null;
  const showRecordings = state.meetingsSellable || current.concurrentRecordings > 0;
  // Prévia na tela (o valor oficial vem do preview da API): preço de cada unidade × quanto muda.
  const unit = state.unitPrices ?? { interval: "monthly" as const };
  const cycle = unit.interval === "yearly" ? "/ano" : "/mês";
  const stepCost = (from: number, to: number, included: number, price?: { amount: number; increment: number }) => price ? (Math.ceil(Math.max(0, to - included) / Math.max(1, price.increment)) - Math.ceil(Math.max(0, from - included) / Math.max(1, price.increment))) * price.amount : 0;
  const recordingCost = (n: number) => (n <= 0 ? 0 : (unit.meetingsBase ?? 0) + Math.max(0, n - 1) * (unit.meetingsExtraRecording ?? 0));
  const lines = [
    { key: "users", label: "Usuários de atendimento", from: current.totalUsers ?? 0, to: users, delta: stepCost(current.totalUsers ?? 0, users, current.includedUsers ?? 0, unit.user), unlimited: current.totalUsers === null },
    { key: "whatsapp", label: "Números de WhatsApp", from: current.totalWhatsappConnections ?? 0, to: whatsappConnections, delta: stepCost(current.totalWhatsappConnections ?? 0, whatsappConnections, current.includedWhatsappConnections ?? 0, unit.whatsappConnection), unlimited: current.totalWhatsappConnections === null },
    { key: "workspaces", label: "Workspaces", from: current.totalWorkspaces ?? workspaceUsage?.max ?? 0, to: workspaces, delta: stepCost(current.totalWorkspaces ?? 0, workspaces, current.includedWorkspaces ?? 0, unit.workspace), unlimited: workspaceUnlimited },
    ...(showRecordings ? [{ key: "recordings", label: "Gravações simultâneas", from: current.concurrentRecordings, to: recordings, delta: recordingCost(recordings) - recordingCost(current.concurrentRecordings) }] : []),
  ];
  for(const item of state.adjustableAddons??[]){const target=addonQuantities[item.addonCode]??item.quantity;lines.push({key:item.addonCode,label:item.name,from:item.currentQuantity,to:target,delta:(target-item.currentQuantity)*item.unitPrice});}
  const estimatedDelta = lines.reduce((sum, line) => sum + line.delta, 0);
  const totalDelta = nextTotal === undefined ? estimatedDelta : nextTotal - current.totalMonthlyAmount;
  const estimatedTotal = current.totalMonthlyAmount + estimatedDelta;
  const pendingLabel = (pending: CapacityPendingChange) => {
    if (pending.resource === "meetings_concurrent_recordings") return `gravações simultâneas passam a ser ${pending.targetQuantity + 1}`;
    const included = pending.resource === "users" ? (current.includedUsers ?? 0) : pending.resource === "workspaces" ? (current.includedWorkspaces ?? 0) : pending.resource==="messaging_connections"?(current.includedWhatsappConnections??0):0;
    const increment = pending.resource === "workspaces" ? unit.workspace?.increment ?? 1 : pending.resource === "users" ? unit.user?.increment ?? 1 : unit.whatsappConnection?.increment ?? 1;
    const label=state.adjustableAddons?.find(item=>item.addonCode===pending.addonCode)?.name;
    if(label)return `${label}: quantidade passa a ser ${pending.targetQuantity}`;
    return `${(RESOURCE_LABELS as Record<string, string>)[pending.resource] ?? pending.resource} passa a ser ${pending.targetQuantity * increment + included}`;
  };

  return (
    <Card id="quantidades-plano" className="mt-5">
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-foreground">Uso do plano</p>
          <p className="mt-1 text-xs text-muted-foreground">Aumente ou diminua usuários, conexões e workspaces. Confira a diferença no valor e salve quando quiser: a cobrança muda a partir da próxima renovação, sem cobrança proporcional agora.</p>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {state.pending.map((pending) => (
          <div key={pending.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/5 px-3 py-2.5 text-sm">
            <span className="text-foreground">A partir de {formatDate(pending.effectiveAt)}: {pendingLabel(pending)}.</span>
            <GuardedButton variant="ghost" size="sm" loading={cancellingId === pending.id} onClick={() => handleCancelPending(pending.id)} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>
              Cancelar alteração
            </GuardedButton>
          </div>
        ))}

        {virtual ? <p className="rounded-lg bg-muted/40 p-3 text-sm">Para contratar quantidades adicionais, <a href="#comparar-planos" className="font-medium text-primary underline">selecione um plano abaixo</a>. A simulação e a contratação ficam por sua conta, sem precisar falar com o suporte.</p> : null}
        <div className="grid gap-5 lg:grid-cols-3">
          <CapacityStepper
            label="Usuários de atendimento"
            hint={current.includedUsers === null ? "Ilimitados incluídos no plano" : `${current.includedUsers} no plano · ${current.additionalUsers} adicionais`}
            price={unit.user ? `${formatAmount(unit.user.amount, current.currency)} por usuário${cycle}` : "O plano não vende usuários adicionais"}
            value={users}
            min={Math.max(current.includedUsers ?? 0, usage("users")?.used ?? 0)}
            onChange={setUsers}
            disabled={!canManage || applying || !!cancellingId || !unit.user || current.totalUsers===null}
            unlimited={current.totalUsers === null}
            usage={usage("users")}
          />
          <CapacityStepper
            label="Números de WhatsApp"
            hint={current.includedWhatsappConnections === null ? "Ilimitadas incluídas no plano" : `${current.includedWhatsappConnections} no plano · ${current.additionalWhatsappConnections} adicionais`}
            price={unit.whatsappConnection ? `${formatAmount(unit.whatsappConnection.amount, current.currency)} por número${cycle}` : "O plano não vende números adicionais"}
            value={whatsappConnections}
            min={Math.max(current.includedWhatsappConnections ?? 0, usage("messaging_connections")?.used ?? 0)}
            onChange={setWhatsappConnections}
            disabled={!canManage || applying || !!cancellingId || !unit.whatsappConnection || current.totalWhatsappConnections===null}
            unlimited={current.totalWhatsappConnections === null}
            usage={usage("messaging_connections")}
          />
          <CapacityStepper label="Workspaces" hint={workspaceUnlimited ? "Ilimitados incluídos no plano" : `${current.includedWorkspaces ?? workspaceUsage?.max ?? 0} no plano · ${current.additionalWorkspaces ?? 0} adicionais`}
            price={workspaceUnlimited ? "Sem custo adicional" : unit.workspace ? `${formatAmount(unit.workspace.amount, current.currency)} por ${unit.workspace.increment === 1 ? "workspace" : `pacote de ${unit.workspace.increment} workspaces`}${cycle}` : "O plano não vende workspaces adicionais"}
            value={workspaces} min={Math.max(current.includedWorkspaces ?? 0, workspaceUsage?.used ?? 0)} max={unit.workspace?.canIncrease === false ? current.totalWorkspaces ?? 0 : undefined}
            onChange={setWorkspaces} disabled={!canManage || applying || !!cancellingId || !unit.workspace || workspaceUnlimited} unlimited={workspaceUnlimited} usage={workspaceUsage} />
          {showRecordings ? (
            <CapacityStepper
              label="Gravações simultâneas (Meetings)"
              hint={current.concurrentRecordings > 0 ? `${current.concurrentRecordings} contratada(s)` : "Vorix Meetings não contratado"}
              price={unit.meetingsBase !== undefined ? `1ª ${formatAmount(unit.meetingsBase, current.currency)} · demais ${formatAmount(unit.meetingsExtraRecording ?? 0, current.currency)}${cycle}` : ""}
              value={recordings}
              min={current.concurrentRecordings > 0 ? 1 : 0}
              onChange={setRecordings}
              disabled={!canManage || applying || !!cancellingId} max={!state.meetingsSellable?current.concurrentRecordings:undefined}
            />
          ) : null}
        </div>

        {(state.adjustableAddons??[]).length?<div className="grid gap-5 sm:grid-cols-2">{state.adjustableAddons!.map(item=><CapacityStepper key={item.addonCode} label={item.name} hint={`${item.currentQuantity} contratado(s) hoje`} price={`${formatAmount(item.unitPrice,current.currency)} por unidade${cycle}`} value={addonQuantities[item.addonCode]??item.quantity} min={0} max={item.canIncrease?item.maxQuantity:item.currentQuantity} onChange={value=>setAddonQuantities(current=>({...current,[item.addonCode]:value}))} disabled={!canManage}/>)}</div>:null}
        <p className="text-xs text-muted-foreground">As quantidades respeitam o uso existente e o mínimo incluído no plano. Contatos, armazenamento e automações são ilimitados em todos os planos.</p>
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <p className="mb-2 font-semibold text-foreground">{dirty ? "O que muda no valor da renovação" : "Valor atual do seu plano"}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-1.5 font-medium">Item</th>
                  <th className="pb-1.5 text-right font-medium">Hoje</th>
                  <th className="pb-1.5 text-right font-medium">Após salvar</th>
                  <th className="pb-1.5 text-right font-medium">Diferença{cycle}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-border/60">
                  <td className="py-1.5 text-muted-foreground">Plano {current.planCode}</td>
                  <td className="py-1.5 text-right" colSpan={2}>{formatAmount(current.baseMonthlyAmount, current.currency)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">—</td>
                </tr>
                {lines.map((line) => (
                  <tr key={line.key} className="border-t border-border/60">
                    <td className="py-1.5 text-foreground">{line.label}</td>
                    <td className="py-1.5 text-right">{"unlimited" in line && line.unlimited ? "Ilimitado" : line.from}</td>
                    <td className={cn("py-1.5 text-right", line.to !== line.from && "font-semibold text-foreground")}>{"unlimited" in line && line.unlimited ? "Ilimitado" : line.to}</td>
                    <td className={cn("py-1.5 text-right font-medium", line.delta > 0 ? "text-orange-600 dark:text-orange-300" : line.delta < 0 ? "text-success" : "text-muted-foreground")}>
                      {line.delta === 0 ? "—" : `${line.delta > 0 ? "+" : "−"} ${formatAmount(Math.abs(line.delta), current.currency)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base">
            <span className="font-semibold text-foreground">{dirty ? "Novo valor por ciclo" : "Valor da próxima renovação"}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">
              {previewing || dirty && previewKey !== selectionKey ? "Calculando..." : formatAmount(nextTotal ?? estimatedTotal, current.currency)}
              {dirty && totalDelta !== 0 ? (
                <span className={cn("ml-2 text-sm", totalDelta > 0 ? "text-orange-600 dark:text-orange-300" : "text-success")}>
                  ({totalDelta > 0 ? "aumenta" : "diminui"} {formatAmount(Math.abs(totalDelta), current.currency)})
                </span>
              ) : null}
            </span>
          </div>
          {dirty && totalDelta < 0 ? <p className="mt-1 text-xs text-muted-foreground">Reduções valem a partir da próxima fatura{state.nextCharge ? ` (${formatDate(state.nextCharge.at)})` : ""} — até lá, você continua com a estrutura atual.</p> : null}
          {dirty && totalDelta > 0 ? <p className="mt-1 text-xs text-muted-foreground">Aumentos liberam a capacidade agora. O novo valor será cobrado a partir da próxima renovação, sem cobrança proporcional nesta alteração.</p> : null}
          {state.nextCharge ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Próxima cobrança em {formatDate(state.nextCharge.at)}: <span className="font-medium tabular-nums text-foreground">{formatAmount(dirty && nextTotal !== undefined ? nextTotal : state.nextCharge.amount, state.nextCharge.currency)}</span>
              {dirty ? " — este é o novo valor recorrente. Aumentos liberam capacidade agora; reduções valem na renovação." : ""}
            </p>
          ) : null}

          {dirty && preview?.recommendation.recommended && preview.recommendation.recommended.planCode !== current.planCode && preview.recommendation.recommended.totalMonthlyAmount < (preview.requestedOnCurrentPlan.totalMonthlyAmount - (preview.requestedOnCurrentPlan.meetingsMonthlyAmount ?? 0)) ? (
            <p className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-xs text-foreground">
              O plano {preview.recommendation.recommended.planCode} fica mais econômico para essa quantidade. Você pode <a href="#comparar-planos" className="font-medium underline">comparar e selecionar outro plano abaixo</a>.
            </p>
          ) : null}

          {dirty && !state.canChangeNow ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">Cadastre uma forma de pagamento para contratar essas quantidades. Suas escolhas serão levadas para o pagamento.</p>
          ) : null}

          {previewError&&dirty?<p role="alert" className="mt-3 text-sm text-destructive">{previewError}</p>:null}
          {dirty ? (
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" disabled={applying} onClick={() => { setUsers((state.next??current).totalUsers ?? 0); setWhatsappConnections((state.next??current).totalWhatsappConnections ?? 0); setWorkspaces((state.next??current).totalWorkspaces ?? workspaceUsage?.max ?? 0); setRecordings((state.next??current).concurrentRecordings);setAddonQuantities(Object.fromEntries((state.adjustableAddons??[]).map(item=>[item.addonCode,item.quantity]))); }}>Cancelar</Button>
              <GuardedButton loading={applying} disabled={previewing||!preview||previewKey!==selectionKey||!!previewError||!!cancellingId||preview.requestedOnCurrentPlan.feasible===false} onClick={handleConfirm} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>
                {state.canChangeNow ? "Salvar quantidades" : "Cadastrar forma de pagamento"}
              </GuardedButton>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Créditos de IA: saldo, e recarga com quantidade LIVRE. Com cartão salvo, cobra na hora; sem,
 * abre o pagamento único do gateway. O teste gratuito libera só uma cota para testar.
 */
function AiCreditsCard({ canManage, workspaceId }: { canManage: boolean; workspaceId: string }) {
  const { data, error, isLoading, mutate } = useAiCredits();
  const { mutate: globalMutate } = useSWRConfig();
  const [credits, setCredits] = useState<number | undefined>();
  const [buying, setBuying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data && credits === undefined) setCredits(data.pricing.presets[1] ?? data.pricing.minPurchase);
  }, [data, credits]);

  if (error) return <Card className="mt-5" id="creditos"><CardBody><ErrorState error={error} onRetry={() => mutate()} /></CardBody></Card>;
  if (isLoading || !data || credits === undefined) return <Card className="mt-5" id="creditos"><CardBody><div className="flex justify-center py-6"><Spinner /></div></CardBody></Card>;

  const { pricing } = data;
  const valid = Number.isInteger(credits) && credits >= pricing.minPurchase && credits <= pricing.maxPurchase;
  const amountCents = valid ? credits * pricing.unitPriceCents : 0;
  const quotaLeft = Math.max(0, data.monthlyQuota - data.consumedThisMonth);
  const isTrial = data.subscriptionStatus === "trial";
  const low = data.remainingCredits <= Math.max(20, data.monthlyQuota * 0.1);

  async function handleBuy() {
    if (!valid) return;
    setBuying(true);
    try {
      const result = await purchaseAiCredits({ credits: credits!, returnPath: `/workspaces/${workspaceId}/settings/plano` });
      if (result.status === "checkout") {
        window.location.href = result.checkoutUrl;
        return;
      }
      await mutate();
      await globalMutate("tenant-credits");
      toast.success(result.status === "paid" ? `${credits!.toLocaleString("pt-BR")} créditos adicionados.` : "Pagamento em processamento — os créditos entram assim que for confirmado.");
      setConfirmOpen(false);
    } catch (err) {
      toast.error("Não foi possível comprar créditos", { description: err instanceof Error ? err.message.replace(/^[A-Z_]+:\s*/, "") : "Tente novamente." });
    } finally {
      setBuying(false);
    }
  }

  return (
    <Card className="mt-5 overflow-hidden" id="creditos">
      <CardHeader>
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><VorixAiIcon className="h-4 w-4" />Créditos de IA</p>
          <p className="mt-1 text-xs text-muted-foreground">Use em análises, resumos, respostas e relatórios com IA. Precisa de mais? Recarregue a quantidade que quiser.</p>
        </div>
        {low ? <Badge variant="warning">Saldo baixo</Badge> : null}
      </CardHeader>
      <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Saldo disponível</p>
            <p className="vorix-display text-3xl font-semibold tabular-nums text-foreground">{data.remainingCredits.toLocaleString("pt-BR")}</p>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{isTrial ? "Créditos do teste" : "Cota do plano neste mês"}</dt><dd className="tabular-nums text-foreground">{quotaLeft.toLocaleString("pt-BR")} de {data.monthlyQuota.toLocaleString("pt-BR")}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Créditos comprados (não expiram)</dt><dd className="tabular-nums text-foreground">{data.extraCredits.toLocaleString("pt-BR")}</dd></div>
          </dl>
          {isTrial ? <p className="rounded-lg border border-ai/25 bg-ai/[0.07] px-3 py-2 text-xs text-foreground">Você recebeu créditos para testar a IA durante o período gratuito. Depois que acabarem, é só recarregar.</p> : null}
          {data.purchases.length > 0 ? (
            <div className="space-y-1 pt-1">
              <p className="text-xs font-medium text-muted-foreground">Últimas recargas</p>
              {data.purchases.slice(0, 4).map((purchase) => (
                <div key={purchase.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{formatDate(purchase.createdAt)} · {purchase.credits.toLocaleString("pt-BR")} créditos</span>
                  <span className="flex items-center gap-2 tabular-nums text-foreground">{formatCurrencyCents(purchase.amountCents, purchase.currency)} <StatusBadge status={purchase.status === "paid" ? "paid" : purchase.status === "pending" ? "open" : "void"} /></span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 bg-surface-2/40 p-4">
          <p className="text-sm font-medium text-foreground">Comprar créditos</p>
          <div className="flex flex-wrap gap-2">
            {pricing.presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCredits(preset)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors", credits === preset ? "border-ai bg-ai/15 text-foreground" : "border-border text-muted-foreground hover:border-ai/50 hover:text-foreground")}
              >
                {preset.toLocaleString("pt-BR")}
              </button>
            ))}
          </div>
          <div>
            <Label htmlFor="credits-amount">Ou escolha a quantidade</Label>
            <Input id="credits-amount" inputMode="numeric" value={credits ? credits.toLocaleString("pt-BR") : ""} onChange={(event) => setCredits(Number(event.target.value.replace(/\D/g, "")) || 0)} />
            <p className="mt-1 text-[11px] text-muted-foreground">De {pricing.minPurchase.toLocaleString("pt-BR")} a {pricing.maxPurchase.toLocaleString("pt-BR")} créditos · {formatCurrencyCents(pricing.unitPriceCents, pricing.currency)} por crédito</p>
          </div>
          <div className="flex items-center justify-between border-t border-border/70 pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{valid ? formatCurrencyCents(amountCents, pricing.currency) : "—"}</span>
          </div>
          {!data.canPurchase ? <p className="text-xs text-warning">{data.blockedReason}</p> : null}
          <GuardedButton variant="ai" className="w-full" disabled={!valid || !data.canPurchase || buying} loading={buying} onClick={() => (data.chargesSavedCard ? setConfirmOpen(true) : void handleBuy())} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>
            <VorixAiIcon className="h-4 w-4 text-current" />
            {data.chargesSavedCard ? `Comprar e cobrar no cartão final ${data.savedCard?.last4 ?? ""}` : "Comprar créditos"}
          </GuardedButton>
          <p className="text-[11px] text-muted-foreground">{data.chargesSavedCard ? "A cobrança é feita na forma de pagamento cadastrada e os créditos entram na hora." : "Você será levado ao pagamento seguro; os créditos entram assim que o pagamento for confirmado."}</p>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar compra de créditos?"
        description={`${credits.toLocaleString("pt-BR")} créditos por ${formatCurrencyCents(amountCents, pricing.currency)}, cobrados agora no cartão final ${data.savedCard?.last4 ?? ""}.`}
        confirmLabel="Comprar agora"
        busy={buying}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleBuy}
      />
    </Card>
  );
}

function CapacityStepper({ label, hint, price, value, min, max=999, onChange, disabled, unlimited, usage }: { label: string; hint: string; price?: string; value: number; min: number; max?:number; onChange: (value: number) => void; disabled: boolean; unlimited?: boolean; usage?: { used: number; max: number | null } }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Diminuir ${label}`} className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-2 disabled:opacity-30">
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={unlimited ? "Ilimitado" : draft}
          disabled={disabled}
          aria-label={`Quantidade de ${label}`}
          onChange={(event) => {
            const raw = event.target.value.replace(/\D/g, "");
            setDraft(raw);
            const next = Number(raw);
            if (raw && Number.isSafeInteger(next) && next >= min && next <= max) onChange(next);
          }}
          onBlur={() => {
            const next = Math.max(min, Math.min(max, Number(draft) || min));
            setDraft(String(next));
            onChange(next);
          }}
          className="h-9 w-24 rounded-md border border-input bg-background text-center text-base font-semibold tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
        />
        <button type="button" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max,value + 1))} aria-label={`Aumentar ${label}`} className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-2 disabled:opacity-30">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {price ? <p className="mt-1.5 text-xs font-medium text-foreground">{price}</p> : null}
      {usage ? <div className="mt-3"><ConsumptionBar label="Em uso" used={usage.used} max={usage.max} /></div> : null}
    </div>
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

function AddonRow({ addon, currency, interval, busy, canManage, onPurchase }: { addon: BillingOverviewAvailableAddon; currency: string; interval: BillingInterval; busy: boolean; canManage: boolean; onPurchase: () => void }) {
  const price = interval === "yearly" ? addon.yearlyPriceUsd : addon.monthlyPriceUsd;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{addon.name}</p>
        <p className="truncate text-xs text-muted-foreground">{addon.description}</p>
      </div>
      <GuardedButton variant="secondary" disabled={busy} onClick={onPurchase} allowed={canManage} blockedReason={RBAC_COPY.manageBilling}>Adicionar · {formatAmount(price, currency)}{interval === "yearly" ? "/ano" : "/mês"}</GuardedButton>
    </div>
  );
}

function cyclePrice(plan: PublicPlan, interval: BillingInterval): string {
  if (interval === "yearly" && plan.yearlyPriceUsd > 0) return `${formatAmount(plan.yearlyPriceUsd, plan.currency)}/ano`;
  return `${formatAmount(plan.monthlyPriceUsd, plan.currency)}/mês`;
}

/** Contagem dos dias de teste — ao terminar, o acesso exige forma de pagamento. */
function TrialCountdown({ days, trialEnd, hasCard }: { days: number; trialEnd: string | null; hasCard: boolean }) {
  const total = 7;
  const left = Math.max(0, days);
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-surface-2/50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{left === 0 ? "Último dia de teste" : left === 1 ? "Falta 1 dia de teste" : `Faltam ${left} dias de teste`}</p>
        {trialEnd ? <p className="text-xs text-muted-foreground">até {formatDate(trialEnd)}</p> : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", left <= 2 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, ((total - left) / total) * 100)}%` }} /></div>
      <p className="mt-2 text-xs text-muted-foreground">{hasCard ? "Ao terminar, a cobrança do plano começa no cartão cadastrado." : "Ao terminar, o acesso fica bloqueado até cadastrar uma forma de pagamento."}</p>
    </div>
  );
}
