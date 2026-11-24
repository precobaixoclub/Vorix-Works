import Link from "next/link";
import { AudioLines, Check, Globe, MessageCircle, Sparkles } from "lucide-react";
import { PUBLIC_CONTACT, formatPublicPrice, type PublicProductCatalog } from "@/features/public-site/catalog";
import { MODULE_KEYS, MODULE_SHOWCASE, productHref, type ModuleKey } from "@/features/public-site/showcase";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";

const icons = { conversations: MessageCircle, marketing: Sparkles, site: Globe, meetings: AudioLines };
const builderHref = "/precos#monte";
type ShotProps = { asset: string; alt: string; sizes?: string; priority?: boolean };

const desktopSources = (asset: string) => [480, 960, 1440].map(width => `/marketing/comercial/${asset}-${width}.webp ${width}w`).join(", ");

export function ProductScreen({ asset, alt, sizes = "(max-width: 760px) 92vw, 640px", priority = false }: ShotProps) {
  const path = `/marketing/comercial/${asset}`;
  // The pre-encoded variants also support art direction in the hero's picture element.
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    className="vc-screen" src={`${path}-960.webp`}
    srcSet={desktopSources(asset)}
    sizes={sizes} width={1440} height={960}
    alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"}
  />;
}

export function CommercialHero() {
  return <section className="vc-hero">
    <div className="vc-wrap vc-hero-grid">
      <div className="vc-hero-copy">
        <h1>Sua empresa conectada, <span>do primeiro contato ao resultado.</span></h1>
        <p>Atendimento, vendas, marketing, sites e reuniões em uma única plataforma. Escolha as ferramentas de que precisa e amplie sua operação conforme ela cresce.</p>
        <div className="public-button-row">
          <Link className="public-button primary" href={builderHref}>Montar meu Vorix</Link>
          <a className="public-button secondary" href="#solucoes">Conhecer as ferramentas</a>
        </div>
      </div>
      <figure className="vc-hero-media">
        <div className="vc-hero-composition">
          <div className="vc-hero-main">
            <span>Início da Vorix</span>
            <picture>
              <source media="(max-width: 600px)" srcSet="/marketing/comercial/dashboard-mobile-390.webp 390w, /marketing/comercial/dashboard-mobile-780.webp 780w" sizes="48vw" />
              <ProductScreen asset="dashboard" alt="Início unificado da Vorix com atalhos e indicadores demonstrativos" sizes="(max-width: 1050px) 65vw, 600px" priority />
            </picture>
          </div>
          <div className="vc-hero-insets">
            <div><span>Conversas</span><ProductScreen asset="inbox" alt={MODULE_SHOWCASE.conversations.shots[0].alt} sizes="(max-width: 600px) 36vw, 210px" /></div>
            <div><span>Marketing</span><ProductScreen asset="create" alt={MODULE_SHOWCASE.marketing.shots[1].alt} sizes="(max-width: 600px) 36vw, 210px" /></div>
            <div><span>Meetings</span><ProductScreen asset="meeting-ai" alt={MODULE_SHOWCASE.meetings.shots[2].alt} sizes="(max-width: 600px) 36vw, 210px" /></div>
          </div>
        </div>
        <figcaption>Interfaces da Vorix com dados demonstrativos.</figcaption>
      </figure>
    </div>
  </section>;
}

