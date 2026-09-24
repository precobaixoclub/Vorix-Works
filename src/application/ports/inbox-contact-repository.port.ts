import type { InboxContact, InboxMediaStorageRef } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0081_inbox_contacts.sql`. */

export type UpsertInboxContactInput = {
  tenantId: string;
  workspaceId: string;
  phoneNormalized: string;
  name?: string;
  profilePictureUrl?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  /** Bloco "Identity UX" — aliases técnicos observados neste evento (ver
   * `InboxContact.whatsappPn`/`whatsappLid`). `undefined` = não observado neste evento, nunca
   * apaga um alias já conhecido (upsert é sempre `coalesce`, nunca sobrescreve com nulo). */
  whatsappPn?: string;
  whatsappLid?: string;
};

export type InboxContactRepositoryPort = {
  /** Upsert por `(workspaceId, phoneNormalized)` — nunca cria um segundo contato pro mesmo
   * telefone normalizado. Preserva `name`/`profilePictureUrl` existentes quando o input não os traz. */
  upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact>;
  getById(id: string): Promise<InboxContact | undefined>;
  findByPhone(input: { tenantId: string; workspaceId: string; phoneNormalized: string }): Promise<InboxContact | undefined>;
  /** Bloco "enviar contato salvo" (pedido explícito do usuário: "selecionar um dos contatos salvos
   * no sistema para estar enviando") — busca por nome/telefone (case-insensitive, substring) entre
   * os contatos de WhatsApp já conhecidos no workspace (cada um tem `phoneNormalized` garantido,
   * ao contrário do `Contact` do CRM — ver `sendInboxContactCardMessage`). `query` vazio/ausente
   * devolve os mais recentes primeiro, até `limit` (default 20). Nunca devolve um contato já
   * fundido (`mergeStatus`), mesmo racional de `findByPhone`. */
  search(input: { tenantId: string; workspaceId: string; query?: string; limit?: number }): Promise<InboxContact[]>;
  /** Foto de perfil (pedido explícito do usuário em produção) — gravada separadamente do upsert
   * principal porque é preenchida de forma assíncrona/best-effort (ver `syncContactProfilePicture`,
   * `inbox-use-cases.ts`), nunca no caminho crítico do ack de uma mensagem. */
  updateProfilePicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void>;
  /**
   * Jornada Comercial Integrada, Fase 1 — grava `inbox_contacts.contact_id` (o único vínculo
   * sancionado com o CRM, migration 0092). Idempotente e NUNCA sobrescreve um vínculo já existente
   * (`where contact_id is null`) — mesma filosofia de "nunca merge/overwrite silencioso" do resto do
   * módulo. Quem chama (a ponte Inbox→CRM) decide o que fazer se o contato já estiver vinculado a
   * OUTRO `contactId` (nunca deveria acontecer sob uso normal — ver
   * `docs/vorix-jornada-comercial-fase1-contatos.md`). Retorna `undefined` se o contato não existir.
   */
  linkCrmContact(id: string, contactId: string): Promise<InboxContact | undefined>;
};
