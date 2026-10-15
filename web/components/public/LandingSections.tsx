import Link from "next/link";
import { ArrowRight, ArrowUpRight, BarChart3, CalendarDays, FileText, KeyRound, Layers3, ListChecks, MessageSquare, Mic, ShieldCheck, SlidersHorizontal, Sparkles, Video, Workflow } from "lucide-react";
import { ProductPreview, ProductShowcase } from "./ProductShowcase";
import { PUBLIC_CONTACT, PUBLIC_FAQ, formatPublicPrice, type PublicProduct } from "@/features/public-site/catalog";

const startLabel = (href: string) => (href.startsWith("mailto:") ? "Falar com o time" : "Começar com Conversas");

/** Primeira dobra: Vorix = plataforma; Conversas + Meetings visíveis de imediato. */
export function Hero({ startHref }: { startHref: string }) {
  return <section className="public-hero"><div className="public-hero-grid" aria-hidden="true" /><div className="public-container public-hero-content">
    <div className="public-hero-copy">
      <span className="public-eyebrow-pill"><i /> Plataforma Vorix</span>
      <h1>Do primeiro contato <span className="public-nowrap">à decisão,</span> <span className="public-gradient-text public-h1-accent">tudo com contexto.</span></h1>
      <p>Atendimento, vendas e reuniões na mesma plataforma. Use uma solução ou as duas, na mesma conta.</p>
      <div className="public-hero-products" aria-label="Soluções Vorix">
        <Link href="#conversas" className="public-hero-product conversations"><MessageSquare size={17} aria-hidden="true" /><span><strong>Vorix Conversas</strong><small>Atendimento e vendas</small></span></Link>
        <Link href="#meetings" className="public-hero-product meetings"><Video size={17} aria-hidden="true" /><span><strong>Vorix Meetings</strong><small>Reuniões inteligentes</small></span></Link>
      </div>
      <div className="public-button-row"><Link href={startHref} className="public-button primary">{startLabel(startHref)} <ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="#monte" className="public-button secondary">Monte seu Vorix <ArrowRight size={17} aria-hidden="true" /></Link></div>
    </div>
    <ProductShowcase />
  </div></section>;
}

/** O problema que a plataforma resolve — sem números inventados. */
export function ProblemSection() {
  const fragments = [
    { Icon: MessageSquare, text: "Conversas espalhadas em celulares e números diferentes" },
    { Icon: Mic, text: "Reuniões importantes sem registro do que foi decidido" },
    { Icon: ListChecks, text: "Próximos passos anotados em lugares que ninguém revisa" },
  ];
  return <section className="public-section public-problem"><div className="public-container public-problem-layout">
    <div><span className="public-eyebrow">O desafio</span><h2>O contexto da operação se perde no caminho.</h2><p className="public-section-copy">Cliente, conversa, reunião e decisão ficam em lugares diferentes. A equipe gasta tempo reconstruindo o que já aconteceu.</p></div>
    <div className="public-problem-panel">
      <ul>{fragments.map(({ Icon, text }) => <li key={text}><Icon size={17} aria-hidden="true" /><span>{text}</span></li>)}</ul>
      <div className="public-problem-answer"><span className="public-problem-mark">V<span>.</span></span><p><strong>Com o Vorix,</strong> atendimento, reuniões e próximos passos ficam na mesma conta, com a mesma equipe.</p></div>
    </div>
  </div></section>;
}

