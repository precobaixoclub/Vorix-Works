"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NotificationBell } from "@/components/NotificationBell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { buildRouteLabels } from "@/components/workspace-navigation";
import { useAuth } from "@/contexts/auth-context";
import { TenantSwitcher } from "@/features/auth/components/TenantSwitcher";
import { useTenantCredits } from "@/features/workspace/hooks";
import { useBillingOverview } from "@/features/billing/hooks";
import { useSolutions } from "@/features/solutions/hooks";
import { VorixAiIcon } from "@/components/vorix/ai";
import { StatusBadge } from "./StatusBadge";

/**
 * Topbar do Vorix Design System 2.0 — vidro discreto, só o necessário: contexto (workspace),
 * créditos de IA, aviso de teste, notificações e o menu do usuário (perfil, conta, tema, admin,
 * sair). Tudo que é de uso raro mora no menu do usuário — o mesmo em desktop e mobile, nunca
 * duplicado em duas variações. `hideBreadcrumb` mantém o "modo foco" (Conversas/Kanban).
 */
export function WorkspaceTopBar({ workspaceId, name, status, hideBreadcrumb }: { workspaceId: string; name: string; status: string; hideBreadcrumb?: boolean }) {
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;
  const { data: credits } = useTenantCredits();
  const { data: billing } = useBillingOverview();
  const { available: availableSolutions } = useSolutions();
  const base = `/workspaces/${workspaceId}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (user?.name ?? user?.email ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    router.push("/login");
  }

  return (
    <header className="vorix-glass sticky top-0 z-30 flex shrink-0 flex-col gap-1 border-b border-border/70 px-3 py-1.5 sm:px-5">
      <div className="flex min-h-10 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <WorkspaceSwitcher currentWorkspaceId={workspaceId} currentWorkspaceName={name} />
          {status !== "active" ? <StatusBadge status={status} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {billing?.status === "trial" || billing?.status === "trial_expired" ? (
            <Link
              href={`${base}/settings/plano`}
              title="Ver planos"
              className={
                billing.status === "trial_expired"
                  ? "hidden h-7 items-center rounded-full border border-destructive/35 bg-destructive/10 px-2.5 text-[11px] font-medium text-destructive hover:bg-destructive/15 sm:inline-flex"
                  : "hidden h-7 items-center rounded-full border border-warning/35 bg-warning/10 px-2.5 text-[11px] font-medium text-warning hover:bg-warning/15 sm:inline-flex"
              }
            >
              {billing.status === "trial_expired" ? "Teste terminou" : billing.trialDaysRemaining === 1 ? "Teste termina amanhã" : `Teste: ${billing.trialDaysRemaining ?? "—"} dias`}
            </Link>
          ) : null}
          {credits ? (
            <span
              className="hidden h-7 items-center gap-1.5 rounded-full border border-border/80 bg-surface-2/60 px-2.5 text-[11px] font-medium tabular-nums text-text-secondary md:inline-flex"
              title={`Cota mensal: ${credits.monthlyCreditsQuota} · Usado este mês: ${credits.creditsConsumedThisMonth} · Extras: ${credits.creditsExtra}`}
            >
              <VorixAiIcon className="h-3 w-3" />
              {credits.remainingCredits.toLocaleString("pt-BR")} créditos
            </span>
          ) : null}
          <NotificationBell workspaceId={workspaceId} />
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={user ? `Menu do usuário: ${user.name}` : "Menu do usuário"}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface-2 text-[11px] font-semibold text-foreground transition-colors hover:border-solution/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              >
                {initials || "?"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              {user ? (
                <div className="border-b border-border/70 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              ) : null}
              <div className="space-y-1 p-2">
                {credits ? (
                  <p className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-text-secondary md:hidden">
                    <VorixAiIcon className="h-3 w-3" />
                    {credits.remainingCredits.toLocaleString("pt-BR")} créditos de IA
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="text-xs text-muted-foreground">Conta</span>
                  <TenantSwitcher />
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="text-xs text-muted-foreground">Tema</span>
                  <ThemeToggle />
                </div>
                <Link href={`${base}/settings`} onClick={() => setMenuOpen(false)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground hover:bg-surface-2">
                  <Settings className="h-4 w-4 text-muted-foreground" /> Configurações
                </Link>
                {isPlatformAdmin ? (
                  <Link href="/admin" onClick={() => setMenuOpen(false)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground hover:bg-surface-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Administração da plataforma
                  </Link>
                ) : null}
              </div>
              <div className="border-t border-border/70 p-2">
                <button type="button" onClick={handleLogout} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground hover:bg-surface-2">
                  <LogOut className="h-4 w-4 text-muted-foreground" /> Sair
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {hideBreadcrumb ? null : <Breadcrumbs homeHref={base} routeLabels={buildRouteLabels(base, availableSolutions)} />}
    </header>
  );
}
