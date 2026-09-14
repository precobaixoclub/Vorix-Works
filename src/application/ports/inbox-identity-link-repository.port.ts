/** Módulo Conversas — bloco "réplica de identidade" (ver `db/migrations/0117_inbox_identity_links.sql`).
 * Persiste correlações LID→telefone descobertas via evidência real do provider (`Info.SenderAlt`/
 * `RecipientAlt`), pra que um LID visto de novo SEM o `*Alt` ainda resolva pro telefone certo. */

export type InboxIdentityLink = {
  id: string;
  tenantId: string;
  workspaceId: string;
  lid: string;
  phoneE164: string;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertInboxIdentityLinkInput = {
  tenantId: string;
  workspaceId: string;
  lid: string;
  phoneE164: string;
  confidence: number;
  source: string;
};

export type InboxIdentityLinkRepositoryPort = {
  /** Idempotente por `(workspaceId, lid)` — `confidence` nunca desce (usa `GREATEST()` no adapter
   * Postgres), `phoneE164` é atualizado pro valor mais recente resolvido. */
  upsert(input: UpsertInboxIdentityLinkInput): Promise<InboxIdentityLink>;
  getByLid(workspaceId: string, lid: string): Promise<InboxIdentityLink | undefined>;
  /** Usado pelo merge (Fase 2) e pelo worker de reconciliação (Fase 4): "quais LIDs já resolveram
   * pra este telefone?" — para achar contatos/conversas antigas que ainda não convergiram. */
  listByPhone(workspaceId: string, phoneE164: string): Promise<InboxIdentityLink[]>;
  /** Usado pelo worker de reconciliação — links criados/atualizados desde um timestamp, para
   * revarrer só o que mudou em vez do dataset inteiro a cada ciclo. */
  listUpdatedSince(workspaceId: string, sinceIso: string, limit: number): Promise<InboxIdentityLink[]>;
};
