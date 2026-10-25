import type { InboxUseCaseDeps } from "../inbox/inbox-use-cases.js";
import { sendInboxMessage } from "../inbox/inbox-use-cases.js";
import type { ProposalUseCaseDeps } from "../crm/proposal-use-cases.js";
import { getProposal, regenerateProposalLink, sendProposal } from "../crm/proposal-use-cases.js";
import type { Proposal, ProposalDelivery, ProposalEvent, ProposalRecipient } from "../../domain/crm/crm.model.js";
import type { InboxMessageStatus } from "../../domain/inbox/inbox.model.js";
import { DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, DEFAULT_PROPOSAL_REMINDER_TEMPLATE, renderProposalMessage, proposalRecipientName, type ProposalMessageVariables } from "../../domain/sales/proposal-message.js";

/** Orquestrador explícito entre os bounded contexts CRM e Inbox. Nenhum dos dois importa o outro:
 * esta camada valida a relação Proposal -> Contact -> InboxConversation e só marca `sent` depois
 * que o pipeline normal da Inbox aceitou/enfileirou a mensagem. */
export type ProposalDeliveryDeps = ProposalUseCaseDeps & {
  inbox: InboxUseCaseDeps;
  appBaseUrl: string;
  /** Sales Engine — modelos configuráveis da mensagem (envio e lembrete). */
  messageTemplates?: (tenantId: string, workspaceId: string) => Promise<{ send: string; reminder: string }>;
  renderMessage?: (template: string, vars: ProposalMessageVariables) => string;
};

const SENDABLE_FIRST: readonly Proposal["status"][] = ["draft", "pending_approval", "approved"];

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

async function buildMessage(deps: ProposalDeliveryDeps, proposal: Proposal, kind: "send" | "reminder", explicit: string | undefined, proposalUrl: string): Promise<string> {
  if (explicit?.trim()) {
    return explicit.includes("{{proposalUrl}}") || explicit.includes("{{proposal_link}}")
      ? explicit.replaceAll("{{proposalUrl}}", proposalUrl).replaceAll("{{proposal_link}}", proposalUrl)
      : `${explicit.trim()}\n\n${proposalUrl}`;
  }
  const contact = proposal.contactId && deps.contactRepository ? await deps.contactRepository.getById(proposal.contactId) : undefined;
  const templates = deps.messageTemplates ? await deps.messageTemplates(proposal.tenantId, proposal.workspaceId) : { send: DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, reminder: DEFAULT_PROPOSAL_REMINDER_TEMPLATE };
  const vars = {
    nome: proposalRecipientName(contact?.name),
    valor: formatMoney(proposal.totalCents, proposal.currency),
    validade: proposal.validUntil ? proposal.validUntil.split("-").reverse().join("/") : undefined,
    proposal_link: proposalUrl,
    numero: proposal.number,
    titulo: proposal.title,
  };
  const template = kind === "send" ? templates.send : templates.reminder;
  return (deps.renderMessage ?? renderProposalMessage)(template, vars);
}

/** A preview never rotates the token, records a view, or dispatches a message. */
export async function previewProposalWhatsappMessage(deps: ProposalDeliveryDeps, input: { proposalId: string; tenantId: string; workspaceId: string; kind: "send" | "reminder" }): Promise<{ message: string }> {
  const proposal = await getProposal(deps, input);
  return { message: await buildMessage(deps, proposal, input.kind, undefined, "{{proposal_link}}") };
}

async function assertConversationOfContact(deps: ProposalDeliveryDeps, proposal: Proposal, conversationId: string): Promise<void> {
  if (!proposal.contactId) throw new Error("PROPOSAL_SEND_CONTEXT_INVALID: proposta sem contato não pode ser enviada à conversa.");
  const contactConversations = await deps.inbox.conversationRepository.listByWorkspace({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, contactId: proposal.contactId });
  if (!contactConversations.some((conversation) => conversation.id === conversationId)) throw new Error("PROPOSAL_SEND_CONTEXT_INVALID: conversa não pertence ao contato da proposta.");
}

