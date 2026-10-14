import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PricingSection } from "@/components/public/PricingSection";
import { FAQSection, FinalCTA, SectionHeading } from "@/components/public/LandingSections";
import { TrackPageView } from "@/components/TrackPageView";
import { CapacitySimulator } from "@/components/public/CapacitySimulator";
import { formatCapacityLine, formatCreditsQuota, formatPlanPrice, getPublicPlanTagline } from "@/features/platform-plans/api";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
export const revalidate = 300;
export const metadata = publicMetadata("Preços Vorix — Escolha a solução para sua operação", "Compare Conversas, conheça Meetings e explore a proposta Vorix Suite. Valores e condições de Conversas integrados ao catálogo de contratação.", "/precos");

export default async function Page() {
  const catalog = await getPublicProductCatalog();
  const conversations = catalog.products.find(product => product.key === "conversations")!;
  const addons = catalog.billing?.addons ?? [];
  const rows = [
    ["Atendimento, funil e propostas", "Incluído", "—", "Proposta integrada"],
    ["Agenda e inteligência de reuniões", "—", "Em validação", "Em validação"],
    ["Gravações simultâneas", "—", "A definir na oferta", "A definir na oferta"],
    ["Minutos mensais de gravação", "—", "A definir na oferta", "A definir na oferta"],
    ["Retenção e armazenamento", "Conforme o plano", "A definir na oferta", "A definir na oferta"],
    ["Créditos de IA", "Conforme o plano", "A definir na oferta", "A definir na oferta"],
    ["Conta, empresa e workspace", "Core compartilhado", "Core compartilhado", "Core compartilhado"],
    ["Contratação", conversations.contractable ? "Disponível" : "Consultar o time", "Ainda indisponível", "Ainda indisponível"],
  ];
  return <div className="public-site"><TrackPageView eventName="pricing_view" /><PublicHeader startHref={conversations.cta.href} /><main id="conteudo"><div className="public-container public-pricing-heading"><span className="public-eyebrow">Cada operação tem seu próximo passo</span><h1>O produto certo.<br />No ritmo da sua empresa.</h1><p className="public-section-copy">Compare as soluções, comece com Conversas e conheça a proposta de Meetings e Suite.</p></div><PricingSection products={catalog.products} standalone />
    <section className="public-section"><div className="public-container"><SectionHeading eyebrow="Vorix Conversas" title="Planos para cada fase da sua operação" description="Escolha a capacidade ideal de equipe, conexões e créditos. A cobrança começa após sua confirmação dentro do produto." />{catalog.plans.length ? <div className="public-plan-grid">{catalog.plans.map(plan => <article key={plan.code} className="public-plan-card"><h3>{plan.name}</h3><p className="public-section-copy">{getPublicPlanTagline(plan)}</p><strong>{formatPlanPrice(plan)}<small>/mês</small></strong><ul><li>{formatCapacityLine(plan)}</li><li>{formatCreditsQuota(plan.monthlyCreditsQuota)} por mês</li>{plan.trialDays ? <li>{plan.trialDays} dias de teste sem cartão</li> : null}{plan.yearlyPriceUsd > 0 ? <li>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: plan.currency }).format(plan.yearlyPriceUsd)} por ano · total do ciclo</li> : null}</ul><Link className="public-button primary" href={conversations.contractable ? `/signup?plan=${encodeURIComponent(plan.code)}` : conversations.cta.href}>{conversations.contractable ? "Começar no " + plan.name : "Consultar condições"}<ArrowUpRight size={15} /></Link></article>)}</div> : <p className="public-comparison-note">As condições oficiais não puderam ser carregadas. Fale com o time para confirmar valores antes de contratar.</p>}</div></section>
    {addons.length ? <section className="public-section public-how"><div className="public-container"><SectionHeading eyebrow="Capacidade sob medida" title="Ajuste equipe e canais à sua operação" description="Simule a estrutura ideal para seu time. Você pode ajustar a capacidade dentro do produto." /><div className="public-capacity"><CapacitySimulator /></div><ul className="public-reference-list">{addons.map(addon => <li key={addon.code}>{addon.name}: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: addon.currency }).format(addon.monthlyPriceUsd)}/mês</li>)}</ul></div></section> : null}
    <section className="public-section"><div className="public-container"><SectionHeading eyebrow="Uma plataforma, produtos independentes" title="Compare o papel de cada solução" /><div className="public-comparison" tabIndex={0} aria-label="Comparação das soluções; role horizontalmente para ver todas as colunas"><table><caption className="public-visually-hidden">Comparação de soluções e limites comerciais</caption><thead><tr><th scope="col">Recursos e capacidade</th><th scope="col">Conversas</th><th scope="col">Meetings</th><th scope="col">Suite</th></tr></thead><tbody>{rows.map(([label, ...values]) => <tr key={label}><th scope="row">{label}</th>{values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div><p className="public-comparison-note">A Suite combina Conversas + Meetings na mesma conta e empresa. Sua contratação aguarda a liberação de Meetings e da oferta do conjunto. Limites de Meetings serão divulgados com a oferta comercial; a capacidade também depende de contas de gravação saudáveis e disponíveis.</p></div></section><FAQSection /><FinalCTA startHref={conversations.cta.href} /></main><PublicFooter /></div>;
}
