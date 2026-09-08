"use client";

import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { useGrowthDashboard } from "@/features/growth/hooks";

/**
 * Growth Dashboard (`/admin/growth`) — Trial + Product Analytics, Fatia E. Painel MÍNIMO e
 * deliberadamente separado de `/admin` (que é lucro/margem de custo de IA, não funil/MRR de
 * verdade). Todo número aqui vem de dados reais (`subscriptions`/`product_events`) — o que o
 * modelo atual não permite calcular corretamente aparece em "O que ainda não dá pra medir",
 * nunca como um valor aproximado.
 */
export default function GrowthDashboardPage() {
  const { data, error, isLoading, mutate } = useGrowthDashboard();

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Growth Dashboard" description="Funil de aquisição, trial e receita recorrente — consolidado de todos os tenants." />

      <ScreenGuide
        title="Para que serve"
        description="Visão do dono da plataforma sobre a jornada Visitante → Cadastro → Trial → Onboarding → Ativação → Pago."
        items={[
          "Acompanhe onde o funil está perdendo gente.",
          "Veja quantos trials estão ativos, vencidos e quantos já converteram.",
          "MRR/ARR/ARPU são somados a partir das assinaturas reais, nunca estimados.",
        ]}
        aside={<p>Métricas que este painel ainda não consegue calcular com confiança aparecem listadas no final, em vez de um número inventado.</p>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? null : (
        <div className="flex flex-col gap-6">
          <StatsGrid>
            <MetricCard label="MRR" value={formatUsd(data.revenue.mrrUsd)} hint={`${data.revenue.payingCustomers} clientes pagantes`} highlight />
            <MetricCard label="ARR" value={formatUsd(data.revenue.arrUsd)} />
            <MetricCard label="ARPU" value={data.revenue.arpuUsd === null ? "—" : formatUsd(data.revenue.arpuUsd)} />
            <MetricCard
              label="Trial → Pago"
              value={data.trial.conversionRate === null ? "—" : formatPercent(data.trial.conversionRate)}
              hint={`${data.trial.active} ativos · ${data.trial.expired} vencidos · ${data.trial.converted} convertidos`}
            />
          </StatsGrid>

          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-foreground">Funil</div>
                <div className="text-xs text-muted-foreground">Visitante → Cadastro → Trial → Onboarding → Ativação → Pago.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 p-5">
              {data.funnel.map((stage, index) => {
                const previous = index > 0 ? data.funnel[index - 1].count : null;
                const rate = previous && previous > 0 ? stage.count / previous : null;
                return (
                  <div key={stage.stage} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                    <span className="text-sm text-foreground">{stage.stage}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-foreground">{formatNumber(stage.count)}</span>
                      {rate !== null ? <span className="text-xs tabular-nums text-muted-foreground">({formatPercent(rate)})</span> : null}
                    </span>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="text-base font-semibold text-foreground">Assinaturas por status</div>
              </CardHeader>
              <CardBody className="flex flex-col gap-2 p-5">
                {Object.entries(data.subscriptionsByStatus).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura ainda.</p>
                ) : (
                  Object.entries(data.subscriptionsByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{STATUS_LABELS[status] ?? status}</span>
                      <span className="font-medium tabular-nums text-foreground">{formatNumber(count ?? 0)}</span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div className="text-base font-semibold text-foreground">Movimentação de assinaturas</div>
              </CardHeader>
              <CardBody className="flex flex-col gap-2 p-5">
                <Row label="Upgrades" value={data.lifecycle.upgrades} />
                <Row label="Downgrades" value={data.lifecycle.downgrades} />
                <Row label="Cancelamentos" value={data.lifecycle.cancellations} />
                <Row label="Reativações" value={data.lifecycle.reactivations} />
                <Row label="Falhas de pagamento" value={data.lifecycle.paymentFailures} />
              </CardBody>
            </Card>
          </div>

          <Card className="border-amber-300/60 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5">
            <CardHeader>
              <div className="text-base font-semibold text-foreground">O que ainda não dá pra medir</div>
              <div className="text-xs text-muted-foreground">Documentado em vez de aproximado — nenhum número acima cobre isto.</div>
            </CardHeader>
            <CardBody className="p-5">
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {data.unavailableMetrics.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  trial: "Em teste",
  trial_expired: "Teste vencido",
  active: "Ativa (paga)",
  past_due: "Pagamento pendente",
  cancelled: "Cancelada",
  expired: "Expirada",
  suspended: "Suspensa",
};

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{formatNumber(value)}</span>
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
