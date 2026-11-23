"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RequirePlatformAdmin } from "@/components/RequirePlatformAdmin";
import { ADMIN_NAV_GROUPS, ADMIN_SETTINGS_HREF, activeAdminItem, isAdminSettingsPage } from "@/components/admin/admin-navigation";
import { useAuth } from "@/contexts/auth-context";

/**
 * Layout do painel administrativo — Sprint 25. Só monta o shell quando o usuário é
 * `isPlatformAdmin === true`. A sidebar tem só três destinos (`admin-navigation.ts`): Visão geral,
 * Clientes e Configurações; cada tela de configuração ganha o atalho "← Configurações".
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
  const router = useRouter();
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  const current = pathname ?? "";
  // Fase 11: categorias com acesso direto a cada tela (antes: 3 destinos + um hub de 8 telas).
  const activeHref = activeAdminItem(current);
  const navLinks = ADMIN_NAV_GROUPS.map((group, index) => (
    <div key={group.label} data-admin-group={group.label}>
      <p className={`px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted ${index ? "pt-3" : ""}`}>{group.label}</p>
      <div className="flex flex-col gap-0.5">{group.items.map((item) => <SidebarLink key={item.href} href={item.href} active={item.href === activeHref}>{item.label}</SidebarLink>)}</div>
    </div>
  ));

  return (
    <div className="flex min-h-dvh min-w-0 flex-col bg-surface-sunken text-ink md:flex-row">
      <div className="border-b border-border bg-surface-raised p-3 md:hidden">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">Ambiente interno</div>
            <div className="truncate text-sm font-semibold text-ink">Administração da Vorix</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/workspaces" className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken">
              Vorix
            </Link>
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.push("/login");
              }}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken"
            >
              Sair
            </button>
          </div>
        </div>
        <div className="mb-3 min-w-0 rounded-md bg-surface-sunken px-2.5 py-2 text-xs">
          <div className="truncate font-medium text-ink">{user?.name ?? "—"}</div>
          <div className="truncate text-ink-muted">{user?.email}</div>
        </div>
        <label htmlFor="admin-section" className="mb-1 block text-xs text-ink-muted">Seção da administração</label>
        <select
          id="admin-section"
          value={activeHref ?? ""}
          onChange={(event) => router.push(event.target.value)}
          className="h-11 w-full rounded-md border border-border bg-surface-raised px-2.5 text-sm text-ink"
        >
          {activeHref ? null : <option value="">Escolha uma seção</option>}
          {ADMIN_NAV_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}</optgroup>)}
        </select>
      </div>
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border bg-surface-raised p-4 md:block">
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted">Ambiente interno</div>
          <div className="text-base font-semibold text-ink">Administração da Vorix</div>
          <p className="mt-1 text-xs text-ink-muted">Dados de todos os clientes. Separado do ambiente do cliente.</p>
        </div>
        <nav aria-label="Admin" className="flex flex-col gap-1 text-sm">{navLinks}</nav>
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
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="w-full rounded-md border border-border px-2.5 py-1.5 text-center text-ink hover:bg-surface-sunken"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-hidden">
        {isAdminSettingsPage(current) ? <div className="mx-auto max-w-6xl px-3 pt-5 text-sm sm:px-6 sm:pt-8"><Link href={ADMIN_SETTINGS_HREF} className="text-primary hover:underline">← Configurações</Link></div> : null}
        {children}
      </main>
    </div>
  );
}

function SidebarLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 py-1.5 transition-colors ${
        active ? "bg-primary/10 font-medium text-primary" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
