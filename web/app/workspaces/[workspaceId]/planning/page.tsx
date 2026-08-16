"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
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
      <PageHeader title="Planejamento" description="Planos criados automaticamente a partir das regras da linha de produção." />

      <ScreenGuide
        title="Tela de acompanhamento"
        description="Aqui você vê o que o sistema planejou. Para configurar o que deve ser criado, use Produção."
        items={[
          "Cada linha representa um plano gerado.",
          "Status pronto indica que pode seguir para runtime.",
          "Abra um plano para conferir detalhes.",
          "Se não houver plano, crie ou ajuste uma linha em Produção.",
        ]}
        aside={<p>Esta tela não cria conteúdo manualmente; ela mostra o resultado da automação.</p>}
      />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !plans || plans.length === 0 ? (
        <EmptyState
          title="Nenhum plano ainda"
          description="Um plano nasce automaticamente quando a linha de produção prepara um lote de conteúdo."
        />
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2"><StatusBadge status={plan.status} /></div>
                  <p className="break-words text-sm font-semibold text-ink">{plan.planningTemplate}</p>
                  <p className="mt-1 text-sm text-ink-muted">{plan.plannerStrategy}</p>
                  <p className="mt-1 text-xs text-ink-muted">Atualizado em {formatDateTime(plan.updatedAt)}</p>
                </div>
                <Link href={`/workspaces/${workspace.id}/planning/${plan.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
                  Abrir plano
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
