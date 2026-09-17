import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxTagRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-tag-repository.js";
import {
  registerInboundMessage,
  listInboxTags,
  createInboxTag,
  updateInboxTag,
  deleteInboxTag,
  addTagToConversation,
  removeTagFromConversation,
  listConversations,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do sistema
 * e nas conversas ser possível adicionar mais do que uma"). Cobre: CRUD da taxonomia (por
 * workspace, nome único case-insensitive), attach/detach idempotente numa conversa (N:N — mais de
 * uma etiqueta por conversa), denormalização em `listConversations`, isolamento cross-tenant/
 * workspace, e exclusão de etiqueta cascateando pra fora de toda conversa que a tinha.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55721 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeSetup(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const conversationEventRepo = new PostgresInboxConversationEventRepository(db.pool);
  const tagRepository = new PostgresInboxTagRepository(db.pool);

  const deps = {
    contactRepository: contactRepo,
    conversationRepository: conversationRepo,
    messageRepository: messageRepo,
    conversationEventRepository: conversationEventRepo,
    tagRepository,
  };
  return { workspace, connectionRepo, deps, conversationRepo, tagRepository };
}

async function makeConversation(tenantId, workspace, connectionRepo, deps, externalMessageId) {
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: `+551199${Math.floor(Math.random() * 10_000_000)}`, isGroup: false, fromMe: false,
    senderId: "+5511900000000", senderName: "Cliente",
    externalMessageId, type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });
  return registered.conversation;
}

test("CRUD: criar/listar/editar/excluir etiqueta, nome único (case-insensitive) por workspace", async () => {
  const tenantId = "tenant-tags-crud-1";
  const { workspace, deps } = await makeSetup(tenantId);

  const tag = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Urgente", color: "rose" });
  assert.equal(tag.name, "Urgente");
  assert.equal(tag.color, "rose");

  await assert.rejects(
    () => createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "urgente" }),
    /INBOX_TAG_NAME_TAKEN/,
    "nome duplicado (mesmo com case diferente) tem que ser rejeitado",
  );

  const listed = await listInboxTags(deps, { tenantId, workspaceId: workspace.id });
  assert.equal(listed.length, 1);

  const updated = await updateInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tag.id, name: "VIP", color: "amber" });
  assert.equal(updated.name, "VIP");
  assert.equal(updated.color, "amber");

  await deleteInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tag.id });
  const afterDelete = await listInboxTags(deps, { tenantId, workspaceId: workspace.id });
  assert.equal(afterDelete.length, 0);
});

test("CRUD: nome vazio (ou só espaços) é rejeitado, tanto na criação quanto na edição", async () => {
  const tenantId = "tenant-tags-crud-2";
  const { workspace, deps } = await makeSetup(tenantId);

  await assert.rejects(() => createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "   " }), /INBOX_TAG_NAME_EMPTY/);

  const tag = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Financeiro" });
  await assert.rejects(() => updateInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tag.id, name: "  " }), /INBOX_TAG_NAME_EMPTY/);
});

test("CRUD: renomear pra um nome já usado por OUTRA etiqueta é rejeitado (nunca um erro cru de banco); renomear pra si mesma (mesmo nome, outro case) funciona", async () => {
  const tenantId = "tenant-tags-crud-3";
  const { workspace, deps } = await makeSetup(tenantId);
  const tagA = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Vendas" });

  await assert.rejects(
    () => updateInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tagA.id, name: "vendas" }),
    /INBOX_TAG_NAME_TAKEN/,
  );

  const renamed = await updateInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tagA.id, name: "SUPORTE", color: "sky" });
  assert.equal(renamed.name, "SUPORTE", "renomear pro MESMO nome (case diferente) da própria etiqueta nunca é bloqueado como duplicidade");
});

test("ISOLAMENTO: etiqueta de outro workspace/tenant nunca é encontrada (404, nunca vaza existência)", async () => {
  const { workspace: workspaceA, deps: depsA } = await makeSetup("tenant-tags-iso-a");
  const { workspace: workspaceB, deps: depsB } = await makeSetup("tenant-tags-iso-b");
  const tagA = await createInboxTag(depsA, { tenantId: "tenant-tags-iso-a", workspaceId: workspaceA.id, name: "Só da A" });

  await assert.rejects(
    () => updateInboxTag(depsB, { tenantId: "tenant-tags-iso-b", workspaceId: workspaceB.id, tagId: tagA.id, name: "Roubada" }),
    /INBOX_TAG_NOT_FOUND/,
  );
  await assert.rejects(
    () => deleteInboxTag(depsA, { tenantId: "tenant-tags-iso-a", workspaceId: workspaceB.id, tagId: tagA.id }),
    /INBOX_TAG_NOT_FOUND/,
    "mesmo tenant, workspace errado — também não encontra",
  );
});

test("CONVERSA: aceita MAIS DE UMA etiqueta por conversa; attach é idempotente; detach some sozinho", async () => {
  const tenantId = "tenant-tags-conv-1";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid-tags-1");

  const tagUrgente = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Urgente", color: "rose" });
  const tagVip = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "VIP", color: "amber" });

  await addTagToConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, tagId: tagUrgente.id });
  await addTagToConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, tagId: tagVip.id });
  // Idempotente — aplicar a MESMA etiqueta de novo nunca duplica nem lança.
  await addTagToConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, tagId: tagUrgente.id });

  const [listed] = await listConversations(deps, { tenantId, workspaceId: workspace.id });
  assert.equal(listed.tags.length, 2, "conversa tem as DUAS etiquetas — nunca só a última aplicada");
  assert.deepEqual(listed.tags.map((tag) => tag.name).sort(), ["Urgente", "VIP"]);

  await removeTagFromConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, tagId: tagUrgente.id });
  const [afterRemove] = await listConversations(deps, { tenantId, workspaceId: workspace.id });
  assert.deepEqual(afterRemove.tags.map((tag) => tag.name), ["VIP"], "remover uma etiqueta nunca afeta a outra");

  // Conversa inexistente/de outro tenant nunca aceita etiqueta — mesmo padrão de isolamento do resto do módulo.
  await assert.rejects(
    () => addTagToConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: "conv-inexistente", tagId: tagVip.id }),
    /INBOX_CONVERSATION_NOT_FOUND/,
  );
});

test("EXCLUSÃO DE ETIQUETA: excluir a etiqueta remove ela de TODA conversa que a tinha, sem apagar a conversa", async () => {
  const tenantId = "tenant-tags-conv-2";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid-tags-2");
  const tag = await createInboxTag(deps, { tenantId, workspaceId: workspace.id, name: "Reclamação", color: "rose" });
  await addTagToConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, tagId: tag.id });

  await deleteInboxTag(deps, { tenantId, workspaceId: workspace.id, tagId: tag.id });

  const [listed] = await listConversations(deps, { tenantId, workspaceId: workspace.id });
  assert.deepEqual(listed.tags, [], "a etiqueta excluída não aparece mais — a conversa em si continua existindo");
});

test("SEM MÓDULO CONFIGURADO: listConversations sem tagRepository nunca lança e nunca preenche `tags` (comportamento anterior preservado)", async () => {
  const tenantId = "tenant-tags-off-1";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid-tags-3");

  const depsWithoutTags = { ...deps, tagRepository: undefined };
  const [listed] = await listConversations(depsWithoutTags, { tenantId, workspaceId: workspace.id });
  assert.equal(listed.tags, undefined);
});
