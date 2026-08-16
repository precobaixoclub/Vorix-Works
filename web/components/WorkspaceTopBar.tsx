"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { TenantSwitcher } from "@/features/auth/components/TenantSwitcher";
import { StatusBadge } from "./StatusBadge";

export function WorkspaceTopBar({ name, status }: { name: string; status: string }) {
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;

  return (
    <header className="flex min-h-14 shrink-0 flex-col items-stretch gap-2 border-b border-border bg-surface-raised px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-center justify-between gap-2.5 sm:justify-start">
        <span className="truncate text-sm font-semibold text-ink">{name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
        <TenantSwitcher />
        {isPlatformAdmin ? (
          <Link
            href="/admin"
            className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"
            title="Painel administrativo da plataforma"
          >
            Admin
          </Link>
        ) : null}
        {user ? (
          <div className="min-w-0 text-xs leading-tight text-ink-muted sm:max-w-56">
            <div className="truncate font-medium text-ink">{user.name}</div>
            <div className="truncate">{user.email}</div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push("/login");
          }}
          className="min-h-9 cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
