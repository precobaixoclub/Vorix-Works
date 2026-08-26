import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresInstagramDmAccountRouteRepository } from "../dist/infrastructure/storage/postgres/postgres-instagram-dm-account-route-repository.js";
import { PostgresInstagramDmConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-instagram-dm-conversation-repository.js";
import { PostgresInstagramDmMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-instagram-dm-message-repository.js";
import { PostgresInstagramDmAutomationRuleRepository } from "../dist/infrastructure/storage/postgres/postgres-instagram-dm-automation-rule-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Persistência real (Postgres via pglite) do módulo Instagram DM Automation, Fase 5. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55660 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("Migrations 0076-0079 aplicam sem erro; tabelas do módulo Instagram DM existem", async () => {
  for (const id of ["0076_instagram_dm_account_routes", "0077_instagram_dm_conversations", "0078_instagram_dm_messages", "0079_instagram_dm_automation_rules"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("PostgresInstagramDmAccountRouteRepository: upsert por instagramBusinessAccountId nunca duplica; reconectar noutro workspace atualiza a rota", async () => {
  const workspaceA = await makeWorkspace("tenant-route-1");
  const workspaceB = await makeWorkspace("tenant-route-1");
  const repo = new PostgresInstagramDmAccountRouteRepository(db.pool);

  await repo.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "tenant-route-1", workspaceId: workspaceA.id });
  let route = await repo.findByInstagramBusinessAccountId("ig_1");
  assert.equal(route.workspaceId, workspaceA.id);

  await repo.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "tenant-route-1", workspaceId: workspaceB.id });
  route = await repo.findByInstagramBusinessAccountId("ig_1");
  assert.equal(route.workspaceId, workspaceB.id, "reconectar a mesma conta em outro workspace deveria atualizar a rota, nunca duplicar");
});

