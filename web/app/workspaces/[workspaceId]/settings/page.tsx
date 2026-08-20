"use client";

import Link from "next/link";
import { Card, CardBody } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

type SettingsLink = { href: string; title: string; description: string; icon: string; ownerOnly?: boolean };

const LINKS: readonly SettingsLink[] = [
  { href: "/production", title: "Diretrizes Criativas", description: "Instruções permanentes usadas pelo motor de IA em toda nova geração (aba \"Diretrizes Criativas\" dentro de Produção).", icon: "✦" },
  { href: "/connections", title: "Conexões", description: "Contas de rede social conectadas a este workspace.", icon: "🔗" },
  { href: "/governance", title: "Governança", description: "Credenciais, auditoria e segurança das integrações.", icon: "▣", ownerOnly: true },
];

/**
 * Redesign "SaaS moderno + IA-first" — aggregator leve: `/settings` não duplica nenhuma tela, só
 * reúne os pontos de configuração que já existiam espalhados (Produção, Conexões, Governança) num
 * lugar previsível. Nenhuma lógica nova.
 */
export default function SettingsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const canSeeGovernance = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const links = LINKS.filter((link) => !link.ownerOnly || canSeeGovernance);

  return (
    <main className="mx-auto max-w-3xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Configurações" description="Pontos de configuração deste workspace." />
      <div className="flex flex-col gap-3">
        {links.map((link) => (
          <Link key={link.href} href={`/workspaces/${workspace.id}${link.href}`}>
            <Card className="transition-colors hover:bg-surface-sunken">
              <CardBody className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{link.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold text-ink">{link.title}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{link.description}</p>
                </div>
                <span aria-hidden="true" className="shrink-0 text-ink-faint">›</span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
