import type { MeetingCrmPort, MeetingMessagingPort } from "../../application/meetings/meeting-intelligence.js";
import { createTask } from "../../application/crm/task-use-cases.js";
import { startInboxConversation, type InboxUseCaseDeps } from "../../application/inbox/inbox-use-cases.js";
import type { ContactIdentityRepositoryPort } from "../../application/ports/contact-identity-repository.port.js";
import type { ContactRepositoryPort } from "../../application/ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../../application/ports/deal-repository.port.js";
import type { TaskRepositoryPort } from "../../application/ports/task-repository.port.js";
import type { TimelineEventRepositoryPort } from "../../application/ports/timeline-event-repository.port.js";

/**
 * Pontes do Vorix Meetings com o CRM e o Conversas — montadas SÓ aqui, na composição da API. O
 * Meetings continua sem importar `crm`/`inbox` (só conhece as portas `MeetingCrmPort` /
 * `MeetingMessagingPort`).
 */

export function buildMeetingCrmBridge(deps: {
  contactRepository: ContactRepositoryPort;
  contactIdentityRepository: ContactIdentityRepositoryPort;
  dealRepository: DealRepositoryPort;
  taskRepository: TaskRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
}): MeetingCrmPort {
  const whatsappPhoneOf = async (contactId: string) => (await deps.contactIdentityRepository.listByContact(contactId)).find((identity) => identity.channel === "whatsapp")?.externalId;
  const toDeal = (deal: { id: string; title: string; valueCents: number; currency: string; wonAt?: string; lostAt?: string; contactId?: string }) => ({
    id: deal.id, title: deal.title, valueCents: deal.valueCents, currency: deal.currency, won: !!deal.wonAt, lost: !!deal.lostAt, ...(deal.contactId ? { contactId: deal.contactId } : {}),
  });
  return {
    async searchContacts({ tenantId, workspaceId, query, limit }) {
      const contacts = await deps.contactRepository.listByWorkspace({ tenantId, workspaceId, search: query, limit });
      return Promise.all(contacts.map(async (contact) => {
        const phone = await whatsappPhoneOf(contact.id);
        return { id: contact.id, name: contact.name, ...(contact.company ? { company: contact.company } : {}), ...(phone ? { whatsappPhone: phone } : {}) };
      }));
    },
    async getContact({ tenantId, workspaceId, contactId }) {
      const contact = await deps.contactRepository.getById(contactId);
      if (!contact || contact.tenantId !== tenantId || contact.workspaceId !== workspaceId) return undefined;
      const phone = await whatsappPhoneOf(contact.id);
      return { id: contact.id, name: contact.name, ...(contact.company ? { company: contact.company } : {}), ...(phone ? { whatsappPhone: phone } : {}) };
    },
    async listDeals({ tenantId, workspaceId, contactId }) {
      return (await deps.dealRepository.listByWorkspace({ tenantId, workspaceId, contactId })).map(toDeal);
    },
    async getDeal({ tenantId, workspaceId, dealId }) {
      const deal = await deps.dealRepository.getById(dealId);
      if (!deal || deal.tenantId !== tenantId || deal.workspaceId !== workspaceId) return undefined;
      return toDeal(deal);
    },
    async createTask(input) {
      const task = await createTask(
        { taskRepository: deps.taskRepository, timelineEventRepository: deps.timelineEventRepository },
        {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          type: "follow_up",
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
          ...(input.contactId ? { contactId: input.contactId } : {}),
          ...(input.dealId ? { dealId: input.dealId } : {}),
        },
      );
      return { taskId: task.id };
    },
  };
}

export function buildMeetingMessagingBridge(inboxDeps: InboxUseCaseDeps, hasConversations: (tenantId: string) => Promise<boolean>): MeetingMessagingPort {
  return {
    isAvailable: hasConversations,
    async listWhatsAppChannels({ tenantId, workspaceId }) {
      const connections = await inboxDeps.connectionRepository.listByWorkspace({ tenantId, workspaceId });
      return connections.filter((connection) => connection.provider === "wuzapi" && connection.status === "connected").map((connection) => ({ id: connection.id, label: `${connection.displayName}${connection.phoneNumber ? ` · ${connection.phoneNumber}` : ""}` }));
    },
    async sendWhatsApp(input) {
      const result = await startInboxConversation(inboxDeps, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        phone: input.phone,
        ...(input.contactName ? { name: input.contactName } : {}),
        body: input.body,
        startedByUserId: input.userId,
      });
      return { conversationId: result.conversation.id };
    },
  };
}
