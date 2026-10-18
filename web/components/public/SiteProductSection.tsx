import Link from "next/link";
import {ArrowUpRight, Check, Globe} from "lucide-react";

export function SiteProductSection(){
 return <section id="vorix-site" className="public-section public-how"><div className="public-container public-product-features-section"><div><span className="public-eyebrow"><Globe size={16}/> Vorix Site</span><h2>Sua empresa e seus produtos em um só site.</h2><p className="public-section-copy">Crie o site da empresa, publique seu catálogo e receba interessados pelo formulário ou WhatsApp. Tudo conectado à sua conta Vorix.</p><div className="public-button-row"><Link href="/produtos/site" className="public-button secondary">Conhecer o Vorix Site <ArrowUpRight size={16}/></Link></div></div><ul className="public-product-feature-list">{["Editor com modelos, cores e identidade da empresa","Catálogo com fotos, preços e variações","Formulário de contato e consulta pelo WhatsApp","Publicação e configuração de domínio próprio"].map(item=><li key={item}><Check size={16}/>{item}</li>)}</ul></div></section>;
}
