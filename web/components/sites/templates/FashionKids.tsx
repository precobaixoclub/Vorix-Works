"use client";
import {Fragment, useRef, useState, type ReactNode} from "react";
import {ArrowDown, ArrowRight, ArrowUpRight, Menu, Search, ShoppingBag, X, Palette, Ruler, MessageCircle} from "lucide-react";
import type {PublicTenantSite, SiteBlock, PublicSiteProduct} from "@/features/sites/types";
import {resolvedHeader, safeSiteHref, siteHref} from "@/features/sites/customization";
import {isColorOption} from "@/features/sites/product-media";
import {formatCurrencyCents} from "@/lib/format";
import {thumbUrl} from "@/lib/media";
import {ProductCard, ProductCardTitle, ProductCardMedia} from "../ProductCard";
import {useEditingSlide} from "../SiteEditorContext";
import {SiteHeaderCart} from "../SiteHeaderActions";
import type {TemplateCardProps, TemplateHeaderProps, TemplateHeroProps} from "./PremiumTemplates";

function Brand({site}: {site: PublicTenantSite}) {
  return site.content.logoUrl ? <img src={site.content.logoUrl} alt={site.content.name} width={180} height={64}/> :
    <span className="fk-wordmark">{site.content.name.replace(/\s+kids$/i, "")}<small>kids</small><i aria-hidden="true"/></span>;
}

export function FashionKidsHeader({site, basePath, query, onQuery, onSearch, menuOpen, onMenu}: TemplateHeaderProps) {
  const header = resolvedHeader(site.content);
  const [searchOpen, setSearchOpen] = useState(false), searchInput = useRef<HTMLInputElement>(null), searchButton = useRef<HTMLButtonElement>(null);
  const catalogEnabled = site.content.blocks.some(b => b.enabled && b.type === "catalog");
  const contactEnabled = site.content.blocks.some(b => b.enabled && b.type === "contact");
  const configured = header.navigation.filter(link => link.enabled && safeSiteHref(link.url));
  const links: {id: string; label: string; url: string; newTab?: boolean}[] = [
    {id: "home", label: "Início", url: "/"},
    ...site.categories.slice(0, 3).map(category => ({id: category.id, label: category.name, url: `/categoria/${category.slug}`})),
    ...(catalogEnabled ? [{id: "collection", label: "Coleção", url: "#catalogo"}, {id: "selection", label: "Em destaque", url: "#em-destaque"}] : []),
    ...configured.filter(link => !["home", "catalog", "contact"].includes(link.id) && !["/", "#catalogo", "#contato"].includes(link.url)),
    ...(contactEnabled ? [{id: "contact", label: "Contato", url: "#contato"}] : []),
  ];
  const closeSearch = () => {setSearchOpen(false); searchButton.current?.focus();};
  return <>
    {header.announcement?.enabled && header.announcement.text ? <div className="ts-announcement">{safeSiteHref(header.announcement.url) ? <a href={siteHref(header.announcement.url, basePath)}>{header.announcement.text}</a> : header.announcement.text}</div> : null}
    <header className={`fk-header ${header.sticky ? "is-sticky" : ""}`}>
      <div className="ts-container fk-header-main">
        <button type="button" className="fk-icon fk-menu-toggle" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="fk-mobile-menu" onClick={onMenu}>{menuOpen ? <X/> : <Menu/>}</button>
        <span className="fk-header-note">Pequenos momentos.<br/>Grandes descobertas.</span>
        <a href={basePath || "/"} className="fk-brand" aria-label={`${site.content.name} — início`}><Brand site={site}/></a>
        <div className="fk-header-actions">
          {catalogEnabled ? <button type="button" ref={searchButton} className="fk-icon" aria-label="Buscar na coleção" aria-expanded={searchOpen} aria-controls="fk-search" onClick={() => {if(searchOpen)closeSearch();else {setSearchOpen(true);requestAnimationFrame(() => searchInput.current?.focus());}}}><Search/></button> : null}
          <SiteHeaderCart className="fk-icon fk-cart"/>
        </div>
      </div>
      <nav className="fk-desktop-nav" aria-label="Navegação do site">{links.map(link => <a key={link.id} data-site-link={link.id} href={siteHref(link.url, basePath)} target={link.newTab ? "_blank" : undefined} rel={link.newTab ? "noopener noreferrer" : undefined}>{link.label}</a>)}</nav>
      {menuOpen ? <nav className="ts-container fk-mobile-nav" id="fk-mobile-menu" aria-label="Menu do celular" onKeyDown={event => {if(event.key === "Escape")onMenu();}}>{links.map(link => <a key={link.id} data-site-link={link.id} href={siteHref(link.url, basePath)} target={link.newTab ? "_blank" : undefined} rel={link.newTab ? "noopener noreferrer" : undefined} onClick={onMenu}>{link.label}<ArrowUpRight size={15}/></a>)}</nav> : null}
      {searchOpen ? <form className="ts-container fk-search" id="fk-search" role="search" onSubmit={event => {event.preventDefault();onSearch(event.currentTarget.ownerDocument);setSearchOpen(false);}} onKeyDown={event => {if(event.key === "Escape")closeSearch();}}>
        <Search size={18}/><label className="fk-sr-only" htmlFor="fk-search-input">Buscar no site</label><input id="fk-search-input" ref={searchInput} value={query} onChange={event => onQuery(event.target.value)} placeholder="O que vamos descobrir hoje?" onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();onSearch(event.currentTarget.ownerDocument);setSearchOpen(false);}}}/><button type="button" className="fk-text-link" onClick={event=>{onSearch(event.currentTarget.ownerDocument);setSearchOpen(false);}}>Buscar<ArrowRight size={15}/></button><button type="button" className="fk-icon" aria-label="Fechar busca" onClick={closeSearch}><X/></button>
      </form> : null}
    </header>
  </>;
}

