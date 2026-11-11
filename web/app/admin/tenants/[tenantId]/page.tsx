"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  adjustTenantCredits,
  setTenantMultiplier,
} from "@/features/platform-admin/api";
import { useTenantDetail } from "@/features/platform-admin/hooks";
import { StatsGrid } from "@/components/StatsGrid";
import { TenantContractPanel, type TenantContractTab } from "@/components/admin/TenantContractPanel";

/**
 * Detalhe de um tenant (`/admin/tenants/[tenantId]`) — Sprint 25. Tudo o que o admin manual
 * precisa para operar sem gateway de pagamento: liberar créditos após um Pix, trocar plano após
 * upgrade, suspender por inadimplência, mexer no multiplicador de preço em casos especiais.
 * Todas as ações caem em `POST /v1/admin/tenants/...` e o SWR revalida a página inteira depois.
 *
 * Continua como ROTA (não virou `DetailModal`, ao contrário de `PublicationDetailModal`): além da
 * listagem de contas (`/admin/tenants`), o dashboard (`/admin/page.tsx`, tabela "Top 10 contas")
 * também linka direto para `/admin/tenants/{tenantId}`. Um modal aberto a partir de uma linha só
 * faz sentido quando existe UMA lista dona da navegação; aqui há duas entradas independentes, e a
 * rota também é um destino compartilhável/copiável (fica no financeiro do time via link direto).
 */
