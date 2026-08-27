"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Textarea } from "@/components/Field";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { decideExecutionGate } from "@/features/execution/api";
import { useExecutionRun, useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunDetail, ExecutionRunState } from "@/features/execution/types";
import { deriveObjective, extractExecutionRunFailure, generateFromIdea, isUnrecoverableSemanticOcclusionFailure, rejectExecutionWithFeedback, REJECTION_REASONS, REJECTION_REASON_LABELS, type RejectionReason, waitForExecutionRunTerminal } from "@/features/production-line/api";
import { getGenerationRecord, recordGeneration, type GenerationRecord } from "@/features/production-line/generation-log";
import { readProductionConfig, writeProductionConfig } from "@/features/production-line/storage";

// Só o que já está pronto pra revisar entra aqui — nunca falha, nunca "gerando". Enquanto uma
// peça não chega num desses dois estados, ela simplesmente não aparece: uma falha volta pro
// usuário direto na tela de Produção (ver production/page.tsx, `handleGenerateRealImage`), nunca
// como um card quebrado aqui.
const READY_STATES: readonly ExecutionRunState[] = ["completed", "waiting_for_approval"];

type RunContent = {
  title: string;
  description: string;
  images: Array<{ uri: string }>;
  record: GenerationRecord | undefined;
};

/** Deriva título/descrição/imagens de um `ExecutionRunDetail` — mesma lógica para o item da lista
 * (compacto) e para o painel de detalhe (completo), nunca duplicada entre os dois. */
function deriveRunContent(workspaceId: string, runId: string, detail: ExecutionRunDetail | undefined): RunContent {
  const images = (detail?.artifacts ?? []).flatMap((artifact) => {
    const payload = artifact.payload as { output?: { images?: Array<{ uri?: string }> } } | undefined;
    return payload?.output?.images?.filter((image): image is { uri: string } => Boolean(image.uri)) ?? [];
  });
  const record = getGenerationRecord(workspaceId, runId);
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
  return { title, description, images, record };
}

/**
 * Revisão, redesign "workspace criativo" em 3 painéis — contexto (lista do que está pronto para
 * decidir) / canvas (a peça selecionada, grande) / ações (título, descrição, aprovar/rejeitar).
 * Antes, cada peça era um card independente numa grade — revisar várias ao mesmo tempo forçava a
 * rolar a página inteira. Agora dá para varrer a lista à esquerda e decidir uma por vez, com a
 * peça atual sempre em destaque. Toda a lógica (hooks, aprovar/rejeitar/solicitar alteração,
 * volta pro tanque) é exatamente a mesma de antes — só a apresentação mudou.
 */
