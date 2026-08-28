import type { InboxContact } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0081_inbox_contacts.sql`. */

export type UpsertInboxContactInput = {
  tenantId: string;
  workspaceId: string;
  phoneNormalized: string;
  name?: string;
  profilePictureUrl?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

export type InboxContactRepositoryPort = {
  /** Upsert por `(workspaceId, phoneNormalized)` — nunca cria um segundo contato pro mesmo
   * telefone normalizado. Preserva `name`/`profilePictureUrl` existentes quando o input não os traz. */
  upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact>;
  getById(id: string): Promise<InboxContact | undefined>;
  findByPhone(input: { tenantId: string; workspaceId: string; phoneNormalized: string }): Promise<InboxContact | undefined>;
};