test("PostgresInstagramDmConversationRepository: upsert por (workspaceId, instagramBusinessAccountId, participantId) nunca duplica; findByParticipant localiza a conversa existente", async () => {
  const workspace = await makeWorkspace("tenant-conv-1");
  const repo = new PostgresInstagramDmConversationRepository(db.pool);
  const base = { tenantId: "tenant-conv-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false };

  await repo.upsertConversation({ ...base, lastMessagePreview: "oi" });
  await repo.upsertConversation({ ...base, lastMessagePreview: "oi de novo" });

  const conversations = await repo.listByWorkspace({ tenantId: "tenant-conv-1", workspaceId: workspace.id });
  assert.equal(conversations.length, 1, "upsert deveria atualizar a linha existente, nunca duplicar");
  assert.equal(conversations[0].lastMessagePreview, "oi de novo");

  const found = await repo.findByParticipant({ tenantId: "tenant-conv-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1" });
  assert.equal(found.id, conversations[0].id);
});

test("PostgresInstagramDmConversationRepository: participantUsername é preservado quando um upsert posterior não manda o campo", async () => {
  const workspace = await makeWorkspace("tenant-conv-2");
  const repo = new PostgresInstagramDmConversationRepository(db.pool);
  const base = { tenantId: "tenant-conv-2", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false };

  await repo.upsertConversation({ ...base, participantUsername: "maria123" });
  const updated = await repo.upsertConversation({ ...base, lastMessagePreview: "segunda mensagem" });
  assert.equal(updated.participantUsername, "maria123", "username já conhecido nunca deveria ser apagado por um evento sem esse campo");
});

test("PostgresInstagramDmConversationRepository: markRead/setAutomationMuted mutam só o campo pedido", async () => {
  const workspace = await makeWorkspace("tenant-conv-3");
  const repo = new PostgresInstagramDmConversationRepository(db.pool);
  const conversation = await repo.upsertConversation({ tenantId: "tenant-conv-3", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });

  await repo.markRead(conversation.id);
  let updated = await repo.getById(conversation.id);
  assert.equal(updated.unread, false);
  assert.equal(updated.automationMuted, false);

  await repo.setAutomationMuted(conversation.id, true);
  updated = await repo.getById(conversation.id);
  assert.equal(updated.automationMuted, true);
  assert.equal(updated.unread, false, "mutar automação nunca deveria mexer em unread");
});

test("PostgresInstagramDmMessageRepository: mensagens sem messageId nunca colidem (NULL é sempre distinto); com messageId, reentrega deduplica", async () => {
  const workspace = await makeWorkspace("tenant-msg-1");
  const conversationRepo = new PostgresInstagramDmConversationRepository(db.pool);
  const messageRepo = new PostgresInstagramDmMessageRepository(db.pool);
  const conversation = await conversationRepo.upsertConversation({ tenantId: "tenant-msg-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });

  await messageRepo.recordMessage({ tenantId: "tenant-msg-1", workspaceId: workspace.id, conversationId: conversation.id, direction: "outbound", sender: "page", messageText: "sem mid A", sentAt: new Date().toISOString() });
  await messageRepo.recordMessage({ tenantId: "tenant-msg-1", workspaceId: workspace.id, conversationId: conversation.id, direction: "outbound", sender: "page", messageText: "sem mid B", sentAt: new Date().toISOString() });
  await messageRepo.recordMessage({ tenantId: "tenant-msg-1", workspaceId: workspace.id, conversationId: conversation.id, direction: "inbound", sender: "user", messageId: "mid_1", messageText: "com mid", sentAt: new Date().toISOString() });
  await messageRepo.recordMessage({ tenantId: "tenant-msg-1", workspaceId: workspace.id, conversationId: conversation.id, direction: "inbound", sender: "user", messageId: "mid_1", messageText: "com mid (reentrega)", sentAt: new Date().toISOString() });

  const messages = await messageRepo.listByConversation({ tenantId: "tenant-msg-1", workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(messages.length, 3, "2 sem mid (nunca colidem) + 1 com mid deduplicado = 3");
  const withMid = messages.find((message) => message.messageId === "mid_1");
  assert.equal(withMid.messageText, "com mid", "reentrega do mesmo mid nunca deveria sobrescrever o texto original");
});

test("FK conversa → workspace: apagar o workspace apaga em cascata conversas/mensagens", async () => {
  const workspace = await makeWorkspace("tenant-msg-2");
  const conversationRepo = new PostgresInstagramDmConversationRepository(db.pool);
  const messageRepo = new PostgresInstagramDmMessageRepository(db.pool);
  const conversation = await conversationRepo.upsertConversation({ tenantId: "tenant-msg-2", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });
  await messageRepo.recordMessage({ tenantId: "tenant-msg-2", workspaceId: workspace.id, conversationId: conversation.id, direction: "inbound", sender: "user", messageText: "oi", sentAt: new Date().toISOString() });

  await db.pool.query("delete from workspaces where id = $1", [workspace.id]);

  const conversations = await db.pool.query("select 1 from instagram_dm_conversations where id = $1", [conversation.id]);
  const messages = await db.pool.query("select 1 from instagram_dm_messages where conversation_id = $1", [conversation.id]);
  assert.equal(conversations.rows.length, 0);
  assert.equal(messages.rows.length, 0);
});

test("PostgresInstagramDmAutomationRuleRepository: upsert cria e atualiza; listByAccount ordena por priority e respeita onlyEnabled", async () => {
  const workspace = await makeWorkspace("tenant-rule-1");
  const repo = new PostgresInstagramDmAutomationRuleRepository(db.pool);

  const ruleB = await repo.upsertRule({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", name: "B", enabled: true, matchType: "contains", keywords: ["preço"], replyMode: "fixed", replyText: "R$ 99", priority: 2 });
  const ruleA = await repo.upsertRule({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", name: "A", enabled: true, matchType: "exact", keywords: ["oi"], replyMode: "fixed", replyText: "Olá!", priority: 1 });
  const ruleDisabled = await repo.upsertRule({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", name: "C (desabilitada)", enabled: false, matchType: "contains", keywords: ["x"], replyMode: "ai", aiInstructions: "seja breve", priority: 0 });

  const all = await repo.listByAccount({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1" });
  assert.deepEqual(all.map((rule) => rule.name), ["C (desabilitada)", "A", "B"], "ordem deveria ser por priority crescente");

  const onlyEnabled = await repo.listByAccount({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1", onlyEnabled: true });
  assert.deepEqual(onlyEnabled.map((rule) => rule.name), ["A", "B"]);

  await repo.upsertRule({ ...ruleA, replyText: "Olá, tudo bem?" });
  const updated = await repo.getById(ruleA.id);
  assert.equal(updated.replyText, "Olá, tudo bem?");

  await repo.delete(ruleDisabled.id);
  assert.equal(await repo.getById(ruleDisabled.id), undefined);
  assert.equal((await repo.listByAccount({ tenantId: "tenant-rule-1", workspaceId: workspace.id, instagramBusinessAccountId: "ig_1" })).length, 2);
  assert.ok(ruleB.id);
});