export default function ReviewPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading, error: runsError, mutate } = useExecutionRuns(workspace.id);
  const readyRuns = (runs ?? [])
    .filter((run) => run.mode === "real" && READY_STATES.includes(run.state))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const selectedRun = readyRuns.find((run) => run.id === selectedRunId) ?? readyRuns[0];

  useEffect(() => {
    // Se a peça selecionada some da lista (decidida, ou lote atualizado), cai pra próxima
    // disponível — nunca trava numa peça que já saiu da fila de revisão.
    if (selectedRunId && !readyRuns.some((run) => run.id === selectedRunId)) setSelectedRunId(undefined);
  }, [selectedRunId, readyRuns]);

  return (
    <main className="mx-auto flex h-full max-w-7xl flex-col px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Revisão" description="Peças geradas prontas para você aprovar." />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : runsError ? (
        <ErrorState error={runsError} onRetry={() => mutate()} />
      ) : readyRuns.length === 0 ? (
        <EmptyState title="Nada para revisar ainda" description="Quando uma peça terminar de ser gerada em Produção, ela aparece aqui." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:items-start">
          <RunList workspaceId={workspace.id} runs={readyRuns} selectedId={selectedRun?.id} onSelect={setSelectedRunId} />
          {selectedRun ? (
            <RunWorkspace
              key={selectedRun.id}
              workspaceId={workspace.id}
              run={selectedRun}
              onDecided={() => {
                mutate();
                setSelectedRunId(undefined);
              }}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}

function RunList({
  workspaceId,
  runs,
  selectedId,
  onSelect,
}: {
  workspaceId: string;
  runs: ExecutionRun[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="lg:sticky lg:top-0">
      <CardBody className="p-2">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {runs.map((run) => (
            <RunListItem key={run.id} workspaceId={workspaceId} run={run} selected={run.id === selectedId} onSelect={() => onSelect(run.id)} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function RunListItem({ workspaceId, run, selected, onSelect }: { workspaceId: string; run: ExecutionRun; selected: boolean; onSelect: () => void }) {
  const { data: detail } = useExecutionRun(workspaceId, run.id);
  const { title, images } = deriveRunContent(workspaceId, run.id, detail);
  const thumbnail = images[0]?.uri;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`flex w-40 shrink-0 flex-col gap-2 rounded-lg border p-2 text-left transition-colors lg:w-full lg:flex-row lg:items-center ${
        selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"
      }`}
    >
      <div className="aspect-square w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted lg:w-12">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">—</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs font-medium ${selected ? "text-primary" : "text-foreground"}`}>{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{run.state === "waiting_for_approval" ? "Aguardando" : "Aprovada"}</p>
      </div>
    </button>
  );
}

type RejectStep = "closed" | "choose" | "confirm_tank" | "request_change";

function RunWorkspace({ workspaceId, run, onDecided }: { workspaceId: string; run: ExecutionRun; onDecided: () => void }) {
  const { data: detail, mutate: mutateDetail } = useExecutionRun(workspaceId, run.id);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectStep, setRejectStep] = useState<RejectStep>("closed");
  const [busy, setBusy] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [rejectReasons, setRejectReasons] = useState<RejectionReason[]>([]);
  const [rejectComment, setRejectComment] = useState("");

  const { title, description, images, record } = deriveRunContent(workspaceId, run.id, detail);
  const openGate = detail?.gates.find((gate) => gate.state === "open");

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
        objective: deriveObjective(record.objective, record.ideaText),
        ideaText: `${record.ideaText}\n\nAjuste solicitado na revisão: ${changeText.trim()}`.slice(0, 2000),
        format: record.format,
        channel: record.channel,
        targetAudience: record.targetAudience,
      };
      // Assíncrono (Rodada 2, Fatia 3 — mesmo achado ao vivo da tela de Produção): a chamada
      // devolve `executionRunId` na hora, o pipeline roda em background, e o acompanhamento até
      // o estado terminar é feito aqui via poll — nunca segura a conexão HTTP original por
      // minutos (era isso que causava "erro de conexão" mesmo com o backend terminando normalmente).
      const first = await generateFromIdea(input);
      let detail = await waitForExecutionRunTerminal(workspaceId, first.executionRunId);
      let executionRunId = first.executionRunId;

      if (detail.run.state === "failed") {
        const { code, message } = extractExecutionRunFailure(detail);
        if (code === "QUALITY_GATE_NOT_PASSED" && !isUnrecoverableSemanticOcclusionFailure(message)) {
          const retry = await generateFromIdea(input);
          executionRunId = retry.executionRunId;
          detail = await waitForExecutionRunTerminal(workspaceId, retry.executionRunId);
        }
      }

      if (detail.run.state === "failed") {
        const { message } = extractExecutionRunFailure(detail);
        setError(message || "Não foi possível gerar a nova versão. Tente novamente.");
        return;
      }
      if (detail.run.state !== "completed" && detail.run.state !== "waiting_for_approval") {
        setError("A geração está demorando mais que o esperado. Confira novamente em alguns minutos.");
        return;
      }
      recordGeneration(workspaceId, { ...input, executionRunId, ideaId: record.ideaId, createdAt: new Date().toISOString() });
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
    <>
      <Card className="lg:col-span-1">
        <CardBody>
          {images.length > 0 ? (
            images.length === 1 ? (
              // Peça única: imagem inteira sem corte (achado ao vivo — `object-cover` com
              // `aspect-square` cortava peças que não são quadradas) e clicável pra abrir em
              // tamanho real numa aba nova.
              <a href={images[0].uri} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[0].uri} alt={title} loading="lazy" className="mx-auto max-h-[70vh] w-full object-contain" />
              </a>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {images.map((image, index) => (
                  <a key={`${image.uri}-${index}`} href={image.uri} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.uri} alt={title} loading="lazy" className="aspect-square w-full object-contain" />
                  </a>
                ))}
              </div>
            )
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">Sem imagem</div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground/70" title={run.createdAt}>
            Gerado em {formatGeneratedAt(run.createdAt)}
          </p>
        </CardBody>
      </Card>

      <Card className="lg:col-span-1">
        <CardBody className="space-y-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-sm font-semibold text-foreground">{title}</p>
              <CopyButton text={title} label="Copiar título" />
            </div>
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{description}</p>
              <CopyButton text={description} label="Copiar descrição" />
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

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
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Aprovada
            </span>
          )}
        </CardBody>
      </Card>

      {rejectStep === "choose" ? (
        <Modal title="Rejeitar peça" onClose={() => setRejectStep("closed")}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Você quer rejeitar por completo ou pedir um ajuste e gerar de novo?</p>
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
              <p className="text-sm text-muted-foreground">Por que essa peça não serve? (escolha ao menos um motivo — ajuda a próxima geração a não repetir o mesmo problema)</p>
              <div className="flex flex-wrap gap-1.5">
                {REJECTION_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      rejectReasons.includes(reason) ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={rejectReasons.includes(reason)} onChange={() => toggleRejectReason(reason)} />
                    {REJECTION_REASON_LABELS[reason]}
                  </label>
                ))}
              </div>
            </div>
            <Textarea value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} rows={2} placeholder="Comentário opcional" />
            <p className="text-sm text-muted-foreground">Quer que a ideia volte disponível no tanque, ou prefere mantê-la como já usada?</p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
            <p className="text-sm text-muted-foreground">Descreva o que precisa mudar. Uma nova versão será gerada com esse ajuste.</p>
            <Textarea value={changeText} onChange={(event) => setChangeText(event.target.value)} rows={4} placeholder="Ex.: deixar o fundo mais claro e destacar o preço." autoFocus />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button className="w-full" disabled={busy || !changeText.trim()} onClick={requestChange}>
              {busy ? "Gerando nova versão…" : "Enviar e gerar novamente"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// Local do navegador de quem revisa, não UTC — é quem decide aprovar/rejeitar que precisa
// controlar "de quando é essa peça", não o fuso do servidor.
function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "data desconhecida";
  return `${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
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
      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
