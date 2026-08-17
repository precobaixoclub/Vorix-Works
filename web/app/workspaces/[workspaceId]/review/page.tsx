"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { decideExecutionGate } from "@/features/execution/api";
import { useExecutionRun, useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";

// Só o que já está pronto pra revisar entra aqui — nunca falha, nunca "gerando". Enquanto uma
// peça não chega num desses dois estados, ela simplesmente não aparece: uma falha volta pro
// usuário direto na tela de Produção (ver production/page.tsx, `handleGenerateRealImage`), nunca
// como um card quebrado aqui.
const READY_STATES: readonly ExecutionRunState[] = ["completed", "waiting_for_approval"];

/**
 * Revisão — só o resultado pronto (imagem/carrossel) para aprovar ou rejeitar. Nenhuma execução em
 * andamento ou com falha aparece nesta tela (ver `production/page.tsx`, que já resolve
 * sucesso/falha na hora do clique, sem deixar nada "pendente" chegar aqui pela metade).
 */
export default function ReviewPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading, mutate } = useExecutionRuns(workspace.id);
  const readyRuns = (runs ?? [])
    .filter((run) => run.mode === "real" && READY_STATES.includes(run.state))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Revisão" description="Peças geradas prontas para você aprovar." />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : readyRuns.length === 0 ? (
        <EmptyState title="Nada para revisar ainda" description="Quando uma peça terminar de ser gerada em Produção, ela aparece aqui." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {readyRuns.map((run) => (
            <RunCard key={run.id} workspaceId={workspace.id} run={run} onDecided={() => mutate()} />
          ))}
        </div>
      )}
    </main>
  );
}

function RunCard({ workspaceId, run, onDecided }: { workspaceId: string; run: ExecutionRun; onDecided: () => void }) {
  const { data: detail, mutate: mutateDetail } = useExecutionRun(workspaceId, run.id);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const images = (detail?.artifacts ?? []).flatMap((artifact) => {
    const payload = artifact.payload as { images?: Array<{ uri?: string }> } | undefined;
    return payload?.images?.filter((image): image is { uri: string } => Boolean(image.uri)) ?? [];
  });
  const openGate = detail?.gates.find((gate) => gate.state === "open");

  async function decide(decision: "approved" | "rejected") {
    if (!openGate) return;
    setDeciding(true);
    setError(null);
    try {
      await decideExecutionGate({ workspaceId, runId: run.id, gateId: openGate.id, decision });
      await mutateDetail();
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a decisão.");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${image.uri}-${index}`} src={image.uri} alt="Peça gerada" className="aspect-square w-full rounded-lg border border-border object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-xs text-ink-muted">Sem imagem</div>
        )}

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        {run.state === "waiting_for_approval" ? (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={deciding || !openGate} onClick={() => decide("approved")}>
              {deciding ? "Enviando…" : "Aprovar"}
            </Button>
            <Button variant="secondary" className="flex-1" disabled={deciding || !openGate} onClick={() => decide("rejected")}>
              Rejeitar
            </Button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Aprovada
          </span>
        )}
      </CardBody>
    </Card>
  );
}
