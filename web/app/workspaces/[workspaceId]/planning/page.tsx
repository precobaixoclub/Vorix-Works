"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { usePlanningList } from "@/features/planning/hooks";
import { formatDateTime } from "@/lib/format";

/**
 * Lista de Planos deste Workspace — Sprint 09 (Fase 8). Só leitura: cada plano nasce sozinho ao
 * confirmar um Briefing (`ConfirmBriefing` → `PreparedCommand` → Planning Engine), nunca por ação
 * do usuário aqui. Sem nenhum botão de criação/execução — só visualização.
 */
export default function PlanningListPage() {
  const workspace = useCurrentWorkspace();
  const { data: plans, isLoading, error, mutate } = usePlanningList(workspace.id);

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Planejamento" description="Planos operacionais gerados automaticamente a partir de comandos confirmados — nada aqui é executado." />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !plans || plans.length === 0 ? (
        <EmptyState
          title="Nenhum plano ainda"
          description="Um plano nasce automaticamente quando um Briefing é confirmado no Chat."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Modelo</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Estratégia</th>
                <th className="px-4 py-3 font-medium">Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/workspaces/${workspace.id}/planning/${plan.id}`} className="hover:text-accent">
                      {plan.planningTemplate}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={plan.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{plan.plannerStrategy}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDateTime(plan.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
