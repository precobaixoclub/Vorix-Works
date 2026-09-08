import type { ContactChannel, ContactIdentity } from "../../domain/crm/crm.model.js";

export type CreateContactIdentityInput = {
  contactId: string;
  tenantId: string;
  workspaceId: string;
  channel: ContactChannel;
  externalId: string;
  connectionId?: string;
};

export type ContactIdentityRepositoryPort = {
  /** Idempotente por `(channel, externalId)` — mesma identidade de canal nunca aponta pra dois
   * contatos diferentes; uma segunda chamada com o mesmo par devolve a existente. */
  create(input: CreateContactIdentityInput): Promise<{ identity: ContactIdentity; wasCreated: boolean }>;
  listByContact(contactId: string): Promise<ContactIdentity[]>;
  findByChannelAndExternalId(channel: ContactChannel, externalId: string): Promise<ContactIdentity | undefined>;
};
