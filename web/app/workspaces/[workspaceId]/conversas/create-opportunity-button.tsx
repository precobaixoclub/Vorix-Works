"use client";

import { useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardedButton } from "@/components/GuardedButton";
import { QuickCreateDealModal } from "@/components/crm/QuickCreateDealModal";
import { QuickCreateProposalModal } from "@/components/crm/QuickCreateProposalModal";
import { createContact, linkContactIdentity } from "@/features/crm/api";
import type { Deal } from "@/features/crm/types";
import type { InboxConversation } from "@/features/inbox/types";
import { RBAC_COPY } from "@/lib/rbac";

/** Ação única "Criar oportunidade" no cabeçalho da conversa (pedido do usuário: fora do painel
 * Detalhes, sem botões de proposta duplicados). Vincula o contato ao CRM sozinho quando ainda não
 * estiver vinculado e, depois de criada, pergunta se já quer gerar a proposta. */
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
  const { mutate: mutateGlobal } = useSWRConfig();
  const [contactId, setContactId] = useState<string | undefined>();
  const [linking, setLinking] = useState(false);
  const [createdDeal, setCreatedDeal] = useState<Deal | undefined>();
  const [askProposal, setAskProposal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);

  if (conversation.chatType === "group" || !conversation.contactId) return null;
  const contactName = conversation.contactName ?? conversation.contactPhone ?? "Contato do WhatsApp";

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

  const refreshCrm = (prefix: string) => mutateGlobal((key) => Array.isArray(key) && key[0] === prefix && key[1] === workspaceId);

  return (
    <>
      <GuardedButton size="sm" variant="secondary" onClick={() => void start()} loading={linking} disabled={linking} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
        <BriefcaseBusiness className="h-3.5 w-3.5" />
        Criar oportunidade
      </GuardedButton>

      {contactId && !createdDeal ? (
        <QuickCreateDealModal
          workspaceId={workspaceId}
          contactId={contactId}
          defaultOrigin="whatsapp"
          onClose={() => setContactId(undefined)}
          onCreated={async (deal) => {
            setCreatedDeal(deal);
            setAskProposal(true);
            await refreshCrm("deals");
          }}
        />
      ) : null}

      <ConfirmDialog
        open={askProposal}
        title="Oportunidade criada"
        description={`Deseja gerar uma proposta para ${contactName} agora?`}
        confirmLabel="Gerar proposta"
        cancelLabel="Agora não"
        onConfirm={() => { setAskProposal(false); setCreatingProposal(true); }}
        onCancel={() => { setAskProposal(false); setCreatedDeal(undefined); setContactId(undefined); }}
      />

      {creatingProposal && createdDeal && contactId ? (
        <QuickCreateProposalModal
          workspaceId={workspaceId}
          contactId={contactId}
          contactName={contactName}
          dealChoice={{ mode: "auto", dealId: createdDeal.id }}
          onClose={() => { setCreatingProposal(false); setCreatedDeal(undefined); setContactId(undefined); }}
          onCreated={async () => {
            setCreatingProposal(false);
            setCreatedDeal(undefined);
            setContactId(undefined);
            toast.success("Proposta criada", { description: "Ela aparece em Detalhes e na oportunidade." });
            await refreshCrm("proposals");
          }}
        />
      ) : null}
    </>
  );
}
