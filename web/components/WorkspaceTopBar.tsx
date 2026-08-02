"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { TenantSwitcher } from "@/features/auth/components/TenantSwitcher";
import { StatusBadge } from "./StatusBadge";

export function WorkspaceTopBar({ name, status }: { name: string; status: string }) {
  const router = useRouter();
  const { state, logout } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-5">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center gap-3">
        <TenantSwitcher />
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
