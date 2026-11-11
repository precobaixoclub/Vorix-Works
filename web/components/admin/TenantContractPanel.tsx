"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input } from "@/components/Field";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TenantAccessEditor } from "./TenantAccessEditor";
import type { CapacityPreviewResult } from "@/features/billing/types";
import { accessLabels, date, describeChange, money, quota, selectClass, type Contract } from "./tenant-contract-model";

export function TenantContractPanel({ tenantId, onChanged }: { tenantId: string; onChanged: () => Promise<unknown> }) {
  const path = `/v1/admin/tenants/${encodeURIComponent(tenantId)}`;
  const { data, error, mutate } = useSWR(["admin-contract", tenantId], () => apiClient.get<Contract>(`${path}/contract`));
  const [tab, setTab] = useState("contract");
  const refresh = async () => { await Promise.all([mutate(), onChanged()]); };
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <p className="py-8 text-sm text-muted-foreground">Carregando contrato e permissões…</p>;
  return <section className="my-6 space-y-5" aria-label="Gestão da conta">
    <nav aria-label="Seções do contrato" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {[["contract", "Contrato e cobrança"], ["access", "Acessos e limites"], ["history", "Histórico de alterações"]].map(([key, name]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)} aria-pressed={tab === key}>{name}</Button>)}
    </nav>
    {tab === "contract" && <>
      <div className="grid gap-4 md:grid-cols-3">
        <Fact title="Plano contratado" value={data.planName} detail={data.contract.virtual ? "Concessão administrativa, sem assinatura de pagamento" : `Versão ${data.contract.planVersionId}`} />
        <Fact title="Cobrança recorrente" value={data.contract.virtual ? "Sem cobrança automática" : money(data.capacity.current.totalMonthlyAmount, data.capacity.current.currency)} detail={data.subscription ? `${data.subscription.interval === "yearly" ? "Anual" : "Mensal"} · ${data.subscription.status} · ${data.subscription.provider}` : "Nenhum contrato vinculado a um provedor de pagamento"} />
        <Fact title="Acesso efetivo" value={data.controls.accessMode === "blocked" ? "Bloqueado pelo administrador" : data.effective.readOnly ? "Somente leitura" : "Liberado"} detail={`${accessLabels[data.controls.accessMode]}${data.subscription?.cancelAtPeriodEnd ? " · Cancelamento agendado" : ""}`} />
      </div>
      <Card><CardHeader><h2 className="font-semibold">Itens contratados</h2><p className="text-sm text-muted-foreground">Adicionais e preços da assinatura. Liberações manuais ficam em Acessos e limites.</p></CardHeader><CardBody className="space-y-3">
        <div className="grid gap-2 text-sm sm:grid-cols-2"><p>Usuários: <strong>{quota(data.capacity.current.totalUsers)}</strong></p><p>Conexões WhatsApp: <strong>{quota(data.capacity.current.totalWhatsappConnections)}</strong></p><p>Espaços ativos: <strong>{quota(data.capacity.current.totalWorkspaces)}</strong></p><p>Gravações simultâneas: <strong>{data.capacity.current.concurrentRecordings}</strong></p></div>
        {data.addons.length ? <ul className="divide-y divide-border">{data.addons.map(addon => <li key={addon.code} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{addon.name} × {addon.quantity}</span><span>{money(addon.unitPrice * addon.quantity, data.capacity.current.currency)} por ciclo</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhum adicional contratado.</p>}
        <p className="text-sm">Próxima renovação: {date(data.subscription?.currentPeriodEnd ?? data.subscription?.trialEnd)}</p>
        {data.capacity.nextCharge && <p className="text-sm">Próxima cobrança: <strong>{money(data.capacity.nextCharge.amount, data.capacity.nextCharge.currency)}</strong> em {date(data.capacity.nextCharge.at)}</p>}
      </CardBody></Card>
      <PlanChange key={data.contract.planVersionId} data={data} path={path} refresh={refresh} />
      <CapacityEditor key={JSON.stringify(data.capacity)} data={data} path={path} refresh={refresh} />
    </>}
    {tab === "access" && <>
      <TenantAccessEditor data={data} path={path} refresh={refresh} />
    </>}
    {tab === "history" && <Card><CardHeader><h2 className="font-semibold">Liberações, bloqueios e limites</h2><p className="text-sm text-muted-foreground">Últimas 100 alterações administrativas. A movimentação de créditos aparece abaixo.</p></CardHeader><CardBody>
      {!data.history.length ? <p className="text-sm text-muted-foreground">Nenhuma alteração manual registrada.</p> : <ul className="divide-y divide-border">{data.history.map(change => <li key={change.id} className="space-y-1 py-4 text-sm"><p className="font-medium">{change.reason}</p><p className="text-xs text-muted-foreground">{date(change.occurredAt)} · {change.actorUserId ?? "Migração da plataforma"}</p><ul className="list-inside list-disc text-muted-foreground">{(describeChange(change.before, change.after).length ? describeChange(change.before, change.after) : ["Configuração salva sem alteração de valores."]).map(line => <li key={line}>{line}</li>)}</ul></li>)}</ul>}
    </CardBody></Card>}
  </section>;
}

function Fact({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <Card><CardBody className="space-y-1 pt-5"><p className="text-xs text-muted-foreground">{title}</p><p className="text-lg font-semibold">{value}</p><p className="break-words text-xs text-muted-foreground">{detail}</p></CardBody></Card>;
}
function PlanChange({ data, path, refresh }: { data: Contract; path: string; refresh: () => Promise<void> }) {
  const [planCode, setPlanCode] = useState(data.contract.planCode); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const plan = data.plans.find(item => item.code === planCode);
  const amount = plan ? (data.subscription?.interval === "yearly" ? plan.yearlyPrice : plan.monthlyPrice) + data.capacity.current.addonsMonthlyAmount : 0;
  const canChange = data.contract.virtual || data.capacity.canChangeNow;
  async function apply() { setBusy(true); try { await apiClient.post(`${path}/plan`, { planCode }); await refresh(); setConfirm(false); toast.success("Plano atualizado"); } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao mudar plano"); } finally { setBusy(false); } }
  return <Card><CardHeader><h2 className="font-semibold">Alterar plano</h2></CardHeader><CardBody className="space-y-3"><p className="text-sm text-muted-foreground">{data.contract.virtual ? "Conta sem assinatura: a troca concede o plano e seus limites, sem criar cobrança automática." : "A troca atualiza a assinatura no provedor. Limites e adicionais são conferidos antes da alteração."}</p><div className="flex flex-wrap gap-3"><select aria-label="Novo plano" className={`${selectClass} max-w-xs`} value={planCode} disabled={busy || !canChange} onChange={event => setPlanCode(event.target.value)}>{data.plans.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select><Button disabled={!canChange || busy || planCode === data.contract.planCode} onClick={() => setConfirm(true)}>Revisar troca de plano</Button></div>{!canChange && <p className="text-xs text-muted-foreground">A assinatura precisa estar regularizada e vinculada ao provedor para alterar a cobrança. Liberações temporárias estão em Acessos e limites.</p>}
    <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} onConfirm={apply} busy={busy} title={`Alterar para ${plan?.name ?? planCode}?`} description={data.contract.virtual ? "O novo plano será liberado imediatamente. Não haverá cobrança automática. Liberações e bloqueios manuais serão mantidos." : `Valor recorrente previsto: ${money(amount, plan?.currency ?? data.capacity.current.currency)} por ciclo. O provedor poderá aplicar o ajuste proporcional. Liberações manuais serão mantidas.`} confirmLabel="Aplicar troca de plano" />
  </CardBody></Card>;
}
function CapacityEditor({ data, path, refresh }: { data: Contract; path: string; refresh: () => Promise<void> }) {
  const current = data.capacity.next ?? data.capacity.current;
  const [values, setValues] = useState({ users: current.totalUsers ?? 0, whatsappConnections: current.totalWhatsappConnections ?? 0, workspaces: current.totalWorkspaces ?? 0, concurrentRecordings: current.concurrentRecordings });
  const [addons, setAddons] = useState<Record<string, number>>(Object.fromEntries((data.capacity.adjustableAddons ?? []).map(item => [item.addonCode, item.quantity])));
  const [preview, setPreview] = useState<CapacityPreviewResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [confirm, setConfirm] = useState(false);
  const payload = { ...values, workspaces: current.totalWorkspaces === null ? undefined : values.workspaces, concurrentRecordings: data.capacity.meetingsSellable ? values.concurrentRecordings : undefined, addonQuantities: addons };
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(""); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível alterar."); } finally { setBusy(false); } }
  return <Card><CardHeader><h2 className="font-semibold">Capacidade e adicionais pagos</h2><p className="text-sm text-muted-foreground">Aumentos entram imediatamente; reduções são agendadas para a renovação e atualizam a próxima cobrança.</p></CardHeader><CardBody className="space-y-4">
    {!data.capacity.canChangeNow ? <p className="text-sm text-muted-foreground">Sem assinatura de pagamento habilitada para ajustes. Use Acessos e limites para concessões administrativas.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">{([{ key: "users", label: "Usuários", unlimited: current.totalUsers === null }, { key: "whatsappConnections", label: "Conexões WhatsApp", unlimited: current.totalWhatsappConnections === null }, { key: "workspaces", label: "Espaços ativos", unlimited: current.totalWorkspaces === null }, ...(data.capacity.meetingsSellable ? [{ key: "concurrentRecordings", label: "Gravações simultâneas", unlimited: false }] : [])] as { key: keyof typeof values; label: string; unlimited: boolean }[]).map(field => <label key={field.key} className="space-y-1 text-sm">{field.label}{field.unlimited ? <p>Ilimitado</p> : <Input type="number" min={0} max={10000} step={1} value={values[field.key]} disabled={busy} onChange={event => { setPreview(null); setValues({ ...values, [field.key]: Number(event.target.value) }); }} />}</label>)}</div>
      {(data.capacity.adjustableAddons ?? []).map(addon => <label key={addon.addonCode} className="block space-y-1 text-sm">{addon.name} (unidades)<Input className="max-w-xs" type="number" min={0} max={addon.canIncrease ? addon.maxQuantity ?? 10000 : addon.currentQuantity} value={addons[addon.addonCode] ?? 0} disabled={busy} onChange={event => { setPreview(null); setAddons({ ...addons, [addon.addonCode]: Number(event.target.value) }); }} /></label>)}
      <Button variant="secondary" disabled={busy} onClick={() => run(async () => setPreview(await apiClient.post<CapacityPreviewResult>(`${path}/capacity/preview`, payload)))}>Calcular nova cobrança</Button>
      {preview && <div className="space-y-2 rounded-lg border border-border p-4 text-sm"><p>Novo valor recorrente: <strong>{money(preview.requestedOnCurrentPlan.totalMonthlyAmount, preview.requestedOnCurrentPlan.currency)}</strong> por ciclo</p><p className="text-muted-foreground">A projeção considera as quantidades solicitadas após as reduções agendadas.</p><Button disabled={busy || !preview.requestedOnCurrentPlan.feasible} onClick={() => setConfirm(true)}>Revisar e aplicar quantidades</Button></div>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!!data.capacity.pending.length && <div><h3 className="mb-2 text-sm font-medium">Reduções agendadas</h3><ul className="space-y-2">{data.capacity.pending.map(change => <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={change.id}><span>{change.addonCode}: {change.targetQuantity} unidades em {date(change.effectiveAt)}</span><Button variant="secondary" disabled={busy} onClick={() => run(async () => { await apiClient.post(`${path}/capacity/pending/${encodeURIComponent(change.id)}/cancel`, {}); await refresh(); })}>Cancelar redução</Button></li>)}</ul></div>}
    <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} busy={busy} onConfirm={() => run(async () => { await apiClient.post(`${path}/capacity/apply`, { ...payload, confirmed: true }); await refresh(); setConfirm(false); toast.success("Capacidade atualizada"); })} title="Aplicar alteração de cobrança?" description={`Valor recorrente projetado: ${preview ? money(preview.requestedOnCurrentPlan.totalMonthlyAmount, preview.requestedOnCurrentPlan.currency) : "—"}. Aumentos entram agora; reduções valem na renovação. O provedor pode aplicar ajuste proporcional.`} confirmLabel="Confirmar quantidades e cobrança" />
  </CardBody></Card>;
}
