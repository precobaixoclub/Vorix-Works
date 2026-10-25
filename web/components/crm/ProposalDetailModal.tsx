"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { ProposalWhatsappDialog } from "@/components/sales/ProposalWhatsappDialog";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { ProposalRejectionDetails } from "@/components/crm/ProposalRejectionDetails";
import { CalendarPlus, FilePlus2, Link2, Link2Off, XCircle } from "lucide-react";
import { regenerateProposalLink, revokeProposalLink } from "@/features/crm/api";
import type { Proposal } from "@/features/crm/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";

export function ProposalDetailModal({ workspaceId, proposal, contactName, dealTitle, conversationId, onClose, onChanged, onCreateNewProposal, onCreateFollowUp, onMarkDealLost, onOpenContact, onOpenDeal }: {
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
  /** Jornada Comercial Fase 5, item 11 — nome do contato/negócio no header nunca deveria ser texto
   * morto quando dá pra abrir aquele contexto direto. Omitidos quando o chamador não tem como
   * navegar (ex.: sem `proposal.contactId`) ou não faz sentido no contexto atual. */
  onOpenContact?: (contactId: string) => void;
  onOpenDeal?: (dealId: string) => void;
}) {
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string>();
  const [busy, setBusy] = useState<"send" | "link" | "revoke">();
  const canShare = ["draft", "sent", "viewed"].includes(proposal.status);
  // Item 18 do pedido — Subtotal/Desconto/"Respondida em" faltavam no resumo (só Total aparecia).
  // Subtotal somado direto dos itens (não `total + desconto`) pra ficar correto mesmo quando o
  // desconto excede o subtotal e `totalCents` é clampado em 0 (`computeItemsAndTotal`, backend).
  const subtotalCents = proposal.items.reduce((sum, item) => sum + item.subtotalCents, 0);

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
        {proposal.status === "rejected" ? <ProposalRejectionDetails proposal={proposal}>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            {onCreateNewProposal ? <Button className="h-auto min-h-[44px] whitespace-normal" onClick={onCreateNewProposal}><FilePlus2 className="h-4 w-4" />Criar nova proposta</Button> : null}
            {onCreateFollowUp ? <Button variant="secondary" className="h-auto min-h-[44px] whitespace-normal border-border bg-muted/50" onClick={onCreateFollowUp}><CalendarPlus className="h-4 w-4" />Criar follow-up</Button> : null}
            {onMarkDealLost ? <Button variant="secondary" className="h-auto min-h-[44px] whitespace-normal border-destructive/30 bg-destructive/5 text-destructive" onClick={onMarkDealLost}><XCircle className="h-4 w-4" />Marcar oportunidade como perdida</Button> : null}
          </div>
        </ProposalRejectionDetails> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {proposal.contactId && onOpenContact ? (
              <button type="button" onClick={() => onOpenContact(proposal.contactId!)} className="underline-offset-2 hover:text-foreground hover:underline">{contactName ?? "Sem contato"}</button>
            ) : (
              <span>{contactName ?? "Sem contato"}</span>
            )}
            {dealTitle ? (
              <>
                <span>·</span>
                {proposal.dealId && onOpenDeal ? (
                  <button type="button" onClick={() => onOpenDeal(proposal.dealId!)} className="underline-offset-2 hover:text-foreground hover:underline">{dealTitle}</button>
                ) : (
                  <span>{dealTitle}</span>
                )}
              </>
            ) : null}
          </p>
          <StatusBadge status={proposal.status} />
        </div>
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

        {generatedLink ? <div><Label htmlFor="generated-proposal-link">Novo link</Label><div className="flex gap-2"><Input id="generated-proposal-link" value={generatedLink} readOnly onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(generatedLink)}>Copiar</Button></div></div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {canShare ? <Button variant="secondary" className="min-h-[44px] border-border bg-muted/50" loading={busy === "link"} disabled={Boolean(busy)} onClick={regenerate}><Link2 className="h-4 w-4" />Gerar novo link</Button> : null}
          {canShare && !proposal.publicLinkRevokedAt ? <Button variant="secondary" className="min-h-[44px] border-border bg-muted/50" loading={busy === "revoke"} disabled={Boolean(busy)} onClick={revoke}><Link2Off className="h-4 w-4" />Revogar link</Button> : null}
          {canShare && conversationId ? <Button disabled={Boolean(busy)} onClick={() => setWhatsappOpen(true)}>{proposal.status === "draft" ? "Enviar no WhatsApp" : "Reenviar"}</Button> : null}
        </div>
      </div>
      {whatsappOpen && conversationId ? <ProposalWhatsappDialog workspaceId={workspaceId} proposalId={proposal.id} conversationId={conversationId} onClose={() => setWhatsappOpen(false)} onSent={onChanged} /> : null}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 px-3 py-2"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
