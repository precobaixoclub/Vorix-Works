"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, Hourglass, LockKeyhole } from "lucide-react";
import { Button } from "@/components/Button";
import { useAuth } from "@/contexts/auth-context";
import { useBillingOverview } from "@/features/billing/hooks";

const TRIAL_WARNING_DAYS = 3;

/**
 * Fim do teste gratuito: o produto inteiro fica atrás desta tela até haver uma forma de pagamento
 * (checkout do plano). Só "Plano e cobrança" continua acessível — é onde o cliente cadastra o
 * cartão. Os dados nunca são apagados. A API também bloqueia (read-only + IA), esta tela é a
 * comunicação, não a única defesa.
 */
export function TrialExpiredGate({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { state } = useAuth();
  const { data: billing } = useBillingOverview();
  const billingPath = `/workspaces/${workspaceId}/settings/plano`;
  if (billing?.status !== "trial_expired" || pathname.startsWith(billingPath)) return null;
  const canPay = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="trial-expired-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="vorix-backdrop w-full max-w-md rounded-2xl border border-border/80 p-6 text-center shadow-[var(--shadow-lg)]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-warning/30 bg-warning/10 text-warning">
          <LockKeyhole className="h-5 w-5" />
        </span>
        <h2 id="trial-expired-title" className="vorix-display mt-4 text-xl font-semibold text-foreground">Seu teste gratuito terminou</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Para continuar usando o Vorix, cadastre uma forma de pagamento e confirme o seu plano. Todos os seus dados, conversas e configurações continuam salvos.
        </p>
        {canPay ? (
          <Link href={billingPath} className="mt-5 block">
            <Button className="w-full"><CreditCard className="h-4 w-4" />Cadastrar forma de pagamento</Button>
          </Link>
        ) : (
          <p className="mt-5 rounded-lg border border-border/70 bg-surface-2 px-3 py-2 text-sm text-foreground">Peça ao administrador da conta para cadastrar a forma de pagamento.</p>
        )}
      </div>
    </div>
  );
}

/** Contagem regressiva do teste: aparece nos últimos dias, antes de bloquear. */
export function TrialCountdownBanner({ workspaceId }: { workspaceId: string }) {
  const { data: billing } = useBillingOverview();
  if (billing?.status !== "trial" || billing.trialDaysRemaining === null || billing.trialDaysRemaining > TRIAL_WARNING_DAYS) return null;
  const days = billing.trialDaysRemaining;
  const hasCard = Boolean(billing.paymentMethod);
  const when = days <= 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm sm:px-6">
      <span className="flex items-center gap-2 text-foreground">
        <Hourglass className="h-4 w-4 shrink-0 text-warning" />
        <span>
          <span className="font-medium">Seu teste gratuito termina {when}.</span>{" "}
          {hasCard ? "A cobrança do plano começa automaticamente no cartão cadastrado." : "Cadastre uma forma de pagamento para não perder o acesso."}
        </span>
      </span>
      {!hasCard ? (
        <Link href={`/workspaces/${workspaceId}/settings/plano`}>
          <Button size="sm">Cadastrar pagamento</Button>
        </Link>
      ) : null}
    </div>
  );
}
