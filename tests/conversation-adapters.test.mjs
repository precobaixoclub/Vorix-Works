import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-repository.js";
import { PostgresConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-event-repository.js";
import { PostgresConversationMemoryRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-memory-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55470 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function seedWorkspace(tenantId = "tenant-a") {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "Workspace de teste" });
}

test("Postgres Conversation: create()/getById()/listByWorkspace()/updateState()", async () => {
  const workspace = await seedWorkspace("tenant-conv-1");
  const repo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });

  const created = await repo.create({ tenantId: "tenant-conv-1", workspaceId: workspace.id, title: "Primeira conversa" });
  assert.equal(created.status, "active");
  assert.equal(created.state, "idle");

  const found = await repo.getById(created.id);
  assert.equal(found.title, "Primeira conversa");

  const list = await repo.listByWorkspace("tenant-conv-1", workspace.id);
  assert.equal(list.length, 1);

  const updated = await repo.updateState(created.id, "waiting_action");
  assert.equal(updated.state, "waiting_action");
  assert.notEqual(updated.updatedAt, created.updatedAt);
});

test("Postgres Conversation: isolamento entre tenants no listByWorkspace", async () => {
  const workspaceA = await seedWorkspace("tenant-conv-iso-a");
  const workspaceB = await seedWorkspace("tenant-conv-iso-b");
  const repo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });

  await repo.create({ tenantId: "tenant-conv-iso-a", workspaceId: workspaceA.id });
  await repo.create({ tenantId: "tenant-conv-iso-b", workspaceId: workspaceB.id });

  const listA = await repo.listByWorkspace("tenant-conv-iso-a", workspaceA.id);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].tenantId, "tenant-conv-iso-a");
});

test("Postgres Conversation: apagar o workspace faz cascata na conversa", async () => {
  const workspace = await seedWorkspace("tenant-conv-cascade");
  const repo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const conversation = await repo.create({ tenantId: "tenant-conv-cascade", workspaceId: workspace.id });

  await db.pool.query("delete from workspaces where id = $1", [workspace.id]);
  const afterDelete = await repo.getById(conversation.id);
  assert.equal(afterDelete, undefined);
});

test("Postgres ConversationEvent: append()/listByConversation() preserva ordem", async () => {
  const workspace = await seedWorkspace("tenant-conv-2");
  const conversationRepo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const eventRepo = new PostgresConversationEventRepository(db.pool, { idGenerator: () => nextId("event") });
  const conversation = await conversationRepo.create({ tenantId: "tenant-conv-2", workspaceId: workspace.id });

  await eventRepo.append({ conversationId: conversation.id, type: "user_message", payload: { content: "oi" } });
  await eventRepo.append({ conversationId: conversation.id, type: "intent_classified", payload: { intent: { type: "free_chat" } } });

  const events = await eventRepo.listByConversation(conversation.id);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.type), ["user_message", "intent_classified"]);
  assert.equal(events[0].payload.content, "oi");
});

test("Postgres ConversationEvent: apagar a conversa faz cascata nos eventos", async () => {
  const workspace = await seedWorkspace("tenant-conv-3");
  const conversationRepo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const eventRepo = new PostgresConversationEventRepository(db.pool, { idGenerator: () => nextId("event") });
  const conversation = await conversationRepo.create({ tenantId: "tenant-conv-3", workspaceId: workspace.id });
  await eventRepo.append({ conversationId: conversation.id, type: "user_message", payload: { content: "oi" } });

  await db.pool.query("delete from conversations where id = $1", [conversation.id]);
  const events = await eventRepo.listByConversation(conversation.id);
  assert.equal(events.length, 0);
});

test("Postgres ConversationMemory: upsert()/get() grava e sobrescreve fatos", async () => {
  const workspace = await seedWorkspace("tenant-conv-4");
  const conversationRepo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const memoryRepo = new PostgresConversationMemoryRepository(db.pool);
  const conversation = await conversationRepo.create({ tenantId: "tenant-conv-4", workspaceId: workspace.id });

  const first = await memoryRepo.upsert(conversation.id, { campaign: "Verão" });
  assert.deepEqual(first.facts, { campaign: "Verão" });

  const second = await memoryRepo.upsert(conversation.id, { campaign: "Inverno", audience: "jovens" });
  assert.deepEqual(second.facts, { campaign: "Inverno", audience: "jovens" });

  const found = await memoryRepo.get(conversation.id);
  assert.deepEqual(found.facts, { campaign: "Inverno", audience: "jovens" });
});

test("Postgres ConversationMemory: get() em conversa sem memória devolve undefined", async () => {
  const memoryRepo = new PostgresConversationMemoryRepository(db.pool);
  const found = await memoryRepo.get("conversa-sem-memoria");
  assert.equal(found, undefined);
});
