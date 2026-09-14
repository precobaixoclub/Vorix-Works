import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxIdentityLinkRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-identity-link-repository.js";
import { registerInboundMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { reconcileMergeableIdentities, reconcileUnresolvedLidContacts } from "../dist/infrastructure/storage/postgres/inbox-identity-reconciliation.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "réplica de identidade" (Fase 5 do plano aprovado) — réplica adaptada da arquitetura de
 * deduplicação do CMDesk (telefone como pivô, LID como alias persistido, merge automático por
 * evidência forte, sob lock, com auditoria), mantendo o WuzAPI como único gateway.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55665 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("InboxIdentityLinkRepository: upsert é idempotente por (workspaceId, lid) e confidence nunca desce", async () => {
  const workspace = await makeWorkspace("tenant-link-1");
  const repo = new PostgresInboxIdentityLinkRepository(db.pool);

  const first = await repo.upsert({ tenantId: "tenant-link-1", workspaceId: workspace.id, lid: "+999111222333444", phoneE164: "+5511988887777", confidence: 100, source: "wuzapi_alt_field" });
  const second = await repo.upsert({ tenantId: "tenant-link-1", workspaceId: workspace.id, lid: "+999111222333444", phoneE164: "+5511988887777", confidence: 50, source: "wuzapi_alt_field" });

  assert.equal(second.id, first.id, "mesmo (workspaceId, lid) nunca cria uma segunda linha");
  assert.equal(second.confidence, 100, "confidence nunca desce — GREATEST() preserva o valor mais alto já visto");

  const found = await repo.getByLid(workspace.id, "+999111222333444");
  assert.equal(found.phoneE164, "+5511988887777");
});

test("registerInboundMessage: LID visto com Alt, depois sem Alt, ainda resolve pro MESMO telefone via link persistido", async () => {
  const workspace = await makeWorkspace("tenant-link-2");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId: "tenant-link-2", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const lid = "+888111222333444";
  const realPhone = "+5511977776666";

  // 1ª mensagem: o WuzAPI manda o alt real (evidência forte) — grava o link E usa o telefone real.
  const r1 = await registerInboundMessage(deps, {
    tenantId: "tenant-link-2", workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false,
    chatPhoneE164: realPhone, chatPn: realPhone, chatLid: lid,
    senderId: lid, senderName: "Pessoa", senderPn: realPhone, senderLid: lid,
    externalMessageId: "wamid.link-1", type: "text", body: "Primeira", occurredAt: new Date().toISOString(),
  });
  assert.equal(r1.contact.phoneNormalized, realPhone);

  // 2ª mensagem: o MESMO lid aparece de novo, SEM o alt desta vez — sem o link persistido, isto
  // recalcularia um pseudo-telefone a partir do lid e criaria um SEGUNDO contato/conversa (o bug
  // documentado). Com o link, resolve pro MESMO telefone real.
  const r2 = await registerInboundMessage(deps, {
    tenantId: "tenant-link-2", workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false,
    chatLid: lid,
    senderId: lid, senderName: "Pessoa",
    externalMessageId: "wamid.link-2", type: "text", body: "Segunda", occurredAt: new Date().toISOString(),
  });

  assert.equal(r2.contact.id, r1.contact.id, "sem alt, mas com link persistido, resolve pro MESMO contato");
  assert.equal(r2.contact.phoneNormalized, realPhone);
  assert.equal(r2.conversation.id, r1.conversation.id, "MESMA conversa — nunca fragmenta por reaparecer só com LID");
});

test("MERGE_AUTOMATICO: LID sem Alt cria contato/conversa separados; Alt chega depois; reconcileMergeableIdentities funde os dois em um só, preservando histórico e auditando o merge", async () => {
  const tenantId = "tenant-link-merge-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const lid = "+777111222333444";
  const realPhone = "+5511966665555";

  // 1ª mensagem: LID aparece SOZINHO, sem nenhum link ainda existir — cria um contato/conversa
  // "perdedor", keyed pelo pseudo-telefone derivado do LID (comportamento pré-existente, nunca
  // inventa telefone).
  const loser = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false,
    chatLid: lid,
    senderId: lid, senderName: "Cliente",
    externalMessageId: "wamid.merge-1", type: "text", body: "Oi, preciso de ajuda", occurredAt: new Date().toISOString(),
  });
  assert.notEqual(loser.contact.phoneNormalized, realPhone);

  // 2ª mensagem: o MESMO lid, agora com o alt real — Fase 1 grava o link e usa o telefone real
  // pro pivô, mas o contato/conversa do telefone real ainda NÃO EXISTE, então nasce um segundo
  // contato/conversa "vencedor" — divergência real que só o merge (Fase 2/4) resolve.
  const winner = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false,
    chatPhoneE164: realPhone, chatPn: realPhone, chatLid: lid,
    senderId: lid, senderName: "Cliente", senderPn: realPhone, senderLid: lid,
    externalMessageId: "wamid.merge-2", type: "text", body: "Aqui está meu número real", occurredAt: new Date().toISOString(),
  });
  assert.notEqual(winner.contact.id, loser.contact.id, "pré-condição: ainda são dois contatos divergentes antes do merge");
  assert.notEqual(winner.conversation.id, loser.conversation.id, "pré-condição: ainda são duas conversas divergentes antes do merge");

  const { contactsMerged, conversationsMerged } = await reconcileMergeableIdentities(db.pool, { sinceIso: new Date(0).toISOString() });
  assert.equal(contactsMerged, 1);
  assert.equal(conversationsMerged, 1);

  const mergedLoserContact = await contactRepo.getById(loser.contact.id);
  assert.equal(mergedLoserContact.mergeStatus, "merged");
  assert.equal(mergedLoserContact.mergedIntoContactId, winner.contact.id);

  const mergedLoserConversation = await conversationRepo.getById(loser.conversation.id);
  assert.equal(mergedLoserConversation.mergeStatus, "merged");
  assert.equal(mergedLoserConversation.mergedIntoConversationId, winner.conversation.id);

  // Histórico completo preservado: as 2 mensagens (uma de cada conversa original) agora vivem na
  // conversa vencedora, em vez de sumirem com o tombstone.
  const winnerMessages = await messageRepo.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: winner.conversation.id, limit: 10 });
  assert.equal(winnerMessages.length, 2, "as mensagens das duas conversas originais convergem pra uma só, nenhuma perdida");

  // Só um contato/uma conversa ativos aparecem numa listagem — o tombstone nunca vaza como
  // duplicata fantasma.
  const activeConversations = await conversationRepo.listByWorkspace({ tenantId, workspaceId: workspace.id });
  const relevant = activeConversations.filter((c) => c.id === winner.conversation.id || c.id === loser.conversation.id);
  assert.deepEqual(relevant.map((c) => c.id), [winner.conversation.id]);

  const mergeLog = await db.pool.query("select entity_type, winner_id, loser_id, reason from inbox_identity_merge_log where workspace_id = $1 order by entity_type", [workspace.id]);
  assert.equal(mergeLog.rows.length, 2, "auditoria: um log de merge pra contato, um pra conversa");
  assert.deepEqual(mergeLog.rows.map((r) => r.entity_type).sort(), ["contact", "conversation"]);
  for (const row of mergeLog.rows) {
    assert.equal(row.reason, "identity_link_strong_evidence");
  }

  // Rodar de novo é um no-op — nada mais pra fundir, nenhum erro, nenhum merge duplicado.
  const again = await reconcileMergeableIdentities(db.pool, { sinceIso: new Date(0).toISOString() });
  assert.equal(again.contactsMerged, 0);
  assert.equal(again.conversationsMerged, 0);
});

