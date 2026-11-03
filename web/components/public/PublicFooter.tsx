import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SupportWhatsAppLink } from "@/components/public/SupportWhatsAppLink";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";
import { SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

export function PublicFooter({
  appearance = "default",
}: {
  appearance?: "default" | "home";
}) {
  if (appearance === "home")
    return (
      <footer className="public-footer vh-footer">
        <div className="vh-container">
          <div className="vh-footer-top">
            <Link href="/" className="public-brand" aria-label="Vorix — início">
              <Logo viewBox="50 8 182 130" className="public-brand-mark" />
              <span>
                Vorix<span className="public-brand-dot">.</span>
              </span>
            </Link>
            <p>
              Da conversa à venda.
              <br />
              <strong>Tudo conectado.</strong>
            </p>
            <a href={PUBLIC_CONTACT}>comercial@vorixworks.com</a>
          </div>
          <div className="vh-footer-links">
            <FooterGroup
              title="Produtos"
              links={[
                ["/produtos/conversas", "Vorix Conversas"],
                ["/produtos/meetings", "Vorix Meetings"],
                ["/#marketing", "Vorix Marketing"],
                ["/produtos/site", "Sites & Commerce"],
              ]}
            />
            <FooterGroup
              title="Soluções"
              links={[
                ["/#equipes", "Vendas por conversa"],
                ["/#solucoes", "Para sua operação"],
                ["/#indicadores", "Gestão comercial"],
              ]}
            />
            <FooterGroup
              title="Empresa"
              links={[
                ["/empresa", "Sobre o Vorix"],
                ["/#contato", "Contato comercial"],
                ["/precos", "Planos e capacidade"],
              ]}
            />
            <FooterGroup
              title="Recursos"
              links={[
                ["/#recursos", "Explore os recursos"],
                ["/#integracoes", "Integrações e status"],
                ["/#faq", "Perguntas frequentes"],
              ]}
            />
            <FooterGroup
              title="Legal"
              links={[
                ["/terms", "Termos de uso"],
                ["/privacy", "Privacidade"],
                ["/data-deletion", "Exclusão de dados"],
              ]}
            />
            <div>
              <h2>Suporte técnico</h2>
              <SupportWhatsAppLink>
                {SUPPORT_WHATSAPP_DISPLAY}
              </SupportWhatsAppLink>
              <small>WhatsApp oficial de suporte</small>
              <a href={PUBLIC_CONTACT}>Falar com o comercial</a>
            </div>
          </div>
          <div className="vh-footer-bottom">
            <span>
              © {new Date().getFullYear()} Vorix. Todos os direitos reservados.
            </span>
            <span>Uma operação inteira. Um único contexto.</span>
          </div>
        </div>
      </footer>
    );
  return (
    <footer className="public-footer">
      <div className="public-container public-footer-grid">
        <div className="public-footer-brand">
          <Link href="/" className="public-brand" aria-label="Vorix — início">
            <Logo viewBox="50 8 182 130" className="public-brand-mark" />
            <span>
              VORIX<span className="public-brand-dot">.</span>
            </span>
          </Link>
          <p>Transforme contexto em ação.</p>
          <small>Uma plataforma para conectar sua operação.</small>
        </div>
        <FooterGroup
          title="Produtos"
          links={[
            ["/produtos/conversas", "Vorix Conversas"],
            ["/produtos/meetings", "Vorix Meetings"],
            ["/produtos/site", "Vorix Site"],
            ["/precos", "Preços"],
          ]}
        />
        <FooterGroup
          title="Empresa"
          links={[
            ["/empresa", "Sobre o Vorix"],
            [PUBLIC_CONTACT, "Contato comercial"],
          ]}
        />
        <div>
          <h2>Recursos</h2>
          <Link href="/#faq">Perguntas frequentes</Link>
          <SupportWhatsAppLink>Ajuda e suporte</SupportWhatsAppLink>
        </div>
        <FooterGroup
          title="Legal"
          links={[
            ["/terms", "Termos de uso"],
            ["/privacy", "Privacidade"],
            ["/data-deletion", "Exclusão de dados"],
          ]}
        />
      </div>
      <div className="public-container public-footer-bottom">
        <span>
          © {new Date().getFullYear()} Vorix. Todos os direitos reservados.
        </span>
        <span>
          <i aria-hidden="true" /> Contexto. Inteligência. Ação.
        </span>
      </div>
    </footer>
  );
}
function FooterGroup({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <h2>{title}</h2>
      {links.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </div>
  );
}
