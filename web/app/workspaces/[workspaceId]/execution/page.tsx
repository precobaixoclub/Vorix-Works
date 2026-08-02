"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRuns } from "@/features/execution/hooks";
import { formatDateTime } from "@/lib/format";

export default function ExecutionRunsPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading, error, mutate } = useExecutionRuns(workspace.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader title="Execuções" description="Simulações determinísticas criadas a partir de RuntimePlans validados." />
      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !runs || runs.length === 0 ? (
        <EmptyState title="Nenhuma simulação ainda" description="Crie uma simulação a partir da tela de detalhe de um Runtime validado." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Execução</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Modo</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/workspaces/${workspace.id}/execution/${run.id}`} className="hover:text-accent">
                      {run.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.state} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{run.mode === "real" ? "Real" : "Simulação"}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{formatDateTime(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
