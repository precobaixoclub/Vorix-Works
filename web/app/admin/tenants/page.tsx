"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
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
 *
 * A paginação é SERVER-SIDE (offset/limit na querystring), então não usa o
 * `usePagination(items, { auto: true })` do padrão de lista client-side — a altura da `ListCard`
 * fica automática (cresce com o conteúdo) e `TablePagination` só espelha o estado de página que já
 * existia (`page`/`setPage`), sem mudar a lógica de busca de dados.
 */
const PAGE_SIZE = 20;

export default function AdminTenantsPage() {
  const [planCode, setPlanCode] = useState<PlatformPlanCode | "all">("all");
  const [subscriptionStatus, setSubscriptionStatus] = useState<PlatformSubscriptionStatus | "all">("all");
  const [page, setPage] = useState(0);

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      planCode: (planCode === "all" ? undefined : planCode) as PlatformPlanCode | undefined,
      subscriptionStatus: (subscriptionStatus === "all" ? undefined : subscriptionStatus) as PlatformSubscriptionStatus | undefined,
    }),
    [page, planCode, subscriptionStatus],
  );

  const { data, error, isLoading, mutate } = useTenantsList(params);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Contas de clientes" description="Cada linha é um tenant. Clique para ver o consumo, ajustar créditos e trocar de plano." />

      <ScreenGuide
        title="Como operar clientes"
        description="Use esta lista para localizar uma conta e abrir os ajustes financeiros e de acesso."
        items={[
          "Filtre por plano ou status.",
          "Clique na conta para ver detalhes.",
          "Ajuste créditos após pagamento manual.",
          "Suspenda ou reative somente quando necessário.",
        ]}
        aside={<p>Tenant significa a conta do cliente dentro da plataforma.</p>}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Plano</label>
            <Select
              value={planCode}
              onValueChange={(value) => {
                setPage(0);
                setPlanCode(value as PlatformPlanCode | "all");
              }}
            >
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {PLATFORM_PLAN_CODES.map((code) => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Status</label>
            <Select
              value={subscriptionStatus}
              onValueChange={(value) => {
                setPage(0);
                setSubscriptionStatus(value as PlatformSubscriptionStatus | "all");
              }}
            >
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {PLATFORM_SUBSCRIPTION_STATUSES.map((code) => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {isLoading ? "Carregando…" : `${total} conta${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}`}
          </div>
        </CardBody>
      </Card>

      <ListCard
        footer={
          data && data.items.length > 0 ? (
            <TablePagination
              currentPage={page + 1}
              totalPages={totalPages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(nextPage) => setPage(nextPage - 1)}
            />
          ) : undefined
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta (tenant)</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Créditos usados</TableHead>
              <TableHead className="text-right">% da cota</TableHead>
              <TableHead className="text-right">Lucro do mês</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8">
                  <ErrorState error={error} onRetry={() => mutate()} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center">
                  <Spinner className="mx-auto h-5 w-5 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : !data || data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {planCode !== "all" || subscriptionStatus !== "all"
                    ? "Nenhuma conta encontrada com esses filtros."
                    : "Nenhuma conta cadastrada ainda."}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => (
                <TableRow key={row.tenantId}>
                  <TableCell>
                    <Link href={`/admin/tenants/${encodeURIComponent(row.tenantId)}`} className="font-medium text-primary hover:underline">
                      {row.tenantId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PlanBadge code={row.billing.planCode} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.billing.subscriptionStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(row.totalCreditsUsedThisMonth)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.quotaUsagePercent.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatUsd(row.currentProfitUsd)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ListCard>
    </div>
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

function StatusBadge({ status }: { status: string }) {
  const style: Record<string, string> = {
    trial: "bg-muted text-muted-foreground",
    active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    past_due: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    suspended: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    cancelled: "bg-muted text-muted-foreground",
    expired: "bg-muted text-muted-foreground",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
