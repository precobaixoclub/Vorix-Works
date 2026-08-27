"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
        className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors ${
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <NavIcon id={item.icon} className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <nav className="app-shell sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-border bg-card p-3 md:flex">
      <Link href={base} className="mb-4 flex items-center px-2 py-1 text-foreground" aria-label="Vorix">
        <Logo className="h-9 w-auto" />
      </Link>

      <Link
        href={`${base}${CREATE_NAV_ITEM.href}`}
        className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-none transition-colors hover:bg-primary/85"
      >
        <NavIcon id={CREATE_NAV_ITEM.icon} className="h-[18px] w-[18px]" />
        <span>{CREATE_NAV_ITEM.label}</span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-col gap-1">{renderLink(HOME_NAV_ITEM)}</div>

        {MAIN_NAV_SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{section.label}</p>
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
              className="flex h-9 w-full items-center justify-between rounded-md px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground"
            >
              <span>Bastidor</span>
              <span aria-hidden="true" className={`transition-transform ${backstageOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>
            {backstageOpen ? <div className="mt-1 flex flex-col gap-1">{BACKSTAGE_NAV.map(renderLink)}</div> : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
