"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
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
 */
export default function AdminTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = decodeURIComponent(params.tenantId);
  const { data, error, isLoading, mutate } = useTenantDetail(tenantId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await mutate();
      setMessage({ kind: "ok", text: "Alteração aplicada." });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Falhou." });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-10 text-sm text-ink-muted sm:px-6 sm:py-14">
        <Spinner className="h-4 w-4" /> Carregando conta…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
        <EmptyState
          title="Não foi possível carregar essa conta"
          description={error instanceof Error ? error.message : "Verifique o tenantId ou tente novamente."}
        />
        <div className="mt-4">
          <Link href="/admin/tenants" className="text-sm text-accent hover:underline">
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
        <Link href="/admin/tenants" className="text-accent hover:underline">
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

      {message ? (
        <div
          className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

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
            <div className="text-base font-semibold text-ink">Ajustar créditos manualmente</div>
          </CardHeader>
          <CardBody>
            <CreditsForm
              busy={busy}
              onSubmit={(delta, reason) => run(() => adjustTenantCredits(tenantId, delta, reason))}
            />
            <p className="mt-3 text-xs text-ink-muted">
              Positivo credita, negativo debita. Use ao liberar tokens após um pagamento manual (Pix, boleto, etc.).
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Trocar plano</div>
          </CardHeader>
          <CardBody>
            <PlanForm
              currentPlan={billing.planCode}
              busy={busy}
              onSubmit={(planCode) => run(() => changeTenantPlan(tenantId, planCode))}
            />
            <p className="mt-3 text-xs text-ink-muted">
              Aplica as cotas do plano imediatamente; se estava suspenso, reativa a conta.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Status da conta</div>
          </CardHeader>
          <CardBody className="flex gap-2">
            {billing.subscriptionStatus === "suspended" ? (
              <Button variant="primary" disabled={busy} onClick={() => run(() => activateTenant(tenantId))}>
                Reativar conta
              </Button>
            ) : (
              <Button variant="danger" disabled={busy} onClick={() => run(() => suspendTenant(tenantId))}>
                Suspender conta
              </Button>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Percentual de lucro</div>
          </CardHeader>
          <CardBody>
            <ProfitPercentForm
              current={billing.priceMultiplier}
              busy={busy}
              onSubmit={(multiplier) => run(() => setTenantMultiplier(tenantId, multiplier))}
            />
            <p className="mt-3 text-xs text-ink-muted">
              Quanto cobramos de lucro em cima do custo real dos provedores para este cliente. Padrão da plataforma é 100%
              (cobramos o dobro do custo) — para uma conta interna própria, use 0% (fica só no custo, sem margem).
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Workspaces desta conta</div>
          </CardHeader>
          <CardBody className="p-0">
            {workspaces.length === 0 ? (
              <div className="px-5 py-4 text-sm text-ink-muted">Nenhum workspace.</div>
            ) : (
              <ul className="divide-y divide-border">
                {workspaces.map((ws) => (
                  <li key={ws.id} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span>{ws.name}</span>
                    <span className="text-xs text-ink-muted">{ws.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Membros</div>
          </CardHeader>
          <CardBody className="p-0">
            {members.length === 0 ? (
              <div className="px-5 py-4 text-sm text-ink-muted">Nenhum membro.</div>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-ink-muted">{m.email}</div>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-ink-muted">{m.role}</span>
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
            <div className="text-base font-semibold text-ink">Histórico de créditos (últimos 50)</div>
          </CardHeader>
          <CardBody className="p-0">
            {recentCreditEntries.length === 0 ? (
              <div className="px-5 py-4 text-sm text-ink-muted">Sem movimentações.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-5 py-2 font-medium">Quando</th>
                      <th className="px-5 py-2 font-medium">Motivo</th>
                      <th className="px-5 py-2 text-right font-medium">Δ tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCreditEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/60 last:border-b-0">
                        <td className="px-5 py-1.5 text-xs text-ink-muted">{formatDate(entry.occurredAt)}</td>
                        <td className="px-5 py-1.5 text-xs">{entry.reason}</td>
                        <td className={`px-5 py-1.5 text-right font-semibold ${entry.deltaCredits >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          {entry.deltaCredits >= 0 ? "+" : ""}
                          {formatNumber(entry.deltaCredits)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Consumo — últimos 6 meses</div>
          </CardHeader>
          <CardBody className="p-0">
            {usageHistory.length === 0 ? (
              <div className="px-5 py-4 text-sm text-ink-muted">Ainda sem histórico.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-5 py-2 font-medium">Período</th>
                      <th className="px-5 py-2 text-right font-medium">Tokens</th>
                      <th className="px-5 py-2 text-right font-medium">Receita</th>
                      <th className="px-5 py-2 text-right font-medium">Lucro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageHistory.map((row) => (
                      <tr key={row.period} className="border-b border-border/60 last:border-b-0">
                        <td className="px-5 py-1.5">{row.period}</td>
                        <td className="px-5 py-1.5 text-right text-ink-muted">{formatNumber(row.inputTokens + row.outputTokens)}</td>
                        <td className="px-5 py-1.5 text-right">{formatUsd(row.customerPriceUsd)}</td>
                        <td className="px-5 py-1.5 text-right font-semibold text-emerald-700">
                          {formatUsd(row.customerPriceUsd - row.providerCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CreditsForm({ busy, onSubmit }: { busy: boolean; onSubmit: (delta: number, reason: string) => void }) {
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number.parseInt(delta, 10);
        if (!Number.isFinite(parsed) || parsed === 0) return;
        if (reason.trim().length < 3) return;
        onSubmit(parsed, reason.trim());
      }}
    >
      <input
        type="number"
        value={delta}
        onChange={(event) => setDelta(event.target.value)}
        placeholder="+ ou − tokens"
        className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
      />
      <input
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Motivo (ex.: Pix R$ 90,00 — plano PRO)"
        className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
      />
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
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(planCode);
      }}
    >
      <select
        value={planCode}
        onChange={(event) => setPlanCode(event.target.value as PlatformPlanCode)}
        className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
      >
        {PLATFORM_PLAN_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
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
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedPercent = Number.parseFloat(value);
        if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 9900) return;
        onSubmit(percentToMultiplier(parsedPercent));
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="1"
          min="0"
          max="9900"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
        />
        <span className="text-sm text-ink-muted">%</span>
      </div>
      <Button type="submit" disabled={busy}>
        Aplicar percentual
      </Button>
    </form>
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
