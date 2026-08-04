"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";

type NavItem = { href: string; label: string; icon: string };

const MAIN_NAV: readonly NavItem[] = [
  { href: "", label: "Início", icon: "◆" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/connections", label: "Conexões", icon: "🔗" },
  { href: "/publish", label: "Publicar", icon: "🚀" },
  { href: "/assets", label: "Materiais", icon: "📂" },
  { href: "/campaigns", label: "Publicações", icon: "📣" },
  { href: "/knowledge", label: "Conhecimento", icon: "🧠" },
  { href: "/calendar", label: "Calendário", icon: "🗓" },
  { href: "/analytics", label: "Análises", icon: "◈" },
] as const;

const BACKSTAGE_NAV: readonly NavItem[] = [
  { href: "/runtime", label: "Runtime", icon: "⚙" },
  { href: "/execution", label: "Execução", icon: "▶" },
  { href: "/providers", label: "Provedores", icon: "◇" },
  { href: "/governance", label: "Governança", icon: "▣" },
  { href: "/operations", label: "Operação", icon: "▦" },
] as const;

const BACKSTAGE_STORAGE_KEY = "zuno.sidebar.backstageOpen";

/**
 * Navegação fixa dentro de um Workspace. Itens divididos em "principais" (jornada do usuário
 * final) e "bastidor" (observabilidade técnica — disjuntores, credenciais, filas, saúde do
 * sistema) — este último só aparece pra `owner`/`admin` do tenant, nunca pra `editor`/`viewer`
 * (nenhum desses controles faz sentido pra quem só usa o produto pra publicar conteúdo), e fica
 * colapsável e persistido em localStorage para quem tem acesso manter aberto entre sessões.
 */
export function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const canSeeBackstage = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const base = `/workspaces/${workspaceId}`;

  const isBackstagePathActive = BACKSTAGE_NAV.some((item) => pathname.startsWith(`${base}${item.href}`));
  const [backstageOpen, setBackstageOpen] = useState<boolean>(isBackstagePathActive);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(BACKSTAGE_STORAGE_KEY) : null;
    if (stored === "true") setBackstageOpen(true);
    else if (stored === "false" && !isBackstagePathActive) setBackstageOpen(false);
  }, [isBackstagePathActive]);

  function toggleBackstage() {
    setBackstageOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem(BACKSTAGE_STORAGE_KEY, String(next));
      return next;
    });
  }

  function renderLink(item: NavItem) {
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
  }

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface-raised p-3">
      <Link href="/workspaces" className="mb-4 flex items-center px-2 py-1 text-ink" aria-label="Vonix — Workspaces">
        <Logo className="h-10 w-auto" />
      </Link>
      <Link
        href="/workspaces"
        className="mb-3 flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
      >
        ← Espaços de Trabalho
      </Link>

      {MAIN_NAV.map(renderLink)}

      {canSeeBackstage ? (
        <>
          <div className="my-2 border-t border-border/60" />

          <button
            type="button"
            onClick={toggleBackstage}
            aria-expanded={backstageOpen}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink-muted"
          >
            <span>Bastidor</span>
            <span aria-hidden="true" className={`transition-transform ${backstageOpen ? "rotate-90" : ""}`}>
              ›
            </span>
          </button>

          {backstageOpen ? <div className="flex flex-col gap-1">{BACKSTAGE_NAV.map(renderLink)}</div> : null}
        </>
      ) : null}
    </nav>
  );
}
