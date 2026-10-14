"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Layers3, MessageSquare, Video } from "lucide-react";
import { formatPublicPrice, type PublicProduct } from "@/features/public-site/catalog";
import { formatCapacityLine } from "@/features/platform-plans/api";

export function PricingSection({ products, standalone = false }: { products: readonly PublicProduct[]; standalone?: boolean }) {
  const [annual, setAnnual] = useState(false);
  const hasAnnual = products.some(product => product.contractable && product.annualPrice !== null);
  return <section id="precos" className="public-section public-pricing"><div className="public-container">
    {!standalone ? <div className="public-section-heading"><span className="public-eyebrow">Investimento que acompanha você</span><h2>Escolha seu próximo passo.</h2><p>Uma solução para começar. Uma plataforma para ir além.</p></div> : null}
    {hasAnnual ? <div className="public-billing-toggle" role="group" aria-label="Período de cobrança"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Mensal</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Anual</button></div> : null}
    <div className="public-price-grid">{products.map(product => <PricingCard key={product.key} product={product} annual={annual} />)}</div>
    <p className="public-pricing-disclaimer">Créditos de IA, gravações adicionais e recursos avançados podem variar conforme o plano e o uso.</p><p className="public-pricing-availability">Meetings e Suite estão em validação para liberação comercial. Seus valores são referências provisórias, sem contratação disponível.</p>
    {!standalone ? <Link href="/precos" className="public-text-link public-pricing-more">Comparar planos e capacidades <ArrowUpRight size={16} /></Link> : null}
  </div></section>;
}

export function PricingCard({ product, annual = false }: { product: PublicProduct; annual?: boolean }) {
  const Icon = product.key === "meetings" ? Video : product.key === "suite" ? Layers3 : MessageSquare;
  const annualPrice = annual && product.contractable ? product.annualPrice : null;
  const price = annualPrice ?? product.monthlyPrice;
  return <article id={product.key} className={"public-price-card " + product.key}>
    <div className="public-price-card-top"><Icon size={22} aria-hidden="true" /><span>{product.badge}</span></div><h3>{product.name}</h3><p className="public-price-description">{product.description}</p>
    <div className="public-price"><small>{price === null ? "Condições comerciais" : product.provisional ? "Referência de lançamento" : "A partir de"}</small><strong>{formatPublicPrice(product, price)}{price !== null ? <span>/{annualPrice !== null ? "ano" : "mês"}</span> : null}</strong><p>{price === null ? "Confirme os valores com nosso time" : product.provisional ? "Valor provisório · sujeito à liberação" : annualPrice !== null ? "Valor total do ciclo anual" : "Cobrança mensal"}</p></div>
    <ul>{product.key === "conversations" && product.plan ? <li><Check size={14} />{formatCapacityLine(product.plan)}</li> : null}{product.features.map(feature => <li key={feature}><Check size={14} aria-hidden="true" />{feature}</li>)}</ul>
    <Link href={product.cta.href} className={"public-button " + (product.contractable ? "primary" : "secondary")}>{product.cta.label}<ArrowUpRight size={17} /></Link>
    <small className="public-price-note">{product.contractable && product.plan?.trialDays ? `${product.plan.trialDays} dias para testar · sem cartão para começar` : "Conheça a proposta e converse com nosso time"}</small>
  </article>;
}
