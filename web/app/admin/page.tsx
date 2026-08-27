"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformDashboard } from "@/features/platform-admin/hooks";

/**
 * Visão geral (`/admin`) — Sprint 25. Números do mês corrente somados sobre todos os tenants:
 * receita cobrada dos clientes vs custo dos provedores de IA vs lucro (a diferença). "Top 10 por
 * receita" ajuda a identificar rápido quais contas estão puxando o faturamento.
 *
 * Não é um hub (nenhum card leva a outra rota — a navegação entre as seções do admin já vive na
 * sidebar de `app/admin/layout.tsx`); é um painel de métricas, então segue o padrão de
 * lista/estados (`StatsGrid` + tabela) em vez do padrão de hub (`HubPage`).
 */
export default function AdminDashboardPage() {
  const { data, error, isLoading, mutate } = usePlatformDashboard();

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Visão geral da plataforma"
        description="Números do mês corrente — receita, custo dos provedores de IA e lucro consolidado."
      />

      <ScreenGuide
        title="Para que serve"
        description="Esta é a visão do dono da plataforma, não de uma marca específica."
        items={[
          "Veja contas ativas e suspensas.",
          "Compare receita, custo e lucro do mês.",
          "Abra uma conta para ajustar plano e créditos.",
          "Use Chaves OpenAI/Gemini para liberar geração por IA.",
        ]}
        aside={<p>Os números são consolidados de todos os clientes e ajudam a acompanhar operação e margem.</p>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando dashboard…
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? null : (
        <div className="flex flex-col gap-6">
          <StatsGrid>
            <MetricCard label="Contas totais" value={data.totalTenants.toString()} hint={`${data.activeTenants} ativas · ${data.suspendedTenants} suspensas`} />
            <MetricCard label="Receita do mês" value={formatUsd(data.totalRevenueUsd)} hint={`Período ${data.currentPeriod}`} />
            <MetricCard label="Custo dos provedores" value={formatUsd(data.totalProviderCostUsd)} hint={`${formatNumber(data.totalRequestsCount)} requisições`} />
            <MetricCard label="Lucro consolidado" value={formatUsd(data.totalProfitUsd)} hint={`${formatNumber(data.totalCreditsConsumed)} créditos consumidos`} highlight />
          </StatsGrid>

          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-foreground">Top 10 contas por receita</div>
                <div className="text-xs text-muted-foreground">Ranking do período {data.currentPeriod} — receita cobrada e lucro por conta.</div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta (tenant)</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Ranking fixo (Top 10) — a ordem É a informação, sem cabeçalho ordenável. */}
                  {data.topTenantsByRevenue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        Ainda não há consumo neste período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.topTenantsByRevenue.map((row) => (
                      <TableRow key={row.tenantId}>
                        <TableCell>
                          <Link href={`/admin/tenants/${encodeURIComponent(row.tenantId)}`} className="text-primary hover:underline">
                            {row.tenantId}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <PlanBadge code={row.planCode} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatUsd(row.customerPriceUsd)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatUsd(row.providerCostUsd)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatUsd(row.profitUsd)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : undefined}>
      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </Card>
  );
}

function PlanBadge({ code }: { code: string }) {
  const style: Record<string, string> = {
    FREE: "bg-muted text-muted-foreground",
    START: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    PRO: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
    BUSINESS: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    ENTERPRISE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style[code] ?? "bg-muted text-muted-foreground"}`}>{code}</span>;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
