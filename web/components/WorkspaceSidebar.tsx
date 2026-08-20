"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";
import { BACKSTAGE_NAV, MAIN_NAV_SECTIONS, SETTINGS_NAV, canUseBackstage, type WorkspaceNavItem } from "@/components/workspace-navigation";

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

  function renderLink(item: WorkspaceNavItem) {
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
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm" aria-hidden="true">
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <nav className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-border bg-surface-raised p-3 md:flex">
      <Link href={base} className="mb-4 flex items-center px-2 py-1 text-ink" aria-label="Vorix">
        <Logo className="h-9 w-auto" />
      </Link>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {MAIN_NAV_SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{section.label}</p>
            {section.items.map(renderLink)}
          </div>
        ))}

        <div className="mt-1 border-t border-border/70 pt-3">{SETTINGS_NAV.map(renderLink)}</div>

        {canSeeBackstage ? (
          <div className="mt-1 border-t border-border/70 pt-3">
            <button
              type="button"
              onClick={() => setBackstageOpen((current) => !current)}
              aria-expanded={backstageOpen}
              className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink-muted"
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
