"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { NavIcon } from "@/components/NavIcon";
import { useAuth } from "@/contexts/auth-context";
import {
  BACKSTAGE_NAV,
  CREATE_NAV_ITEM,
  HOME_NAV_ITEM,
  MAIN_NAV_SECTIONS,
  SETTINGS_NAV,
  canUseBackstage,
  type WorkspaceNavItem,
} from "@/components/workspace-navigation";

export function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const base = `/workspaces/${workspaceId}`;
  const canSeeBackstage = state.status === "authenticated" && canUseBackstage(state.role);
  const isBackstagePathActive = BACKSTAGE_NAV.some((item) => pathname.startsWith(`${base}${item.href}`));
  const [backstageOpen, setBackstageOpen] = useState(isBackstagePathActive);

  useEffect(() => {
    if (isBackstagePathActive) setBackstageOpen(true);
  }, [isBackstagePathActive]);

  function isItemActive(item: WorkspaceNavItem): boolean {
    const href = `${base}${item.href}`;
    return item.href === "" ? pathname === base : pathname.startsWith(href);
  }

  function renderLink(item: WorkspaceNavItem) {
    const isActive = isItemActive(item);
    return (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        aria-current={isActive ? "page" : undefined}
        className={`group flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 active:bg-muted/70 ${
          isActive
            ? "bg-primary/10 text-primary ring-1 ring-primary/15 dark:text-primary-glow dark:ring-primary-glow/20"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        }`}
      >
        <NavIcon id={item.icon} className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <nav className="app-shell sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-card/95 px-3 py-3 md:flex">
      <Link href={base} className="mb-3 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-foreground" aria-label="Vorix">
        <Logo className="h-8 w-auto shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">AI Command</p>
          <p className="truncate text-xs text-muted-foreground/80">Center</p>
        </div>
      </Link>

      <Link
        href={`${base}${CREATE_NAV_ITEM.href}`}
        className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-none transition-colors hover:bg-primary/85 active:bg-primary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:bg-primary-glow dark:text-background dark:hover:bg-primary-glow/90"
      >
        <NavIcon id={CREATE_NAV_ITEM.icon} className="h-4 w-4" />
        <span>Novo conteúdo</span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">{renderLink(HOME_NAV_ITEM)}</div>

        {MAIN_NAV_SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">{section.label}</p>
            {section.items.map(renderLink)}
          </div>
        ))}

        <div className="mt-1 border-t border-border pt-3">{SETTINGS_NAV.map(renderLink)}</div>

        {canSeeBackstage ? (
          <div className="mt-1 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setBackstageOpen((current) => !current)}
              aria-expanded={backstageOpen}
              className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <span>Bastidor</span>
              <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-150 ${backstageOpen ? "rotate-90" : ""}`} />
            </button>
            {backstageOpen ? <div className="mt-1 flex flex-col gap-1">{BACKSTAGE_NAV.map(renderLink)}</div> : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
