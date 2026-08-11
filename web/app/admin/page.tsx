"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { usePlatformDashboard } from "@/features/platform-admin/hooks";

/**
 * Visão geral (`/admin`) — Sprint 25. Números do mês corrente somados sobre todos os tenants:
 * receita cobrada dos clientes vs custo dos provedores de IA vs lucro (a diferença). "Top 10 por
 * receita" ajuda a identificar rápido quais contas estão puxando o faturamento.
 */
export default function AdminDashboardPage() {
  const { data, error, isLoading } = usePlatformDashboard();

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Visão geral da plataforma"
        description="Números do mês corrente — receita, custo dos provedores de IA e lucro consolidado."
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando dashboard…
        </div>
      ) : error ? (
        <EmptyState
          title="Não foi possível carregar o dashboard"
          description={error instanceof Error ? error.message : "Verifique se a API está no ar."}
        />
      ) : !data ? null : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Contas totais" value={data.totalTenants.toString()} hint={`${data.activeTenants} ativas · ${data.suspendedTenants} suspensas`} />
            <MetricCard label="Receita do mês" value={formatUsd(data.totalRevenueUsd)} hint={`Período ${data.currentPeriod}`} />
            <MetricCard label="Custo dos provedores" value={formatUsd(data.totalProviderCostUsd)} hint={`${formatNumber(data.totalRequestsCount)} requisições`} />
            <MetricCard label="Lucro consolidado" value={formatUsd(data.totalProfitUsd)} hint={`${formatNumber(data.totalCreditsConsumed)} créditos consumidos`} highlight />
          </div>

          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-ink">Top 10 contas por receita</div>
                <div className="text-xs text-ink-muted">Ranking do período {data.currentPeriod} — receita cobrada e lucro por conta.</div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.topTenantsByRevenue.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-ink-muted">
                  Ainda não há consumo neste período.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th className="px-5 py-2 font-medium">Conta (tenant)</th>
                        <th className="px-5 py-2 font-medium">Plano</th>
                        <th className="px-5 py-2 text-right font-medium">Receita</th>
                        <th className="px-5 py-2 text-right font-medium">Custo</th>
                        <th className="px-5 py-2 text-right font-medium">Lucro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topTenantsByRevenue.map((row) => (
                        <tr key={row.tenantId} className="border-b border-border/60 last:border-b-0 hover:bg-surface-sunken">
                          <td className="px-5 py-2">
                            <Link href={`/admin/tenants/${encodeURIComponent(row.tenantId)}`} className="text-accent hover:underline">
                              {row.tenantId}
                            </Link>
                          </td>
                          <td className="px-5 py-2">
                            <PlanBadge code={row.planCode} />
                          </td>
                          <td className="px-5 py-2 text-right font-medium">{formatUsd(row.customerPriceUsd)}</td>
                          <td className="px-5 py-2 text-right text-ink-muted">{formatUsd(row.providerCostUsd)}</td>
                          <td className="px-5 py-2 text-right font-semibold text-emerald-700">{formatUsd(row.profitUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-accent/40 bg-accent/5" : undefined}>
      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
        {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
      </div>
    </Card>
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
