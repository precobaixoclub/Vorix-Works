"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { buildRouteLabels } from "@/components/workspace-navigation";
import { useAuth } from "@/contexts/auth-context";
import { TenantSwitcher } from "@/features/auth/components/TenantSwitcher";
import { useTenantCredits } from "@/features/workspace/hooks";
import { StatusBadge } from "./StatusBadge";

export function WorkspaceTopBar({ workspaceId, name, status }: { workspaceId: string; name: string; status: string }) {
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;
  const { data: credits } = useTenantCredits();
  const base = `/workspaces/${workspaceId}`;

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-3 py-2 sm:px-5">
      <div className="flex min-h-9 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-2.5 sm:justify-start">
          <WorkspaceSwitcher currentWorkspaceId={workspaceId} currentWorkspaceName={name} />
          <StatusBadge status={status} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
          <ThemeToggle />
          <NotificationBell workspaceId={workspaceId} />
          {credits ? (
            <span
              className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              title={`Cota mensal: ${credits.monthlyCreditsQuota} · Usado este mês: ${credits.creditsConsumedThisMonth} · Extras: ${credits.creditsExtra}`}
            >
              {credits.remainingCredits.toLocaleString("pt-BR")} créditos
            </span>
          ) : null}
          <TenantSwitcher />
          {isPlatformAdmin ? (
            <Link
              href="/admin"
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              title="Painel administrativo da plataforma"
            >
              Admin
            </Link>
          ) : null}
          {user ? (
            <div className="min-w-0 text-xs leading-tight text-muted-foreground sm:max-w-56">
              <div className="truncate font-medium text-foreground">{user.name}</div>
              <div className="truncate">{user.email}</div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="h-9 cursor-pointer rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Sair
          </button>
        </div>
      </div>
      <Breadcrumbs homeHref={base} routeLabels={buildRouteLabels(base)} />
    </header>
  );
}
