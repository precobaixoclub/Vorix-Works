"use client";

import { useState } from "react";
import { BriefcaseBusiness, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { QuickCreateDealModal } from "@/components/crm/QuickCreateDealModal";
import { createContact, linkContactIdentity } from "@/features/crm/api";
import type { Deal, ProposalWithToken } from "@/features/crm/types";
import type { InboxConversation } from "@/features/inbox/types";
import { createProposalFromDeal, sendProposalWhatsapp } from "@/features/sales/api";
import { useInvalidateSales } from "@/features/sales/hooks";
import { proposalLabel } from "@/features/sales/presentation";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { RBAC_COPY } from "@/lib/rbac";

/** Ação única "Criar oportunidade" no cabeçalho da conversa. Vincula o contato ao CRM sozinho
 * quando preciso e, depois de criada, oferece gerar a proposta com os produtos da oportunidade e
 * enviá-la nesta mesma conversa (gerar → revisar → aprovação se necessária → enviar). */
export function CreateOpportunityButton({
  workspaceId,
  conversation,
  canOperate,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  canOperate: boolean;
  onConversationChanged: () => Promise<unknown> | void;
}) {
  const invalidateSales = useInvalidateSales(workspaceId);
  const [contactId, setContactId] = useState<string | undefined>();
  const [linking, setLinking] = useState(false);
  const [createdDeal, setCreatedDeal] = useState<Deal | undefined>();
  const [askProposal, setAskProposal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [review, setReview] = useState<(ProposalWithToken & { approvalRequired: boolean }) | undefined>();
  const [sending, setSending] = useState(false);

  if (conversation.chatType === "group" || !conversation.contactId) return null;
  const contactName = conversation.contactName ?? conversation.contactPhone ?? "Contato do WhatsApp";

  function reset() {
    setAskProposal(false);
    setCreatedDeal(undefined);
    setContactId(undefined);
    setReview(undefined);
  }

  async function start() {
    if (conversation.crmContactId) {
      setContactId(conversation.crmContactId);
      return;
    }
    setLinking(true);
    try {
      const contact = await createContact({ workspaceId, name: contactName, origin: "whatsapp" });
      await linkContactIdentity(contact.id, workspaceId, "whatsapp", conversation.contactId!);
      await onConversationChanged();
      setContactId(contact.id);
    } catch (cause) {
      toast.error("Não foi possível vincular o contato ao CRM", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setLinking(false);
    }
  }

  async function generate() {
    if (!createdDeal) return;
    setGenerating(true);
    try {
      setReview(await createProposalFromDeal(createdDeal.id, { workspaceId }));
      setAskProposal(false);
      await invalidateSales();
    } catch (cause) {
      toast.error("Não foi possível gerar a proposta", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setGenerating(false);
    }
  }

  async function send() {
    if (!review) return;
    setSending(true);
    try {
      await sendProposalWhatsapp(review.id, { workspaceId, conversationId: conversation.id, idempotencyKey: `conv-${review.id}-${Date.now().toString(36)}` });
      toast.success("Proposta enviada nesta conversa.");
      await Promise.all([invalidateSales(), onConversationChanged()]);
      reset();
    } catch (cause) {
      toast.error("Não foi possível enviar", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <GuardedButton size="sm" variant="primary" onClick={() => void start()} loading={linking} disabled={linking} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
        <BriefcaseBusiness className="h-3.5 w-3.5" />
        Criar oportunidade
      </GuardedButton>

      {contactId && !createdDeal ? (
        <QuickCreateDealModal
          workspaceId={workspaceId}
          contactId={contactId}
          defaultOrigin="whatsapp"
          defaultOwnerUserId={conversation.assignedUserId}
          defaultTeamId={conversation.currentTeamId}
          onClose={() => setContactId(undefined)}
          onCreated={async (deal) => {
            setCreatedDeal(deal);
            setAskProposal(true);
            await invalidateSales();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={askProposal}
        title="Oportunidade criada"
        description={`Deseja gerar a proposta para ${contactName} agora? Ela usa os produtos e preços da oportunidade.`}
        confirmLabel="Gerar proposta"
        cancelLabel="Agora não"
        busy={generating}
        onConfirm={generate}
        onCancel={reset}
      />

      {review ? (
        <Modal title={`Revisar ${proposalLabel(review)}`} onClose={reset}>
          <div className="space-y-3 text-sm">
            <p className="font-medium">{review.title}</p>
            <ul className="space-y-1">
              {review.items.map((item, index) => <li key={index} className="flex justify-between gap-3"><span className="min-w-0 truncate">{String(item.quantity).replace(".", ",")} × {item.name}</span><span className="shrink-0 tabular-nums">{formatCurrencyCents(item.subtotalCents, review.currency)}</span></li>)}
            </ul>
            {review.discountCents > 0 ? <p className="flex justify-between text-muted-foreground"><span>Desconto</span><span className="tabular-nums">- {formatCurrencyCents(review.discountCents, review.currency)}</span></p> : null}
            <p className="flex justify-between border-t border-border/60 pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrencyCents(review.totalCents, review.currency)}</span></p>
            {review.validUntil ? <p className="text-muted-foreground">Válida até {formatDate(review.validUntil)}</p> : null}
            {review.approvalRequired ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Condição fora da política comercial — o pedido de aprovação foi enviado ao gestor. O envio libera assim que for aprovado.</p> : null}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={reset}>Revisar depois</Button>
              <GuardedButton className="flex-1" allowed={!review.approvalRequired} blockedReason="Aguardando aprovação do gestor." loading={sending} onClick={send}><Send className="mr-1.5 h-4 w-4" />Enviar no WhatsApp</GuardedButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
