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

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-5">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center gap-3">
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
        {state.status === "authenticated" ? <span className="text-xs text-ink-muted">{state.user.name}</span> : null}
        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push("/login");
          }}
          className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
