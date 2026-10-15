"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Layers3, MessageSquare, Video } from "lucide-react";
import { formatPublicPrice, type PublicProduct, type PublicProductCatalog } from "@/features/public-site/catalog";
import { formatCapacityLine } from "@/features/platform-plans/api";
import { PlanConfigurator } from "./PlanConfigurator";

/** Preços: três pontos de entrada simples + "Monte seu Vorix" para ajustar a capacidade. */
export function PricingSection({ catalog, standalone = false }: { catalog: PublicProductCatalog; standalone?: boolean }) {
  const { products } = catalog;
  const [annual, setAnnual] = useState(false);
  const hasAnnual = products.some(product => product.contractable && product.annualPrice !== null);
  return <section id="precos" className="public-section public-pricing"><div className="public-container">
    {!standalone ? <div className="public-section-heading"><span className="public-eyebrow">Planos</span><h2>Comece com o que precisa hoje.</h2><p>Ajuste a Vorix conforme sua operação cresce: usuários e números em Conversas, gravações simultâneas no Meetings.</p></div> : null}
    {hasAnnual ? <div className="public-billing-toggle" role="group" aria-label="Período de cobrança"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Mensal</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Anual</button></div> : null}
    <div className="public-price-grid">{products.map(product => <PricingCard key={product.key} product={product} annual={annual} />)}</div>
    <p className="public-pricing-availability">Meetings e Suite estão em validação para liberação comercial: os valores são referências provisórias, sem contratação disponível.</p>

    <div className="public-config-heading"><span className="public-eyebrow">Monte seu Vorix</span><h2>Ajuste a capacidade, veja o valor na hora.</h2><p>Os valores de Conversas vêm do mesmo catálogo usado na contratação.</p></div>
    <PlanConfigurator catalog={catalog} />
    <p className="public-pricing-disclaimer">Créditos de IA, gravações adicionais e recursos avançados podem variar conforme o plano e o uso.</p>
    {!standalone ? <Link href="/precos" className="public-text-link public-pricing-more">Comparar planos e capacidades <ArrowUpRight size={16} aria-hidden="true" /></Link> : null}
  </div></section>;
}

export function PricingCard({ product, annual = false }: { product: PublicProduct; annual?: boolean }) {
  const Icon = product.key === "meetings" ? Video : product.key === "suite" ? Layers3 : MessageSquare;
  const annualPrice = annual && product.contractable ? product.annualPrice : null;
  const price = annualPrice ?? product.monthlyPrice;
  const caption = price === null ? "Confirme os valores com nosso time" : product.provisional ? "Valor provisório · sujeito à liberação" : annualPrice !== null ? "Total do ciclo anual" : "Cobrança mensal";
  return <article id={product.key} className={"public-price-card " + product.key}>
    <div className="public-price-card-top"><span className="public-icon small"><Icon size={18} aria-hidden="true" /></span><span className="public-badge">{product.badge}</span></div>
    <h3>{product.name}</h3><p className="public-price-description">{product.key === "suite" ? "Configure sua operação com as duas soluções." : product.description}</p>
    <div className="public-price"><small>{price === null ? "Condições comerciais" : product.provisional ? "Referência a partir de" : "A partir de"}</small><strong>{formatPublicPrice(product, price)}{price !== null ? <span>/{annualPrice !== null ? "ano" : "mês"}</span> : null}</strong><p>{caption}</p></div>
    <ul>{product.key === "conversations" && product.plan ? <li><Check size={14} aria-hidden="true" />{formatCapacityLine(product.plan)} incluídos</li> : null}{product.highlights.map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>
    <Link href={product.cta.href} className={"public-button " + (product.contractable ? "primary" : "secondary")}>{product.cta.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>
    <small className="public-price-note">{product.contractable && product.plan?.trialDays ? `${product.plan.trialDays} dias para testar · sem cartão para começar` : product.key === "suite" ? "Monte a configuração e fale com o time" : "Conheça a proposta e fale com o time"}</small>
  </article>;
}
