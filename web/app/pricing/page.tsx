import Link from "next/link";
import { fetchPublicPlans, formatPlanPrice, formatCreditsQuota, type PublicPlan } from "@/features/platform-plans/api";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

export const revalidate = 300;

/**
 * Página pública de pricing (Fase 2). SSR — busca `/v1/platform/plans` no server-side com
 * revalidate de 5 minutos (o catálogo muda em release, não em runtime). Sem autenticação, cada
 * card leva para `/signup` (plano começa em FREE — usuário pode fazer upgrade depois em
 * `/workspaces/settings/billing`, ainda a construir).
 */
export default async function PricingPage() {
  let plans: readonly PublicPlan[] = [];
  let loadError: string | undefined;
  try {
    plans = await fetchPublicPlans();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Não foi possível carregar os planos.";
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo className="h-12 w-auto text-ink" />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="secondary">Entrar</Button>
          </Link>
          <Link href="/signup">
            <Button>Criar conta grátis</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-6 pb-6 pt-12 text-center">
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">Planos e preços</span>
        <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Escolha o plano que combina com seu volume.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-muted sm:text-lg">
          Comece grátis com 100 mil tokens de IA e evolua quando precisar de mais volume, publicações ou workspaces.
        </p>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-6 pb-12 md:grid-cols-2 lg:grid-cols-4">
        {loadError ? (
          <div className="col-span-full rounded-xl border border-red-300 bg-red-50 p-6 text-center text-sm text-red-700">
            {loadError}
          </div>
        ) : (
          plans.map((plan) => <PlanCard key={plan.code} plan={plan} />)
        )}
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 pb-16 text-center">
        <div className="rounded-2xl border border-border bg-surface-raised p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Volume corporativo</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Precisa de mais?</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Cotas negociadas, SLA contábil e jurídico, onboarding assistido e contrato empresarial.
          </p>
          <a href="mailto:comercial@vorixworks.com" className="mt-4 inline-block">
            <Button variant="secondary">Falar com o comercial</Button>
          </a>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} Vorix. Todos os direitos reservados.
      </footer>
    </main>
  );
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const isFree = plan.monthlyPriceUsd === 0;
  return (
    <div
      className={
        "flex flex-col rounded-xl border p-6 " +
        (plan.highlighted
          ? "border-accent bg-accent-soft/40 shadow-md"
          : "border-border bg-surface-raised")
      }
    >
      {plan.highlighted ? (
        <span className="mb-2 inline-block self-start rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Mais popular
        </span>
      ) : null}
      <div>
        <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
        <p className="mt-1 text-xs text-ink-muted">{plan.tagline}</p>
      </div>
      <div className="mt-4">
        <p className="text-3xl font-semibold text-ink">
          {formatPlanPrice(plan)}
          {!isFree ? <span className="ml-1 text-sm font-normal text-ink-muted">/mês</span> : null}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{formatCreditsQuota(plan.monthlyCreditsQuota)} · {plan.monthlyPublicationsQuota} publicações</p>
      </div>
      <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-ink">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-0.5 text-accent">✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link href="/signup" className="mt-6">
        <Button className="w-full" variant={plan.highlighted ? "primary" : "secondary"}>
          {isFree ? "Começar grátis" : `Começar com ${plan.name}`}
        </Button>
      </Link>
    </div>
  );
}
