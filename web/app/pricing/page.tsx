import { CheckCircle2 } from "lucide-react";
import { CapacitySimulator } from "@/components/public/CapacitySimulator";
import { PlanSelectLink } from "@/components/PlanSelectLink";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";
import { fetchPublicCatalog, formatCapacityLine, formatCreditsQuota, formatPlanPrice, type PublicCapacityAddon, type PublicPlan } from "@/features/platform-plans/api";

export const revalidate = 300;

export default async function PricingPage() {
  let plans: readonly PublicPlan[] = [];
  let addons: readonly PublicCapacityAddon[] = [];
  let loadError: string | undefined;
  try {
    const catalog = await fetchPublicCatalog();
    plans = catalog.plans;
    addons = catalog.addons;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Não foi possível carregar os planos.";
  }

  const userAddon = addons.find((addon) => addon.resource === "users");
  const numberAddon = addons.find((addon) => addon.resource === "messaging_connections");

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TrackPageView eventName="pricing_view" />
      <PublicHeader />

      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Planos</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Escolha pelo volume que sua operação usa hoje.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-muted-foreground">Todo plano inclui 7 dias de teste, sem cartão de crédito. Aumente ou reduza usuários e números conectados quando quiser, direto no Vorix.</p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-3">
        {loadError ? (
          <div className="col-span-full rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive">{loadError}</div>
        ) : plans.map((plan) => <PlanCard key={plan.code} plan={plan} />)}
      </section>

      {addons.length > 0 ? (
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <CapacitySimulator />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {userAddon ? <AddonCard addon={userAddon} description="Para times que crescem além da capacidade incluída." /> : null}
            {numberAddon ? <AddonCard addon={numberAddon} description="Para operar mais de um número de WhatsApp." /> : null}
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">Você pode aumentar ou reduzir sua capacidade a qualquer momento, dentro do Vorix.</p>
        </section>
      ) : null}

      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Como funciona o teste</p>
          <h2 className="mt-2 text-2xl font-semibold">7 dias para usar o Vorix de verdade, sem compromisso.</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Você escolhe um plano e começa a usar na hora, sem cadastrar cartão. Quando quiser continuar, ativa o
            plano dentro do Vorix — a cobrança só começa depois da sua confirmação. Cancele quando quiser.
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  return (
    <div className={`flex flex-col rounded-xl border p-6 ${plan.highlighted ? "border-primary bg-primary/10 shadow-lg" : "border-border bg-card"}`}>
      {plan.highlighted ? <span className="mb-3 w-fit rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">Recomendado</span> : null}
      <h2 className="text-lg font-semibold">{plan.name}</h2>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{formatPlanPrice(plan)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
      <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{formatCapacityLine(plan)}</li>
        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{formatCreditsQuota(plan.monthlyCreditsQuota)}</li>
      </ul>
      <PlanSelectLink planCode={plan.code} className="mt-6" variant={plan.highlighted ? "primary" : "secondary"}>
        Testar {plan.name} por 7 dias
      </PlanSelectLink>
    </div>
  );
}

function AddonCard({ addon, description }: { addon: PublicCapacityAddon; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-4">
      <p className="font-medium text-foreground">{addon.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-lg font-semibold">
        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: addon.currency }).format(addon.monthlyPriceUsd)}
        <span className="text-sm font-normal text-muted-foreground">/mês</span>
      </p>
    </div>
  );
}
