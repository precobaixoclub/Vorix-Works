"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RequirePlatformAdmin } from "@/components/RequirePlatformAdmin";
import { useAuth } from "@/contexts/auth-context";

/**
 * Layout do painel administrativo — Sprint 25. Só monta o shell quando o usuário é
 * `isPlatformAdmin === true`. Sidebar mostra as duas seções principais (Dashboard geral e
 * Contas de clientes); os detalhes de tenant são páginas dinâmicas sob `/admin/tenants/[id]`.
 * O botão de "Voltar ao Vorix" é útil porque o admin também tem workspaces próprios.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequirePlatformAdmin>
      <AdminShell>{children}</AdminShell>
    </RequirePlatformAdmin>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname?.startsWith(href);
  };

  return (
    <div className="flex min-h-dvh bg-surface-sunken text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface-raised p-4 md:block">
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted">Painel</div>
          <div className="text-base font-semibold text-ink">Admin da Plataforma</div>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          <SidebarLink href="/admin" active={isActive("/admin") && pathname === "/admin"}>
            Visão geral
          </SidebarLink>
          <SidebarLink href="/admin/tenants" active={isActive("/admin/tenants")}>
            Contas de clientes
          </SidebarLink>
        </nav>
        <div className="mt-8 border-t border-border pt-4 text-xs text-ink-muted">
          <div className="mb-3">
            Logado como
            <div className="mt-0.5 font-medium text-ink">{user?.name ?? "—"}</div>
            <div className="truncate text-ink-muted">{user?.email}</div>
          </div>
          <Link href="/workspaces" className="mb-2 block rounded-md border border-border px-2.5 py-1.5 text-center text-ink hover:bg-surface-sunken">
            ← Voltar ao Vorix
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-md border border-border px-2.5 py-1.5 text-center text-ink hover:bg-surface-sunken"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}

function SidebarLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 transition-colors ${
        active ? "bg-accent/10 font-medium text-accent" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
