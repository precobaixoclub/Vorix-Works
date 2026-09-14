import type { Pool, PoolClient } from "pg";
import { identityLockKeyForLid, withIdentityLock } from "./identity-advisory-lock.js";

const mergeLogIdGenerator = () => `idmerge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Bloco "réplica de identidade" (Fase 2/4) — worker de reconciliação equivalente ao
 * `lidAutoMergeScheduler.service.ts` do CMDesk, adaptado à realidade do Vorix: UMA fonte de
 * evidência (sempre forte, nunca heurística — ver `docs`/plano aprovado), então a classificação é
 * binária: existe um par contato/conversa divergente correlacionado por `inbox_identity_links`? Se
 * sim, funde (AUTO_MERGE). Se não, não faz nada — nunca merge cego por nome/heurística.
 *
 * Corre em cima de `pg_advisory_xact_lock` (mesma chave por LID que protege a resolução de
 * identidade em `registerInboundMessage`) — mesmo que o worker rode concorrente com uma mensagem
 * nova chegando para o mesmo LID, as duas nunca decidem/escrevem ao mesmo tempo.
 */

type MergeCandidate = {
  linkId: string;
  tenantId: string;
  workspaceId: string;
  lid: string;
  phoneE164: string;
  loserContactId: string;
  winnerContactId: string;
};

async function findContactMergeCandidates(pool: Pool, sinceIso: string, limit: number): Promise<MergeCandidate[]> {
  // Um contato "perdedor" tem o MESMO lid do link mas um `phone_normalized` diferente do telefone
  // resolvido (ele foi criado ANTES do link existir, via pseudo-telefone-por-LID); o "vencedor" é o
  // contato que já usa o telefone real como pivô — normalmente criado NO MESMO evento que gravou o
  // link (ver `resolveInboundPivotPhone`, `inbox-use-cases.ts`).
  const result = await pool.query<{
    link_id: string; tenant_id: string; workspace_id: string; lid: string; phone_e164: string;
    loser_contact_id: string; winner_contact_id: string;
  }>(
    `select l.id as link_id, l.tenant_id, l.workspace_id, l.lid, l.phone_e164,
            loser.id as loser_contact_id, winner.id as winner_contact_id
     from inbox_identity_links l
     join inbox_contacts loser
       on loser.workspace_id = l.workspace_id
      and loser.whatsapp_lid = l.lid
      and loser.phone_normalized <> l.phone_e164
      and loser.merge_status is null
     join inbox_contacts winner
       on winner.workspace_id = l.workspace_id
      and winner.phone_normalized = l.phone_e164
      and winner.merge_status is null
     where l.updated_at >= $1
     order by l.updated_at asc
     limit $2`,
    [sinceIso, limit],
  );
  return result.rows.map((row) => ({
    linkId: row.link_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, lid: row.lid, phoneE164: row.phone_e164,
    loserContactId: row.loser_contact_id, winnerContactId: row.winner_contact_id,
  }));
}

/** Funde `loserContactId` em `winnerContactId` — DEVE rodar dentro da transação/lock já aberta por
 * quem chama (`withIdentityLock`). Reconfere as duas linhas com `for update` (nunca confia no
 * estado lido fora do lock: outra rodada concorrente pode já ter mergeado). Reponta
 * `inbox_conversations.contact_id` que ainda apontava pro perdedor — única tabela satélite de
 * contato hoje (lista fixa, ver plano aprovado — nunca um mecanismo genérico de FK via
 * `information_schema`). */
async function mergeContactRows(client: PoolClient, input: { tenantId: string; workspaceId: string; winnerId: string; loserId: string }): Promise<boolean> {
  const rows = await client.query<{ id: string; phone_normalized: string; whatsapp_pn: string | null; whatsapp_lid: string | null; name: string | null; merge_status: string | null }>(
    "select id, phone_normalized, whatsapp_pn, whatsapp_lid, name, merge_status from inbox_contacts where id = any($1) for update",
    [[input.winnerId, input.loserId]],
  );
  const winner = rows.rows.find((r) => r.id === input.winnerId);
  const loser = rows.rows.find((r) => r.id === input.loserId);
  if (!winner || !loser || winner.merge_status || loser.merge_status) return false;

  await client.query("update inbox_conversations set contact_id = $2, updated_at = now() where contact_id = $1 and merge_status is null", [loser.id, winner.id]);
  await client.query("update inbox_contacts set merge_status = 'merged', merged_into_contact_id = $2, merged_at = now() where id = $1", [loser.id, winner.id]);
  await client.query(
    `insert into inbox_identity_merge_log (id, tenant_id, workspace_id, entity_type, winner_id, loser_id, reason, snapshot)
     values ($1, $2, $3, 'contact', $4, $5, 'identity_link_strong_evidence', $6)`,
    [mergeLogIdGenerator(), input.tenantId, input.workspaceId, winner.id, loser.id, JSON.stringify(loser)],
  );
  return true;
}

/** Depois que um contato é fundido, resolve toda conversa ATIVA que ainda apontava pro perdedor:
 * se já existe uma conversa ativa do vencedor no MESMO `connection_id`, funde as duas (move
 * mensagens + eventos, tombstone); senão, só reaponta `external_chat_id`/`contact_id` da própria
 * conversa (nenhuma colisão possível — é a única conversa ativa com aquela chave). */
async function reconcileConversationsForMergedContact(
  client: PoolClient,
  input: { tenantId: string; workspaceId: string; winnerContactId: string; loserContactId: string; winnerPhoneE164: string },
): Promise<number> {
  const orphaned = await client.query<{ id: string; connection_id: string; external_chat_id: string; last_message_at: Date | null; unread_count: number }>(
    "select id, connection_id, external_chat_id, last_message_at, unread_count from inbox_conversations where contact_id = $1 and merge_status is null for update",
    [input.winnerContactId],
  );
  let mergedCount = 0;
  for (const loserConv of orphaned.rows) {
    if (loserConv.external_chat_id === input.winnerPhoneE164) continue; // já está com a chave certa (repoint anterior).
    const winnerConv = await client.query<{ id: string; last_message_at: Date | null; unread_count: number }>(
      "select id, last_message_at, unread_count from inbox_conversations where connection_id = $1 and external_chat_id = $2 and merge_status is null for update",
      [loserConv.connection_id, input.winnerPhoneE164],
    );
    const winner = winnerConv.rows[0];
    if (!winner || winner.id === loserConv.id) {
      // Nenhuma conversa concorrente com a chave real ainda — só corrige a identidade no lugar.
      await client.query("update inbox_conversations set external_chat_id = $2, updated_at = now() where id = $1", [loserConv.id, input.winnerPhoneE164]);
      continue;
    }
    await client.query("update inbox_messages set conversation_id = $2 where conversation_id = $1", [loserConv.id, winner.id]);
    await client.query("update inbox_conversation_events set conversation_id = $2 where conversation_id = $1", [loserConv.id, winner.id]);
    const mergedLastMessageAt = [loserConv.last_message_at, winner.last_message_at].filter((v): v is Date => v !== null).sort((a, b) => b.getTime() - a.getTime())[0];
    await client.query(
      "update inbox_conversations set unread_count = unread_count + $2, last_message_at = coalesce($3, last_message_at), updated_at = now() where id = $1",
      [winner.id, loserConv.unread_count, mergedLastMessageAt ?? null],
    );
    await client.query("update inbox_conversations set merge_status = 'merged', merged_into_conversation_id = $2, merged_at = now() where id = $1", [loserConv.id, winner.id]);
    await client.query(
      `insert into inbox_identity_merge_log (id, tenant_id, workspace_id, entity_type, winner_id, loser_id, reason, snapshot)
       values ($1, $2, $3, 'conversation', $4, $5, 'identity_link_strong_evidence', $6)`,
      [mergeLogIdGenerator(), input.tenantId, input.workspaceId, winner.id, loserConv.id, JSON.stringify(loserConv)],
    );
    mergedCount += 1;
  }
  return mergedCount;
}

/**
 * Fase 4 — equivalente ao `lidAutoMergeScheduler.service.ts` do CMDesk. Varre `inbox_identity_links`
 * atualizados desde `sinceIso`, encontra pares contato/conversa divergentes correlacionados pelo
 * MESMO lid, e funde sob lock (nunca corrida entre dois ticks, nem entre um tick e uma mensagem
 * nova chegando para o mesmo LID via `registerInboundMessage`).
 */
export async function reconcileMergeableIdentities(pool: Pool, options: { sinceIso: string; limit?: number }): Promise<{ scanned: number; contactsMerged: number; conversationsMerged: number }> {
  const candidates = await findContactMergeCandidates(pool, options.sinceIso, options.limit ?? 200);
  let contactsMerged = 0;
  let conversationsMerged = 0;
  for (const candidate of candidates) {
    const lockKey = identityLockKeyForLid(candidate.workspaceId, candidate.lid);
    await withIdentityLock(pool, lockKey, async (client) => {
      const merged = await mergeContactRows(client, {
        tenantId: candidate.tenantId, workspaceId: candidate.workspaceId, winnerId: candidate.winnerContactId, loserId: candidate.loserContactId,
      });
      if (!merged) return;
      contactsMerged += 1;
      conversationsMerged += await reconcileConversationsForMergedContact(client, {
        tenantId: candidate.tenantId, workspaceId: candidate.workspaceId,
        winnerContactId: candidate.winnerContactId, loserContactId: candidate.loserContactId, winnerPhoneE164: candidate.phoneE164,
      });
    });
  }
  return { scanned: candidates.length, contactsMerged, conversationsMerged };
}

/**
 * Fase 4 — equivalente ao `identityReconciliation.worker.ts` do CMDesk, adaptado: preenche
 * `whatsapp_pn`/metadados de contatos que só têm `whatsapp_lid` conhecido, quando
 * `inbox_identity_links` já resolveu esse lid para um telefone — SÓ quando esse telefone é o
 * PRÓPRIO `phone_normalized` do contato (mera completude de metadado, nunca decide merge aqui —
 * merge é sempre responsabilidade de `reconcileMergeableIdentities`, que roda com lock e
 * auditoria).
 */
export async function reconcileUnresolvedLidContacts(pool: Pool, options: { limit?: number }): Promise<{ scanned: number; resolved: number }> {
  const candidates = await pool.query<{ id: string; workspace_id: string; whatsapp_lid: string }>(
    `select id, workspace_id, whatsapp_lid from inbox_contacts
     where whatsapp_lid is not null and whatsapp_pn is null and merge_status is null
     order by updated_at asc
     limit $1`,
    [options.limit ?? 200],
  );
  let resolved = 0;
  for (const contact of candidates.rows) {
    const link = await pool.query<{ phone_e164: string }>(
      "select phone_e164 from inbox_identity_links where workspace_id = $1 and lid = $2",
      [contact.workspace_id, contact.whatsapp_lid],
    );
    const phoneE164 = link.rows[0]?.phone_e164;
    if (!phoneE164) continue;
    const result = await pool.query(
      "update inbox_contacts set whatsapp_pn = $2, updated_at = now() where id = $1 and phone_normalized = $2 and whatsapp_pn is null",
      [contact.id, phoneE164],
    );
    if ((result.rowCount ?? 0) > 0) resolved += 1;
  }
  return { scanned: candidates.rows.length, resolved };
}
