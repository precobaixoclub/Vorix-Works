import Link from "next/link";
import { ArrowUpRight, Check, Megaphone } from "lucide-react";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";

/** Fase 13: o Marketing também aparece em Preços — sem preço inventado (não há oferta self-service no
 * catálogo oficial): a contratação é com o time comercial. */
export function MarketingProductSection() {
  return <section id="vorix-marketing" className="public-section public-how"><div className="public-container public-product-features-section"><div><span className="public-eyebrow"><Megaphone size={16} aria-hidden="true" /> Vorix Marketing</span><h2>Conteúdo e publicação, sob consulta.</h2><p className="public-section-copy">Ideias, criação com IA a partir da sua marca, revisão e calendário de publicações. Os valores do Marketing são combinados com o nosso time comercial.</p><div className="public-button-row"><Link href="/produtos/marketing" className="public-button secondary">Conhecer o Vorix Marketing <ArrowUpRight size={16} aria-hidden="true" /></Link><a href={PUBLIC_CONTACT} className="public-text-link">Falar com o time</a></div></div><ul className="public-product-feature-list">{["Bolsão de ideias e criação com IA", "Revisão antes de publicar", "Calendário de publicações", "Instagram e Facebook pela integração oficial da Meta"].map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul></div></section>;
}
