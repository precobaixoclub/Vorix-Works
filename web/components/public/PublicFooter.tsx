import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SupportWhatsAppLink } from "@/components/public/SupportWhatsAppLink";
import { SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

/**
 * Polimento final do site público (pedido explícito do usuário) — Comercial e Suporte são
 * intencionalmente colunas/linhas DISTINTAS ("quero deixar muito claro que COMERCIAL é uma coisa
 * e SUPORTE é outra"), nunca misturadas num único "Contato" genérico: "Empresa → Contato"
 * continua existindo (pré-venda/institucional, e-mail comercial), "Atendimento" é a coluna nova,
 * só com os dois canais de pós-venda lado a lado.
 */
export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[minmax(0,1.1fr)_repeat(4,minmax(130px,1fr))]">
        <div>
          <Logo className="h-12 w-auto text-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">Transforme contexto em ação.</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">Marketing, atendimento e vendas conectados por IA.</p>
          <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} Vorix. Todos os direitos reservados.</p>
        </div>
        <FooterGroup title="Produto" links={[["/", "Visão geral"], ["/pricing", "Preços"], ["/signup", "Criar conta"]]} />
        <FooterGroup title="Empresa" links={[["/empresa", "Por que existimos"], ["mailto:comercial@vorixworks.com", "Contato"]]} />
        <div>
          <p className="text-sm font-semibold text-foreground">Atendimento</p>
          <div className="mt-3 grid gap-3 text-sm text-muted-foreground">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground/70">Comercial</p>
              <Link href="mailto:comercial@vorixworks.com" className="hover:text-foreground">comercial@vorixworks.com</Link>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground/70">Suporte</p>
              <SupportWhatsAppLink className="hover:text-foreground">WhatsApp {SUPPORT_WHATSAPP_DISPLAY}</SupportWhatsAppLink>
            </div>
          </div>
        </div>
        <FooterGroup title="Legal" links={[["/privacy", "Privacidade"], ["/terms", "Termos"], ["/data-deletion", "Exclusão de dados"]]} />
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="hover:text-foreground">{label}</Link>
        ))}
      </div>
    </div>
  );
}
