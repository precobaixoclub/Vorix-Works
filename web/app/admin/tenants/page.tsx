"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { useTenantsList } from "@/features/platform-admin/hooks";
import {
  PLATFORM_PLAN_CODES,
  PLATFORM_SUBSCRIPTION_STATUSES,
  type PlatformPlanCode,
  type PlatformSubscriptionStatus,
} from "@/features/platform-admin/types";

/**
 * Listagem paginada de contas (`/admin/tenants`). Filtros por plano e status são passados como
 * querystring ao backend — nada é filtrado no cliente. Paginação simples "próxima/anterior" (20
 * por página) — Sprint 25.
 */
const PAGE_SIZE = 20;

export default function AdminTenantsPage() {
  const [planCode, setPlanCode] = useState<PlatformPlanCode | "">("");
  const [subscriptionStatus, setSubscriptionStatus] = useState<PlatformSubscriptionStatus | "">("");
  const [page, setPage] = useState(0);

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      planCode: (planCode || undefined) as PlatformPlanCode | undefined,
      subscriptionStatus: (subscriptionStatus || undefined) as PlatformSubscriptionStatus | undefined,
    }),
    [page, planCode, subscriptionStatus],
  );

  const { data, error, isLoading } = useTenantsList(params);
  const total = data?.total ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Contas de clientes" description="Cada linha é um tenant. Clique para ver o consumo, ajustar créditos e trocar de plano." />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-ink-muted">Plano</label>
            <select
              value={planCode}
              onChange={(event) => {
                setPage(0);
                setPlanCode((event.target.value as PlatformPlanCode) || "");
              }}
              className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {PLATFORM_PLAN_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-ink-muted">Status</label>
            <select
              value={subscriptionStatus}
              onChange={(event) => {
                setPage(0);
                setSubscriptionStatus((event.target.value as PlatformSubscriptionStatus) || "");
              }}
              className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {PLATFORM_SUBSCRIPTION_STATUSES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-xs text-ink-muted">
            {isLoading ? "Carregando…" : `${total} conta${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}`}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-base font-semibold text-ink">Lista</div>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-muted">
              <Spinner className="h-4 w-4" /> Carregando contas…
            </div>
          ) : error ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Não foi possível carregar as contas"
                description={error instanceof Error ? error.message : "Verifique se a API está no ar."}
              />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState title="Nenhuma conta encontrada" description="Ajuste os filtros ou aguarde novos cadastros." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-2 font-medium">Conta (tenant)</th>
                  <th className="px-5 py-2 font-medium">Plano</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 text-right font-medium">Créditos usados</th>
                  <th className="px-5 py-2 text-right font-medium">% da cota</th>
                  <th className="px-5 py-2 text-right font-medium">Lucro do mês</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.tenantId} className="border-b border-border/60 last:border-b-0 hover:bg-surface-sunken">
                    <td className="px-5 py-2">
                      <Link href={`/admin/tenants/${encodeURIComponent(row.tenantId)}`} className="text-accent hover:underline">
                        {row.tenantId}
                      </Link>
                    </td>
                    <td className="px-5 py-2">
                      <PlanBadge code={row.billing.planCode} />
                    </td>
                    <td className="px-5 py-2">
                      <StatusBadge status={row.billing.subscriptionStatus} />
                    </td>
                    <td className="px-5 py-2 text-right text-ink-muted">{formatNumber(row.totalCreditsUsedThisMonth)}</td>
                    <td className="px-5 py-2 text-right">{row.quotaUsagePercent.toFixed(1)}%</td>
                    <td className="px-5 py-2 text-right font-semibold text-emerald-700">{formatUsd(row.currentProfitUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {data && data.items.length > 0 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            disabled={page === 0}
            className="rounded-md border border-border px-3 py-1.5 text-ink hover:bg-surface-raised disabled:opacity-40"
          >
            ← Anterior
          </button>
          <div className="text-ink-muted">
            Página {page + 1} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </div>
          <button
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={!hasNext}
            className="rounded-md border border-border px-3 py-1.5 text-ink hover:bg-surface-raised disabled:opacity-40"
          >
            Próxima →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PlanBadge({ code }: { code: string }) {
  const style: Record<string, string> = {
    FREE: "bg-slate-100 text-slate-700",
    START: "bg-sky-100 text-sky-800",
    PRO: "bg-violet-100 text-violet-800",
    BUSINESS: "bg-amber-100 text-amber-800",
    ENTERPRISE: "bg-emerald-100 text-emerald-800",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style[code] ?? "bg-slate-100 text-slate-700"}`}>{code}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const style: Record<string, string> = {
    trial: "bg-slate-100 text-slate-700",
    active: "bg-emerald-100 text-emerald-800",
    past_due: "bg-amber-100 text-amber-800",
    suspended: "bg-red-100 text-red-800",
    cancelled: "bg-slate-100 text-slate-500",
    expired: "bg-slate-100 text-slate-500",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style[status] ?? "bg-slate-100 text-slate-700"}`}>{status}</span>;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
