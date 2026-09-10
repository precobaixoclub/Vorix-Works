import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanSelectLink } from "@/components/PlanSelectLink";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";
import { fetchPublicPlans, formatCreditsQuota, type PublicPlan } from "@/features/platform-plans/api";

export const revalidate = 300;

export default async function PricingPage() {
  let plans: readonly PublicPlan[] = [];
  let loadError: string | undefined;
  try {
    plans = await fetchPublicPlans();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Não foi possível carregar os planos.";
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TrackPageView eventName="pricing_view" />
      <PublicHeader />

      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Planos reais</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Escolha pelo volume que sua operação usa hoje.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-muted-foreground">A API pública informa preço mensal, créditos, publicações e principais limites. Sem anual decorativo enquanto o catálogo não entregar ciclo anual.</p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-2 xl:grid-cols-4">
        {loadError ? (
          <div className="col-span-full rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive">{loadError}</div>
        ) : plans.map((plan) => <PlanCard key={plan.code} plan={plan} />)}
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comparação simples</p>
          <h2 className="mt-2 text-2xl font-semibold">Os limites importantes, sem tabela infinita.</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">Compare créditos, publicações e recursos principais. Billing detalhado, add-ons e downgrade seguro ficam dentro do Vorix, em Plano e cobrança.</p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const isFree = plan.monthlyPriceUsd === 0;
  return (
    <div className={`flex flex-col rounded-xl border p-6 ${plan.highlighted ? "border-primary bg-primary/10 shadow-lg" : "border-border bg-card"}`}>
      {plan.highlighted ? <span className="mb-3 w-fit rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">Mais escolhido</span> : null}
      <h2 className="text-lg font-semibold">{plan.name}</h2>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{isFree ? "Grátis" : `US$ ${plan.monthlyPriceUsd}`}{!isFree ? <span className="text-sm font-normal text-muted-foreground">/mês</span> : null}</p>
      <p className="mt-1 text-sm text-muted-foreground">{formatCreditsQuota(plan.monthlyCreditsQuota)} · {plan.monthlyPublicationsQuota.toLocaleString("pt-BR")} publicações</p>
      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
        {plan.features.slice(0, 5).map((feature) => (
          <li key={feature} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{feature}</li>
        ))}
      </ul>
      <PlanSelectLink planCode={plan.code} className="mt-6" variant={plan.highlighted ? "primary" : "secondary"}>
        {isFree ? "Começar grátis" : `Selecionar ${plan.name}`}
      </PlanSelectLink>
    </div>
  );
}
