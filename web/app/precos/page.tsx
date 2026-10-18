import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PricingSection } from "@/components/public/PricingSection";
import { FAQSection, FinalCTA, SectionHeading } from "@/components/public/LandingSections";
import { TrackPageView } from "@/components/TrackPageView";
import { formatCapacityLine, formatCreditsQuota, formatPlanPrice, getPublicPlanTagline } from "@/features/platform-plans/api";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Preços Vorix — Escolha a solução para sua operação", "Compare Conversas, conheça Meetings e explore a proposta Vorix Suite. Valores e condições de Conversas integrados ao catálogo de contratação.", "/precos");

export default async function Page() {
  const catalog = await getPublicProductCatalog();
  const conversations = catalog.products.find(product => product.key === "conversations")!;
  const addons = catalog.billing?.addons ?? [];
  const meetings = catalog.products.find(product => product.key === "meetings")!;
  const offer = catalog.billing?.meetingsOffer ?? null;
  const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: offer?.currency ?? "BRL", minimumFractionDigits: 0 }).format(value);
  const recordingsLine = offer ? `1 incluída · +${brl(offer.additionalRecordingMonthlyPrice)}/mês cada adicional` : "Definidas no plano";
  const rows = [
    ["Atendimento, funil e propostas", "Incluído", "—", "Proposta integrada"],
    ["Agenda e inteligência de reuniões", "—", "Em validação", "Em validação"],
    ["Gravações simultâneas", "—", recordingsLine, recordingsLine],
    ["Usuários e números adicionais", addons.length ? addons.map(addon => addon.name + " " + new Intl.NumberFormat("pt-BR", { style: "currency", currency: addon.currency }).format(addon.monthlyPriceUsd) + "/mês").join(" · ") : "Conforme o catálogo", "—", "Conforme Conversas"],
    ["Minutos mensais de gravação", "—", "A definir na oferta", "A definir na oferta"],
    ["Retenção e armazenamento", "Conforme o plano", "A definir na oferta", "A definir na oferta"],
    ["Créditos de IA", "Conforme o plano", "A definir na oferta", "A definir na oferta"],
    ["Conta, empresa e workspace", "Core compartilhado", "Core compartilhado", "Core compartilhado"],
    ["Contratação", conversations.contractable ? "Direto pelo site" : "Em breve", meetings.contractable ? "Direto pelo site" : "Em breve", meetings.contractable && conversations.contractable ? "Direto pelo site" : "Em breve"],
  ];
  return <div className="public-site"><TrackPageView eventName="pricing_view" /><PublicHeader startHref={conversations.cta.href} /><main id="conteudo"><div className="public-container public-pricing-heading"><span className="public-eyebrow">Planos Vorix</span><h1>Comece simples.<br />Ajuste conforme cresce.</h1><p className="public-section-copy">Escolha um ponto de partida e ajuste a capacidade de cada produto. Conversas pode ser contratado hoje, direto pelo site.</p></div><PricingSection catalog={catalog} standalone />
    <section className="public-section"><div className="public-container"><SectionHeading eyebrow="Vorix Conversas" title="Planos para cada fase da sua operação" description="Escolha a capacidade ideal de equipe, conexões e créditos. Contrate direto pelo site: cadastre o cartão e a primeira cobrança só acontece depois do período de teste." />{catalog.plans.length ? <div className="public-plan-grid">{catalog.plans.map(plan => <article key={plan.code} className="public-plan-card"><h3>{plan.name}</h3><p className="public-section-copy">{getPublicPlanTagline(plan)}</p><strong>{formatPlanPrice(plan)}<small>/mês</small></strong><ul><li>{formatCapacityLine(plan)}</li><li>{formatCreditsQuota(plan.monthlyCreditsQuota)} por mês</li>{plan.trialDays ? <li>{plan.trialDays} dias de teste</li> : null}{plan.yearlyPriceUsd > 0 ? <li>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: plan.currency }).format(plan.yearlyPriceUsd)} por ano · total do ciclo</li> : null}</ul><Link className="public-button primary" href={conversations.contractable ? `/signup?plan=${encodeURIComponent(plan.code)}` : conversations.cta.href}>{conversations.contractable ? "Começar no " + plan.name : "Consultar condições"}<ArrowUpRight size={15} /></Link></article>)}</div> : <p className="public-comparison-note">As condições oficiais não puderam ser carregadas. Fale com o time para confirmar valores antes de contratar.</p>}</div></section>
    
    <section className="public-section"><div className="public-container"><SectionHeading eyebrow="Uma plataforma, produtos independentes" title="Compare o papel de cada solução" /><div className="public-comparison" tabIndex={0} aria-label="Comparação das soluções; role horizontalmente para ver todas as colunas"><table><caption className="public-visually-hidden">Comparação de soluções e limites comerciais</caption><thead><tr><th scope="col">Recursos e capacidade</th><th scope="col">Conversas</th><th scope="col">Meetings</th><th scope="col">Suite</th></tr></thead><tbody>{rows.map(([label, ...values]) => <tr key={label}><th scope="row">{label}</th>{values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div><p className="public-comparison-note">A Suite combina Conversas + Meetings na mesma conta e empresa. O valor é a soma das partes, sem pacote fechado. No Meetings, a capacidade também depende de contas de gravação saudáveis e disponíveis.</p></div></section><FAQSection /><FinalCTA startHref={conversations.cta.href} /></main><PublicFooter /></div>;
}
