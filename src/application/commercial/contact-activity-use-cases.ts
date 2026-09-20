import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { TaskRepositoryPort } from "../ports/task-repository.port.js";
import type { ProposalRepositoryPort } from "../ports/proposal-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import type { Deal, Proposal, Task, TimelineEvent } from "../../domain/crm/crm.model.js";
import type { InboxConversationRepositoryPort, InboxConversationListItem } from "../ports/inbox-conversation-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationEvent } from "../../domain/inbox/inbox.model.js";

/**
 * Jornada Comercial, Fase 5 — TIMELINE COMERCIAL 360. Ponte NEUTRA (mesmo racional de
 * `commercial-bridge` na Fase 1 e `proposal-delivery-use-cases.ts` na Fase 4): agrega, em modo
 * LEITURA apenas, os eventos já gravados em `timeline_events` (CRM: contact/deal/task/proposal) com
 * os eventos operacionais de `inbox_conversation_events` (Conversas), sem criar uma terceira tabela
 * de eventos e sem o CRM importar Inbox diretamente — só através de `inbox.conversationRepository`/
 * `inbox.conversationEventRepository`, injetados pelo composition root exatamente como
 * `sharedInboxDeps` já é passado para `delivery` em `proposals.route.ts`. `inbox` é OPCIONAL: se o
 * módulo Conversas estiver desligado neste ambiente (`CONVERSATIONS_MODULE_ENABLED=false`), a
 * Timeline 360 continua funcionando só com os eventos CRM.
 *
 * NUNCA inclui mensagens de WhatsApp (isso seria a Inbox inteira virando ruído na Timeline) nem os
 * eventos `ai_response_*`/`ai_response_skipped_insufficient_credits`/token público/JID/LID — ver
 * `mapConversationEvent` abaixo para a lista exata (branca, não negativa) de tipos aceitos.
 */
export type ContactActivityUseCaseDeps = {
  contactRepository: ContactRepositoryPort;
  dealRepository: DealRepositoryPort;
  taskRepository: TaskRepositoryPort;
  proposalRepository: ProposalRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  inbox?: {
    conversationRepository: InboxConversationRepositoryPort;
    conversationEventRepository: InboxConversationEventRepositoryPort;
  };
};

export type ContactActivityCategory = "contact" | "conversation" | "deal" | "task" | "proposal";

/** Ator normalizado pra exibição — nunca um UUID cru na tela. `label` só é preenchido aqui para os
 * tipos fixos (Sistema/IA/Automação/Cliente); para `type: "user"`, o frontend resolve o nome real a
 * partir de `id` usando a mesma lista de membros já carregada (mesmo padrão de `userLabel`, ver
 * `web/features/crm/presentation.ts`) — o backend não tem motivo pra duplicar essa tabela. */
export type ContactActivityActor =
  | { type: "user"; id: string }
  | { type: "system" | "ai" | "automation" | "contact" };

