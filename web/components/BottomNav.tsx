"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "@/components/NavIcon";
import { useAuth } from "@/contexts/auth-context";
import { BACKSTAGE_NAV, MOBILE_MENU_NAV, PRIMARY_MOBILE_NAV, canUseBackstage, type WorkspaceNavItem } from "@/components/workspace-navigation";

export function BottomNav({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const canSeeBackstage = state.status === "authenticated" && canUseBackstage(state.role);
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

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  function isActive(href: string): boolean {
    const target = `${base}${href}`;
    return href === "" ? pathname === base : pathname.startsWith(target);
  }

  function renderSheetLink(item: WorkspaceNavItem) {
    return (
      <Link
        key={item.href}
        href={`${base}${item.href}`}
        onClick={() => setMenuOpen(false)}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors active:bg-muted/70 ${
          isActive(item.href) ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
        }`}
      >
        <NavIcon id={item.icon} className="h-[18px] w-[18px] shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur md:hidden">
        {PRIMARY_MOBILE_NAV.map((item) =>
          item.href === "/create" ? (
            <Link key={item.href} href={`${base}${item.href}`} className="flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary">
              <span aria-hidden="true" className="-mt-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-colors active:bg-primary/85">
                <NavIcon id={item.icon} className="h-5 w-5" />
              </span>
              <span>{item.label}</span>
            </Link>
          ) : (
            <Link
              key={item.href}
              href={`${base}${item.href}`}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium transition-colors ${
                isActive(item.href) ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <NavIcon id={item.icon} className="h-[18px] w-[18px]" />
              <span>{item.label}</span>
            </Link>
          ),
        )}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium text-muted-foreground transition-colors"
        >
          <NavIcon id="menu" className="h-[18px] w-[18px]" />
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <div role="menu" className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="flex flex-col gap-1">
              {MOBILE_MENU_NAV.map(renderSheetLink)}
              {canSeeBackstage ? (
                <>
                  <div className="my-2 border-t border-border" />
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Bastidor</p>
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
