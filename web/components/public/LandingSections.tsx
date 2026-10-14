import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Layers3, MessageSquare, Plug, ShieldCheck, SlidersHorizontal, Sparkles, Users, Video } from "lucide-react";
import { ProductPreview, ProductShowcase } from "./ProductShowcase";
import { PUBLIC_CONTACT, PUBLIC_FAQ, type PublicProduct } from "@/features/public-site/catalog";

export function Hero({ startHref }: { startHref: string }) {
  return <section className="public-hero"><div className="public-hero-grid" aria-hidden="true" /><div className="public-container public-hero-content">
    <div className="public-hero-copy"><span className="public-eyebrow-pill"><i /> Plataforma multi-solução</span><h1>Uma plataforma.<br /><span className="public-gradient-text">Duas soluções</span><br />para acelerar<br className="public-desktop-break" /> sua operação.</h1><p>O Vorix conecta atendimento, vendas e reuniões inteligentes em uma experiência única, com produtos independentes e escaláveis para cada fase do seu negócio.</p><div className="public-button-row"><Link href={startHref} className="public-button primary">{startHref.startsWith("mailto:") ? "Falar com o time" : "Começar agora"} <ArrowUpRight size={18} /></Link><Link href="#produtos" className="public-button secondary">Conhecer os produtos <ArrowRight size={17} /></Link></div><div className="public-hero-footnote"><ShieldCheck size={15} /> Uma conta. Sua empresa. Tudo conectado.</div></div>
    <ProductShowcase />
    </div><div className="public-container public-platform-strip"><span><MessageSquare size={15} /> ATENDIMENTO E VENDAS</span><span><Video size={15} /> INTELIGÊNCIA DE REUNIÕES</span><span><Layers3 size={15} /> UM CORE COMPARTILHADO</span></div></section>;
}

export function ProductsSection({ products }: { products: readonly PublicProduct[] }) {
  return <section id="produtos" className="public-section"><div className="public-container"><SectionHeading eyebrow="Nossos produtos" title="Escolha a solução ideal para sua operação" description="Use cada produto de forma independente ou combine as soluções conforme sua necessidade." />
    <div className="public-product-grid">{products.filter(product => product.key !== "suite").map(product => <ProductCard key={product.key} product={product} />)}</div></div></section>;
}

function ProductCard({ product }: { product: PublicProduct }) {
  const meetings = product.key === "meetings";
  const Icon = meetings ? Video : MessageSquare;
  return <article className={"public-product-card " + (meetings ? "violet" : "green")}><div className="public-card-top"><span className={"public-icon " + (meetings ? "violet" : "green")}><Icon size={24} /></span><span className="public-small-label">{product.eyebrow}</span></div><h3>{product.name}</h3><p>{product.description}</p><div className="public-product-card-preview"><ProductPreview product={meetings ? "meetings" : "conversations"} compact /></div><ul className="public-product-features">{product.features.map(feature => <li key={feature}><Check size={14} aria-hidden="true" /> {feature}</li>)}</ul><div className="public-product-card-bottom"><Link href={product.productHref} className="public-text-link">{meetings && !product.contractable ? "Conhecer Meetings" : "Explorar " + (meetings ? "Meetings" : "Conversas")} <ArrowUpRight size={18} /></Link>{meetings && !product.contractable ? <span className="public-status-note">Em validação para liberação</span> : null}</div></article>;
}

export function HowItWorks() {
  const steps = [{ Icon: Layers3, title: "Escolha sua solução", text: "Use Conversas, Meetings ou combine os dois, conforme a disponibilidade comercial." }, { Icon: Plug, title: "Conecte sua operação", text: "Integre equipe, canais e agenda em uma experiência que faz sentido para o seu negócio." }, { Icon: Sparkles, title: "Ganhe produtividade com IA", text: "Automatize tarefas, extraia informações e reduza trabalho operacional." }];
  return <section id="solucoes" className="public-section public-how"><div className="public-container"><SectionHeading eyebrow="Como o Vorix funciona" title="Em três passos, sua operação mais produtiva" /><div className="public-steps">{steps.map(({ Icon, title, text }, index) => <article key={title}><div className="public-step-top"><span className="public-step-number">0{index + 1}</span><Icon size={25} aria-hidden="true" /></div><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>;
}

export function Differentials() {
  const items = [{ Icon: Layers3, title: "Produtos independentes", text: "Contrate apenas o que precisa e adicione outras soluções quando fizer sentido e estiverem disponíveis." }, { Icon: ShieldCheck, title: "Infraestrutura segura", text: "Dados, permissões e integrações com isolamento por empresa." }, { Icon: SlidersHorizontal, title: "IA com controle de uso", text: "Recursos de IA com consumo transparente e controle por operação." }, { Icon: Users, title: "Escalável por equipe", text: "Do atendimento às reuniões, o Vorix acompanha o crescimento da operação." }];
  return <section id="recursos" className="public-section public-differentials"><div className="public-container public-differentials-layout"><div><span className="public-eyebrow">Uma base. Mais possibilidades.</span><h2>Projetado para crescer com sua empresa<span className="public-brand-dot">.</span></h2><p className="public-section-copy">A inteligência conecta os produtos. O Core conecta toda a sua operação.</p><div className="public-core-visual" aria-hidden="true"><div className="public-core-orbit" /><span className="public-core-center">V<span>.</span><small>VORIX CORE</small></span><span className="public-core-node conversations"><MessageSquare size={18} /> Conversas</span><span className="public-core-node meetings"><Video size={18} /> Meetings</span><span className="public-core-caption">CONTA · EMPRESA · EQUIPE · WORKSPACE</span></div></div><div className="public-differential-grid">{items.map(({ Icon, title, text }) => <article key={title}><Icon size={23} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>;
}

export function FAQSection() {
  return <section id="faq" className="public-section public-faq"><div className="public-container public-faq-grid"><div><span className="public-eyebrow">Tudo mais claro</span><h2>Suas perguntas.<br />Nosso contexto.</h2><p className="public-section-copy">Entenda como os produtos se conectam e encontre o próximo passo para sua operação.</p><Link href={PUBLIC_CONTACT} className="public-text-link">Falar com o time <ArrowUpRight size={16} /></Link></div><div className="public-faq-list">{PUBLIC_FAQ.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></section>;
}

export function FinalCTA({ startHref = "/signup" }: { startHref?: string }) {
  return <section className="public-final-wrap"><div className="public-container"><div className="public-final-cta"><div className="public-final-landscape" aria-hidden="true"><div /><span>V<span>.</span></span></div><div className="public-final-copy"><span className="public-eyebrow">Seu próximo passo começa aqui</span><h2>Centralize sua operação no Vorix.</h2><p>Atendimento, vendas e reuniões inteligentes em uma única plataforma.</p><div className="public-button-row"><Link href={startHref} className="public-button primary">{startHref.startsWith("mailto:") ? "Consultar condições" : "Começar agora"} <ArrowUpRight size={18} /></Link><Link href={PUBLIC_CONTACT} className="public-button secondary">Falar com o time <ArrowUpRight size={17} /></Link></div></div></div></div></section>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div className="public-section-heading"><span className="public-eyebrow">{eyebrow}</span><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>;
}
