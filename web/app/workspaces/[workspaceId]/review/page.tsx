"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Textarea } from "@/components/Field";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { decideExecutionGate } from "@/features/execution/api";
import { useExecutionRun, useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";
import { generateFromIdea, rejectExecutionWithFeedback, REJECTION_REASONS, REJECTION_REASON_LABELS, type RejectionReason } from "@/features/production-line/api";
import { getGenerationRecord, recordGeneration, type GenerationRecord } from "@/features/production-line/generation-log";
import { readProductionConfig, writeProductionConfig } from "@/features/production-line/storage";

// Só o que já está pronto pra revisar entra aqui — nunca falha, nunca "gerando". Enquanto uma
// peça não chega num desses dois estados, ela simplesmente não aparece: uma falha volta pro
// usuário direto na tela de Produção (ver production/page.tsx, `handleGenerateRealImage`), nunca
// como um card quebrado aqui.
const READY_STATES: readonly ExecutionRunState[] = ["completed", "waiting_for_approval"];

/**
 * Revisão — só o resultado pronto (imagem + a ideia que a originou) para aprovar ou rejeitar.
 * Nenhuma execução em andamento ou com falha aparece nesta tela.
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

type RejectStep = "closed" | "choose" | "confirm_tank" | "request_change";

function RunCard({ workspaceId, run, onDecided }: { workspaceId: string; run: ExecutionRun; onDecided: () => void }) {
  const { data: detail, mutate: mutateDetail } = useExecutionRun(workspaceId, run.id);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectStep, setRejectStep] = useState<RejectStep>("closed");
  const [busy, setBusy] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [rejectReasons, setRejectReasons] = useState<RejectionReason[]>([]);
  const [rejectComment, setRejectComment] = useState("");

  const images = (detail?.artifacts ?? []).flatMap((artifact) => {
    const payload = artifact.payload as { output?: { images?: Array<{ uri?: string }> } } | undefined;
    return payload?.output?.images?.filter((image): image is { uri: string } => Boolean(image.uri)) ?? [];
  });
  const openGate = detail?.gates.find((gate) => gate.state === "open");
  const record = getGenerationRecord(workspaceId, run.id);
  // Fonte principal: o artefato "structure" (produzido pelo content_brief) já vem do servidor e
  // reflete a ideia real que gerou esta peça — funciona em qualquer navegador/dispositivo. O
  // registro local (`record`, localStorage) só cobre o que o servidor não guarda (o vínculo com a
  // ideia do tanque, para "voltar pro tanque") — nunca a fonte de título/descrição, que quebrava
  // sempre que a revisão acontecia num navegador diferente de onde a peça foi gerada.
  const structureOutput = (detail?.artifacts ?? [])
    .find((artifact) => artifact.outputPort === "structure")
    ?.payload as { output?: { angle?: string; centralPromise?: string; objective?: string } } | undefined;
  // Fonte principal: o artefato "copy" (Maria real, grafo content_request-visual-only-v2) — título/
  // legenda/CTA escritos por IA de verdade, com loop de qualidade e anti-clichê, prontos para
  // postar. `structureOutput` (João) só entra como fallback para execuções antigas.
  const copyOutput = (detail?.artifacts ?? [])
    .find((artifact) => artifact.outputPort === "copy")
    ?.payload as { output?: { title?: string; caption?: string; cta?: string; publication?: string } } | undefined;
  const title = copyOutput?.output?.title || structureOutput?.output?.angle || record?.name || "Peça gerada";
  // `publication` já é a legenda + CTA + hashtags prontos para colar no post — mais útil aqui do
  // que só `caption` sozinha, já que o usuário pediu explicitamente "uma descrição para postar".
  const description = copyOutput?.output?.publication || copyOutput?.output?.caption || structureOutput?.output?.centralPromise || record?.ideaText || record?.objective || "Sem descrição.";

  async function approve() {
    if (!openGate) return;
    setApproving(true);
    setError(null);
    try {
      await decideExecutionGate({ workspaceId, runId: run.id, gateId: openGate.id, decision: "approved" });
      await mutateDetail();
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a decisão.");
    } finally {
      setApproving(false);
    }
  }

  function toggleRejectReason(reason: RejectionReason) {
    setRejectReasons((current) => (current.includes(reason) ? current.filter((candidate) => candidate !== reason) : [...current, reason]));
  }

  async function rejectAndResolveTank(returnToTank: boolean) {
    if (!openGate || rejectReasons.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Rejeição estruturada: decide o gate E registra o(s) motivo(s) escolhido(s), consumidos
      // pela memória editorial da próxima geração deste workspace.
      await rejectExecutionWithFeedback({ workspaceId, runId: run.id, gateId: openGate.id, reasons: rejectReasons, comment: rejectComment.trim() || undefined });
      if (returnToTank && record) {
        const config = readProductionConfig(workspaceId);
        writeProductionConfig(workspaceId, {
          ...config,
          blueprints: config.blueprints.map((blueprint) => (blueprint.id === record.ideaId ? { ...blueprint, status: "available", usedAt: undefined } : blueprint)),
        });
      }
      setRejectStep("closed");
      setRejectReasons([]);
      setRejectComment("");
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a rejeição.");
    } finally {
      setBusy(false);
    }
  }

  async function requestChange() {
    if (!openGate || !record || !changeText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await decideExecutionGate({ workspaceId, runId: run.id, gateId: openGate.id, decision: "rejected" });
      const input = {
        workspaceId,
        name: record.name,
        objective: record.objective,
        ideaText: `${record.ideaText}\n\nAjuste solicitado na revisão: ${changeText.trim()}`.slice(0, 2000),
        format: record.format,
        channel: record.channel,
        targetAudience: record.targetAudience,
      };
      const result = await generateFromIdea(input);
      if (result.state === "failed") {
        setError(result.failureMessage || "Não foi possível gerar a nova versão. Tente novamente.");
        return;
      }
      recordGeneration(workspaceId, { ...input, executionRunId: result.executionRunId, ideaId: record.ideaId, createdAt: new Date().toISOString() });
      setRejectStep("closed");
      setChangeText("");
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar a nova versão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${image.uri}-${index}`} src={image.uri} alt={title} className="aspect-square w-full rounded-lg border border-border object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-xs text-ink-muted">Sem imagem</div>
        )}

        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{title}</p>
            <CopyButton text={title} label="Copiar título" />
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="whitespace-pre-wrap text-xs text-ink-muted">{description}</p>
            <CopyButton text={description} label="Copiar descrição" />
          </div>
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        {run.state === "waiting_for_approval" ? (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={approving || !openGate} onClick={approve}>
              {approving ? "Enviando…" : "Aprovar"}
            </Button>
            <Button variant="secondary" className="flex-1" disabled={approving || !openGate} onClick={() => setRejectStep("choose")}>
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

      {rejectStep === "choose" ? (
        <Modal title="Rejeitar peça" onClose={() => setRejectStep("closed")}>
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Você quer rejeitar por completo ou pedir um ajuste e gerar de novo?</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => setRejectStep("request_change")}>Solicitar alteração</Button>
              <Button variant="secondary" onClick={() => setRejectStep("confirm_tank")}>
                Rejeitar por completo
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {rejectStep === "confirm_tank" ? (
        <Modal title="Rejeitar por completo" onClose={() => setRejectStep("closed")}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-sm text-ink-muted">Por que essa peça não serve? (escolha ao menos um motivo — ajuda a próxima geração a não repetir o mesmo problema)</p>
              <div className="flex flex-wrap gap-1.5">
                {REJECTION_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      rejectReasons.includes(reason) ? "border-ink bg-ink text-surface" : "border-border text-ink-muted hover:bg-surface-sunken"
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={rejectReasons.includes(reason)} onChange={() => toggleRejectReason(reason)} />
                    {REJECTION_REASON_LABELS[reason]}
                  </label>
                ))}
              </div>
            </div>
            <Textarea value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} rows={2} placeholder="Comentário opcional" />
            <p className="text-sm text-ink-muted">Quer que a ideia volte disponível no tanque, ou prefere mantê-la como já usada?</p>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex flex-col gap-2">
              <Button disabled={busy || rejectReasons.length === 0} onClick={() => rejectAndResolveTank(true)}>
                {busy ? "Enviando…" : "Voltar ideia para o tanque"}
              </Button>
              <Button variant="secondary" disabled={busy || rejectReasons.length === 0} onClick={() => rejectAndResolveTank(false)}>
                Manter como usada
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {rejectStep === "request_change" ? (
        <Modal title="Solicitar alteração" onClose={() => setRejectStep("closed")}>
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Descreva o que precisa mudar. Uma nova versão será gerada com esse ajuste.</p>
            <Textarea value={changeText} onChange={(event) => setChangeText(event.target.value)} rows={4} placeholder="Ex.: deixar o fundo mais claro e destacar o preço." autoFocus />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <Button className="w-full" disabled={busy || !changeText.trim()} onClick={requestChange}>
              {busy ? "Gerando nova versão…" : "Enviar e gerar novamente"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sem permissão de clipboard (ex.: contexto não seguro) — sem fallback, só não marca "copiado".
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
