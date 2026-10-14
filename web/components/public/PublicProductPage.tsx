import Link from "next/link";
import { ArrowUpRight, Check, Layers3, MessageSquare, ShieldCheck, Sparkles, Video } from "lucide-react";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";
import { ProductShowcase } from "./ProductShowcase";
import { PricingCard } from "./PricingSection";
import { FinalCTA, SectionHeading } from "./LandingSections";
import { PUBLIC_CONTACT, type PublicProduct } from "@/features/public-site/catalog";

export function PublicProductPage({ product, startHref }: { product: PublicProduct; startHref: string }) {
  const meetings = product.key === "meetings";
  const benefits = meetings ? [
    { Icon: Video, title: "O contexto permanece", description: "Agenda, gravações e transcrições reunidas no contexto da reunião." },
    { Icon: Sparkles, title: "A conversa vira ação", description: "Resumos, decisões e tarefas extraídas para orientar os próximos passos." },
    { Icon: ShieldCheck, title: "Você mantém o controle", description: "Permissões por empresa e capacidade de gravação conforme o plano e as contas disponíveis." },
  ] : [
    { Icon: MessageSquare, title: "Toda conversa tem contexto", description: "Organize a fila, acompanhe contatos e mantenha o histórico perto de quem atende." },
    { Icon: Layers3, title: "Uma oportunidade de cada vez", description: "Conecte atendimento, funil e propostas para saber onde agir em cada negociação." },
    { Icon: Sparkles, title: "Menos trabalho operacional", description: "Automações, tarefas e relatórios ajudam a equipe a manter o ritmo da operação." },
  ];
  return <div className={"public-site " + (meetings ? "meetings" : "conversations")}><PublicHeader startHref={startHref} /><main id="conteudo">
    <section className="public-page-hero"><div className="public-container"><div><span className="public-eyebrow-pill">{product.name}</span><h1>{meetings ? "Reuniões que não terminam quando a chamada acaba." : "Atendimento que vira oportunidade."}</h1><p className="public-section-copy">{meetings ? "Conheça a solução Vorix que conecta agenda, gravação, transcrição e inteligência para transformar reuniões em próximos passos." : "Seu WhatsApp, contatos, oportunidades e propostas conectados em uma experiência clara para a equipe atender melhor e vender com contexto."}</p><div className="public-button-row"><Link href={meetings && !product.contractable ? PUBLIC_CONTACT : product.cta.href} className={"public-button " + (meetings ? "secondary" : "primary")}>{meetings && !product.contractable ? "Falar sobre Meetings" : product.cta.label}<ArrowUpRight size={18} /></Link><Link href="#recursos-produto" className="public-button secondary">Explorar recursos <ArrowUpRight size={16} /></Link></div>{!product.contractable ? <p className="public-release-notice"><ShieldCheck size={15} />{meetings ? "Meetings está em validação para liberação comercial. A integração Google e a gravação real ainda dependem de homologação; não há contratação disponível." : "Consulte nosso time para confirmar as condições comerciais disponíveis."}</p> : null}</div><ProductShowcase initialProduct={meetings ? "meetings" : "conversations"} selector={false} /></div></section>
    <section className="public-section"><div className="public-container public-product-benefits">{benefits.map(({ Icon, title, description }) => <article key={title}><Icon size={26} /><h3>{title}</h3><p>{description}</p></article>)}</div></section>
    <section id="recursos-produto" className="public-section public-how"><div className="public-container public-product-features-section"><div><span className="public-eyebrow">{meetings ? "Inteligência de reuniões" : "Atendimento & vendas"}</span><h2>{meetings ? "O que foi dito. O que importa. O que vem depois." : "Do primeiro contato ao próximo negócio."}</h2><p className="public-section-copy">{meetings ? "Uma solução independente, construída sobre o mesmo Core do Vorix. Recursos apresentados como visão do produto em homologação." : "Um fluxo conectado para conversas, oportunidades e propostas. Sem perder o histórico da relação com cada cliente."}</p></div><ul className="public-product-feature-list">{product.features.map(feature => <li key={feature}><Check size={16} />{feature}</li>)}</ul></div></section>
    <section className="public-section"><div className="public-container"><SectionHeading eyebrow={meetings ? "Conheça a proposta" : "Comece no seu ritmo"} title={meetings ? "Preparado para o próximo passo da sua operação." : "Uma solução completa. Um começo simples."} description={meetings ? "O valor abaixo é uma referência provisória. Contratação e limites comerciais serão confirmados na liberação." : "Escolha o plano ideal para sua equipe. Você confirma a contratação dentro do Vorix."} /><div className="public-single-pricing"><PricingCard product={product} /></div><Link href="/precos" className="public-text-link public-pricing-more">Conhecer todos os planos <ArrowUpRight size={16} /></Link></div></section><FinalCTA startHref={startHref} />
  </main><PublicFooter /></div>;
}
