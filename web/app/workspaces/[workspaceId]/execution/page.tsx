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
import { useExecutionRuns } from "@/features/execution/hooks";
import { formatDateTime } from "@/lib/format";

export default function ExecutionRunsPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading, error, mutate } = useExecutionRuns(workspace.id);

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Execuções" description="Histórico de testes e processamentos feitos pela linha de produção." />
      <ScreenGuide
        title="Como usar"
        description="Esta tela ajuda a entender se a automação executou como esperado antes de publicar de verdade."
        items={[
          "Abra uma execução para ver os passos.",
          "Confira o estado antes de usar conteúdo gerado.",
          "Use Simulação para validar sem publicar.",
          "Falhas aqui indicam ajuste necessário na produção ou nas conexões.",
        ]}
        aside={<p>No uso diário, você normalmente acompanha o resultado final em Postagens Publicadas.</p>}
      />
      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !runs || runs.length === 0 ? (
        <EmptyState title="Nenhuma simulação ainda" description="Crie uma simulação a partir da tela de detalhe de um Runtime validado." />
      ) : (
        <div className="grid gap-3">
          {runs.map((run) => (
            <Card key={run.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={run.state} />
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{run.mode === "real" ? "Real" : "Simulação"}</span>
                  </div>
                  <p className="text-sm font-semibold text-ink">{run.mode === "real" ? "Execução real" : "Simulação"} da linha de produção</p>
                  <p className="mt-1 text-xs text-ink-muted">Criado em {formatDateTime(run.createdAt)} · Runtime {run.runtimePlanId}</p>
                  <p className="mt-1 break-all text-[11px] text-ink-faint">Execução {run.id}</p>
                </div>
                <Link href={`/workspaces/${workspace.id}/execution/${run.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
                  Abrir execução
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
