import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SupportWhatsAppLink } from "@/components/public/SupportWhatsAppLink";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";

export function PublicFooter() {
  return <footer className="public-footer">
    <div className="public-container public-footer-grid">
      <div className="public-footer-brand"><Link href="/" className="public-brand" aria-label="Vorix — início"><Logo viewBox="50 8 182 130" className="public-brand-mark" /><span>VORIX<span className="public-brand-dot">.</span></span></Link><p>Transforme contexto em ação.</p><small>Uma plataforma para conectar sua operação.</small></div>
      <FooterGroup title="Produtos" links={[["/produtos/conversas", "Vorix Conversas"], ["/produtos/meetings", "Vorix Meetings"], ["/produtos/site", "Vorix Site"], ["/precos", "Preços"]]} />
      <FooterGroup title="Empresa" links={[["/empresa", "Sobre o Vorix"], [PUBLIC_CONTACT, "Contato comercial"]]} />
      <div><h2>Recursos</h2><Link href="/#faq">Perguntas frequentes</Link><SupportWhatsAppLink>Ajuda e suporte</SupportWhatsAppLink></div>
      <FooterGroup title="Legal" links={[["/terms", "Termos de uso"], ["/privacy", "Privacidade"], ["/data-deletion", "Exclusão de dados"]]} />
    </div>
    <div className="public-container public-footer-bottom"><span>© {new Date().getFullYear()} Vorix. Todos os direitos reservados.</span><span><i aria-hidden="true" /> Contexto. Inteligência. Ação.</span></div>
  </footer>;
}
function FooterGroup({ title, links }: { title: string; links: [string, string][] }) {
  return <div><h2>{title}</h2>{links.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</div>;
}