/** Plataforma: o Core compartilhado + confiança baseada em capacidades reais. */
export function PlatformSection() {
  const items = [
    { Icon: ShieldCheck, title: "Isolamento por empresa", text: "Dados e integrações separados por empresa, sem mistura entre contas." },
    { Icon: KeyRound, title: "Controle de acesso", text: "Papéis e permissões definem quem vê, opera e administra cada área." },
    { Icon: SlidersHorizontal, title: "IA com consumo visível", text: "Recursos de IA usam créditos com controle por operação." },
    { Icon: Layers3, title: "Produtos independentes", text: "Contrate só o que precisa. Adicione outra solução na mesma conta." },
  ];
  return <section id="plataforma" className="public-section public-platform"><div className="public-container public-differentials-layout">
    <div><span className="public-eyebrow">Uma plataforma</span><h2>Um Core. Soluções que crescem com você<span className="public-brand-dot">.</span></h2><p className="public-section-copy">Conta, empresa, equipe e permissões ficam no Core. Cada solução usa essa base sem duplicar cadastro.</p>
      <div className="public-core-visual" aria-hidden="true"><div className="public-core-orbit" /><span className="public-core-center">V<span>.</span><small>VORIX CORE</small></span><span className="public-core-node conversations"><MessageSquare size={18} /> Conversas</span><span className="public-core-node meetings"><Video size={18} /> Meetings</span><span className="public-core-caption">CONTA · EMPRESA · EQUIPE · PERMISSÕES</span></div></div>
    <div className="public-differential-grid">{items.map(({ Icon, title, text }) => <article key={title}><Icon size={22} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div>
  </div></section>;
}

type Capability = { Icon: typeof MessageSquare; title: string; text: string };

/** Produtos em blocos alternados: problema → resultado → produto → 4 capacidades → CTA. */
export function ProductsSection({ products }: { products: readonly PublicProduct[] }) {
  const conversations = products.find(product => product.key === "conversations")!;
  const meetings = products.find(product => product.key === "meetings")!;
  return <section id="produtos" className="public-section public-products"><div className="public-container public-product-stack">
    <ProductBlock product={conversations} id="conversas" title="Atendimento que vira oportunidade." problem="Mensagens chegam por vários números e o histórico fica com quem atendeu."
      result="Toda conversa entra numa fila da equipe, com contato, oportunidade e proposta ao lado."
      capabilities={[
        { Icon: MessageSquare, title: "WhatsApp da equipe", text: "Números conectados em uma fila compartilhada." },
        { Icon: Workflow, title: "Funil e oportunidades", text: "Cada negociação com etapa e próximo passo." },
        { Icon: FileText, title: "Propostas comerciais", text: "Montadas e acompanhadas a partir da conversa." },
        { Icon: BarChart3, title: "Automações e relatórios", text: "Menos trabalho repetido, mais visão da operação." },
      ]} />
    <ProductBlock product={meetings} id="meetings" reverse title="Reuniões que viram próximos passos." problem="Depois da chamada, decisões e responsáveis dependem da memória de cada um."
      result="A reunião é gravada, transcrita e resumida, com decisões e tarefas para revisar."
      capabilities={[
        { Icon: CalendarDays, title: "Agenda com Google Calendar", text: "Reuniões da agenda prontas para gravar." },
        { Icon: Mic, title: "Gravação e transcrição", text: "O que foi dito, pesquisável depois." },
        { Icon: Sparkles, title: "Resumo, decisões e tarefas", text: "Sugeridos pela IA, confirmados pela equipe." },
        { Icon: Video, title: "Gravações simultâneas", text: "Capacidade definida pelo plano contratado." },
      ]} />
  </div></section>;
}

function ProductBlock({ product, id, title, problem, result, capabilities, reverse = false }: { product: PublicProduct; id: string; title: string; problem: string; result: string; capabilities: Capability[]; reverse?: boolean }) {
  const meetings = product.key === "meetings";
  const available = product.contractable;
  return <article id={id} className={"public-product-block " + (meetings ? "meetings" : "conversations") + (reverse ? " reverse" : "")}>
    <div className="public-product-copy">
      <span className="public-product-label"><span className="public-icon small">{meetings ? <Video size={17} aria-hidden="true" /> : <MessageSquare size={17} aria-hidden="true" />}</span>{product.name}</span>
      <h2>{title}</h2>
      <p className="public-product-problem">{problem}</p>
      <p className="public-product-result">{result}</p>
      <ul className="public-capabilities">{capabilities.map(({ Icon, title: name, text }) => <li key={name}><Icon size={17} aria-hidden="true" /><span><strong>{name}</strong><small>{text}</small></span></li>)}</ul>
      <div className="public-product-cta">
        <Link href={product.productHref} className="public-button secondary">{meetings ? "Conhecer o Meetings" : "Explorar Conversas"} <ArrowUpRight size={16} aria-hidden="true" /></Link>
        <span className="public-product-price">{product.monthlyPrice !== null ? <>{product.provisional ? "Referência" : "A partir de"} <strong>{formatPublicPrice(product)}</strong>/mês</> : "Condições sob consulta"}{!available && meetings ? <em>Em validação para liberação comercial</em> : null}</span>
      </div>
    </div>
    <div className="public-product-visual"><ProductPreview product={meetings ? "meetings" : "conversations"} /><p className="public-preview-caption">Prévia ilustrativa com dados de exemplo</p></div>
  </article>;
}

/** Como os produtos se complementam — só o que existe hoje (mesma conta, equipe e permissões). */
export function ComplementSection() {
  const stages = [
    { tone: "conversations", label: "Antes da reunião", product: "Vorix Conversas", Icon: MessageSquare, text: "O relacionamento acontece na fila da equipe: contato, histórico, oportunidade e proposta." },
    { tone: "meetings", label: "Durante e depois", product: "Vorix Meetings", Icon: Video, text: "A reunião é gravada e transcrita. O resumo traz decisões e tarefas para a equipe confirmar." },
    { tone: "core", label: "No dia a dia", product: "Mesma conta Vorix", Icon: Layers3, text: "Quem atende e quem participa das reuniões trabalha na mesma empresa, equipe e permissões." },
  ] as const;
  return <section id="como-funciona" className="public-section public-complement"><div className="public-container">
    <SectionHeading eyebrow="Juntos" title="Uma operação, do primeiro contato à próxima ação." description="Cada solução funciona sozinha. Na mesma conta, elas cobrem a jornada inteira." />
    <ol className="public-journey">{stages.map(({ tone, label, product, Icon, text }, index) => <li key={label} className={tone}><span className="public-journey-step">0{index + 1}</span><span className="public-icon small"><Icon size={17} aria-hidden="true" /></span><small>{label}</small><h3>{product}</h3><p>{text}</p></li>)}</ol>
  </div></section>;
}

export function FAQSection() {
  return <section id="faq" className="public-section public-faq"><div className="public-container public-faq-grid"><div><span className="public-eyebrow">Perguntas frequentes</span><h2>Antes de começar.</h2><p className="public-section-copy">Como os produtos se conectam, o que pode ser contratado hoje e como a capacidade funciona.</p><Link href={PUBLIC_CONTACT} className="public-text-link">Falar com o time <ArrowUpRight size={16} aria-hidden="true" /></Link></div><div className="public-faq-list">{PUBLIC_FAQ.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></section>;
}

export function FinalCTA({ startHref = "/signup" }: { startHref?: string }) {
  return <section className="public-final-wrap"><div className="public-container"><div className="public-final-cta"><div className="public-final-landscape" aria-hidden="true"><div /><span>V<span>.</span></span></div><div className="public-final-copy"><span className="public-eyebrow">Seu próximo passo</span><h2>Comece com o que precisa hoje.</h2><p>Ajuste usuários, números e soluções conforme sua operação cresce.</p><div className="public-button-row"><Link href={startHref} className="public-button primary">{startLabel(startHref)} <ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="/#monte" className="public-button secondary">Monte seu Vorix <ArrowRight size={17} aria-hidden="true" /></Link></div><Link href="/produtos/meetings" className="public-text-link public-final-meetings">Conhecer o Vorix Meetings <ArrowUpRight size={15} aria-hidden="true" /></Link></div></div></div></section>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div className="public-section-heading"><span className="public-eyebrow">{eyebrow}</span><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>;
}