export default function AdminTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = decodeURIComponent(params.tenantId);
  const { data, error, isLoading, mutate } = useTenantDetail(tenantId);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TenantTab>("contract");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await mutate();
      toast.success("Alteração aplicada.");
    } catch (err) {
      toast.error("Não foi possível aplicar a alteração", {
        description: err instanceof Error ? err.message : "Falhou.",
      });
    } finally {
      setBusy(false);
    }
  }


  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-10 text-sm text-muted-foreground sm:px-6 sm:py-14">
        <Spinner className="h-4 w-4" /> Carregando conta…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
        <ErrorState error={error} onRetry={() => mutate()} />
        <div className="mt-4">
          <Link href="/admin/tenants" className="text-sm text-primary hover:underline">
            ← Voltar para a lista
          </Link>
        </div>
      </div>
    );
  }

  const { overview, planName, workspaces, members, recentCreditEntries, usageHistory } = data;
  const { billing, currentUsage } = overview;
  const activeMembers = members.filter((member) => member.status !== "disabled").length;
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active").length;
  const statusLabel = STATUS_LABEL[billing.subscriptionStatus] ?? billing.subscriptionStatus;

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 text-sm">
        <Link href="/admin/tenants" className="text-primary hover:underline">
          ← Clientes
        </Link>
      </div>
      <PageHeader title={overview.displayName ?? tenantId} description={`Plano ${planName} · ${statusLabel}`} />

      <StatsGrid className="mb-6">
        <MetricCard label="Plano" value={planName} hint={statusLabel} />
        <MetricCard label="Usuários ativos" value={formatNumber(activeMembers)} hint={`${formatNumber(members.length)} no total`} />
        <MetricCard label="Espaços ativos" value={formatNumber(activeWorkspaces)} hint={`${formatNumber(workspaces.length)} no total`} />
        <MetricCard label="Créditos de IA no mês" value={formatNumber(overview.totalCreditsUsedThisMonth)} hint={`Cota mensal: ${formatQuota(billing.monthlyCreditsQuota)}`} />
      </StatsGrid>

      <nav aria-label="Seções do cliente" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "contract" || tab === "access" || tab === "history" ? <TenantContractPanel tenantId={tenantId} tab={tab} onChanged={() => mutate()} /> : null}

      {tab === "credits" ? (
        <div className="space-y-6">
          <StatsGrid>
            <MetricCard label="Créditos usados no mês" value={formatNumber(overview.totalCreditsUsedThisMonth)} hint={`Cota mensal: ${formatQuota(billing.monthlyCreditsQuota)}`} />
            <MetricCard label="Créditos extras" value={formatNumber(billing.creditsExtra)} hint="Somam à cota do plano" />
            <MetricCard label="Margem estimada de IA" value={formatUsd(overview.currentProfitUsd)} hint={`${formatUsd(currentUsage.customerPriceUsd)} receita · ${formatUsd(currentUsage.providerCostUsd)} custo`} />
          </StatsGrid>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Dar ou tirar créditos</div></CardHeader>
              <CardBody>
                <CreditsForm busy={busy} onSubmit={(delta, reason) => run(() => adjustTenantCredits(tenantId, delta, reason))} />
                <p className="mt-3 text-xs text-muted-foreground">Positivo dá créditos, negativo tira. Use ao liberar créditos depois de um pagamento manual (Pix, boleto etc.).</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Lucro sobre o custo da IA</div></CardHeader>
              <CardBody>
                <ProfitPercentForm current={billing.priceMultiplier} busy={busy} onSubmit={(multiplier) => run(() => setTenantMultiplier(tenantId, multiplier))} />
                <p className="mt-3 text-xs text-muted-foreground">Quanto cobramos em cima do custo real dos provedores de IA para este cliente. O padrão é 100% (o dobro do custo); para uma conta interna, use 0%.</p>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Movimentações de créditos (últimas 25)</div></CardHeader>
              <CardBody className="p-0">
                {recentCreditEntries.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-muted-foreground">Sem movimentações.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Motivo</TableHead><TableHead className="text-right">Créditos</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {recentCreditEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(entry.occurredAt)}</TableCell>
                          <TableCell className="text-xs">{entry.reason}</TableCell>
                          <TableCell className={`text-right font-semibold tabular-nums ${entry.deltaCredits >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{entry.deltaCredits >= 0 ? "+" : ""}{formatNumber(entry.deltaCredits)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Consumo dos últimos 6 meses</div></CardHeader>
              <CardBody className="p-0">
                {usageHistory.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-muted-foreground">Ainda sem histórico.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Período</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Receita</TableHead><TableHead className="text-right">Lucro</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {usageHistory.map((row) => (
                        <TableRow key={row.period}>
                          <TableCell>{row.period}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(row.inputTokens + row.outputTokens)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatUsd(row.customerPriceUsd)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatUsd(row.customerPriceUsd - row.providerCostUsd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "people" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Somente consulta. Quem acessa quais espaços é definido pelo próprio cliente em Configurações → Usuários.</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Usuários</div></CardHeader>
              <CardBody className="p-0">
                {members.length === 0 ? <div className="px-5 py-4 text-sm text-muted-foreground">Nenhum usuário.</div> : (
                  <ul className="divide-y divide-border">
                    {members.map((member) => (
                      <li key={member.userId} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{member.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[member.role] ?? member.role}{member.isAccountOwner ? " · principal" : ""}{member.status === "disabled" ? " · desativado" : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader><div className="text-base font-semibold text-foreground">Espaços de trabalho</div></CardHeader>
              <CardBody className="p-0">
                {workspaces.length === 0 ? <div className="px-5 py-4 text-sm text-muted-foreground">Nenhum espaço.</div> : (
                  <ul className="divide-y divide-border">
                    {workspaces.map((workspace) => (
                      <li key={workspace.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <span className="truncate">{workspace.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{WORKSPACE_STATUS_LABEL[workspace.status] ?? workspace.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type TenantTab = TenantContractTab | "credits" | "people";
const TABS: [TenantTab, string][] = [["contract", "Plano e cobrança"], ["access", "Acessos e limites"], ["credits", "Créditos de IA"], ["people", "Usuários e espaços"], ["history", "Histórico"]];
const STATUS_LABEL: Record<string, string> = { trial: "Em teste grátis", active: "Ativo", past_due: "Pagamento atrasado", cancelled: "Cancelado", expired: "Expirado", suspended: "Suspenso", trial_expired: "Teste grátis encerrado" };
const ROLE_LABEL: Record<string, string> = { owner: "Administrador", admin: "Gerente", editor: "Atendente", viewer: "Visualizador" };
const WORKSPACE_STATUS_LABEL: Record<string, string> = { active: "Ativo", inactive: "Inativo", archived: "Arquivado" };

function CreditsForm({ busy, onSubmit }: { busy: boolean; onSubmit: (delta: number, reason: string) => void }) {
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number.parseInt(delta, 10);
        if (!Number.isFinite(parsed) || parsed === 0) return;
        if (reason.trim().length < 3) return;
        onSubmit(parsed, reason.trim());
      }}
    >
      <div>
        <Label htmlFor="credits-delta">Créditos</Label>
        <Input
          id="credits-delta"
          type="number"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          placeholder="+ ou − tokens"
        />
      </div>
      <div>
        <Label htmlFor="credits-reason">Motivo</Label>
        <Input
          id="credits-reason"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ex.: Pix R$ 90,00 — plano PRO"
        />
      </div>
      <Button type="submit" disabled={busy}>
        Aplicar ajuste
      </Button>
    </form>
  );
}


function multiplierToPercent(multiplier: number): number {
  return Math.round((multiplier - 1) * 100 * 100) / 100;
}

function percentToMultiplier(percent: number): number {
  return 1 + percent / 100;
}

function formatProfitPercent(multiplier: number): string {
  return multiplierToPercent(multiplier).toString();
}

function ProfitPercentForm({
  current,
  busy,
  onSubmit,
}: {
  current: number;
  busy: boolean;
  onSubmit: (multiplier: number) => void;
}) {
  const [value, setValue] = useState<string>(multiplierToPercent(current).toString());
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedPercent = Number.parseFloat(value);
        if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 9900) return;
        onSubmit(percentToMultiplier(parsedPercent));
      }}
    >
      <div className="relative">
        <Input
          type="number"
          step="1"
          min="0"
          max="9900"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="pr-8"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
      </div>
      <Button type="submit" disabled={busy}>
        Aplicar percentual
      </Button>
    </form>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </Card>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

/** `monthlyCreditsQuota` do plano ENTERPRISE é `Number.MAX_SAFE_INTEGER` (ver `platform-plan-catalog.ts`)
 * — mostrar esse número cru confundiria mais do que ajudaria. */
function formatQuota(value: number): string {
  return value >= Number.MAX_SAFE_INTEGER ? "Ilimitada" : formatNumber(value);
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR");
}
