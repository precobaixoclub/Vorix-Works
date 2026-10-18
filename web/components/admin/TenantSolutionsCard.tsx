"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Switch } from "@/components/ui/switch";
import { apiClient, ApiError } from "@/lib/api-client";

type TenantSolution = { key: string; name: string; enabled: boolean; internal: boolean; commercialAvailability: "public" | "internal" };

/** Limites padrão ao liberar o Meetings manualmente (1 gravação simultânea, 600 min/mês, 90 dias, 20 GB). */
const MEETINGS_DEFAULT_LIMITS = { maxConcurrentRecordings: 1, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 20 * 1024 * 1024 * 1024 };

/**
 * Admin da plataforma: liga/desliga cada solução (Conversas, Meetings, Marketing) para a conta.
 * Solução ainda não comercial (Marketing) só aceita concessão "interna".
 */
export function TenantSolutionsCard({ tenantId }: { tenantId: string }) {
  const { data, error, mutate } = useSWR(["admin-tenant-solutions", tenantId], () => apiClient.get<{ solutions: TenantSolution[] }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/solutions`));
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(solution: TenantSolution, enabled: boolean) {
    setBusy(solution.key);
    try {
      await apiClient.put(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/solutions/${encodeURIComponent(solution.key)}`, {
        enabled,
        source: solution.commercialAvailability === "internal" ? "internal" : "manual",
        reason: enabled ? "Liberado pelo admin da plataforma" : "Desligado pelo admin da plataforma",
        ...(enabled && solution.key === "meetings" ? { limits: MEETINGS_DEFAULT_LIMITS } : {}),
      });
      await mutate();
      toast.success(`${solution.name} ${enabled ? "liberado" : "desligado"} para esta conta`, { description: "Pode levar até 30 segundos para aparecer para os usuários." });
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
        <p className="text-sm text-muted-foreground">Ferramentas que os usuários desta conta enxergam.</p>
      </CardHeader>
      <CardBody className="space-y-2">
        {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
        {!data && !error ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {(data?.solutions ?? []).map((solution) => (
          <label key={solution.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-foreground">{solution.name}</span>
              {solution.commercialAvailability === "internal" ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">acesso interno</span> : null}
            </span>
            <Switch checked={solution.enabled} disabled={busy === solution.key} onCheckedChange={(value) => void toggle(solution, value)} aria-label={`${solution.enabled ? "Desligar" : "Liberar"} ${solution.name}`} />
          </label>
        ))}
      </CardBody>
    </Card>
  );
}