export async function deliverProposalThroughInbox(deps: ProposalDeliveryDeps, input: {
  proposalId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  /** Opcional: sem texto, usa o modelo configurado do workspace (com {{proposal_link}}). */
  message?: string;
  idempotencyKey: string;
  sentByUserId: string;
}): Promise<Proposal> {
  const proposal = await getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  await assertConversationOfContact(deps, proposal, input.conversationId);
  if (!SENDABLE_FIRST.includes(proposal.status) && proposal.status !== "sent" && proposal.status !== "viewed") {
    throw new Error(`PROPOSAL_NOT_SENDABLE: proposta com status "${proposal.status}" não pode ser enviada.`);
  }
  // Gate ANTES de qualquer mensagem sair: condição fora da política sem aprovação nunca é enviada.
  if (SENDABLE_FIRST.includes(proposal.status)) await deps.approvalGate?.(proposal);

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
    // Duplo clique/repetição com a mesma chave: nunca envia a segunda mensagem.
    const current = await getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
    return SENDABLE_FIRST.includes(current.status) ? sendProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId, actorUserId: input.sentByUserId, channel: "whatsapp", conversationId: input.conversationId }) : current;
  }

  let dispatchStarted = false;
  try {
    const { rawToken } = await regenerateProposalLink(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
    const proposalUrl = new URL(`/p/${rawToken}`, deps.appBaseUrl).toString();
    const text = await buildMessage(deps, proposal, "send", input.message, proposalUrl);
    // From this point Inbox may have persisted the message even if queue publication throws.
    // Keeping the reservation pending prevents a second send while reconciliation recovers it.
    dispatchStarted = true;
    const message = await sendInboxMessage(deps.inbox, { tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: input.conversationId, body: text, sentByUserId: input.sentByUserId, linkPreview: true });
    await deps.proposalRepository.completeDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, inboxMessageId: message.id, queuedAt: new Date().toISOString() });
    return sendProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId, actorUserId: input.sentByUserId, channel: "whatsapp", conversationId: input.conversationId, messageId: message.id });
  } catch (error) {
    if (!dispatchStarted) await deps.proposalRepository.failDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Lembrete pelo WhatsApp (ação manual do vendedor — nunca automático). O link é renovado: só o
 * HASH do token é guardado, então o lembrete carrega o link novo e o anterior deixa de valer. */
export async function sendProposalReminderThroughInbox(deps: ProposalDeliveryDeps, input: { proposalId: string; tenantId: string; workspaceId: string; conversationId: string; message?: string; idempotencyKey: string; sentByUserId: string }): Promise<Proposal> {
  const proposal = await getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (proposal.status !== "sent" && proposal.status !== "viewed") throw new Error("PROPOSAL_NOT_SENDABLE: só é possível lembrar uma proposta enviada e ainda em análise.");
  await assertConversationOfContact(deps, proposal, input.conversationId);
  const reservation = await deps.proposalRepository.reserveDelivery({
    id: `proposal-delivery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId, workspaceId: input.workspaceId, proposalId: input.proposalId, conversationId: input.conversationId, idempotencyKey: input.idempotencyKey,
  });
  if (reservation !== "reserved") return proposal;
  let dispatchStarted = false;
  try {
    const { rawToken } = await regenerateProposalLink(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
    const proposalUrl = new URL(`/p/${rawToken}`, deps.appBaseUrl).toString();
    const text = await buildMessage(deps, proposal, "reminder", input.message, proposalUrl);
    dispatchStarted = true;
    const message = await sendInboxMessage(deps.inbox, { tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: input.conversationId, body: text, sentByUserId: input.sentByUserId, linkPreview: true });
    await deps.proposalRepository.completeDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, inboxMessageId: message.id, queuedAt: new Date().toISOString() });
    await deps.proposalRepository.appendEvent({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, eventType: "reminder_sent", payload: { channel: "whatsapp", conversationId: input.conversationId, messageId: message.id, byUserId: input.sentByUserId } });
    return getProposal(deps, { proposalId: input.proposalId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  } catch (error) {
    if (!dispatchStarted) await deps.proposalRepository.failDelivery({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export type ProposalTracking = {
  proposal: Proposal;
  /** Status de ENTREGA da mensagem (provider) — nunca confundido com a proposta aberta. */
  deliveries: (ProposalDelivery & { messageStatus?: InboxMessageStatus })[];
  events: ProposalEvent[];
  recipients: ProposalRecipient[];
  versions: { id: string; version: number; status: Proposal["status"]; sentAt?: string; totalCents: number }[];
};

const MESSAGE_EVENT: Partial<Record<InboxMessageStatus, "delivered" | "whatsapp_read" | "whatsapp_failed">> = { delivered: "delivered", read: "whatsapp_read", failed: "whatsapp_failed" };

export async function getProposalTracking(deps: ProposalDeliveryDeps, input: { proposalId: string; tenantId: string; workspaceId: string }): Promise<ProposalTracking> {
  const proposal = await getProposal(deps, input);
  const deliveries = await deps.proposalRepository.listDeliveries(proposal.id);
  const withStatus = await Promise.all(deliveries.map(async (delivery) => {
    const message = delivery.inboxMessageId ? await deps.inbox.messageRepository.getById(delivery.inboxMessageId) : undefined;
    const messageStatus = message && message.tenantId === proposal.tenantId ? message.status : undefined;
    // Status observado do provider vira evento (uma vez). Leitura da MENSAGEM ≠ proposta aberta.
    if (messageStatus) {
      const reached: ("delivered" | "whatsapp_read" | "whatsapp_failed")[] = messageStatus === "read" ? ["delivered", "whatsapp_read"] : MESSAGE_EVENT[messageStatus] ? [MESSAGE_EVENT[messageStatus] as "delivered"] : [];
      for (const eventType of reached) {
        await deps.proposalRepository.appendEvent({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, proposalId: proposal.id, eventType, payload: { messageId: delivery.inboxMessageId, observed: true } });
      }
    }
    return { ...delivery, messageStatus };
  }));
  const [events, recipients, versions] = await Promise.all([
    deps.proposalRepository.listEvents(proposal.id),
    deps.proposalRepository.listRecipients(proposal.id),
    deps.proposalRepository.listVersions(proposal.rootProposalId),
  ]);
  return {
    proposal,
    deliveries: withStatus,
    events,
    recipients,
    versions: versions.map((version) => ({ id: version.id, version: version.version, status: version.status, sentAt: version.sentAt, totalCents: version.totalCents })),
  };
}

/** Propostas enviadas numa conversa — o chat mostra o cartão da proposta junto da mensagem. */
export async function listConversationProposals(deps: ProposalDeliveryDeps, input: { tenantId: string; workspaceId: string; conversationId: string }) {
  const deliveries = await deps.proposalRepository.listDeliveriesByConversation(input);
  return deliveries.map((delivery) => ({
    inboxMessageId: delivery.inboxMessageId,
    proposalId: delivery.proposal.id,
    dealId: delivery.proposal.dealId,
    number: delivery.proposal.number,
    version: delivery.proposal.version,
    title: delivery.proposal.title,
    totalCents: delivery.proposal.totalCents,
    currency: delivery.proposal.currency,
    status: delivery.proposal.status,
    viewCount: delivery.proposal.viewCount,
    lastViewedAt: delivery.proposal.lastViewedAt,
    validUntil: delivery.proposal.validUntil,
  }));
}
