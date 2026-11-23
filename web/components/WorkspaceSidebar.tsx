"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { NavIcon } from "@/components/NavIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarState } from "@/contexts/sidebar-context";
import { cn } from "@/lib/utils";
import { MARKETING_BACKSTAGE_NAV, type WorkspaceNavItem } from "@/components/workspace-navigation";
import type { GlobalArea } from "@/components/global-navigation";
import { useGlobalNavigation } from "@/components/use-global-navigation";

/**
 * Menu principal permanente do workspace (Reorganização de UX — Fase 1): todas as áreas da conta
 * (Início, Conversas, Vendas, Marketing, Meu site, Reuniões, Resultados, Configurações) ficam
 * visíveis o tempo todo; trocar de ferramenta é um clique. A área ativa abre as próprias telas
 * logo abaixo dela. Todos os links levam o workspace atual na URL — nunca outro workspace.
 */
export function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
  const { collapsed, toggle } = useSidebarState();
  // Mesmo estado do menu do celular (BottomNav): áreas, permissões e área ativa nunca divergem.
  const { pathname, base, areas, activeKey, activeItem, isLoading, canSeeBackstage, isBackstageActive, expanded, toggleArea } = useGlobalNavigation(workspaceId);
  const [backstageOpen, setBackstageOpen] = useState(isBackstageActive);

  useEffect(() => {
    if (isBackstageActive) setBackstageOpen(true);
  }, [isBackstageActive]);

  function withTooltip(label: string, node: React.ReactElement, key: string) {
    if (!collapsed) return node;
    return (
      <Tooltip key={key} delayDuration={200}>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  function renderArea(area: GlobalArea) {
    const isActive = area.key === activeKey;
    const isOpen = !collapsed && area.items.length > 0 && expanded.has(area.key);
    const link = (
      <Link
        href={`${base}${area.href}`}
        aria-current={isActive && !activeItem ? "page" : undefined}
        aria-label={collapsed ? area.label : undefined}
        data-area={area.key}
        data-active={isActive ? "true" : undefined}
        className={cn(
          "group relative flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md text-[13.5px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          collapsed ? "justify-center px-0" : "px-2.5",
          isActive
            ? "bg-solution/12 text-foreground before:absolute before:left-0 before:top-2 before:h-5 before:w-[3px] before:rounded-full before:bg-solution [&_svg]:text-solution"
            : "text-text-secondary hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <NavIcon id={area.icon} className="h-[18px] w-[18px] shrink-0" />
        {!collapsed ? <span className="truncate">{area.label}</span> : null}
      </Link>
    );
    return (
      <div key={area.key} className="flex flex-col">
        <div className="flex items-center gap-1">
          {withTooltip(area.label, link, area.key)}
          {!collapsed && area.items.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleArea(area.key)}
              aria-expanded={isOpen}
              aria-label={isOpen ? `Recolher ${area.label}` : `Mostrar telas de ${area.label}`}
              className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform duration-150", isOpen ? "" : "-rotate-90")} />
            </button>
          ) : null}
        </div>
        {isOpen ? (
          <div className="mb-1 ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-border/70 pl-2" data-area-items={area.key}>
            {area.items.map((item, index) => (
              <Fragment key={item.href}>
                {item.section && item.section !== area.items[index - 1]?.section ? <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70" data-section={item.section}>{item.section}</p> : null}
                {renderItem(item, item.href === activeItem && isActive)}
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderItem(item: WorkspaceNavItem, isActive: boolean) {
    return (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        aria-current={isActive ? "page" : undefined}
        // Menu recolhido (ex.: modo foco do editor do site): só o ícone, com o nome no rótulo e no tooltip.
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "flex h-8 min-w-0 items-center gap-2 rounded-md text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          collapsed ? "justify-center px-0" : "px-2",
          isActive ? "bg-solution/10 text-foreground [&_svg]:text-solution" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <NavIcon id={item.icon} className="h-4 w-4 shrink-0" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  const settings = areas.find((area) => area.key === "settings");
  const mainAreas = areas.filter((area) => area.key !== "settings");

  return (
    <nav
      aria-label="Menu principal"
      className={cn(
        "app-shell sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/70 bg-surface-1 bg-gradient-to-b from-solution/[0.05] via-transparent to-transparent py-3 transition-[width] duration-200 ease-[var(--ease-standard)] md:flex",
        collapsed ? "w-16 px-2" : "w-[248px] px-3",
      )}
    >
      <Link href={base} className={cn("mb-4 flex items-center gap-2 rounded-lg py-1.5", collapsed ? "justify-center px-0" : "px-2")} aria-label="Vorix — início do espaço de trabalho">
        <Logo className="h-8 w-auto shrink-0" />
        {!collapsed ? <span className="text-sm font-semibold tracking-wide text-foreground">Vorix</span> : null}
      </Link>

      <div className={cn("flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden", !collapsed && "pr-1")} data-testid="global-nav">
        {isLoading ? <p className="px-2.5 text-xs text-muted-foreground">Carregando menu…</p> : mainAreas.map(renderArea)}

        {settings ? <div className="mt-2 border-t border-border/70 pt-2">{renderArea(settings)}</div> : null}

        {canSeeBackstage ? (
          <div className="mt-1 border-t border-border pt-3">
            {!collapsed ? (
              <button
                type="button"
                onClick={() => setBackstageOpen((current) => !current)}
                aria-expanded={backstageOpen}
                className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <span>Operação técnica</span>
                <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-150 ${backstageOpen ? "rotate-90" : ""}`} />
              </button>
            ) : null}
            {collapsed || backstageOpen ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {MARKETING_BACKSTAGE_NAV.map((item) => withTooltip(item.label, renderItem(item, pathname.startsWith(`${base}${item.href}`)), item.href))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={cn("mt-2 border-t border-border/70 pt-2", collapsed ? "flex justify-center" : "flex justify-end")}>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expandir menu" : "Recolher menu"}</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}
