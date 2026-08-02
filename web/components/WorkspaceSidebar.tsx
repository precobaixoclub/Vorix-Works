"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

const NAV_ITEMS = [
  { href: "", label: "Início", icon: "◆" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/assets", label: "Ativos", icon: "🗂" },
  { href: "/campaigns", label: "Campanhas", icon: "📣" },
  { href: "/planning", label: "Planejamento", icon: "🧭" },
  { href: "/runtime", label: "Runtime", icon: "⚙" },
  { href: "/execution", label: "Execução", icon: "▶" },
  { href: "/providers", label: "Provedores", icon: "◇" },
  { href: "/governance", label: "Governança", icon: "▣" },
  { href: "/knowledge", label: "Conhecimento", icon: "🧠" },
  { href: "/calendar", label: "Calendário", icon: "🗓" },
  { href: "/analytics", label: "Análises", icon: "◈" },
  { href: "/operations", label: "Operação", icon: "▦" },
] as const;

/**
 * Navegação fixa dentro de um Workspace — a espinha dorsal do fluxo pedido na Sprint 04
 * (Home → Chat → Assets → Campaigns → Knowledge → Calendar). Nunca aparece fora de um Workspace
 * (ver `app/workspaces/[workspaceId]/layout.tsx`, que é o único lugar que a renderiza).
 */
export function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/workspaces/${workspaceId}`;

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface-raised p-3">
      <Link href="/workspaces" className="mb-4 flex items-center px-2 py-1 text-ink" aria-label="Vonix — Workspaces">
        <Logo className="h-6 w-auto" />
      </Link>
      <Link
        href="/workspaces"
        className="mb-3 flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
      >
        ← Espaços de Trabalho
      </Link>
      {NAV_ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        const isActive = item.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={item.href}
            href={href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
            }`}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
