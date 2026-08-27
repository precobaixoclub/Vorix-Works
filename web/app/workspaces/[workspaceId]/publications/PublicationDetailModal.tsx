"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ClipboardList, History, Send, ShieldCheck } from "lucide-react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailBlock, DetailModal, type DetailModalSection } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approvePublication,
  cancelPublication,
  publishPublication,
  reconcilePublication,
  reprocessPublicationDeadLetter,
  retryPublication,
  runPublicationWorker,
} from "@/features/publication/api";
import { usePublication } from "@/features/publication/hooks";
import { formatDateTime } from "@/lib/format";

type PendingAction = {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "danger";
  action: () => Promise<void>;
};

/**
 * Detalhe de uma publicação — padrão único do design system pra "mostrar os detalhes de um
 * registro" (`DetailModal`, nunca `Sheet`/drawer, nunca rota separada). Substitui a antiga rota
 * `/publications/[publicationId]`: nada mais linkava pra ela, então a navegação inteira migrou
 * pra cá, aberta a partir da linha da lista em `publications/page.tsx`.
 *
 * Monte este componente só quando `publicationId` existir (`key={publicationId}` no chamador) —
 * assim `usePublication` nunca dispara com um id vazio e o estado de seção/ação reseta sozinho
 * ao trocar de registro.
 */
