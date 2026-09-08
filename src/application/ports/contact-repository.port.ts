import type { Contact } from "../../domain/crm/crm.model.js";

export type CreateContactInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  company?: string;
  document?: string;
  origin?: string;
  ownerUserId?: string;
  teamId?: string;
  tags?: readonly string[];
  customFields?: Record<string, unknown>;
  notes?: string;
};

export type UpdateContactInput = Partial<Omit<CreateContactInput, "tenantId" | "workspaceId">>;

export type ContactRepositoryPort = {
  create(input: CreateContactInput): Promise<Contact>;
  getById(id: string): Promise<Contact | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; search?: string; ownerUserId?: string; teamId?: string; cursor?: string; limit?: number }): Promise<Contact[]>;
  update(id: string, input: UpdateContactInput): Promise<Contact>;
  touchLastInteraction(id: string, occurredAt: string): Promise<void>;
};
