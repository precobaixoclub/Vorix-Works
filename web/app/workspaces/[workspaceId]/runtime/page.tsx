"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useRuntimeList } from "@/features/runtime/hooks";
import { formatDateTime } from "@/lib/format";

/**
 * Lista de Runtimes deste Workspace — Sprint 10 (Fase 7). Só leitura: cada RuntimePlan nasce
 * sozinho quando um Planning fica "ready", nunca por ação do usuário aqui. Sem nenhum botão de
 * criação/execução — só visualização.
 */
export default function RuntimeListPage() {
  const workspace = useCurrentWorkspace();
  const { data: runtimes, isLoading, error, mutate } = useRuntimeList(workspace.id);

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Runtime" description="Planos traduzidos e validados a partir de Plannings prontos — nada aqui é executado." />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !runtimes || runtimes.length === 0 ? (
        <EmptyState title="Nenhum runtime ainda" description="Um runtime nasce automaticamente quando um plano de campanha fica pronto." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Template de tradução</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Estratégia</th>
                <th className="px-4 py-3 font-medium">Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {runtimes.map((runtime) => (
                <tr key={runtime.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/workspaces/${workspace.id}/runtime/${runtime.id}`} className="hover:text-accent">
                      {runtime.translationTemplate}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={runtime.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{runtime.translatorStrategy}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDateTime(runtime.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