export function PublicationDetailModal({
  workspaceId,
  publicationId,
  onOpenChange,
}: {
  workspaceId: string;
  publicationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: detail, isLoading, error } = usePublication(workspaceId, publicationId);
  const [active, setActive] = useState("geral");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  async function refresh() {
    await Promise.all([
      mutate(["publication", workspaceId, publicationId]),
      mutate(["publication-queue", workspaceId]),
      mutate(["publication-dead-letters", workspaceId]),
      // A lista (fora do modal) precisa refletir o novo estado quando o usuário fechar — sem isso
      // ela ficaria com o snapshot de antes da ação até a próxima revalidação por foco.
      mutate(["publications", workspaceId]),
    ]);
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  function confirmAction(action: PendingAction) {
    setPendingAction(action);
  }

  if (isLoading || error || !detail) {
    return (
      <DetailModal
        open
        onOpenChange={onOpenChange}
        eyebrow="Publicação"
        title="Detalhes da publicação"
        description="Estado, tentativas, entrega e eventos técnicos desta publicação."
        widthStorageKey="vorix:modal-width:publication-detail"
        defaultWidthPercent={70}
      >
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate(["publication", workspaceId, publicationId])} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Publicação não encontrada.</p>
        )}
      </DetailModal>
    );
  }

  const canApprove = ["draft", "waiting_for_approval"].includes(detail.plan.state);
  const canPublish = detail.plan.state === "approved";
  const canCancel = !["published", "cancelled"].includes(detail.plan.state);
  const pageTitle = detail.plan.mode === "real" ? "Publicação real" : "Publicação de simulação";
  const verifications = [...detail.reconciliations, ...detail.receiptVerifications];

  const sections: DetailModalSection[] = [
    { value: "geral", label: "Geral", icon: ClipboardList },
    { value: "outbox", label: "Caixa de Saída", icon: Send, badge: detail.outbox.length || undefined },
    { value: "reconciliacao", label: "Reconciliação", icon: ShieldCheck, badge: verifications.length || undefined },
    { value: "dead-letters", label: "Não Entregues", icon: AlertTriangle, badge: detail.deadLetters.length || undefined },
    { value: "eventos", label: "Eventos", icon: History, badge: detail.events.length || undefined },
  ];

  const headerExtra = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
        {detail.plan.mode === "dry_run" ? "Simulação" : "Real"}
      </span>
      <StatusBadge status={detail.plan.state} />
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={!canApprove || busy}
        onClick={() =>
          confirmAction({
            title: "Aprovar publicação?",
            description: "A aprovação libera esta publicação para envio pelo fluxo técnico.",
            confirmLabel: "Aprovar",
            action: () => runAction(() => approvePublication(workspaceId, detail.plan.id, "Aprovação operacional via painel.")),
          })
        }
      >
        Aprovar
      </Button>
      <Button
        size="sm"
        disabled={!canPublish || busy}
        onClick={() =>
          confirmAction({
            title: "Publicar via outbox?",
            description: "Esta ação tenta publicar agora usando o fluxo durável de publicação.",
            confirmLabel: "Publicar",
            action: () => runAction(() => publishPublication(workspaceId, detail.plan.id, false)),
          })
        }
      >
        Publicar via outbox
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={!canPublish || busy}
        onClick={() =>
          confirmAction({
            title: "Enviar para fila?",
            description: "A publicação será colocada na fila deste workspace para processamento assíncrono.",
            confirmLabel: "Enviar para fila",
            action: () => runAction(() => publishPublication(workspaceId, detail.plan.id, true)),
          })
        }
      >
        Enviar para fila
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          confirmAction({
            title: "Rodar worker do workspace?",
            description: "O worker processará apenas jobs disponíveis para este workspace.",
            confirmLabel: "Rodar worker",
            action: () => runAction(() => runPublicationWorker(workspaceId)),
          })
        }
      >
        Rodar worker
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          confirmAction({
            title: "Repetir publicação?",
            description: "Uma nova tentativa será enfileirada para esta publicação.",
            confirmLabel: "Repetir",
            action: () => runAction(() => retryPublication(workspaceId, detail.plan.id)),
          })
        }
      >
        Repetir
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => runAction(() => reconcilePublication(workspaceId, detail.plan.id, false))}>
        Reconciliar
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => runAction(() => reconcilePublication(workspaceId, detail.plan.id, true))}>
        Verificar receipts
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={!canCancel || busy}
        onClick={() =>
          confirmAction({
            title: "Cancelar publicação?",
            description: "A publicação será cancelada e deixará de seguir para envio.",
            confirmLabel: "Cancelar publicação",
            variant: "danger",
            action: () => runAction(() => cancelPublication(workspaceId, detail.plan.id)),
          })
        }
      >
        Cancelar
      </Button>
    </div>
  );

  return (
    <>
      <DetailModal
        open
        onOpenChange={onOpenChange}
        eyebrow="Publicação"
        title={pageTitle}
        description={`Criada em ${formatDateTime(detail.plan.createdAt)} · atualizada em ${formatDateTime(detail.plan.updatedAt)}`}
        headerExtra={headerExtra}
        sections={sections}
        value={active}
        onValueChange={setActive}
        footer={footer}
        widthStorageKey="vorix:modal-width:publication-detail"
        defaultWidthPercent={70}
      >
        {active === "geral" && (
          <div className="space-y-8">
            <p className="break-all text-xs text-muted-foreground">
              Publicação {detail.plan.id} · Execução fonte {detail.plan.sourceExecutionRunId ?? "n/a"} · trace {detail.plan.traceId}
            </p>

            <DetailBlock label="Tentativas">
              {detail.attempts.length === 0 ? (
                <EmptySection>Nenhuma tentativa.</EmptySection>
              ) : (
                <div className="space-y-2">
                  {detail.attempts.map((attempt) => (
                    <div key={String(attempt.id)} className="rounded-xl bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">
                          {String(attempt.provider)} · #{String(attempt.attemptNumber)}
                        </p>
                        <StatusBadge status={String(attempt.state)} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{String(attempt.idempotencyKey ?? "")}</p>
                    </div>
                  ))}
                </div>
              )}
            </DetailBlock>

            <DetailBlock label="Destinos">
              {detail.targets.length === 0 ? (
                <EmptySection>Nenhum destino configurado.</EmptySection>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canal</TableHead>
                      <TableHead>Provedor</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.targets.map((target) => (
                      <TableRow key={target.id}>
                        <TableCell>{target.channel}</TableCell>
                        <TableCell>{target.provider}</TableCell>
                        <TableCell>
                          <StatusBadge status={target.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DetailBlock>

            <DetailBlock label="Recibos">
              {detail.receipts.length === 0 ? (
                <EmptySection>Nenhum receipt ainda.</EmptySection>
              ) : (
                <div className="space-y-2">
                  {detail.receipts.map((receipt) => (
                    <div key={receipt.id} className="rounded-xl bg-muted/30 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        {receipt.channel} · {receipt.provider}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {receipt.providerPublicationId} · {receipt.status}
                      </p>
                      {receipt.providerRequestId ? (
                        <p className="text-xs text-muted-foreground">request {receipt.providerRequestId}</p>
                      ) : null}
                      <p className="mt-1 break-all text-xs text-muted-foreground">{receipt.url}</p>
                      {receipt.externalIdentifiers ? (
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {Object.entries(receipt.externalIdentifiers)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </DetailBlock>
          </div>
        )}

        {active === "outbox" && (
          <DetailBlock label="Caixa de Saída e Leases">
            {detail.outbox.length === 0 ? (
              <EmptySection>Nenhuma mensagem durável.</EmptySection>
            ) : (
              <div className="space-y-2">
                {detail.outbox.map((message) => (
                  <div key={String(message.outboxMessageId)} className="rounded-xl bg-muted/30 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{String(message.providerId)}</p>
                      <StatusBadge status={String(message.status)} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      fencing {String(message.fencingToken)} · worker {String(message.claimedBy ?? "n/a")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      lease {String(message.leaseExpiresAt ?? "n/a")} · retry {String(message.retryAfter ?? "n/a")}
                    </p>
                    {message.lastFailureCode ? <p className="mt-1 text-xs text-destructive">{message.lastFailureCode}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </DetailBlock>
        )}

        {active === "reconciliacao" && (
          <DetailBlock label="Reconciliação e Verificação">
            {verifications.length === 0 ? (
              <EmptySection>Nenhum registro operacional.</EmptySection>
            ) : (
              <div className="space-y-2">
                {verifications.map((item, index) => (
                  <div key={index} className="rounded-xl bg-muted/30 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {String("verificationStatus" in item ? item.externalStatus ?? "receipt" : item.idempotencyKey)}
                      </p>
                      <StatusBadge status={String("verificationStatus" in item ? item.verificationStatus : item.status)} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {String(item.providerId ?? "provider n/a")} ·{" "}
                      {String("verificationStatus" in item ? item.detailsCode ?? "" : item.providerRequestId ?? "")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DetailBlock>
        )}

        {active === "dead-letters" && (
          <DetailBlock label="Não Entregues">
            {detail.deadLetters.length === 0 ? (
              <EmptySection>Nenhuma mensagem não entregue.</EmptySection>
            ) : (
              <div className="space-y-2">
                {detail.deadLetters.map((letter) => (
                  <div key={letter.id} className="rounded-xl bg-muted/30 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {letter.providerId ?? "provedor n/a"} · {letter.lastFailureCode ?? "falha"}
                      </p>
                      <StatusBadge status={letter.recoveryStatus ?? "pending"} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{letter.lastSafeMessage ?? letter.reason}</p>
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="secondary"
                      disabled={busy || letter.recoveryStatus === "reprocessed"}
                      onClick={() =>
                        confirmAction({
                          title: "Reprocessar não entregue?",
                          description: "Este registro voltará para a fila técnica do workspace.",
                          confirmLabel: "Reprocessar",
                          action: () => runAction(() => reprocessPublicationDeadLetter(workspaceId, letter.id)),
                        })
                      }
                    >
                      Reprocessar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </DetailBlock>
        )}

        {active === "eventos" && (
          <DetailBlock label="Eventos">
            {detail.events.length === 0 ? (
              <EmptySection>Nenhum evento registrado.</EmptySection>
            ) : (
              <div className="space-y-2">
                {detail.events.map((event) => (
                  <div key={event.id} className="rounded-xl bg-muted/30 p-3 text-sm">
                    <p className="font-medium text-foreground">{event.eventType}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)} · trace {event.traceId ?? "n/a"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DetailBlock>
        )}
      </DetailModal>

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction?.title ?? ""}
        description={pendingAction?.description ?? ""}
        confirmLabel={pendingAction?.confirmLabel ?? "Confirmar"}
        variant={pendingAction?.variant ?? "primary"}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (pendingAction) await pendingAction.action();
        }}
      />
    </>
  );
}

function EmptySection({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
