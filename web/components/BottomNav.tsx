"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavIcon } from "@/components/NavIcon";
import { MARKETING_BACKSTAGE_NAV, type WorkspaceNavItem } from "@/components/workspace-navigation";
import type { GlobalArea } from "@/components/global-navigation";
import { useGlobalNavigation } from "@/components/use-global-navigation";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";

/**
 * Navegação do celular (Reorganização de UX — Fase 2). Usa o MESMO menu global do desktop
 * (`useGlobalNavigation`): a barra de baixo dá acesso direto às áreas principais que a conta tem
 * (Início, Conversas, Marketing, Meu site, Reuniões — Vendas/Resultados ocupam vaga que sobrar) e o
 * botão "Menu" abre todas as áreas com as respectivas telas. A seta de uma área só mostra as telas
 * dela; a página só muda quando a pessoa escolhe um destino.
 */
export function BottomNav({ workspaceId }: { workspaceId: string }) {
  const workspace = useCurrentWorkspace();
  const { pathname, base, areas, barAreas, activeKey, activeItem, isLoading, canSeeBackstage, isBackstageActive, expanded, toggleArea } = useGlobalNavigation(workspaceId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [backstageOpen, setBackstageOpen] = useState(isBackstageActive);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // A área atual não está na barra (ex.: Vendas, Configurações): o botão "Menu" é que fica aceso.
  const activeInMenuOnly = activeKey !== undefined && !barAreas.some((area) => area.key === activeKey);

  // Trocou de tela (link do menu, Voltar do navegador): o menu fecha sozinho.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  // Foco previsível: ao abrir vai para o "Fechar"; ao fechar volta para o botão "Menu".
  useEffect(() => {
    if (menuOpen) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  function renderItem(item: WorkspaceNavItem, isActive: boolean) {
    return (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        onClick={() => setMenuOpen(false)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex min-h-[44px] min-w-0 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors active:bg-muted/70",
          isActive ? "bg-solution/10 text-foreground [&_svg]:text-solution" : "text-text-secondary hover:bg-muted",
        )}
      >
        <NavIcon id={item.icon} className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  function renderArea(area: GlobalArea) {
    const isActive = area.key === activeKey;
    const isOpen = area.items.length > 0 && expanded.has(area.key);
    return (
      <div key={area.key} className="flex flex-col">
        <div className="flex items-center gap-1">
          <Link
            href={`${base}${area.href}`}
            onClick={() => setMenuOpen(false)}
            data-area={area.key}
            data-active={isActive ? "true" : undefined}
            aria-current={isActive && !activeItem ? "page" : undefined}
            className={cn(
              "relative flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors active:bg-muted/70",
              isActive
                ? "bg-solution/12 text-foreground before:absolute before:left-0 before:top-3 before:h-6 before:w-[3px] before:rounded-full before:bg-solution [&_svg]:text-solution"
                : "text-foreground hover:bg-muted",
            )}
          >
            <NavIcon id={area.icon} className="h-5 w-5 shrink-0" />
            <span className="truncate">{area.label}</span>
          </Link>
          {area.items.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleArea(area.key)}
              aria-expanded={isOpen}
              aria-label={isOpen ? `Recolher ${area.label}` : `Mostrar telas de ${area.label}`}
              className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:bg-muted/70"
            >
              <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform duration-150", isOpen ? "" : "-rotate-90")} />
            </button>
          ) : null}
        </div>
        {isOpen ? (
          <div className="mb-1 ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-border/70 pl-2" data-area-items={area.key}>
            {area.items.map((item) => renderItem(item, isActive && item.href === activeItem))}
          </div>
        ) : null}
      </div>
    );
  }

  const settings = areas.find((area) => area.key === "settings");
  const mainAreas = areas.filter((area) => area.key !== "settings");
  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-[52px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-[11px] font-medium leading-tight tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 max-[359px]:text-[10px]",
      active ? "text-foreground [&_svg]:text-solution" : "text-muted-foreground",
    );
  const pillClass = (active: boolean) => cn("flex h-[28px] w-[44px] items-center justify-center rounded-full transition-colors max-[359px]:w-[36px]", active ? "bg-solution/15" : "");

  return (
    <>
      <nav
        aria-label="Navegação rápida"
        data-testid="mobile-bottom-nav"
        className="mobile-chat-hide fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden"
      >
        <div className="mx-auto flex w-full max-w-lg items-stretch">
          {isLoading
            ? null
            : barAreas.map((area) => {
                const active = area.key === activeKey;
                return (
                  <Link key={area.key} href={`${base}${area.href}`} data-area={area.key} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                    <span aria-hidden="true" className={pillClass(active)}>
                      <NavIcon id={area.icon} className="h-5 w-5" />
                    </span>
                    <span className="max-w-full truncate">{area.label}</span>
                  </Link>
                );
              })}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-label={activeInMenuOnly ? `Menu — você está em ${areas.find((area) => area.key === activeKey)?.label}` : "Abrir o menu com todas as áreas"}
            data-active={activeInMenuOnly || menuOpen ? "true" : undefined}
            className={tabClass(activeInMenuOnly || menuOpen)}
          >
            <span aria-hidden="true" className={pillClass(activeInMenuOnly || menuOpen)}>
              <NavIcon id="menu" className="h-5 w-5" />
            </span>
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/45" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-menu-title"
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-4 pb-2 pt-3">
              <div className="min-w-0 flex-1">
                <p id="mobile-menu-title" className="text-base font-semibold text-foreground">Menu</p>
                <p className="truncate text-xs text-muted-foreground">{workspace.name}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar menu"
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 pb-[calc(env(safe-area-inset-bottom)+16px)]" data-testid="mobile-global-nav">
              {mainAreas.map(renderArea)}
              {settings ? <div className="mt-2 border-t border-border/70 pt-2">{renderArea(settings)}</div> : null}
              {canSeeBackstage ? (
                <div className="mt-2 border-t border-border/70 pt-2">
                  <button
                    type="button"
                    onClick={() => setBackstageOpen((current) => !current)}
                    aria-expanded={backstageOpen}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 transition-colors hover:bg-muted"
                  >
                    <span>Bastidor</span>
                    <ChevronRight aria-hidden="true" className={cn("h-4 w-4 transition-transform duration-150", backstageOpen ? "rotate-90" : "")} />
                  </button>
                  {backstageOpen ? <div className="mt-1 flex flex-col gap-0.5">{MARKETING_BACKSTAGE_NAV.map((item) => renderItem(item, pathname.startsWith(`${base}${item.href}`)))}</div> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
