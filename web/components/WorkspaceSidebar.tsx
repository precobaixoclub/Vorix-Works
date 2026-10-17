"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { SolutionSwitcher } from "@/components/SolutionSwitcher";
import { NavIcon } from "@/components/NavIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { useSidebarState } from "@/contexts/sidebar-context";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV, SOLUTION_NAVIGATION, canUseBackstage, type WorkspaceNavItem } from "@/components/workspace-navigation";
import { useActiveSolution } from "@/features/solutions/hooks";

export function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const { collapsed, toggle } = useSidebarState();
  const base = `/workspaces/${workspaceId}`;
  // A navegação exibida é SÓ a da solução ativa (Conversas ou Marketing) — nunca as duas juntas.
  const { active, solutions } = useActiveSolution(pathname, base);
  const navigation = SOLUTION_NAVIGATION[active];
  const BACKSTAGE_NAV = navigation.backstage;
  const canSeeBackstage = state.status === "authenticated" && canUseBackstage(state.role) && BACKSTAGE_NAV.length > 0;
  const isBackstagePathActive = BACKSTAGE_NAV.some((item) => pathname.startsWith(`${base}${item.href}`));
  const [backstageOpen, setBackstageOpen] = useState(isBackstagePathActive);

  useEffect(() => {
    if (isBackstagePathActive) setBackstageOpen(true);
  }, [isBackstagePathActive]);

  function isItemActive(item: WorkspaceNavItem): boolean {
    const href = `${base}${item.href}`;
    // A home de cada solução só fica ativa nela mesma (`/meetings` é prefixo das outras telas do Meetings).
    return item.href === "" || item.href === navigation.home.href ? pathname === href : pathname.startsWith(href);
  }

  function renderLink(item: WorkspaceNavItem) {
    const isActive = isItemActive(item);
    const link = (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        aria-current={isActive ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "group relative flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          collapsed ? "justify-center px-0" : "px-2.5",
          isActive
            ? "bg-solution/10 text-foreground before:absolute before:left-0 before:top-1.5 before:h-5 before:w-[3px] before:rounded-full before:bg-solution [&_svg]:text-solution"
            : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <NavIcon id={item.icon} className="h-4 w-4 shrink-0" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );

    if (!collapsed) return link;
    return (
      <Tooltip key={item.href} delayDuration={200}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <nav
      className={cn(
        "app-shell sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/70 bg-surface-1 bg-gradient-to-b from-solution/[0.05] via-transparent to-transparent py-3 transition-[width] duration-200 ease-[var(--ease-standard)] md:flex",
        collapsed ? "w-16 px-2" : "w-[264px] px-3",
      )}
    >
      <SolutionSwitcher workspaceBase={base} active={active} solutions={solutions} collapsed={collapsed} />

      {navigation.primaryAction ? (
        collapsed ? (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Link
                href={`${base}${navigation.primaryAction.href}`}
                aria-label={navigation.primaryAction.label}
                className="mb-3 flex h-9 w-full items-center justify-center rounded-md bg-solution text-solution-foreground transition-[background-color,box-shadow] hover:bg-solution/90 hover:shadow-[var(--shadow-glow-solution)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              >
                <NavIcon id={navigation.primaryAction.icon} className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{navigation.primaryAction.label}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href={`${base}${navigation.primaryAction.href}`}
            className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-solution px-3 text-sm font-semibold text-solution-foreground transition-[background-color,box-shadow] hover:bg-solution/90 hover:shadow-[var(--shadow-glow-solution)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          >
            <NavIcon id={navigation.primaryAction.icon} className="h-4 w-4" />
            <span>{navigation.primaryAction.cta}</span>
          </Link>
        )
      ) : null}

      <div className={cn("flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden", !collapsed && "pr-1")}>
        <div className="flex flex-col gap-1">{renderLink(navigation.home)}</div>

        {navigation.sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            {!collapsed ? (
              <p className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-disabled">{section.label}</p>
            ) : null}
            {section.items.map(renderLink)}
          </div>
        ))}

        <div className="mt-1 border-t border-border/70 pt-3">{SETTINGS_NAV.map(renderLink)}</div>

        {canSeeBackstage ? (
          <div className="mt-1 border-t border-border pt-3">
            {!collapsed ? (
              <button
                type="button"
                onClick={() => setBackstageOpen((current) => !current)}
                aria-expanded={backstageOpen}
                className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <span>Bastidor</span>
                <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-150 ${backstageOpen ? "rotate-90" : ""}`} />
              </button>
            ) : null}
            {collapsed || backstageOpen ? <div className="mt-1 flex flex-col gap-1">{BACKSTAGE_NAV.map(renderLink)}</div> : null}
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
