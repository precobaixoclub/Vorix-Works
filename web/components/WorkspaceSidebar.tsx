"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";

type NavItem = { href: string; label: string; icon: string };

// Redesign "SaaS moderno + IA-first" — nova ordem/rótulos pedidos: Início, Criar, Produção,
// Conteúdos, Calendário, Campanhas, Materiais, Marca, Analytics, Configurações. "Revisão" sai da
// navegação principal (a experiência de revisar uma peça passa a viver dentro de Produção — a
// rota `/review` continua existindo e é aberta a partir de lá, nunca removida). "Conteúdos"/
// "Campanhas"/"Marca" são só rótulos novos sobre rotas que já existiam (`/campaigns`, `/publish`,
// `/knowledge`) — ver decisões 3/4 da proposta de redesign.
const MAIN_NAV: readonly NavItem[] = [
  { href: "", label: "Início", icon: "◆" },
  { href: "/create", label: "Criar", icon: "✦" },
  { href: "/production", label: "Produção", icon: "▤" },
  { href: "/campaigns", label: "Conteúdos", icon: "▥" },
  { href: "/calendar", label: "Calendário", icon: "🗓" },
  { href: "/publish", label: "Campanhas", icon: "🚀" },
  { href: "/assets", label: "Materiais", icon: "📂" },
  { href: "/knowledge", label: "Marca", icon: "🧠" },
  { href: "/analytics", label: "Analytics", icon: "◈" },
  { href: "/settings", label: "Configurações", icon: "⚙" },
] as const;

const BACKSTAGE_NAV: readonly NavItem[] = [
  { href: "/runtime", label: "Runtime", icon: "⚙" },
  { href: "/execution", label: "Execução", icon: "▶" },
  { href: "/providers", label: "Provedores", icon: "◇" },
  { href: "/governance", label: "Governança", icon: "▣" },
  { href: "/operations", label: "Operação", icon: "▦" },
  { href: "/publications", label: "Publicação técnica", icon: "📡" },
] as const;

const BACKSTAGE_STORAGE_KEY = "zuno.sidebar.backstageOpen";

/**
 * Navegação fixa dentro de um Workspace — DESKTOP APENAS (`md:` e acima). No mobile, a navegação
 * vive em `WorkspaceTopBar` (troca de espaço) + `BottomNav` (as 4 áreas mais usadas + "Menu" com
 * o resto) — ver esses dois componentes. Antes desta revisão este arquivo também renderizava a
 * versão mobile (uma faixa no topo); separar os dois evita a barra "← Espaços"/"Menu" ocupando
 * espaço permanente no topo do desktop, que era o problema original.
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
        className={`flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
        }`}
      >
        <span className="shrink-0" aria-hidden="true">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <nav className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface-raised p-3 md:flex">
      <Link href={base} className="mb-4 flex items-center px-2 py-1 text-ink" aria-label="Vorix">
        <Logo className="h-9 w-auto" />
      </Link>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {MAIN_NAV.map(renderLink)}

        {canSeeBackstage ? (
          <>
            <div className="my-2 border-t border-border/60" />

            <button
              type="button"
              onClick={toggleBackstage}
              aria-expanded={backstageOpen}
              className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink-muted"
            >
              <span>Bastidor</span>
              <span aria-hidden="true" className={`transition-transform ${backstageOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>

            {backstageOpen ? <div className="flex flex-col gap-1">{BACKSTAGE_NAV.map(renderLink)}</div> : null}
          </>
        ) : null}
      </div>
    </nav>
  );
}
