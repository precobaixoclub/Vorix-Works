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
      <PageHeader title="Runtime" description="Bastidor técnico da linha de produção: mostra planos preparados pelo sistema antes da execução." />

      <ScreenGuide
        title="Tela de bastidor"
        description="Você não precisa usar esta tela no fluxo normal. Ela existe para conferir se a automação preparou tudo corretamente."
        items={[
          "Produção cria as regras.",
          "Planejamento transforma regras em plano.",
          "Runtime valida o plano antes de executar.",
          "Execuções mostra o teste ou processamento final.",
        ]}
        aside={<p>Se a lista estiver vazia, volte em Produção e crie uma linha ou aguarde a automação preparar o próximo lote.</p>}
      />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !runtimes || runtimes.length === 0 ? (
        <EmptyState title="Nenhum runtime ainda" description="Um runtime nasce automaticamente quando um plano de campanha fica pronto." />
      ) : (
        <div className="grid gap-3">
          {runtimes.map((runtime) => (
            <Card key={runtime.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2"><StatusBadge status={runtime.status} /></div>
                  <p className="break-words text-sm font-semibold text-ink">{runtime.translationTemplate}</p>
                  <p className="mt-1 text-sm text-ink-muted">{runtime.translatorStrategy}</p>
                  <p className="mt-1 text-xs text-ink-muted">Atualizado em {formatDateTime(runtime.updatedAt)} · Planejamento {runtime.sourceContext.planningId}</p>
                  <p className="mt-1 break-all text-[11px] text-ink-faint">Runtime {runtime.id}</p>
                </div>
                <Link href={`/workspaces/${workspace.id}/runtime/${runtime.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
                  Abrir runtime
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