function FashionPhoto({product, image, mobileImage, alt, priority = false, className = "", intrinsic = false}: {product?: PublicSiteProduct; image?: string; mobileImage?: string; alt?: string; priority?: boolean; className?: string; intrinsic?: boolean}) {
  const url = image || product?.imageUrls[0];
  return <div className={`fk-photo ${className}`}>{url ? <picture>{mobileImage ? <source media="(max-width:700px)" srcSet={mobileImage}/> : null}<img src={image ? url : thumbUrl(url, 960)} alt={alt || product?.name || ""} width={intrinsic ? undefined : 960} height={intrinsic ? undefined : 1200} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" data-fashion-product-photo={!image || undefined}/></picture> : <span className="fk-photo-empty">{product?.name || "Bambilu Kids"}</span>}</div>;
}

export function FashionKidsHero({site, block, basePath}: TemplateHeroProps) {
  const [selected, setSelected] = useState(0), editingSlide=useEditingSlide(block.id), slides = block.slides?.filter(s => s.enabled) ?? [], editingIndex=slides.findIndex(slide=>slide.id===editingSlide), active=editingIndex>=0?editingIndex:selected % (slides.length || 1);
  const product = site.products.find(p => p.id === (site.layoutConfig?.featuredProductId ?? block.productIds[0])) ?? site.products[0];
  const slide = slides[active], image = site.layoutConfig?.heroImageUrl || slide?.imageUrl || block.imageUrl;
  const mobileImage = site.layoutConfig?.heroMobileImageUrl || slide?.mobileImageUrl;
  const copy = slide ?? block, defaultCopy = !copy.title || copy.title === "Boas escolhas começam por aqui.";
  return <section id={`secao-${block.id}`} className="fk-hero" data-image-fit={block.style?.imageFit??"cover"} data-campaign-visual={!!image || undefined} data-mobile-campaign-visual={!!mobileImage || undefined} aria-label="Coleção Bambilu Kids">
    <div className="fk-hero-copy"><span className="fk-kicker">UM MUNDO DE POSSIBILIDADES</span>
      <h1>{defaultCopy ? <>Estilo para<br/>acompanhar<br/><em>cada fase.</em></> : copy.title}</h1>
      <p>{defaultCopy ? "Para os dias cheios de histórias. E todos os que ainda estão por vir." : copy.text}</p>
      <a href={siteHref(defaultCopy ? "#catalogo" : copy.buttonUrl || "#catalogo", basePath)} className="fk-text-link">{defaultCopy ? "Ver coleção" : copy.buttonLabel || "Ver coleção"}<ArrowRight size={18}/></a>
      <span className="fk-hero-footnote"><span aria-hidden="true">✳</span> O bonito é crescer do seu jeito.</span>
    </div>
    <div className="fk-hero-visual"><FashionPhoto product={product} image={image} mobileImage={mobileImage} alt={slide?.imageAlt || block.imageAlt} intrinsic={!!(image || mobileImage)} priority/>
      <a href={`${basePath}#catalogo`} className="fk-photo-caption"><span>{image ? "O universo Bambilu" : "Um olhar para a nossa coleção"}</span><ArrowDown size={18}/></a>
      {!site.layoutConfig?.heroImageUrl && slides.length > 1 ? <div className="fk-banner-controls" aria-label="Banners em destaque">{slides.map((s, index) => <button type="button" key={s.id} aria-label={`Mostrar banner ${index + 1}`} aria-pressed={active === index} onClick={() => setSelected(index)}>{index + 1}</button>)}</div> : null}
    </div>
  </section>;
}

export function FashionKidsProductCard({site, product, basePath}: TemplateCardProps) {
  return <ProductCard product={product} compact photoColors className="fk-product" href={`${basePath}/produto/${encodeURIComponent(product.slug)}`}>
    <div className="premium-product-image fk-product-image"><ProductCardMedia/></div>
    <div className="fk-product-copy"><ProductCardTitle/>{site.theme.catalog?.showPrice !== false ? <span className="fk-price">{formatCurrencyCents(product.priceCents, product.currency)}</span> : null}</div>
  </ProductCard>;
}

function FashionExplore({site, basePath}: {site: PublicTenantSite; basePath: string}) {
  return <section className="ts-container fk-explore" aria-label="Explore a coleção"><span className="fk-kicker">ENCONTRE SEU JEITO</span><div>
    {site.categories.length ? site.categories.slice(0, 5).map(c => <a key={c.id} href={`${basePath}/categoria/${c.slug}`}>{c.name}<ArrowUpRight size={17}/></a>) : <><a href={`${basePath}#em-destaque`}>Nossas escolhas<ArrowUpRight size={17}/></a><a href={`${basePath}#catalogo`}>Toda a coleção<ArrowUpRight size={17}/></a></>}
  </div></section>;
}

function FashionEditorial({site, basePath}: {site: PublicTenantSite; basePath: string}) {
  const block = site.content.blocks.find(b => b.enabled && b.type === "image_text");
  const product = site.products.find(p => p.id !== site.products[0]?.id && p.imageUrls.length) ?? site.products[0];
  return <section className="fk-editorial" id="nosso-olhar" data-site-block={block?.id}>{block?<span id={`secao-${block.id}`} aria-hidden="true"/>:null}<div className="ts-container fk-editorial-layout">
    <FashionPhoto product={product} image={block?.imageUrl} alt={block?.imageAlt}/>
    <div className="fk-editorial-copy"><span className="fk-kicker">{block?.eyebrow || "O NOSSO OLHAR"}</span><span className="fk-editorial-flower" aria-hidden="true">✳</span><h2>{block?.title || <>Para brincar,<br/>descobrir<br/>e <em>crescer.</em></>}</h2><p>{block?.text || "A infância acontece nos pequenos momentos. Nas cores preferidas, nas novas descobertas e na liberdade de ser quem se é."}</p><a className="fk-text-link" href={siteHref(block?.buttonUrl || "#catalogo", basePath)}>{block?.buttonLabel || "Encontre sua próxima escolha"}<ArrowRight size={18}/></a></div>
  </div></section>;
}

function FashionDetails({site, basePath}: {site: PublicTenantSite; basePath: string}) {
  const colors = site.products.some(p => p.options.some(o => isColorOption(o) && o.values.length > 1));
  const sizes = site.products.some(p => p.options.some(o => /^(size|tamanho)$/i.test(o.key) && o.values.length > 1));
  const contact = site.content.blocks.some(b => b.enabled && b.type === "contact") && !!(site.content.contactForm || site.content.phone || site.content.email || site.content.whatsapp);
  if(!colors && !sizes && !contact)return null;
  return <section className="ts-container fk-details" aria-label="Explore as possibilidades">
    {colors ? <div><Palette size={21}/><h3>Suas cores, seu jeito</h3><p>Veja as opções de cada peça.</p></div> : null}
    {sizes ? <div><Ruler size={21}/><h3>Uma escolha que combina</h3><p>Confira os tamanhos no produto.</p></div> : null}
    {contact ? <a href={`${basePath}#contato`}><MessageCircle size={21}/><h3>Vamos conversar?</h3><p>Fale com a gente sobre suas escolhas.</p></a> : null}
  </section>;
}

/** Keep the original catalog/contact components, including their commerce and form logic. */
export function FashionKidsHome({site, basePath, renderSection}: {site: PublicTenantSite; basePath: string; renderSection: (block: SiteBlock) => ReactNode}) {
  const blocks = site.content.blocks.filter(b => b.enabled), firstCatalog = blocks.find(b => b.type === "catalog");
  const featured = site.products.filter(p => !firstCatalog?.productIds.length || firstCatalog.productIds.includes(p.id)).slice(0, 4);
  const editorial = blocks.find(b => b.type === "image_text" && b.imageUrl);
  return <>{blocks.map(block => {
    if(block === editorial && firstCatalog)return null;
    if(block === firstCatalog)return <Fragment key={block.id}>
      <FashionExplore site={site} basePath={basePath}/>
      {featured.length ? <section className="ts-container fk-featured" id="em-destaque"><div className="fk-section-heading"><div><span className="fk-kicker">ESCOLHAS BAMBILU</span><h2>Pequenos favoritos.</h2></div><a className="fk-text-link" href={`${basePath}#catalogo`}>Ver tudo<ArrowRight size={16}/></a></div><div className="fk-featured-grid">{featured.map((product, index) => <FashionKidsProductCard key={product.id} product={product} site={site} basePath={basePath} index={index}/>)}</div></section> : null}
      <FashionEditorial site={site} basePath={basePath}/>
      {renderSection({...block, title: block.title === "Nosso catálogo" ? "Encontre a sua próxima escolha." : block.title, eyebrow: block.eyebrow || "TODA A COLEÇÃO"})}
      <FashionDetails site={site} basePath={basePath}/>
    </Fragment>;
    return <Fragment key={block.id}>{renderSection(block)}</Fragment>;
  })}</>;
}

export const FASHION_KIDS_RENDERER = {Header: FashionKidsHeader, Hero: FashionKidsHero, ProductCard: FashionKidsProductCard};
