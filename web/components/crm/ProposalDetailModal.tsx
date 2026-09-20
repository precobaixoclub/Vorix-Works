"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { regenerateProposalLink, revokeProposalLink, sendProposal } from "@/features/crm/api";
import type { Proposal } from "@/features/crm/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";

export function ProposalDetailModal({ workspaceId, proposal, contactName, dealTitle, conversationId, onClose, onChanged, onCreateNewProposal, onCreateFollowUp, onMarkDealLost }: {
  workspaceId: string;
  proposal: Proposal;
  contactName?: string;
  dealTitle?: string;
  conversationId?: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onCreateNewProposal?: () => void;
  onCreateFollowUp?: () => void;
  onMarkDealLost?: () => void;
}) {
  const [message, setMessage] = useState(`${contactName ? `Olá, ${contactName}! ` : "Olá! "}Preparei sua proposta comercial.\n\nVocê pode visualizar aqui:\n{{proposalUrl}}`);
  const [generatedLink, setGeneratedLink] = useState<string>();
  const [busy, setBusy] = useState<"send" | "link" | "revoke">();
  const canShare = ["draft", "sent", "viewed"].includes(proposal.status);
  // Item 18 do pedido — Subtotal/Desconto/"Respondida em" faltavam no resumo (só Total aparecia).
  // Subtotal somado direto dos itens (não `total + desconto`) pra ficar correto mesmo quando o
  // desconto excede o subtotal e `totalCents` é clampado em 0 (`computeItemsAndTotal`, backend).
  const subtotalCents = proposal.items.reduce((sum, item) => sum + item.subtotalCents, 0);

  async function send() {
    if (!conversationId) return;
    setBusy("send");
    try {
      await sendProposal(proposal.id, { workspaceId, conversationId, message, idempotencyKey: crypto.randomUUID() });
      await onChanged();
      toast.success(proposal.status === "draft" ? "Proposta enviada." : "Proposta reenviada.");
    } catch (cause) { toast.error("Não foi possível enviar pelo WhatsApp", { description: cause instanceof Error ? cause.message : "Tente novamente." }); }
    finally { setBusy(undefined); }
  }

  async function regenerate() {
    setBusy("link");
    try {
      const result = await regenerateProposalLink(proposal.id, workspaceId);
      setGeneratedLink(`${window.location.origin}/p/${result.publicToken}`);
      await onChanged();
    } catch (cause) { toast.error("Não foi possível gerar o link", { description: cause instanceof Error ? cause.message : "Tente novamente." }); }
    finally { setBusy(undefined); }
  }

  async function revoke() {
    setBusy("revoke");
    try { await revokeProposalLink(proposal.id, workspaceId); await onChanged(); toast.success("Link revogado."); }
    catch (cause) { toast.error("Não foi possível revogar o link", { description: cause instanceof Error ? cause.message : "Tente novamente." }); }
    finally { setBusy(undefined); }
  }

  return (
    <Modal title={proposal.title} onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{contactName ?? "Sem contato"}{dealTitle ? ` · ${dealTitle}` : ""}</p><StatusBadge status={proposal.status} /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Info label="Subtotal" value={formatCurrencyCents(subtotalCents, proposal.currency)} />
          <Info label="Desconto" value={formatCurrencyCents(proposal.discountCents, proposal.currency)} />
          <Info label="Total" value={formatCurrencyCents(proposal.totalCents, proposal.currency)} />
          <Info label="Validade" value={formatDate(proposal.validUntil)} />
          <Info label="Enviada" value={formatDateTime(proposal.sentAt)} />
          <Info label="Respondida" value={formatDateTime(proposal.respondedAt)} />
          <Info label="Primeira visualização" value={formatDateTime(proposal.viewedAt)} />
          <Info label="Última visualização" value={formatDateTime(proposal.lastViewedAt)} />
          <Info label="Visualizações" value={String(proposal.viewCount ?? 0)} />
        </div>
        <div className="space-y-2">{proposal.items.map((item, index) => <div key={index} className="flex justify-between gap-3 rounded-lg border px-3 py-2 text-sm"><span>{item.quantity}× {item.name}</span><span>{formatCurrencyCents(item.subtotalCents, proposal.currency)}</span></div>)}</div>
        {proposal.conditions ? <p className="whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">{proposal.conditions}</p> : null}
        {proposal.status === "rejected" ? <p className="text-sm text-muted-foreground">Motivo: {proposal.rejectionReason ?? "Não informado"}{proposal.rejectionComment ? ` · ${proposal.rejectionComment}` : ""}</p> : null}
        {proposal.status === "rejected" ? <div className="flex flex-wrap gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3"><Button variant="secondary" onClick={onCreateNewProposal}>Criar nova proposta</Button>{onCreateFollowUp ? <Button variant="secondary" onClick={onCreateFollowUp}>Criar follow-up</Button> : null}{onMarkDealLost ? <Button variant="ghost" onClick={onMarkDealLost}>Marcar negócio como perdido</Button> : null}</div> : null}

        {canShare && conversationId ? <div><Label htmlFor="proposal-message">Mensagem do WhatsApp</Label><Textarea id="proposal-message" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Use {"{{proposalUrl}}"} onde o link deve aparecer.</p></div> : null}
        {generatedLink ? <div><Label htmlFor="generated-proposal-link">Novo link</Label><div className="flex gap-2"><Input id="generated-proposal-link" value={generatedLink} readOnly onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(generatedLink)}>Copiar</Button></div></div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {canShare ? <Button variant="secondary" loading={busy === "link"} disabled={Boolean(busy)} onClick={regenerate}>Gerar novo link</Button> : null}
          {canShare && !proposal.publicLinkRevokedAt ? <Button variant="ghost" loading={busy === "revoke"} disabled={Boolean(busy)} onClick={revoke}>Revogar link</Button> : null}
          {canShare && conversationId ? <Button loading={busy === "send"} disabled={Boolean(busy) || !message.trim()} onClick={send}>{proposal.status === "draft" ? "Enviar no WhatsApp" : "Reenviar"}</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 px-3 py-2"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
