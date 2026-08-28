import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Persistência real (Postgres via pglite) do módulo Conversas, Fase 1/2. Foco em idempotência
 * (Seção 46 do pedido original — "mesmo evento recebido duas vezes gera uma mensagem") e
 * isolamento multi-tenant, já que são os dois requisitos não-negociáveis do módulo.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55661 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("Migrations 0080-0083 aplicam sem erro; tabelas do módulo Conversas existem", async () => {
  for (const id of ["0080_messaging_connections", "0081_inbox_contacts", "0082_inbox_conversations", "0083_inbox_messages"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("PostgresMessagingConnectionRepository: create()/updateStatus()/getById() round trip", async () => {
  const workspace = await makeWorkspace("tenant-conn-1");
  const repo = new PostgresMessagingConnectionRepository(db.pool);

  const connection = await repo.create({ tenantId: "tenant-conn-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp Comercial" });
  assert.equal(connection.status, "connecting");

  const updated = await repo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-abc", phoneNumber: "+5511999990000" });
  assert.equal(updated.status, "connected");
  assert.equal(updated.phoneNumber, "+5511999990000");

  // Correlação de evento inbound usa `getById` direto — `instanceName` no evento do WuzAPI é
  // sempre o próprio `MessagingConnection.id` (ver `wuzapi-messaging-provider.ts:connect`), não o
  // token de sessão. Ver `wuzapi-event-mapper.ts`.
  const found = await repo.getById(connection.id);
  assert.equal(found.externalSessionId, "sess-abc");
});

test("PostgresInboxContactRepository: upsertByPhone() nunca duplica pelo mesmo (workspace, telefone)", async () => {
  const workspace = await makeWorkspace("tenant-contact-1");
  const repo = new PostgresInboxContactRepository(db.pool);

  const first = await repo.upsertByPhone({ tenantId: "tenant-contact-1", workspaceId: workspace.id, phoneNormalized: "+5511988887777", name: "João" });
  const second = await repo.upsertByPhone({ tenantId: "tenant-contact-1", workspaceId: workspace.id, phoneNormalized: "+5511988887777", name: "João da Silva" });

  assert.equal(first.id, second.id, "upsert pelo mesmo telefone deve atualizar o mesmo registro, nunca criar um novo");
  assert.equal(second.name, "João da Silva");
});

test("PostgresInboxConversationRepository: findOrCreate() é idempotente por (connectionId, contactId)", async () => {
  const workspace = await makeWorkspace("tenant-conv-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-conv-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-conv-1", workspaceId: workspace.id, phoneNormalized: "+5511977776666" });

  const first = await conversationRepo.findOrCreate({ tenantId: "tenant-conv-1", workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  const second = await conversationRepo.findOrCreate({ tenantId: "tenant-conv-1", workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });

  assert.equal(first.id, second.id, "findOrCreate repetido pelo mesmo par (connection, contact) nunca deve criar uma segunda conversa");
});

test("PostgresInboxMessageRepository: create() com o mesmo (connectionId, externalMessageId) é idempotente — reentrega de evento nunca duplica mensagem", async () => {
  const workspace = await makeWorkspace("tenant-msg-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-msg-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-msg-1", workspaceId: workspace.id, phoneNormalized: "+5511966665555" });
  const conversation = await conversationRepo.findOrCreate({ tenantId: "tenant-msg-1", workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });

  const input = {
    tenantId: "tenant-msg-1",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    connectionId: connection.id,
    externalMessageId: "wamid.duplicated-event",
    direction: "inbound",
    type: "text",
    body: "Oi",
  };

  const first = await messageRepo.create(input);
  const second = await messageRepo.create(input); // simula reentrega do mesmo evento pelo RabbitMQ

  assert.equal(first.id, second.id, "o mesmo externalMessageId na mesma conexão nunca deve gerar uma segunda mensagem");

  const count = await db.pool.query("select count(*)::int as count from inbox_messages where connection_id = $1 and external_message_id = $2", [connection.id, "wamid.duplicated-event"]);
  assert.equal(count.rows[0].count, 1);
});

test("PostgresInboxMessageRepository: mensagens outbound sem externalMessageId (queued) não colidem entre si", async () => {
  const workspace = await makeWorkspace("tenant-msg-2");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-msg-2", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-msg-2", workspaceId: workspace.id, phoneNormalized: "+5511955554444" });
  const conversation = await conversationRepo.findOrCreate({ tenantId: "tenant-msg-2", workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });

  const base = { tenantId: "tenant-msg-2", workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id, direction: "outbound", type: "text", status: "queued" };
  const first = await messageRepo.create({ ...base, body: "Mensagem 1" });
  const second = await messageRepo.create({ ...base, body: "Mensagem 2" });

  assert.notEqual(first.id, second.id, "duas mensagens queued sem externalMessageId (NULL) não podem ser tratadas como a mesma");
});

test("Isolamento multi-tenant: listByWorkspace() nunca mistura conexões/conversas de tenants diferentes", async () => {
  const workspaceA = await makeWorkspace("tenant-iso-a");
  const workspaceB = await makeWorkspace("tenant-iso-b");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);

  const connectionA = await connectionRepo.create({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, provider: "wuzapi", displayName: "A" });
  const connectionB = await connectionRepo.create({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id, provider: "wuzapi", displayName: "B" });

  const listA = await connectionRepo.listByWorkspace({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id });
  const listB = await connectionRepo.listByWorkspace({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id });
  assert.deepEqual(listA.map((c) => c.id), [connectionA.id]);
  assert.deepEqual(listB.map((c) => c.id), [connectionB.id]);

  const contactA = await contactRepo.upsertByPhone({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, phoneNormalized: "+5511911112222" });
  const contactB = await contactRepo.upsertByPhone({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id, phoneNormalized: "+5511911112222" }); // mesmo telefone, workspace diferente
  assert.notEqual(contactA.id, contactB.id, "o mesmo telefone em workspaces diferentes deve gerar contatos DIFERENTES, nunca ser tratado como o mesmo contato entre tenants");

  const conversationA = await conversationRepo.findOrCreate({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, connectionId: connectionA.id, contactId: contactA.id });
  const conversationsA = await conversationRepo.listByWorkspace({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id });
  const conversationsB = await conversationRepo.listByWorkspace({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id });
  assert.deepEqual(conversationsA.map((c) => c.id), [conversationA.id]);
  assert.deepEqual(conversationsB, [], "workspace B não pode ver a conversa criada no workspace A");
});
