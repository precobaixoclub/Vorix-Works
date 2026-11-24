import Link from "next/link";
import { PlanConfigurator } from "@/components/public/PlanConfigurator";
import { CommercialFAQ, CommercialFinalCTA } from "@/components/public/CommercialShowcase";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { TrackPageView } from "@/components/TrackPageView";
import { formatCapacityLine, formatCreditsQuota } from "@/features/platform-plans/api";
import { formatMoney } from "@/features/public-site/configurator";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "../pricing-commercial.css";
import "../commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Preços Vorix | Monte seu plano por módulos", "Compare Conversas, Marketing, Site e Meetings. Ajuste usuários, WhatsApps e gravações simultâneas e confira como contratar.", "/precos");

const questions = [
  ["O que acontece quando incluo mais usuários ou WhatsApps?", "O valor de Conversas considera apenas a quantidade acima da capacidade do plano escolhido. Compare o investimento e os créditos antes de trocar de plano."],
  ["O total do Meetings inclui a assinatura da conta?", "A capacidade de gravação é um adicional da conta. Conectar contas Google é uma etapa operacional e não aumenta o limite de reuniões simultâneas."],
  ["Posso contratar qualquer combinação pela internet?", "Quando o checkout aceita a combinação, o configurador leva os módulos e a capacidade para o cadastro. As demais combinações podem ser encaminhadas ao time comercial com as escolhas preenchidas."],
  ["Como alterar uma assinatura existente?", "Em Conta e assinatura, confira o uso, os adicionais e a cotação da alteração antes de confirmar, conforme as condições do contrato."],
] as const;

type Props = { searchParams: Promise<{ modulo?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  const [catalog, params] = await Promise.all([getPublicProductCatalog(), searchParams]);
  const initialModule = typeof params.modulo === "string" ? params.modulo : undefined;

  return <div className="public-site vorix-commercial">
    <TrackPageView eventName="pricing_view" />
    <PublicHeader startHref="#monte" appearance="home" />
    <main id="conteudo">
      <section className="vc-hero vc-price-hero">
        <div className="vc-wrap vc-hero-copy">
          <h1>Monte o Vorix ideal <span>para sua empresa.</span></h1>
          <p>Escolha as ferramentas, ajuste sua equipe e visualize o investimento em tempo real.</p>
        </div>
      </section>
      <section className="vc-wrap vc-config-section"><PlanConfigurator key={initialModule ?? "padrao"} catalog={catalog} initialModule={initialModule} /></section>
      <section className="vc-band"><div className="vc-wrap vc-section">
        <header className="vc-section-head"><h2>Compare os planos de Conversas</h2><p>Capacidade incluída, créditos por mês e valores oficiais por ciclo.</p></header>
        {catalog.plans.length ? <div className="vc-offers vc-plan-comparison">
          {catalog.plans.map(plan => <article key={plan.code}>
            <h3>{plan.name}</h3>
            <strong>{formatMoney(plan.monthlyPriceUsd, plan.currency)}/mês</strong>
            {plan.yearlyPriceUsd > 0 && <p>{formatMoney(plan.yearlyPriceUsd, plan.currency)}/ano · total do ciclo</p>}
            <p>{formatCapacityLine(plan)}</p><p>{formatCreditsQuota(plan.monthlyCreditsQuota)} por mês</p>
            {plan.trialDays ? <p>{plan.trialDays} dias de teste no cadastro elegível</p> : null}
          </article>)}
        </div> : <p>Confirme a disponibilidade dos planos com o time comercial.</p>}
        {catalog.billing?.priceSource === "plan_versions" && catalog.billing.addons.length > 0 && <p className="vc-plan-addons">{catalog.billing.addons.map(item => `${item.name} · ${formatMoney(item.monthlyPriceUsd, item.currency)}/mês`).join(" | ")}</p>}
      </div></section>
      <section id="suite" className="vc-wrap vc-section">
        <header className="vc-section-head"><h2>Combinações para operações diferentes</h2><p>Use as configurações como ponto de partida e revise a capacidade de cada módulo.</p></header>
        <div className="vc-flow vc-combinations">
          <article><h3>Atendimento e reuniões</h3><p>Conversas + Meetings para acompanhar clientes, reuniões e próximos passos.</p><Link className="public-button secondary" href="/precos?modulo=suite#monte">Simular esta combinação</Link></article>
          <article id="vorix-site"><h3>Operação com os quatro módulos</h3><p>Conversas, Marketing, Site e Meetings com condições confirmadas pelo comercial.</p><Link className="public-button secondary" href="/precos?modulo=completo#monte">Simular os quatro módulos</Link></article>
        </div>
      </section>
      <CommercialFAQ entries={questions} />
      <CommercialFinalCTA href="#monte" label="Voltar ao configurador" />
    </main>
    <PublicFooter />
  </div>;
}
