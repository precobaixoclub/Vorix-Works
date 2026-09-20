import type { InboxUseCaseDeps } from "../inbox/inbox-use-cases.js";
import { sendInboxMessage } from "../inbox/inbox-use-cases.js";
import type { ProposalUseCaseDeps } from "../crm/proposal-use-cases.js";
import { getProposal, regenerateProposalLink, sendProposal } from "../crm/proposal-use-cases.js";
import type { Proposal } from "../../domain/crm/crm.model.js";

/** Orquestrador explícito entre os bounded contexts CRM e Inbox. Nenhum dos dois importa o outro:
 * esta camada valida a relação Proposal -> Contact -> InboxConversation e só marca `sent` depois
 * que o pipeline normal da Inbox aceitou/enfileirou a mensagem. */
export type ProposalDeliveryDeps = ProposalUseCaseDeps & { inbox: InboxUseCaseDeps; appBaseUrl: string };

export async function deliverProposalThroughInbox(deps: ProposalDeliveryDeps, input: {
  proposalId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  message: string;
  idempotencyKey: string;
  sentByUserId: string;
}): Promise<Proposal> {
  const proposal = await getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (!proposal.contactId) throw new Error("PROPOSAL_SEND_CONTEXT_INVALID: proposta sem contato não pode ser enviada à conversa.");
  const contactConversations = await deps.inbox.conversationRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId, contactId: proposal.contactId });
  if (!contactConversations.some((conversation) => conversation.id === input.conversationId)) throw new Error("PROPOSAL_SEND_CONTEXT_INVALID: conversa não pertence ao contato da proposta.");

  const reservation = await deps.proposalRepository.reserveDelivery({
    id: `proposal-delivery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    proposalId: input.proposalId,
    conversationId: input.conversationId,
    idempotencyKey: input.idempotencyKey,
  });
  if (reservation === "pending") throw new Error("PROPOSAL_SEND_IN_PROGRESS: este envio já está em processamento.");
  if (reservation === "queued") {
    const current = await getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
    return current.status === "draft" ? sendProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId }) : current;
  }

  let dispatchStarted = false;
  try {
    const { rawToken } = await regenerateProposalLink(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
    const proposalUrl = new URL(`/p/${rawToken}`, deps.appBaseUrl).toString();
    const text = input.message.includes("{{proposalUrl}}") ? input.message.replaceAll("{{proposalUrl}}", proposalUrl) : `${input.message.trim()}\n\n${proposalUrl}`;
    // From this point Inbox may have persisted the message even if queue publication throws.
    // Keeping the reservation pending prevents a second send while reconciliation recovers it.
    dispatchStarted = true;
    const message = await sendInboxMessage(deps.inbox, { tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: input.conversationId, body: text, sentByUserId: input.sentByUserId });
    await deps.proposalRepository.completeDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, inboxMessageId: message.id, queuedAt: new Date().toISOString() });
    return sendProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  } catch (error) {
    if (!dispatchStarted) await deps.proposalRepository.failDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
