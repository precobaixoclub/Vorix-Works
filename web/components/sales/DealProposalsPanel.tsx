"use client";

import { useState } from "react";
import { Check, CheckCheck, Copy, Eye, FileText, MessageCircle, RefreshCw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardedButton } from "@/components/GuardedButton";
import { DetailBlock } from "@/components/DetailModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PROPOSAL_STATUS_LABEL } from "@/features/crm/presentation";
import type { Deal, Proposal } from "@/features/crm/types";
import { listInboxConversations } from "@/features/inbox/api";
import { cancelProposal, createProposalVersion, markProposalSent, remindProposalWhatsapp, sendProposalWhatsapp } from "@/features/sales/api";
import { useInvalidateSales, useProposalTracking } from "@/features/sales/hooks";
import { PROPOSAL_EVENT_LABEL, proposalLabel } from "@/features/sales/presentation";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GenerateProposalModal } from "./DealProposalComposer";

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : "Tente novamente.");
const newKey = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function conversationFor(workspaceId: string, contactId?: string): Promise<string | undefined> {
  if (!contactId) return undefined;
  const { conversations } = await listInboxConversations(workspaceId, undefined, contactId);
  return conversations[0]?.id;
}

/** Propostas da oportunidade: gerar → revisar → (aprovação) → enviar no WhatsApp, com rastreio. */
export function DealProposalsPanel({ workspaceId, deal, proposals, onChanged, onMarkLost }: { workspaceId: string; deal: Deal; proposals: readonly Proposal[]; onChanged: () => void | Promise<void>; onMarkLost: () => void }) {
  const invalidate = useInvalidateSales(workspaceId);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(proposals[0]?.id);
  const ordered = [...proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = ordered.find((proposal) => proposal.id === selected) ?? ordered[0];
  const refresh = async () => { await Promise.all([invalidate(), onChanged()]); };

  return (
    <div className="space-y-6">
      <DetailBlock
        label={`Propostas (${proposals.length})`}
        action={deal.status === "open" ? <Button size="sm" onClick={() => setGenerating(true)}><FileText className="mr-1.5 h-4 w-4" />Gerar proposta</Button> : undefined}
      >
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma proposta. A proposta é gerada com os produtos, preços e descontos desta oportunidade — sem digitar de novo.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ordered.map((proposal) => (
              <button key={proposal.id} type="button" onClick={() => setSelected(proposal.id)} className={cn("rounded-full border px-3 py-1 text-xs", proposal.id === current?.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                {proposalLabel(proposal)} · {PROPOSAL_STATUS_LABEL[proposal.status]}
              </button>
            ))}
          </div>
        )}
      </DetailBlock>

      {current ? <ProposalTrackingCard key={current.id} workspaceId={workspaceId} deal={deal} proposal={current} onChanged={refresh} onSelect={setSelected} onMarkLost={onMarkLost} /> : null}

      {generating ? (
        <GenerateProposalModal
          workspaceId={workspaceId}
          deal={deal}
          onClose={() => setGenerating(false)}
          onCreated={async (proposal, approvalRequired) => {
            setGenerating(false);
            setSelected(proposal.id);
            await refresh();
            toast.success(approvalRequired ? "Proposta criada — aguardando aprovação do gestor antes do envio." : "Proposta criada. Revise e envie.");
          }}
        />
      ) : null}
    </div>
  );
}

