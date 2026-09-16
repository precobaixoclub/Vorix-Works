"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NotificationBell } from "@/components/NotificationBell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { buildRouteLabels } from "@/components/workspace-navigation";
import { useAuth } from "@/contexts/auth-context";
import { TenantSwitcher } from "@/features/auth/components/TenantSwitcher";
import { useTenantCredits } from "@/features/workspace/hooks";
import type { TenantCreditsSummary } from "@/features/workspace/types";
import { useBillingOverview } from "@/features/billing/hooks";
import type { BillingOverview } from "@/features/billing/types";
import { StatusBadge } from "./StatusBadge";

type TopBarUser = { name: string; email: string };

/**
 * Otimização de espaço vertical (pedido explícito do usuário, com captura de tela mostrando a
 * topbar + breadcrumb + cabeçalho da tela de Conversas ocupando espaço demais, sem responsividade
 * no celular). Duas mudanças: (1) `hideBreadcrumb` — telas em "modo foco" (ex.: Conversas, que já
 * repete o próprio nome no cabeçalho da tela) podem pedir pra não duplicar "Início > Conversas"
 * bem acima de um título "Conversas"; (2) no mobile, itens de uso raro (tema, teste/plano,
 * trocar conta, admin, nome/e-mail) saem da linha principal — que antes quebrava em 2-3 linhas
 * por `flex-wrap` — e vão para um menu "mais" (Popover), mantendo só troca de workspace, sino de
 * notificações e Sair sempre visíveis. Nada disso muda o desktop (`sm:` pra cima continua tudo
 * inline, só um pouco mais compacto).
 */
export function WorkspaceTopBar({ workspaceId, name, status, hideBreadcrumb }: { workspaceId: string; name: string; status: string; hideBreadcrumb?: boolean }) {
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;
  const { data: credits } = useTenantCredits();
  const { data: billing } = useBillingOverview();
  const base = `/workspaces/${workspaceId}`;
  const [moreOpen, setMoreOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-card px-3 py-1.5 sm:px-5 sm:py-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <WorkspaceSwitcher currentWorkspaceId={workspaceId} currentWorkspaceName={name} />
          <StatusBadge status={status} />
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Desktop: tudo inline (só um pouco mais compacto que antes). */}
          <div className="hidden items-center gap-2 sm:flex sm:gap-3">
            <TopBarExtras base={base} credits={credits} billing={billing} isPlatformAdmin={isPlatformAdmin} user={user} variant="inline" />
          </div>
          <NotificationBell workspaceId={workspaceId} />
          {/* Mobile: itens de uso raro colapsam num menu "mais" — sem isso a linha quebrava em
             2-3 linhas (até 8 itens com flex-wrap), inflando a topbar bem além do necessário. */}
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Mais opções"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2 sm:hidden">
              <TopBarExtras
                base={base}
                credits={credits}
                billing={billing}
                isPlatformAdmin={isPlatformAdmin}
                user={user}
                variant="menu"
                onNavigate={() => setMoreOpen(false)}
                onLogout={async () => {
                  setMoreOpen(false);
                  await handleLogout();
                }}
              />
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={handleLogout}
            className="hidden h-8 shrink-0 cursor-pointer rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex sm:items-center"
          >
            Sair
          </button>
        </div>
      </div>
      {hideBreadcrumb ? null : <Breadcrumbs homeHref={base} routeLabels={buildRouteLabels(base)} />}
    </header>
  );
}

/** Conteúdo compartilhado entre a linha inline (desktop) e o menu "mais" (mobile) — uma única
 * fonte pros itens em si, só o container em volta muda (mesmo racional de nunca duplicar lógica
 * entre variações visuais, ver `web/CLAUDE.md`). */
function TopBarExtras({
  base,
  credits,
  billing,
  isPlatformAdmin,
  user,
  variant,
  onNavigate,
  onLogout,
}: {
  base: string;
  credits: TenantCreditsSummary | null | undefined;
  billing: BillingOverview | undefined;
  isPlatformAdmin: boolean;
  user: TopBarUser | null;
  variant: "inline" | "menu";
  onNavigate?: () => void;
  onLogout?: () => void;
}) {
  const isMenu = variant === "menu";
  const badgeClass = isMenu ? "block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium" : "rounded-md border px-2.5 py-1 text-xs font-medium";

  return (
    <>
      {credits ? (
        <span
          className={isMenu ? `${badgeClass} text-muted-foreground` : `${badgeClass} border-border bg-muted text-muted-foreground`}
          title={`Cota mensal: ${credits.monthlyCreditsQuota} · Usado este mês: ${credits.creditsConsumedThisMonth} · Extras: ${credits.creditsExtra}`}
        >
          {credits.remainingCredits.toLocaleString("pt-BR")} créditos
        </span>
      ) : null}
      {billing?.status === "trial" || billing?.status === "trial_expired" ? (
        <Link
          href={`${base}/settings/plano`}
          onClick={onNavigate}
          className={
            billing.status === "trial_expired"
              ? `${badgeClass} ${isMenu ? "text-destructive hover:bg-destructive/10" : "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"}`
              : `${badgeClass} ${isMenu ? "text-warning hover:bg-warning/10" : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"}`
          }
          title="Ver planos"
        >
          {billing.status === "trial_expired" ? "Teste terminou" : billing.trialDaysRemaining === 1 ? "Teste termina amanhã" : `Teste: ${billing.trialDaysRemaining ?? "—"} dias`}
        </Link>
      ) : null}
      {isPlatformAdmin ? (
        <Link
          href="/admin"
          onClick={onNavigate}
          className={isMenu ? `${badgeClass} text-primary hover:bg-primary/10` : `${badgeClass} border-primary/40 bg-primary/10 text-primary hover:bg-primary/20`}
          title="Painel administrativo da plataforma"
        >
          Admin
        </Link>
      ) : null}
      <div className={isMenu ? "flex items-center justify-between gap-2 px-2 py-1.5" : "flex items-center gap-2"}>
        <TenantSwitcher />
        <ThemeToggle />
      </div>
      {user ? (
        <div className={isMenu ? "min-w-0 border-t border-border px-2 pt-1.5 text-xs leading-tight text-muted-foreground" : "min-w-0 text-xs leading-tight text-muted-foreground sm:max-w-56"}>
          <div className="truncate font-medium text-foreground">{user.name}</div>
          <div className="truncate">{user.email}</div>
        </div>
      ) : null}
      {isMenu ? (
        <button
          type="button"
          onClick={onLogout}
          className="mt-1.5 block w-full rounded-md border border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Sair
        </button>
      ) : null}
    </>
  );
}
