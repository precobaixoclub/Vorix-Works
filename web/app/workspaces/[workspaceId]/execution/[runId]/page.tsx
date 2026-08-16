"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { cancelExecutionRun, decideExecutionGate, startExecutionRun } from "@/features/execution/api";
import { useExecutionRun } from "@/features/execution/hooks";
import { formatDateTime } from "@/lib/format";

export default function ExecutionRunDetailPage() {
  const params = useParams<{ workspaceId: string; runId: string }>();
  const { data: detail, isLoading, error } = useExecutionRun(params.workspaceId, params.runId);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await mutate(["execution-run", params.workspaceId, params.runId]);
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!detail) return;
    if (detail.run.mode === "real" && !window.confirm("Iniciar uma execução real pode chamar a Skill real de pesquisa habilitada por feature flag. Continuar?")) return;
    await runAction(() => startExecutionRun(params.workspaceId, detail.run.id));
  }

  if (isLoading) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-3 py-10 sm:px-6 sm:py-16">
        <ErrorState error={error} onRetry={refresh} />
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  const openGate = detail.gates.find((gate) => gate.state === "open");
  const canStart = ["created", "ready"].includes(detail.run.state);
  const canCancel = !["completed", "failed", "cancelled"].includes(detail.run.state);

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={detail.run.id}
        description={`Runtime ${detail.run.runtimePlanId} · criado em ${formatDateTime(detail.run.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{detail.run.mode === "real" ? "Real" : "Simulação"}</span>
            <StatusBadge status={detail.run.state} />
          </div>
        }
      />
      <ScreenGuide
        title="Acompanhar execução"
        description="Aqui você vê cada etapa que rodou, o que foi aprovado e onde uma falha aconteceu."
        items={[
          "Inicie a simulação ou execução quando estiver pronta.",
          "Aprove um gate somente se o conteúdo estiver correto.",
          "Use Cancelar para interromper execuções não finalizadas.",
          "Leia Tarefas e Artefatos para entender o resultado.",
        ]}
        aside={<p>IDs de rastreio aparecem para suporte técnico e não precisam ser copiados no uso normal.</p>}
      />
      <p className="mb-4 break-words text-xs text-ink-muted">traceId {detail.run.traceId} · correlationId {detail.run.correlationId}</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button disabled={!canStart || busy} onClick={handleStart}>
          {detail.run.mode === "real" ? "Iniciar execução real" : "Iniciar simulação"}
        </Button>
        <Button variant="danger" disabled={!canCancel || busy} onClick={() => runAction(() => cancelExecutionRun(params.workspaceId, detail.run.id))}>
          Cancelar
        </Button>
        {openGate ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => runAction(() => decideExecutionGate({ workspaceId: params.workspaceId, runId: detail.run.id, gateId: openGate.id, decision: "approved" }))}>
              Aprovar gate
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => runAction(() => decideExecutionGate({ workspaceId: params.workspaceId, runId: detail.run.id, gateId: openGate.id, decision: "rejected" }))}>
              Rejeitar gate
            </Button>
          </>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-ink">Tarefas</p>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">Tentativas</th>
                </tr>
              </thead>
              <tbody>
                {detail.taskRuns.map((task) => (
                  <tr key={task.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink">{task.type}</td>
                    <td className="py-2 pr-3"><StatusBadge status={task.state} /></td>
                    <td className="py-2 pr-3 text-ink-muted">{task.attemptsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-ink">Gates</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {detail.gates.length === 0 ? <p className="text-sm text-ink-muted">Nenhum gate aberto.</p> : detail.gates.map((gate) => (
              <div key={gate.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink">{gate.id}</p>
                  <StatusBadge status={gate.state} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{gate.decision ?? "aguardando decisão"}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-ink">Artefatos</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {detail.artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className="font-medium text-ink">{artifact.schemaId} · {artifact.outputPort}</p>
                <p className="mt-1 text-ink-muted">{artifact.artifactType} · checksum {artifact.checksum.slice(0, 12)}</p>
                <p className="mt-1 text-ink-muted">handler {artifact.handlerId ?? "n/a"} · provider {artifact.provider ?? "n/a"}</p>
                <p className="mt-1 text-ink-muted">lineage {artifact.parentArtifactIds.length ? artifact.parentArtifactIds.join(", ") : "root"}</p>
              </div>
            ))}
            {detail.artifacts.length === 0 ? <p className="text-sm text-ink-muted">Nenhum artefato produzido.</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-ink">Eventos</p>
          </CardHeader>
          <CardBody className="flex max-h-96 flex-col gap-2 overflow-auto">
            {detail.events.map((event) => (
              <div key={event.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className={event.eventType === "side_effect_blocked" ? "font-medium text-status-danger" : "font-medium text-ink"}>{event.eventType}</p>
                <p className="mt-1 text-ink-muted">{formatDateTime(event.createdAt)}</p>
                <p className="mt-1 text-ink-muted">trace {event.traceId ?? "n/a"}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <p className="text-sm font-medium text-ink">Resolução de Manipulador</p>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {detail.handlerResolution.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum handler resolvido ainda.</p>
          ) : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Capacidade</th>
                  <th className="py-2 pr-3 font-medium">Manipulador</th>
                  <th className="py-2 pr-3 font-medium">Provedor</th>
                  <th className="py-2 pr-3 font-medium">Modo</th>
                  <th className="py-2 pr-3 font-medium">Alternativa</th>
                  <th className="py-2 pr-3 font-medium">Mapeamento</th>
                  <th className="py-2 pr-3 font-medium">Rastro</th>
                </tr>
              </thead>
              <tbody>
                {detail.handlerResolution.map((resolution) => (
                  <tr key={resolution.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink">{resolution.capability}</td>
                    <td className="py-2 pr-3 text-ink-muted">{resolution.handler}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      <span className={resolution.provider === "deterministic" ? "rounded-full bg-ink-muted/10 px-2 py-0.5 text-xs" : "rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"}>
                        {resolution.provider === "deterministic" ? "Manipulador Determinístico" : "Habilidade Real"}
                      </span>
                      <span className="ml-2">{resolution.provider}</span>
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{resolution.executionMode}</td>
                    <td className="py-2 pr-3 text-ink-muted">{resolution.fallbackPolicy}</td>
                    <td className="py-2 pr-3 text-ink-muted">{resolution.capabilityMapping?.skillCapability ?? "deterministic"}</td>
                    <td className="py-2 pr-3 text-ink-muted">{resolution.traceId ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <p className="text-sm font-medium text-ink">Rastreamento de Execução</p>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {detail.traces.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum trace registrado ainda.</p>
          ) : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Capacidade</th>
                  <th className="py-2 pr-3 font-medium">Manipulador</th>
                  <th className="py-2 pr-3 font-medium">Duração</th>
                  <th className="py-2 pr-3 font-medium">Tentativas</th>
                  <th className="py-2 pr-3 font-medium">Avisos</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Rastro</th>
                </tr>
              </thead>
              <tbody>
                {detail.traces.map((trace) => (
                  <tr key={trace.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink">{trace.capability}</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.handler}</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.durationMs}ms</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.retryAttempt}</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.warnings.length}</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.success ? "sucesso" : "falhou"}</td>
                    <td className="py-2 pr-3 text-ink-muted">{trace.traceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
