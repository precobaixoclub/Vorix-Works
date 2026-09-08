import type { ContactIdentityRepositoryPort } from "../ports/contact-identity-repository.port.js";
import type { ContactRepositoryPort, CreateContactInput, UpdateContactInput } from "../ports/contact-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { evaluateAutomationTrigger, type AutomationUseCaseDeps } from "./automation-use-cases.js";
import type { Contact, ContactChannel, ContactIdentity, TimelineEvent } from "../../domain/crm/crm.model.js";

export type ContactUseCaseDeps = {
  contactRepository: ContactRepositoryPort;
  contactIdentityRepository: ContactIdentityRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** Fase 6 — opcional de propósito, mesmo racional de `DealUseCaseDeps.automation`. */
  automation?: AutomationUseCaseDeps;
};

/** Guard de tenant/workspace — nunca 403 (não revela existência cross-tenant), sempre 404. */
export async function mustContactBelongToTenantAndWorkspace(deps: ContactUseCaseDeps, contactId: string, tenantId: string, workspaceId: string): Promise<Contact> {
  const contact = await deps.contactRepository.getById(contactId);
  if (!contact || contact.tenantId !== tenantId || contact.workspaceId !== workspaceId) {
    throw new Error(`CONTACT_NOT_FOUND: contato "${contactId}" não existe.`);
  }
  return contact;
}

export async function createContact(deps: ContactUseCaseDeps, input: CreateContactInput): Promise<Contact> {
  const contact = await deps.contactRepository.create(input);
  await deps.timelineEventRepository.record({
    tenantId: contact.tenantId,
    workspaceId: contact.workspaceId,
    entityType: "contact",
    entityId: contact.id,
    eventType: "contact_created",
    actorType: "user",
    payload: { origin: contact.origin },
  });
  if (deps.automation) {
    await evaluateAutomationTrigger(deps.automation, { tenantId: contact.tenantId, workspaceId: contact.workspaceId, trigger: "contact_created", contact });
  }
  return contact;
}

export async function listContacts(deps: ContactUseCaseDeps, input: { tenantId: string; workspaceId: string; search?: string; ownerUserId?: string; teamId?: string; cursor?: string; limit?: number }): Promise<Contact[]> {
  return deps.contactRepository.listByWorkspace(input);
}

export async function getContact(deps: ContactUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string }): Promise<Contact> {
  return mustContactBelongToTenantAndWorkspace(deps, input.contactId, input.tenantId, input.workspaceId);
}

export async function updateContact(deps: ContactUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string; patch: UpdateContactInput }): Promise<Contact> {
  await mustContactBelongToTenantAndWorkspace(deps, input.contactId, input.tenantId, input.workspaceId);
  return deps.contactRepository.update(input.contactId, input.patch);
}

/**
 * Liga uma identidade de canal a um contato — idempotente por `(channel, externalId)` (nunca a
 * mesma identidade de WhatsApp/Instagram/etc. aponta pra dois contatos diferentes). Nunca faz
 * fusão automática: se a identidade já existir ligada a OUTRO contato, isso é reportado, nunca
 * sobrescrito silenciosamente (auditoria, seção 4 — "não fazer merge automático agressivo").
 */
export async function linkContactIdentity(deps: ContactUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string; channel: ContactChannel; externalId: string; connectionId?: string }): Promise<{ identity: ContactIdentity; wasCreated: boolean; conflictsWithAnotherContact: boolean }> {
  await mustContactBelongToTenantAndWorkspace(deps, input.contactId, input.tenantId, input.workspaceId);
  const { identity, wasCreated } = await deps.contactIdentityRepository.create({
    contactId: input.contactId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    channel: input.channel,
    externalId: input.externalId,
    connectionId: input.connectionId,
  });
  const conflictsWithAnotherContact = !wasCreated && identity.contactId !== input.contactId;
  if (wasCreated) {
    await deps.timelineEventRepository.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      entityType: "contact",
      entityId: input.contactId,
      eventType: "identity_linked",
      actorType: "user",
      payload: { channel: input.channel },
    });
  }
  return { identity, wasCreated, conflictsWithAnotherContact };
}

export async function getContactTimeline(deps: ContactUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string; limit?: number }): Promise<TimelineEvent[]> {
  await mustContactBelongToTenantAndWorkspace(deps, input.contactId, input.tenantId, input.workspaceId);
  return deps.timelineEventRepository.listByEntity({ entityType: "contact", entityId: input.contactId, limit: input.limit });
}