export type ContactActivityItem = {
  id: string;
  type: string;
  category: ContactActivityCategory;
  occurredAt: string;
  actor: ContactActivityActor;
  title: string;
  description?: string;
  entityType?: "contact" | "deal" | "task" | "proposal" | "conversation";
  entityId?: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_LIMIT = 50;

function actorFor(event: { actorType: TimelineEvent["actorType"]; actorId?: string }, overrideAsContact = false): ContactActivityActor {
  if (overrideAsContact) return { type: "contact" };
  if (event.actorType === "user" && event.actorId) return { type: "user", id: event.actorId };
  if (event.actorType === "ai") return { type: "ai" };
  if (event.actorType === "automation") return { type: "automation" };
  return { type: "system" };
}

function mapContactEvent(event: TimelineEvent): ContactActivityItem | undefined {
  if (event.eventType === "contact_created") {
    return { id: event.id, type: "contact_created", category: "contact", occurredAt: event.occurredAt, actor: actorFor(event), title: "Contato criado", entityType: "contact", entityId: event.entityId };
  }
  if (event.eventType === "identity_linked") {
    const channel = typeof event.payload?.channel === "string" ? event.payload.channel : undefined;
    return { id: event.id, type: "identity_linked", category: "contact", occurredAt: event.occurredAt, actor: actorFor(event), title: "Canal vinculado", description: channel ? `Canal: ${channel}` : undefined, entityType: "contact", entityId: event.entityId };
  }
  return undefined;
}

/** Eventos `deal_stage_changed` só carregam `isWon`/`isLost` da etapa DE DESTINO — pra distinguir
 * "reaberto" (saiu de uma etapa terminal pra uma aberta) é preciso olhar a sequência cronológica do
 * PRÓPRIO negócio, não um evento isolado. Por isso os eventos de cada deal são processados juntos,
 * em ordem crescente, antes de entrarem na lista final (que depois é reordenada por `occurredAt`). */
function mapDealEvents(deal: Deal, events: readonly TimelineEvent[]): ContactActivityItem[] {
  const stageEvents = events.filter((event) => event.eventType === "deal_stage_changed").slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let wasTerminal = false;
  const stageItems: ContactActivityItem[] = stageEvents.map((event) => {
    const isWon = event.payload?.isWon === true;
    const isLost = event.payload?.isLost === true;
    let type = "deal_stage_changed";
    let title = `Etapa de "${deal.title}" alterada`;
    if (isWon) { type = "deal_won"; title = `Negócio "${deal.title}" ganho`; }
    else if (isLost) { type = "deal_lost"; title = `Negócio "${deal.title}" perdido`; }
    else if (wasTerminal) { type = "deal_reopened"; title = `Negócio "${deal.title}" reaberto`; }
    wasTerminal = isWon || isLost;
    const lossReason = typeof event.payload?.lossReason === "string" ? event.payload.lossReason : undefined;
    const trigger = typeof event.payload?.trigger === "string" ? event.payload.trigger : undefined;
    return {
      id: event.id,
      type,
      category: "deal",
      occurredAt: event.occurredAt,
      actor: actorFor(event),
      title,
      description: lossReason ? `Motivo: ${lossReason}` : trigger === "proposal_accepted" ? "Movido automaticamente após aceite da proposta." : undefined,
      entityType: "deal",
      entityId: deal.id,
      metadata: { dealId: deal.id, fromStageId: event.payload?.fromStageId, toStageId: event.payload?.toStageId },
    } satisfies ContactActivityItem;
  });
  const createdEvent = events.find((event) => event.eventType === "deal_created");
  const createdItem: ContactActivityItem[] = createdEvent
    ? [{ id: createdEvent.id, type: "deal_created", category: "deal", occurredAt: createdEvent.occurredAt, actor: actorFor(createdEvent), title: `Negócio "${deal.title}" criado`, entityType: "deal", entityId: deal.id, metadata: { dealId: deal.id } }]
    : [];
  return [...createdItem, ...stageItems];
}

function mapTaskEvents(task: Task, events: readonly TimelineEvent[]): ContactActivityItem[] {
  const items: ContactActivityItem[] = [];
  for (const event of events) {
    if (event.eventType === "task_created") {
      items.push({ id: event.id, type: "task_created", category: "task", occurredAt: event.occurredAt, actor: actorFor(event), title: `Tarefa "${task.title}" criada`, entityType: "task", entityId: task.id, metadata: { taskId: task.id } });
    } else if (event.eventType === "task_rescheduled") {
      const toDueAt = typeof event.payload?.toDueAt === "string" ? event.payload.toDueAt : undefined;
      items.push({ id: event.id, type: "task_rescheduled", category: "task", occurredAt: event.occurredAt, actor: actorFor(event), title: `Tarefa "${task.title}" reagendada`, description: toDueAt ? `Nova data: ${toDueAt}` : undefined, entityType: "task", entityId: task.id, metadata: { taskId: task.id } });
    } else if (event.eventType === "task_completed") {
      items.push({ id: event.id, type: "task_completed", category: "task", occurredAt: event.occurredAt, actor: actorFor(event), title: `Tarefa "${task.title}" concluída`, entityType: "task", entityId: task.id, metadata: { taskId: task.id } });
    } else if (event.eventType === "task_cancelled") {
      items.push({ id: event.id, type: "task_cancelled", category: "task", occurredAt: event.occurredAt, actor: actorFor(event), title: `Tarefa "${task.title}" cancelada`, entityType: "task", entityId: task.id, metadata: { taskId: task.id } });
    }
  }
  return items;
}

/** `proposal_viewed`/`proposal_accepted`/`proposal_rejected` são gravados com `actorType: "system"`
 * (é a página pública, sem sessão de usuário, quem os dispara) — mas quem realmente age ali é o
 * CLIENTE, nunca "o sistema" no sentido de automação interna. Só na Timeline 360 (camada de
 * apresentação, não muda o dado gravado) esses 3 tipos ganham `actor: {type: "contact"}`. */
const PROPOSAL_CUSTOMER_ACTIONS = new Set(["proposal_viewed", "proposal_accepted", "proposal_rejected"]);

function mapProposalEvents(proposal: Proposal, events: readonly TimelineEvent[]): ContactActivityItem[] {
  const items: ContactActivityItem[] = [];
  for (const event of events) {
    const asCustomer = PROPOSAL_CUSTOMER_ACTIONS.has(event.eventType);
    const actor = actorFor(event, asCustomer);
    if (event.eventType === "proposal_created") {
      items.push({ id: event.id, type: "proposal_created", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" criada`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_sent") {
      items.push({ id: event.id, type: "proposal_sent", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" enviada`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_resent") {
      items.push({ id: event.id, type: "proposal_resent", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" reenviada`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_link_regenerated") {
      items.push({ id: event.id, type: "proposal_link_regenerated", category: "proposal", occurredAt: event.occurredAt, actor, title: "Link da proposta regenerado", entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_viewed") {
      items.push({ id: event.id, type: "proposal_viewed", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" visualizada pelo cliente`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_accepted") {
      items.push({ id: event.id, type: "proposal_accepted", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" aceita pelo cliente`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    } else if (event.eventType === "proposal_rejected") {
      const reason = typeof event.payload?.reason === "string" ? event.payload.reason : undefined;
      items.push({ id: event.id, type: "proposal_rejected", category: "proposal", occurredAt: event.occurredAt, actor, title: `Proposta "${proposal.title}" recusada pelo cliente`, description: reason ? `Motivo: ${reason}` : undefined, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
    }
  }
  // Sintético — a expiração de proposta é lida sob demanda (`respondToPublicProposal`/`listProposals`
  // marcam `status: "expired"` na leitura, nunca gravam um `timelineEventRepository.record` próprio,
  // ver `proposal-use-cases.ts`). Deriva o evento a partir do estado atual real (nunca inventado):
  // só aparece quando `proposal.status === "expired"` de fato, com `occurredAt = validUntil`.
  if (proposal.status === "expired" && proposal.validUntil) {
    items.push({ id: `${proposal.id}:expired`, type: "proposal_expired", category: "proposal", occurredAt: proposal.validUntil, actor: { type: "system" }, title: `Proposta "${proposal.title}" expirada`, entityType: "proposal", entityId: proposal.id, metadata: { proposalId: proposal.id } });
  }
  return items;
}

const CONVERSATION_ENTITY: { entityType: "conversation" } = { entityType: "conversation" };

function mapConversationEvent(event: InboxConversationEvent): ContactActivityItem | undefined {
  const base = { id: event.id, category: "conversation" as const, occurredAt: event.createdAt, entityType: CONVERSATION_ENTITY.entityType, entityId: event.conversationId, metadata: { conversationId: event.conversationId } };
  if (event.type === "took_over") {
    return { ...base, type: "conversation_took_over", actor: { type: "user", id: event.performedBy }, title: "Atendimento assumido" };
  }
  if (event.type === "transferred") {
    return { ...base, type: "conversation_transferred", actor: { type: "user", id: event.performedBy }, title: "Conversa transferida" };
  }
  if (event.type === "ai_paused") {
    return { ...base, type: "conversation_ai_paused", actor: { type: "user", id: event.performedBy }, title: "IA pausada nesta conversa" };
  }
  if (event.type === "ai_resumed") {
    return { ...base, type: "conversation_ai_resumed", actor: { type: "user", id: event.performedBy }, title: "IA retomada nesta conversa" };
  }
  if (event.type === "status_changed") {
    if (event.toStatus === "resolved") {
      return { ...base, type: "conversation_resolved", actor: { type: "user", id: event.performedBy }, title: "Conversa finalizada" };
    }
    if (event.fromStatus === "resolved") {
      return { ...base, type: "conversation_reopened", actor: { type: "user", id: event.performedBy }, title: "Conversa reaberta" };
    }
    return undefined;
  }
  // `assigned`/`unassigned`/`kanban_phase_changed`/`ai_response_*`/
  // `ai_response_skipped_insufficient_credits` — deliberadamente fora da Timeline 360 (ruído
  // operacional interno da Inbox, ou dado sensível de IA que nunca deve aparecer aqui, ver
  // comentário de topo do arquivo).
  return undefined;
}

function mapConversationStarted(conversation: InboxConversationListItem): ContactActivityItem {
  return { id: `${conversation.id}:started`, type: "conversation_started", category: "conversation", occurredAt: conversation.createdAt, actor: { type: "contact" }, title: "Conversa iniciada", entityType: "conversation", entityId: conversation.id, metadata: { conversationId: conversation.id } };
}

function tieBreakSort(a: ContactActivityItem, b: ContactActivityItem): number {
  const byTime = b.occurredAt.localeCompare(a.occurredAt);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/** Guard local (não reaproveita `mustContactBelongToTenantAndWorkspace` de `contact-use-cases.ts`
 * porque aquela função exige `ContactUseCaseDeps` inteiro, incluindo `contactIdentityRepository` —
 * dependência que este agregador nunca usa; mesma checagem, nunca 403, sempre 404). */
async function mustContactBelongToTenantAndWorkspace(deps: Pick<ContactActivityUseCaseDeps, "contactRepository">, contactId: string, tenantId: string, workspaceId: string) {
  const contact = await deps.contactRepository.getById(contactId);
  if (!contact || contact.tenantId !== tenantId || contact.workspaceId !== workspaceId) {
    throw new Error(`CONTACT_NOT_FOUND: contato "${contactId}" não existe.`);
  }
  return contact;
}

export async function getContactActivity(deps: ContactActivityUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string; limit?: number }): Promise<ContactActivityItem[]> {
  const { tenantId, workspaceId } = input;
  await mustContactBelongToTenantAndWorkspace(deps, input.contactId, tenantId, workspaceId);

  const [contactEvents, deals, tasks, proposals, conversations] = await Promise.all([
    deps.timelineEventRepository.listByEntity({ entityType: "contact", entityId: input.contactId }),
    deps.dealRepository.listByWorkspace({ tenantId, workspaceId, contactId: input.contactId }),
    deps.taskRepository.listByWorkspace({ tenantId, workspaceId, contactId: input.contactId }),
    deps.proposalRepository.listByWorkspace({ tenantId, workspaceId, contactId: input.contactId }),
    deps.inbox ? deps.inbox.conversationRepository.listByWorkspace({ tenantId, workspaceId, contactId: input.contactId }) : Promise.resolve([]),
  ]);

  const activeConversations = conversations.filter((conversation) => conversation.mergeStatus !== "merged");

  const [dealEventLists, taskEventLists, proposalEventLists, conversationEventLists] = await Promise.all([
    Promise.all(deals.map((deal) => deps.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id }))),
    Promise.all(tasks.map((task) => deps.timelineEventRepository.listByEntity({ entityType: "task", entityId: task.id }))),
    Promise.all(proposals.map((proposal) => deps.timelineEventRepository.listByEntity({ entityType: "proposal", entityId: proposal.id }))),
    deps.inbox
      ? Promise.all(activeConversations.map((conversation) => deps.inbox!.conversationEventRepository.listByConversation({ tenantId, workspaceId, conversationId: conversation.id })))
      : Promise.resolve([]),
  ]);

  const items: ContactActivityItem[] = [];
  for (const event of contactEvents) {
    const mapped = mapContactEvent(event);
    if (mapped) items.push(mapped);
  }
  deals.forEach((deal, index) => items.push(...mapDealEvents(deal, dealEventLists[index] ?? [])));
  tasks.forEach((task, index) => items.push(...mapTaskEvents(task, taskEventLists[index] ?? [])));
  proposals.forEach((proposal, index) => items.push(...mapProposalEvents(proposal, proposalEventLists[index] ?? [])));
  activeConversations.forEach((conversation, index) => {
    items.push(mapConversationStarted(conversation));
    for (const event of conversationEventLists[index] ?? []) {
      const mapped = mapConversationEvent(event);
      if (mapped) items.push(mapped);
    }
  });

  const deduped = Array.from(new Map(items.map((item) => [`${item.category}:${item.id}`, item])).values());
  deduped.sort(tieBreakSort);
  return deduped.slice(0, input.limit ?? DEFAULT_LIMIT);
}
