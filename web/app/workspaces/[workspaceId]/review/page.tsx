"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRun, useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";
import { formatDateTime } from "@/lib/format";

const IN_PROGRESS_STATES: readonly ExecutionRunState[] = ["created", "validating", "ready", "running"];

const STATE_LABEL: Record<ExecutionRunState, string> = {
  created: "Criada",
  validating: "Validando",
  ready: "Pronta para rodar",
  running: "Gerando…",
  waiting_for_approval: "Aguardando aprovação",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

/**
 * Lista peças REALMENTE geradas (execuções com `mode: "real"`) — nunca ideias do tanque. Enquanto
 * nada foi gerado (ou nada com `mode: "real"` ainda rodou), mostra o estado vazio explicando o que
 * vai aparecer aqui. Ver `web/app/workspaces/[workspaceId]/production/page.tsx` (botão
 * "Gerar imagem real") para onde essas execuções nascem.
 */
export default function ReviewPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading } = useExecutionRuns(workspace.id);
  const realRuns = (runs ?? []).filter((run) => run.mode === "real").sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Revisão e aprovação"
        description="Peças já geradas a partir de uma rotina ou de um conteúdo avulso aparecem aqui para você conferir."
      />

      <ScreenGuide
        title="O que aparece aqui"
        description="Só imagem, carrossel ou vídeo realmente gerados — nunca uma ideia do tanque."
        items={[
          "Peças em geração aparecem com status \"Gerando…\", atualizado automaticamente.",
          "Peças prontas mostram a imagem final.",
          "Falhas mostram o motivo, sem sumir da lista.",
          "Para gerar uma peça nova, use \"Gerar imagem real\" numa ideia em Produção.",
        ]}
        aside={<p>Para abastecer o que vai gerar, use <Link href={`/workspaces/${workspace.id}/production`} className="font-medium text-accent hover:underline">Produção</Link>.</p>}
      />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : realRuns.length === 0 ? (
        <EmptyState
          title="Nada para revisar ainda"
          description="Nenhuma imagem, carrossel ou vídeo foi gerado ainda. Quando uma rotina ou um conteúdo avulso gerar uma peça final, ela aparece aqui para aprovação."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {realRuns.map((run) => (
            <RunCard key={run.id} workspaceId={workspace.id} run={run} />
          ))}
        </div>
      )}
    </main>
  );
}

function RunCard({ workspaceId, run }: { workspaceId: string; run: ExecutionRun }) {
  const inProgress = IN_PROGRESS_STATES.includes(run.state);
  const { data: detail } = useExecutionRun(workspaceId, run.id, { refreshInterval: inProgress ? 4000 : 0 });
  const images = (detail?.artifacts ?? []).flatMap((artifact) => {
    const payload = artifact.payload as { images?: Array<{ uri?: string; mimeType?: string }> } | undefined;
    return payload?.images?.filter((image): image is { uri: string; mimeType?: string } => Boolean(image.uri)) ?? [];
  });
  const failedAttempts = detail?.attempts.filter((attempt) => attempt.failure) ?? [];
  const failureMessage = failedAttempts[failedAttempts.length - 1]?.failure?.message;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">Execução {run.id.slice(0, 12)}</p>
          <p className="text-xs text-ink-muted">{formatDateTime(run.createdAt)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">{STATE_LABEL[run.state]}</span>
      </CardHeader>
      <CardBody>
        {run.state === "failed" ? (
          <p className="text-xs text-red-600">{failureMessage ?? "A geração falhou."}</p>
        ) : images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${image.uri}-${index}`} src={image.uri} alt="Peça gerada" className="aspect-square w-full rounded-lg border border-border object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            {inProgress ? <Spinner className="h-4 w-4" /> : null}
            {inProgress ? "Gerando peça…" : "Sem imagem neste artefato ainda."}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
