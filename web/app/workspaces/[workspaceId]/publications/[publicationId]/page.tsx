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
import { approvePublication, cancelPublication, publishPublication, reconcilePublication, reprocessPublicationDeadLetter, retryPublication, runPublicationWorker } from "@/features/publication/api";
import { usePublication } from "@/features/publication/hooks";
import { formatDateTime } from "@/lib/format";

export default function PublicationDetailPage() {
  const params = useParams<{ workspaceId: string; publicationId: string }>();
  const { data: detail, isLoading, error } = usePublication(params.workspaceId, params.publicationId);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await mutate(["publication", params.workspaceId, params.publicationId]);
    await mutate("publication-queue");
    await mutate(["publication-dead-letters", params.workspaceId]);
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

  if (isLoading) {
    return <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16"><Spinner /></main>;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-3 py-10 sm:px-6 sm:py-16">
        <ErrorState error={error} onRetry={refresh} />
      </main>
    );
  }

  if (!detail) {
    return <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16"><Spinner /></main>;
  }

  const canApprove = ["draft", "waiting_for_approval"].includes(detail.plan.state);
  const canPublish = detail.plan.state === "approved";
  const canCancel = !["published", "cancelled"].includes(detail.plan.state);

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={detail.plan.id}
        description={`Criado em ${formatDateTime(detail.plan.createdAt)} · trace ${detail.plan.traceId}`}
        actions={<div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{detail.plan.mode === "dry_run" ? "Simulação" : "Real"}</span><StatusBadge status={detail.plan.state} /></div>}
      />

      <ScreenGuide
        title="Investigação de publicação"
        description="Esta é uma tela técnica para corrigir uma postagem específica quando ela não saiu como esperado."
        items={[
          "Aprovar libera uma publicação em rascunho.",
          "Publicar via outbox envia pelo fluxo normal.",
          "Repetir tenta novamente depois de uma falha.",
          "Reconciliar busca o status real no provedor.",
        ]}
        aside={<p>Para criar post novo, use Publicar. Para ver resultados gerais, use Postagens Publicadas.</p>}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Button disabled={!canApprove || busy} onClick={() => runAction(() => approvePublication(params.workspaceId, detail.plan.id, "Aprovação operacional via painel."))}>Aprovar</Button>
        <Button disabled={!canPublish || busy} onClick={() => runAction(() => publishPublication(params.workspaceId, detail.plan.id, false))}>Publicar via outbox</Button>
        <Button variant="secondary" disabled={!canPublish || busy} onClick={() => runAction(() => publishPublication(params.workspaceId, detail.plan.id, true))}>Enviar para fila</Button>
        <Button variant="secondary" disabled={busy} onClick={() => runAction(() => runPublicationWorker())}>Rodar worker</Button>
        <Button variant="secondary" disabled={busy} onClick={() => runAction(() => retryPublication(params.workspaceId, detail.plan.id))}>Repetir</Button>
        <Button variant="secondary" disabled={busy} onClick={() => runAction(() => reconcilePublication(params.workspaceId, detail.plan.id, false))}>Reconciliar</Button>
        <Button variant="secondary" disabled={busy} onClick={() => runAction(() => reconcilePublication(params.workspaceId, detail.plan.id, true))}>Verificar receipts</Button>
        <Button variant="danger" disabled={!canCancel || busy} onClick={() => runAction(() => cancelPublication(params.workspaceId, detail.plan.id))}>Cancelar</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Tentativas</p></CardHeader>
          <CardBody className="space-y-2">
            {detail.attempts.length === 0 ? <p className="text-sm text-ink-muted">Nenhuma tentativa.</p> : detail.attempts.map((attempt) => (
              <div key={String(attempt.id)} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{String(attempt.provider)} · #{String(attempt.attemptNumber)}</p>
                  <StatusBadge status={String(attempt.state)} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{String(attempt.idempotencyKey ?? "")}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Destinos</p></CardHeader>
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-ink-muted"><th className="py-2 pr-3">Canal</th><th className="py-2 pr-3">Provedor</th><th className="py-2 pr-3">Estado</th></tr></thead>
              <tbody>{detail.targets.map((target) => <tr key={target.id} className="border-b border-border last:border-0"><td className="py-2 pr-3">{target.channel}</td><td className="py-2 pr-3">{target.provider}</td><td className="py-2 pr-3"><StatusBadge status={target.status} /></td></tr>)}</tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Caixa de Saída e Leases</p></CardHeader>
          <CardBody className="space-y-2">
            {detail.outbox.length === 0 ? <p className="text-sm text-ink-muted">Nenhuma mensagem durável.</p> : detail.outbox.map((message) => (
              <div key={String(message.outboxMessageId)} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{String(message.providerId)}</p>
                  <StatusBadge status={String(message.status)} />
                </div>
                <p className="text-xs text-ink-muted">fencing {String(message.fencingToken)} · worker {String(message.claimedBy ?? "n/a")}</p>
                <p className="text-xs text-ink-muted">lease {String(message.leaseExpiresAt ?? "n/a")} · retry {String(message.retryAfter ?? "n/a")}</p>
                {message.lastFailureCode ? <p className="mt-1 text-xs text-red-600">{message.lastFailureCode}</p> : null}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Recibos</p></CardHeader>
          <CardBody className="space-y-2">
            {detail.receipts.length === 0 ? <p className="text-sm text-ink-muted">Nenhum receipt ainda.</p> : detail.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-ink">{receipt.channel} · {receipt.provider}</p>
                <p className="text-xs text-ink-muted">{receipt.providerPublicationId} · {receipt.status}</p>
                {receipt.providerRequestId ? <p className="text-xs text-ink-muted">request {receipt.providerRequestId}</p> : null}
                <p className="mt-1 break-all text-xs text-ink-muted">{receipt.url}</p>
                {receipt.externalIdentifiers ? <p className="mt-1 break-all text-xs text-ink-muted">{Object.entries(receipt.externalIdentifiers).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p> : null}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Reconciliação e Verificação</p></CardHeader>
          <CardBody className="space-y-2">
            {[...detail.reconciliations, ...detail.receiptVerifications].length === 0 ? <p className="text-sm text-ink-muted">Nenhum registro operacional.</p> : [...detail.reconciliations, ...detail.receiptVerifications].map((item, index) => (
              <div key={index} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{String("verificationStatus" in item ? item.externalStatus ?? "receipt" : item.idempotencyKey)}</p>
                  <StatusBadge status={String("verificationStatus" in item ? item.verificationStatus : item.status)} />
                </div>
                <p className="text-xs text-ink-muted">{String(item.providerId ?? "provider n/a")} · {String("verificationStatus" in item ? item.detailsCode ?? "" : item.providerRequestId ?? "")}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-medium text-ink">Não Entregues</p></CardHeader>
          <CardBody className="space-y-2">
            {detail.deadLetters.length === 0 ? <p className="text-sm text-ink-muted">Nenhuma mensagem não entregue.</p> : detail.deadLetters.map((letter) => (
              <div key={letter.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{letter.providerId ?? "provedor n/a"} · {letter.lastFailureCode ?? "falha"}</p>
                  <StatusBadge status={letter.recoveryStatus ?? "pending"} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{letter.lastSafeMessage ?? letter.reason}</p>
                <Button className="mt-3" variant="secondary" disabled={busy || letter.recoveryStatus === "reprocessed"} onClick={() => runAction(() => reprocessPublicationDeadLetter(params.workspaceId, letter.id))}>Reprocessar</Button>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><p className="text-sm font-medium text-ink">Eventos</p></CardHeader>
          <CardBody className="space-y-2">
            {detail.events.map((event) => (
              <div key={event.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-ink">{event.eventType}</p>
                <p className="text-xs text-ink-muted">{formatDateTime(event.createdAt)} · trace {event.traceId ?? "n/a"}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
