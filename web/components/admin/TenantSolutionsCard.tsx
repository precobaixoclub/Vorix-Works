"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Switch } from "@/components/ui/switch";
import { apiClient, ApiError } from "@/lib/api-client";
import { Input } from "@/components/Field";
import { Button } from "@/components/Button";

type TenantSolution = { key: string; name: string; enabled: boolean; internal: boolean; commercialAvailability: "public" | "internal"; entitlement?: { enabled: boolean; source: string; reason?: string; updatedAt: string; limits?: Record<string, number> } };

/** Limites padrão ao liberar o Meetings manualmente (1 gravação simultânea, 600 min/mês, 90 dias, 20 GB). */
const MEETINGS_DEFAULT_LIMITS = { maxConcurrentRecordings: 1, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 20 * 1024 * 1024 * 1024 };

/**
 * Admin da plataforma: liga/desliga cada solução (Conversas, Meetings, Marketing) para a conta.
 * Solução ainda não comercial (Marketing) só aceita concessão "interna".
 */
export function TenantSolutionsCard({ tenantId }: { tenantId: string }) {
  const { data, error, mutate } = useSWR(["admin-tenant-solutions", tenantId], () => apiClient.get<{ solutions: TenantSolution[] }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/solutions`));
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function toggle(solution: TenantSolution, enabled: boolean, limits?: Record<string, number>) {
    setBusy(solution.key);
    try {
      await apiClient.put(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/solutions/${encodeURIComponent(solution.key)}`, {
        enabled,
        source: solution.commercialAvailability === "internal" ? "internal" : "manual",
        reason: reason.trim(),
        ...(solution.key === "meetings" ? { limits: limits ?? solution.entitlement?.limits ?? MEETINGS_DEFAULT_LIMITS } : {}),
      });
      await mutate();
      toast.success(`${solution.name} atualizado`, { description: "O acesso é atualizado em até 1 segundo. Bloqueios globais ou da conta continuam valendo." });
    } catch (cause) {
      toast.error("Não foi possível alterar", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="text-base font-semibold text-foreground">Soluções da conta</div>
        <p className="text-sm text-muted-foreground">Libere ou bloqueie cada produto. A concessão manual preserva a assinatura e o valor cobrado.</p>
      </CardHeader>
      <CardBody className="space-y-2">
        {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
        {!data && !error ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        <label className="mb-4 block space-y-1 text-sm">Motivo da alteração do produto<Input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} minLength={3} placeholder="Informe o motivo antes de alterar" /></label>
        {(data?.solutions ?? []).map((solution) => (
          <div key={solution.key} className="rounded-lg border border-border/60 px-3 py-3 text-sm"><div className="flex items-center justify-between gap-3">
            <span>
              <span className="font-medium text-foreground">{solution.name}</span>
              <span className="block text-xs text-muted-foreground">Origem: {solution.entitlement?.source === "subscription" ? "assinatura" : solution.entitlement?.source === "manual" ? "liberação manual" : solution.entitlement?.source === "internal" ? "conta interna" : "padrão da plataforma"} · Acesso efetivo: {solution.enabled ? "liberado" : "bloqueado"}</span>
              {solution.commercialAvailability === "internal" ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">acesso interno</span> : null}
            </span>
            <Switch checked={solution.entitlement?.enabled ?? solution.enabled} disabled={!!busy || reason.trim().length < 3} onCheckedChange={(value) => void toggle(solution, value)} aria-label={`${solution.enabled ? "Desligar" : "Liberar"} ${solution.name}`} />
          </div>{solution.key === "meetings" && <MeetingLimits key={solution.entitlement?.updatedAt ?? "initial"} limits={solution.entitlement?.limits ?? MEETINGS_DEFAULT_LIMITS} disabled={!!busy || reason.trim().length < 3} onSave={limits => toggle(solution, solution.entitlement?.enabled ?? solution.enabled, limits)} />}</div>
        ))}
      </CardBody>
    </Card>
  );
}

function MeetingLimits({ limits, disabled, onSave }: { limits: Record<string, number>; disabled: boolean; onSave: (limits: Record<string, number>) => Promise<void> }) {
  const [draft, setDraft] = useState({ ...MEETINGS_DEFAULT_LIMITS, ...limits });
  return <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">Limites do Meetings</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void onSave(draft); }}><div className="grid gap-3 sm:grid-cols-2">{(Object.entries({ maxConcurrentRecordings: "Gravações simultâneas", monthlyRecordingMinutes: "Minutos de gravação por mês", meetingRetentionDays: "Retenção (dias)", maxStorageBytes: "Armazenamento (bytes)" }) as [keyof typeof MEETINGS_DEFAULT_LIMITS, string][]).map(([key, label]) => <label key={key} className="space-y-1 text-xs">{label}<Input required type="number" step={1} min={0} max={Number.MAX_SAFE_INTEGER} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} /></label>)}</div><Button type="submit" variant="secondary" disabled={disabled}>Salvar limites do Meetings</Button></form></details>;
}