const MESSAGE_STATUS_LABEL: Record<string, string> = { queued: "Na fila", sending: "Enviando", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou" };

function ProposalTrackingCard({ workspaceId, deal, proposal, onChanged, onSelect, onMarkLost }: { workspaceId: string; deal: Deal; proposal: Proposal; onChanged: () => Promise<void>; onSelect: (id: string) => void; onMarkLost: () => void }) {
  const { data: tracking, mutate } = useProposalTracking(workspaceId, proposal.id);
  const [busy, setBusy] = useState<string>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const delivery = tracking?.deliveries.find((item) => item.messageStatus) ?? tracking?.deliveries[0];
  const firstView = tracking?.events.find((event) => event.eventType === "viewed");
  const sendable = ["draft", "approved"].includes(proposal.status);
  const inAnalysis = proposal.status === "sent" || proposal.status === "viewed";

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      await Promise.all([mutate(), onChanged()]);
      toast.success(success);
    } catch (cause) {
      toast.error("Não foi possível concluir", { description: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  }

  async function sendWhatsapp(reminder: boolean) {
    const conversationId = await conversationFor(workspaceId, deal.contactId);
    if (!conversationId) throw new Error("O contato desta oportunidade não tem conversa no WhatsApp. Inicie uma conversa primeiro.");
    const input = { workspaceId, conversationId, idempotencyKey: newKey() };
    return reminder ? remindProposalWhatsapp(proposal.id, input) : sendProposalWhatsapp(proposal.id, input);
  }

  return (
    <DetailBlock label={`${proposalLabel(proposal)} · ${proposal.title}`} action={<StatusBadge status={proposal.status} />}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cell label="Valor" value={formatCurrencyCents(proposal.totalCents, proposal.currency)} strong />
          <Cell label="Validade" value={formatDate(proposal.validUntil)} />
          <Cell label="Enviada" value={proposal.sentAt ? formatDateTime(proposal.sentAt) : "—"} hint={proposal.sentChannel === "whatsapp" ? "pelo WhatsApp" : proposal.sentChannel ? "por link" : undefined} />
          <Cell label="Status" value={PROPOSAL_STATUS_LABEL[proposal.status]} />
        </div>

        {proposal.sentAt ? (
          <ul className="space-y-1.5 rounded-xl border border-border/60 p-3 text-sm">
            {delivery ? (
              <li className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                WhatsApp: <span className="font-medium">{delivery.messageStatus ? MESSAGE_STATUS_LABEL[delivery.messageStatus] : delivery.status === "failed" ? "Falhou" : "Na fila"}</span>
                {delivery.messageStatus === "delivered" || delivery.messageStatus === "read" ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                {delivery.messageStatus === "read" ? <span className="text-xs text-muted-foreground">(mensagem lida — não significa que a proposta foi aberta)</span> : null}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Proposta aberta: {firstView ? <><span className="font-medium">{formatDateTime(firstView.occurredAt)}</span><CheckCheck className="h-4 w-4 text-emerald-500" /></> : <span className="text-muted-foreground">ainda não</span>}
            </li>
            <li className="text-xs text-muted-foreground">
              Visualizações: {proposal.viewCount}{proposal.lastViewedAt ? ` · última ${formatDateTime(proposal.lastViewedAt)}` : ""}{proposal.totalViewSeconds ? ` · leitura aprox. ${Math.round(proposal.totalViewSeconds / 60)} min` : ""}
            </li>
          </ul>
        ) : null}

        {proposal.status === "pending_approval" ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Condição fora da política — o envio fica bloqueado até o gestor aprovar.</p> : null}
        {proposal.status === "rejected" ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
            Cliente recusou a proposta{proposal.rejectionReason ? ` (${proposal.rejectionReason})` : ""}{proposal.rejectionComment ? ` — “${proposal.rejectionComment}”` : ""}.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={busy === "version"} onClick={() => run("version", async () => onSelect((await createProposalVersion(proposal.id, { workspaceId })).id), "Nova versão criada")}>Criar nova versão</Button>
              <Button size="sm" variant="secondary" onClick={onMarkLost}>Marcar oportunidade como perdida</Button>
              <span className="self-center text-xs">ou continue negociando pela conversa.</span>
            </div>
          </div>
        ) : null}
        {proposal.status === "accepted" && deal.status === "open" ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">Cliente aceitou. Finalize a oportunidade como ganha quando a venda estiver concluída.</p> : null}

        <div className="flex flex-wrap gap-2">
          {sendable || proposal.status === "pending_approval" ? (
            <GuardedButton size="sm" allowed={sendable} blockedReason="Aguardando aprovação do gestor para esta condição comercial." loading={busy === "send"} onClick={() => run("send", () => sendWhatsapp(false), "Proposta enviada pelo WhatsApp")}><Send className="mr-1.5 h-4 w-4" />Enviar pelo WhatsApp</GuardedButton>
          ) : null}
          {sendable ? (
            <Button size="sm" variant="secondary" loading={busy === "link"} onClick={() => run("link", async () => {
              await markProposalSent(proposal.id, workspaceId, "link");
            }, "Marcada como enviada")}><Copy className="mr-1.5 h-4 w-4" />Enviei por outro canal</Button>
          ) : null}
          {inAnalysis ? <Button size="sm" variant="secondary" loading={busy === "remind"} onClick={() => run("remind", () => sendWhatsapp(true), "Lembrete enviado")}><RefreshCw className="mr-1.5 h-4 w-4" />Lembrete pelo WhatsApp</Button> : null}
          {inAnalysis || proposal.status === "expired" ? <Button size="sm" variant="secondary" loading={busy === "version"} onClick={() => run("version", async () => onSelect((await createProposalVersion(proposal.id, { workspaceId })).id), "Nova versão criada (em rascunho)")}>Nova versão</Button> : null}
          {!["accepted", "cancelled", "superseded"].includes(proposal.status) ? <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}><XCircle className="mr-1.5 h-4 w-4" />Cancelar</Button> : null}
        </div>
        <ConfirmDialog
          open={confirmCancel}
          title={`Cancelar ${proposalLabel(proposal)}?`}
          description="O link enviado ao cliente deixa de funcionar e a proposta não poderá mais ser aceita. O histórico é mantido."
          confirmLabel="Cancelar proposta"
          cancelLabel="Voltar"
          variant="danger"
          busy={busy === "cancel"}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async () => { await run("cancel", () => cancelProposal(proposal.id, workspaceId), "Proposta cancelada"); setConfirmCancel(false); }}
        />

        {tracking?.events.length ? (
          <ol className="space-y-1 border-t border-border/60 pt-3">
            {tracking.events.slice().reverse().slice(0, 12).map((event) => (
              <li key={event.id} className="flex justify-between gap-2 text-xs">
                <span className="text-foreground">{PROPOSAL_EVENT_LABEL[event.eventType]}{event.payload.observed ? " (observado)" : ""}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {tracking && tracking.versions.length > 1 ? <p className="text-xs text-muted-foreground">Versões: {tracking.versions.map((version) => `v${version.version} (${PROPOSAL_STATUS_LABEL[version.status]})`).join(" · ")}</p> : null}
      </div>
    </DetailBlock>
  );
}

function Cell({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-sm tabular-nums", strong && "font-semibold")}>{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
