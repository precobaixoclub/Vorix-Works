import Link from "next/link";
import { Logo } from "@/components/Logo";

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(140px,1fr))]">
        <div>
          <Logo className="h-10 w-auto text-foreground" />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">Marketing, atendimento e vendas conectados por IA.</p>
          <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} Vorix. Todos os direitos reservados.</p>
        </div>
        <FooterGroup title="Produto" links={[["/", "Visão geral"], ["/pricing", "Preços"], ["/signup", "Criar conta"]]} />
        <FooterGroup title="Empresa" links={[["mailto:comercial@vorixworks.com", "Contato"]]} />
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