export function CommercialModules() {
  return <section id="solucoes" className="vc-wrap vc-section">
    <header className="vc-section-head">
      <h2>Quatro ferramentas. A operação que você precisa.</h2>
      <p>Comece pelo que resolve o trabalho de hoje. Amplie na mesma conta quando sua equipe precisar.</p>
    </header>
    <div className="vc-module-list" id="produtos">
      {MODULE_KEYS.map((key) => {
        const tool = MODULE_SHOWCASE[key];
        const Icon = icons[key];
        const shot = key === "marketing" || key === "meetings" ? tool.shots[2] : tool.shots[0];
        return <article key={key} className="vc-module-row" data-module={key}>
          <div className="vc-module-copy">
            <span className="vc-module-name"><Icon size={20} aria-hidden="true" /> Vorix {tool.name}</span>
            <h3>{tool.title}</h3>
            <p>{tool.description}</p>
            <ul className="vc-benefits">{tool.benefits.map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
            <Link className="public-button secondary" href={productHref(key)}>Conhecer {tool.name}</Link>
          </div>
          <figure className="vc-panel"><ProductScreen asset={shot.asset} alt={shot.alt} /><figcaption>{shot.title}</figcaption></figure>
        </article>;
      })}
    </div>
  </section>;
}

export function CommercialFlow() {
  return <section id="como-funciona" className="vc-band">
    <div className="vc-wrap vc-section">
      <header className="vc-section-head"><h2>Quando a operação pede mais, as ferramentas trabalham juntas.</h2><p>Uma equipe pode manter a vitrine, atender quem chega pelo WhatsApp e registrar os próximos passos na mesma conta.</p></header>
      <div className="vc-flow">
        {([
          ["marketing", "Planeje a campanha", "Organize ideias, produza uma peça e revise a legenda."],
          ["site", "Apresente sua oferta", "Mostre o catálogo e ofereça o canal de contato adequado."],
          ["conversations", "Acompanhe a negociação", "Organize a conversa, o responsável e a proposta comercial."],
          ["meetings", "Registre o que foi decidido", "Consulte o resumo e atribua os próximos passos da equipe."],
        ] as const).map(([key, title, description]) => {
          const Icon = icons[key];
          return <article key={key}><Icon size={23} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></article>;
        })}
      </div>
    </div>
  </section>;
}

export function CommercialIntelligence() {
  return <section id="recursos" className="vc-wrap vc-section vc-ai-grid">
    <div>
      <h2>IA para criar e acompanhar o trabalho.</h2>
      <p>No Marketing, a equipe parte de um briefing e das referências da marca para criar e revisar peças. No Meetings, a transcrição ajuda a encontrar decisões, responsáveis e próximos passos.</p>
      <div className="vc-ai-links"><Link href="/produtos/marketing">Criação com IA</Link><Link href="/produtos/meetings">Análise de reuniões</Link></div>
    </div>
    <figure className="vc-panel"><ProductScreen asset="meeting-ai" alt={MODULE_SHOWCASE.meetings.shots[2].alt} /><figcaption>Resumo e assuntos de uma reunião demonstrativa.</figcaption></figure>
  </section>;
}

export function CommercialTeamBenefits() {
  return <section className="vc-wrap vc-section">
    <header className="vc-section-head"><h2>A equipe cresce na mesma conta.</h2></header>
    <div className="vc-team">
      <article><h3>Divida as responsabilidades</h3><p>Organize quem atende, cria, revisa e administra pelo acesso de cada colaborador.</p></article>
      <article><h3>Ajuste a capacidade</h3><p>Consulte usuários, conexões e gravações contratadas antes de ampliar o plano.</p></article>
      <article><h3>Acompanhe o trabalho</h3><p>Veja a fila de atendimento, o funil, as peças em revisão e as decisões por reunião.</p></article>
    </div>
  </section>;
}

export function publicModuleTerms(key: ModuleKey, catalog: PublicProductCatalog): { price: string; note: string; cta: string } {
  const product = catalog.products.find(item => item.key === key);
  const published = product && !product.provisional && product.monthlyPrice !== null
    && Number.isFinite(product.monthlyPrice) && product.monthlyPrice > 0;
  if (key === "conversations" && published) {
    return { price: `A partir de ${formatPublicPrice(product)}/mês`, note: "Usuários, WhatsApps e créditos variam conforme o plano.", cta: builderHref };
  }
  if (key === "meetings" && published) {
    return { price: `Gravações a partir de ${formatPublicPrice(product)}/mês`, note: "Capacidade de gravação adicional ao plano da conta.", cta: "/precos?modulo=meetings#monte" };
  }
  return { price: "Sob consulta", note: key === "site" ? "Acesso conforme a oferta da conta." : key === "marketing" ? "Condições de acesso com o time comercial." : "Confirme as condições com o time comercial.", cta: PUBLIC_CONTACT };
}

export function CommercialPricing({ catalog }: { catalog: PublicProductCatalog }) {
  return <section id="planos" className="vc-band">
    <div className="vc-wrap vc-section">
      <header className="vc-section-head"><h2>Entenda o investimento antes de começar.</h2><p>Compare os valores do catálogo e ajuste a capacidade ao tamanho da sua equipe.</p></header>
      <div className="vc-offers">
        {MODULE_KEYS.map(key => {
          const offer = publicModuleTerms(key, catalog);
          return <article key={key}>
            <h3>{MODULE_SHOWCASE[key].name}</h3>
            <strong>{offer.price}</strong>
            <p>{offer.note}</p>
          </article>;
        })}
      </div>
      <Link className="public-button primary" href={builderHref}>Montar meu Vorix</Link>
    </div>
  </section>;
}

export function CommercialFAQ({ entries }: { entries: readonly (readonly [string, string])[] }) {
  return <section id="faq" className="vc-wrap vc-section vc-faq">
    <header className="vc-section-head"><h2>Perguntas frequentes</h2></header>
    <div>{entries.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </section>;
}

export function CommercialFinalCTA({ href = builderHref, label = "Montar meu Vorix" }: { href?: string; label?: string }) {
  return <section className="vc-wrap vc-section">
    <div className="vc-final"><h2>Comece com as ferramentas de que precisa hoje.</h2><Link className="public-button primary" href={href}>{label}</Link></div>
  </section>;
}

export function CommercialProduct({ moduleKey, catalog }: { moduleKey: ModuleKey; catalog: PublicProductCatalog }) {
  const tool = MODULE_SHOWCASE[moduleKey];
  const offer = publicModuleTerms(moduleKey, catalog);
  const hero = moduleKey === "meetings" || moduleKey === "marketing" ? tool.shots[2] : tool.shots[0];
  const cta = offer.cta.startsWith("mailto:") ? "Falar com o time comercial" : "Configurar este módulo";
  const Icon = icons[moduleKey];
  const billing = catalog.billing?.priceSource === "plan_versions" ? catalog.billing : null;
  const meetings = billing?.meetingsOffer;
  const additions = moduleKey === "conversations" ? (billing?.addons ?? [])
    .map(addon => `${addon.name} · ${formatPublicPrice({ currency: addon.currency, monthlyPrice: addon.monthlyPriceUsd })}/mês`)
    : moduleKey === "meetings" && meetings && Number.isFinite(meetings.additionalRecordingMonthlyPrice) && meetings.additionalRecordingMonthlyPrice > 0
      ? [`${meetings.includedConcurrentRecordings} simultânea no preço-base`, `Simultânea adicional · ${formatPublicPrice({ currency: meetings.currency, monthlyPrice: meetings.additionalRecordingMonthlyPrice })}/mês`]
      : [];
  return <div className="public-site vorix-commercial">
    <PublicHeader startHref={builderHref} appearance="home" />
    <main id="conteudo">
      <section className="vc-hero">
        <div className="vc-wrap vc-product-hero">
          <div className="vc-hero-copy">
            <span className="vc-module-name"><Icon size={21} aria-hidden="true" /> Vorix {tool.name}</span>
            <h1>{tool.title}</h1><p>{tool.description}</p>
            <div className="public-button-row"><Link className="public-button primary" href={offer.cta}>{cta}</Link><a className="public-button secondary" href="#recursos-produto">Ver funcionalidades</a></div>
            <p className="vc-availability">{offer.price} · {offer.note}</p>
          </div>
          <figure className="vc-panel"><ProductScreen asset={hero.asset} alt={hero.alt} priority /><figcaption>Interface da Vorix com dados demonstrativos.</figcaption></figure>
        </div>
      </section>
      <section id="recursos-produto" className="vc-wrap vc-section">
        <header className="vc-section-head"><h2>Veja Vorix {tool.name} em ação.</h2><p>{tool.availability}</p></header>
        <div className="vc-gallery">{tool.shots.map(shot => <article key={shot.asset}><ProductScreen asset={shot.asset} alt={shot.alt} sizes="(max-width: 760px) 92vw, (max-width: 1100px) 44vw, 590px" /><div><h3>{shot.title}</h3><p>{shot.description}</p></div></article>)}</div>
      </section>
      <section className="vc-band"><div className="vc-wrap vc-section vc-product-capacity">
        <div><h2>Recursos para sua equipe</h2><ul className="vc-benefits">{tool.benefits.map(item => <li key={item}><Check size={17} aria-hidden="true" />{item}</li>)}</ul></div>
        <div>
          <h2>Preço e capacidade</h2><strong>{offer.price}</strong><p>{tool.capacity}</p>
          {additions.length > 0 && <ul className="vc-product-additions">{additions.map(text => <li key={text}>{text}</li>)}</ul>}
          <Link className="public-button secondary" href={offer.cta}>{cta}</Link>
        </div>
      </div></section>
      <CommercialFAQ entries={tool.faq} />
      <CommercialFinalCTA href={offer.cta} label={cta} />
    </main>
    <PublicFooter />
  </div>;
}
