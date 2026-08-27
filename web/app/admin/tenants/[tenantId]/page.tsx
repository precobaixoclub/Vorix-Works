"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  activateTenant,
  adjustTenantCredits,
  changeTenantPlan,
  setTenantMultiplier,
  suspendTenant,
} from "@/features/platform-admin/api";
import { useTenantDetail } from "@/features/platform-admin/hooks";
import { PLATFORM_PLAN_CODES, type PlatformPlanCode } from "@/features/platform-admin/types";

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
  const [confirmSuspendOpen, setConfirmSuspendOpen] = useState(false);

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

  async function confirmSuspend() {
    await run(() => suspendTenant(tenantId));
    setConfirmSuspendOpen(false);
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

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 text-sm">
        <Link href="/admin/tenants" className="text-primary hover:underline">
          ← Todas as contas
        </Link>
      </div>
      <PageHeader
        title={tenantId}
        description={`Plano ${planName} · status ${billing.subscriptionStatus} · ${formatProfitPercent(billing.priceMultiplier)}% de lucro sobre o custo`}
      />

      <ScreenGuide
        title="Cuidados nesta conta"
        description="Aqui ficam ações manuais que afetam cobrança, limite e acesso do cliente."
        items={[
          "Ajuste créditos extras após pagamento confirmado.",
          "Troque plano quando houver upgrade ou downgrade.",
          "Suspenda apenas por bloqueio administrativo.",
          "Revise consumo antes de mudar multiplicador.",
        ]}
        aside={<p>Alterações feitas aqui valem para todos os espaços de trabalho deste cliente.</p>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricCard label="Créditos usados no mês" value={formatNumber(overview.totalCreditsUsedThisMonth)} hint={`Cota mensal: ${formatQuota(billing.monthlyCreditsQuota)}`} />
        <MetricCard label="Créditos extras" value={formatNumber(billing.creditsExtra)} hint="Somam à cota do plano" />
        <MetricCard
          label="Lucro do mês"
          value={formatUsd(overview.currentProfitUsd)}
          hint={`${formatUsd(currentUsage.customerPriceUsd)} receita · ${formatUsd(currentUsage.providerCostUsd)} custo`}
          highlight
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Ajustar créditos manualmente</div>
          </CardHeader>
          <CardBody>
            <CreditsForm
              busy={busy}
              onSubmit={(delta, reason) => run(() => adjustTenantCredits(tenantId, delta, reason))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Positivo credita, negativo debita. Use ao liberar tokens após um pagamento manual (Pix, boleto, etc.).
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Trocar plano</div>
          </CardHeader>
          <CardBody>
            <PlanForm
              currentPlan={billing.planCode}
              busy={busy}
              onSubmit={(nextPlanCode) => run(() => changeTenantPlan(tenantId, nextPlanCode))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Aplica as cotas do plano imediatamente; se estava suspenso, reativa a conta.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Status da conta</div>
          </CardHeader>
          <CardBody className="flex gap-2">
            {billing.subscriptionStatus === "suspended" ? (
              <Button variant="primary" disabled={busy} onClick={() => run(() => activateTenant(tenantId))}>
                Reativar conta
              </Button>
            ) : (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmSuspendOpen(true)}>
                Suspender conta
              </Button>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Percentual de lucro</div>
          </CardHeader>
          <CardBody>
            <ProfitPercentForm
              current={billing.priceMultiplier}
              busy={busy}
              onSubmit={(multiplier) => run(() => setTenantMultiplier(tenantId, multiplier))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Quanto cobramos de lucro em cima do custo real dos provedores para este cliente. Padrão da plataforma é 100%
              (cobramos o dobro do custo) — para uma conta interna própria, use 0% (fica só no custo, sem margem).
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Workspaces desta conta</div>
          </CardHeader>
          <CardBody className="p-0">
            {workspaces.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">Nenhum workspace.</div>
            ) : (
              <ul className="divide-y divide-border">
                {workspaces.map((ws) => (
                  <li key={ws.id} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span>{ws.name}</span>
                    <span className="text-xs text-muted-foreground">{ws.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Membros</div>
          </CardHeader>
          <CardBody className="p-0">
            {members.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">Nenhum membro.</div>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{m.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Histórico de créditos (últimos 50)</div>
          </CardHeader>
          <CardBody className="p-0">
            {recentCreditEntries.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">Sem movimentações.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Δ tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCreditEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(entry.occurredAt)}</TableCell>
                      <TableCell className="text-xs">{entry.reason}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${entry.deltaCredits >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                        {entry.deltaCredits >= 0 ? "+" : ""}
                        {formatNumber(entry.deltaCredits)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Consumo — últimos 6 meses</div>
          </CardHeader>
          <CardBody className="p-0">
            {usageHistory.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">Ainda sem histórico.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageHistory.map((row) => (
                    <TableRow key={row.period}>
                      <TableCell>{row.period}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(row.inputTokens + row.outputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(row.customerPriceUsd)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatUsd(row.customerPriceUsd - row.providerCostUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmSuspendOpen}
        title="Suspender conta?"
        description={`A conta "${tenantId}" ficará suspensa: o cliente perde acesso à plataforma até você reativá-la.`}
        confirmLabel="Suspender conta"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmSuspendOpen(false)}
        onConfirm={confirmSuspend}
      />
    </div>
  );
}

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

function PlanForm({
  currentPlan,
  busy,
  onSubmit,
}: {
  currentPlan: PlatformPlanCode;
  busy: boolean;
  onSubmit: (planCode: PlatformPlanCode) => void;
}) {
  const [planCode, setPlanCode] = useState<PlatformPlanCode>(currentPlan);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(planCode);
      }}
    >
      <Select value={planCode} onValueChange={(value) => setPlanCode(value as PlatformPlanCode)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {PLATFORM_PLAN_CODES.map((code) => (
            <SelectItem key={code} value={code}>{code}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={busy || planCode === currentPlan}>
        Aplicar plano
      </Button>
    </form>
  );
}

/** Armazenamos internamente como multiplicador (1.00–100.00, `TenantBilling.priceMultiplier`) —
 * o admin pensa em "% de lucro", não em "multiplicador", então a conversão fica só aqui na borda:
 * `percent = (multiplier - 1) * 100`, `multiplier = 1 + percent / 100`. 0% = multiplicador 1.00 =
 * cobra exatamente o custo, sem margem. */
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