test("MERGE_CONCORRENCIA: duas rodadas de reconcileMergeableIdentities em paralelo pro mesmo LID nunca lançam nem fundem em duplicidade", async () => {
  const tenantId = "tenant-link-merge-concurrent";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const lid = "+666111222333444";
  const realPhone = "+5511955554444";

  const loser = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false, chatLid: lid,
    senderId: lid, senderName: "Cliente",
    externalMessageId: "wamid.concurrent-1", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });
  const winner = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: lid, isGroup: false, fromMe: false,
    chatPhoneE164: realPhone, chatPn: realPhone, chatLid: lid,
    senderId: lid, senderName: "Cliente", senderPn: realPhone, senderLid: lid,
    externalMessageId: "wamid.concurrent-2", type: "text", body: "Meu número", occurredAt: new Date().toISOString(),
  });

  const results = await Promise.all([
    reconcileMergeableIdentities(db.pool, { sinceIso: new Date(0).toISOString() }),
    reconcileMergeableIdentities(db.pool, { sinceIso: new Date(0).toISOString() }),
  ]);
  const totalContactsMerged = results[0].contactsMerged + results[1].contactsMerged;
  assert.equal(totalContactsMerged, 1, "exatamente um merge de contato acontece, nunca duas corridas fundindo a mesma coisa duas vezes");

  const mergedLoserContact = await contactRepo.getById(loser.contact.id);
  assert.equal(mergedLoserContact.mergeStatus, "merged");
  assert.equal(mergedLoserContact.mergedIntoContactId, winner.contact.id);
});

test("reconcileUnresolvedLidContacts: completa whatsapp_pn de um contato já correto sem decidir merge nenhum", async () => {
  const tenantId = "tenant-link-reconcile-1";
  const workspace = await makeWorkspace(tenantId);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);

  const phone = "+5511944443333";
  const lid = "+555111222333444";
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, whatsappLid: lid });
  assert.equal(contact.whatsappPn, undefined);

  await identityLinkRepository.upsert({ tenantId, workspaceId: workspace.id, lid, phoneE164: phone, confidence: 100, source: "wuzapi_alt_field" });

  const { resolved } = await reconcileUnresolvedLidContacts(db.pool, {});
  assert.ok(resolved >= 1);

  const updated = await contactRepo.getById(contact.id);
  assert.equal(updated.whatsappPn, phone);
  assert.equal(updated.mergeStatus, undefined, "isto é só completude de metadado — nunca decide merge sozinho");
});
