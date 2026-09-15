import type { Pool } from "pg";
import type { InboxMediaStoragePort } from "../../../application/ports/inbox-media-storage.port.js";
import type { MessagingProvider } from "../../../application/ports/messaging-provider.port.js";

/**
 * Bloco "fotos de grupo/contato" — achado ao vivo em produção (o usuário testou logo após o deploy
 * e reportou "não mudou nada"): `syncContactProfilePicture`/`syncGroupPicture` (inbox-use-cases.ts)
 * só disparam quando uma mensagem NOVA chega — contatos/grupos que já existiam ANTES do deploy
 * nunca ganham foto até alguém mandar mensagem de novo, o que pode levar dias. Esta reconciliação
 * varre o que já existe e busca a foto retroativamente, sem depender de mensagem nova nenhuma —
 * mesmo racional dos outros workers de reconciliação já existentes (`reconcileOrphanedOutboundMessages`
 * etc.): roda uma vez imediatamente no boot (pra não esperar o primeiro tick) e depois no intervalo
 * configurado.
 */

async function ensureProviderReady(provider: MessagingProvider, inboxMediaStorage: InboxMediaStoragePort | undefined): Promise<boolean> {
  return Boolean(provider.getProfilePicture && inboxMediaStorage);
}

export async function reconcilePendingContactPictures(
  pool: Pool,
  provider: MessagingProvider,
  inboxMediaStorage: InboxMediaStoragePort | undefined,
  options: { limit?: number } = {},
): Promise<{ scanned: number; synced: number }> {
  if (!(await ensureProviderReady(provider, inboxMediaStorage)) || !provider.getProfilePicture || !inboxMediaStorage) return { scanned: 0, synced: 0 };

  // Um contato pode ter várias conversas diretas (uma por conexão) — pega a conexão mais recente
  // que ainda tem sessão ativa, nunca uma conexão desconectada (a chamada falharia à toa).
  const candidates = await pool.query<{
    contact_id: string; tenant_id: string; workspace_id: string; phone_normalized: string; external_session_id: string;
  }>(
    `select distinct on (ic.id) ic.id as contact_id, ic.tenant_id, ic.workspace_id, ic.phone_normalized, mc.external_session_id
     from inbox_contacts ic
     join inbox_conversations conv on conv.contact_id = ic.id and conv.merge_status is null and conv.chat_type = 'direct'
     join messaging_connections mc on mc.id = conv.connection_id
     where ic.profile_picture_storage_ref is null and ic.merge_status is null and mc.external_session_id is not null
     order by ic.id, conv.updated_at desc
     limit $1`,
    [options.limit ?? 100],
  );

  let synced = 0;
  for (const row of candidates.rows) {
    let picture;
    try {
      picture = await provider.getProfilePicture({ externalSessionId: row.external_session_id, jid: row.phone_normalized });
    } catch {
      continue; // best-effort — um erro pontual num contato nunca deve travar os demais.
    }
    if (!picture) continue;
    const objectKey = `${row.tenant_id}/${row.workspace_id}/avatar-contact-${row.contact_id}`;
    await inboxMediaStorage.put({ key: objectKey, body: picture.body, contentType: picture.mimeType });
    await pool.query(
      "update inbox_contacts set profile_picture_storage_ref = $2, profile_picture_synced_at = now(), updated_at = now() where id = $1",
      [row.contact_id, JSON.stringify({ provider: "inbox-media", objectKey, metadata: { tenantId: row.tenant_id } })],
    );
    synced += 1;
  }
  return { scanned: candidates.rows.length, synced };
}

export async function reconcilePendingGroupPictures(
  pool: Pool,
  provider: MessagingProvider,
  inboxMediaStorage: InboxMediaStoragePort | undefined,
  options: { limit?: number } = {},
): Promise<{ scanned: number; synced: number }> {
  if (!(await ensureProviderReady(provider, inboxMediaStorage)) || !provider.getProfilePicture || !inboxMediaStorage) return { scanned: 0, synced: 0 };

  const candidates = await pool.query<{ conversation_id: string; tenant_id: string; workspace_id: string; external_chat_id: string; external_session_id: string }>(
    `select c.id as conversation_id, c.tenant_id, c.workspace_id, c.external_chat_id, mc.external_session_id
     from inbox_conversations c
     join messaging_connections mc on mc.id = c.connection_id
     where c.chat_type = 'group' and c.merge_status is null and c.group_picture_storage_ref is null
       and c.external_chat_id like '%@g.us' and mc.external_session_id is not null
     limit $1`,
    [options.limit ?? 100],
  );

  let synced = 0;
  for (const row of candidates.rows) {
    let picture;
    try {
      picture = await provider.getProfilePicture({ externalSessionId: row.external_session_id, jid: row.external_chat_id });
    } catch {
      continue;
    }
    if (!picture) continue;
    const objectKey = `${row.tenant_id}/${row.workspace_id}/avatar-group-${row.conversation_id}`;
    await inboxMediaStorage.put({ key: objectKey, body: picture.body, contentType: picture.mimeType });
    await pool.query(
      "update inbox_conversations set group_picture_storage_ref = $2, group_picture_synced_at = now(), updated_at = now() where id = $1",
      [row.conversation_id, JSON.stringify({ provider: "inbox-media", objectKey, metadata: { tenantId: row.tenant_id } })],
    );
    synced += 1;
  }
  return { scanned: candidates.rows.length, synced };
}
