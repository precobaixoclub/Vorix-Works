"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";

type NavItem = { href: string; label: string; icon: string };

const PRIMARY_NAV: readonly NavItem[] = [
  { href: "", label: "Início", icon: "◆" },
  { href: "/production", label: "Produção", icon: "▤" },
  { href: "/create", label: "Criar", icon: "✦" },
  { href: "/campaigns", label: "Conteúdos", icon: "▥" },
] as const;

const MENU_NAV: readonly NavItem[] = [
  { href: "/calendar", label: "Calendário", icon: "🗓" },
  { href: "/publish", label: "Campanhas", icon: "🚀" },
  { href: "/assets", label: "Materiais", icon: "📂" },
  { href: "/knowledge", label: "Marca", icon: "🧠" },
  { href: "/analytics", label: "Analytics", icon: "◈" },
  { href: "/settings", label: "Configurações", icon: "⚙" },
] as const;

const BACKSTAGE_NAV: readonly NavItem[] = [
  { href: "/connections", label: "Conexões", icon: "🔗" },
  { href: "/governance", label: "Governança", icon: "▣" },
  { href: "/operations", label: "Operação", icon: "▦" },
];

/**
 * Redesign "SaaS moderno + IA-first" — navegação principal no mobile. Antes desta revisão, o
 * "menu mobile" era a mesma lista de 10 itens da sidebar desktop, expandida inline sob uma faixa
 * fixa no topo. Agora: as 4 áreas mais usadas (Início/Produção/Criar/Conteúdos, pedido explícito)
 * ficam sempre alcançáveis numa barra fixa no rodapé — "Criar" em destaque, como o gesto mais
 * frequente do produto — e "Menu" abre um bottom sheet com o resto. Só visível abaixo de `md:`;
 * no desktop, `WorkspaceSidebar` cobre a mesma navegação.
 */
export function BottomNav({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const canSeeBackstage = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const base = `/workspaces/${workspaceId}`;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  // Trava o scroll do fundo enquanto o sheet está aberto — sem isso, o conteúdo por trás rola
  // junto e a folha some por baixo dele em telas pequenas.
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);

  function isActive(href: string): boolean {
    const target = `${base}${href}`;
    return href === "" ? pathname === base : pathname.startsWith(target);
  }

  function renderSheetLink(item: NavItem) {
    return (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        onClick={() => setMenuOpen(false)}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
          isActive(item.href) ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-sunken"
        }`}
      >
        <span aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-surface-raised/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur md:hidden">
        {PRIMARY_NAV.map((item) =>
          item.href === "/create" ? (
            <Link key={item.href} href={`${base}${item.href}`} className="flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium text-accent">
              <span
                aria-hidden="true"
                className="-mt-4 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white shadow-lg shadow-accent/30"
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ) : (
            <Link
              key={item.href}
              href={`${base}${item.href}`}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium ${isActive(item.href) ? "text-accent" : "text-ink-muted"}`}
            >
              <span aria-hidden="true" className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ),
        )}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium text-ink-muted"
        >
          <span aria-hidden="true" className="text-base">☰</span>
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <div role="menu" className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface-raised p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="flex flex-col gap-1">
              {MENU_NAV.map(renderSheetLink)}
              {canSeeBackstage ? (
                <>
                  <div className="my-2 border-t border-border" />
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Bastidor</p>
                  {BACKSTAGE_NAV.map(renderSheetLink)}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
