"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/Button";
import { useBillingOverview } from "@/features/billing/hooks";

/**
 * Aquisição self-service (seção 39-42 do pedido) — quando a assinatura entra em modo somente-
 * leitura (trial vencido, pagamento pendente ou suspensão), o produto continua visível e os dados
 * continuam salvos (nunca apagados) — mas a pessoa precisa SABER disso em qualquer tela, não só
 * quando entra em Plano e cobrança. Faixa persistente no topo do shell do workspace, não uma tela
 * bloqueante — ver `read-only-guard.ts` no backend pra onde as ações que geram uso/custo são de
 * fato bloqueadas (aqui é só a comunicação, nunca a única linha de defesa).
 */
export function WorkspaceReadOnlyBanner({ workspaceId }: { workspaceId: string }) {
  const { data: billing } = useBillingOverview();
  if (!billing?.readOnly) return null;

  const { title, description } = copyFor(billing.status);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-sm sm:px-6">
      <div className="flex items-center gap-2 text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <span>
          <span className="font-medium">{title}</span> {description}
        </span>
      </div>
      <Link href={`/workspaces/${workspaceId}/settings/plano`}>
        <Button size="sm">Ativar plano</Button>
      </Link>
    </div>
  );
}

function copyFor(status: string | null): { title: string; description: string } {
  if (status === "past_due") {
    return { title: "Não conseguimos confirmar seu pagamento.", description: "Seus dados continuam salvos. Atualize a forma de pagamento para continuar usando o Vorix." };
  }
  if (status === "suspended") {
    return { title: "Sua conta está suspensa.", description: "Seus dados continuam salvos. Regularize seu plano para continuar usando o Vorix." };
  }
  return { title: "Seu período de teste terminou.", description: "Seus dados continuam salvos. Escolha um plano para continuar usando o Vorix." };
}
