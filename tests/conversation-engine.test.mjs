import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresAssetLibraryRepository } from "../dist/infrastructure/storage/postgres/postgres-asset-library-repository.js";
import { PostgresConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-repository.js";
import { PostgresConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-event-repository.js";
import { PostgresConversationMemoryRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-memory-repository.js";
import { PostgresBriefingRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-repository.js";
import { PostgresBriefingFieldValueRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-field-value-repository.js";
import { PostgresBriefingQuestionRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-question-repository.js";
import { PostgresPreparedCommandRepository } from "../dist/infrastructure/storage/postgres/postgres-prepared-command-repository.js";
import { createNotConnectedCompanyKnowledgeSource } from "../dist/infrastructure/briefing/not-connected-company-knowledge-source.js";
import { createAssetLibraryAssetMetadataSource } from "../dist/infrastructure/briefing/asset-library-asset-metadata-source.js";
import {
  createConversation,
  getConversation,
  getHistory,
  listConversations,
  sendMessage,
} from "../dist/application/conversation/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

function makeDeps() {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetLibraryRepository = new PostgresAssetLibraryRepository(db.pool);
  return {
    workspaceRepository,
    conversationRepository: new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") }),
    eventRepository: new PostgresConversationEventRepository(db.pool, { idGenerator: () => nextId("event") }),
    memoryRepository: new PostgresConversationMemoryRepository(db.pool),
    briefingRepository: new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") }),
    fieldValueRepository: new PostgresBriefingFieldValueRepository(db.pool, { idGenerator: () => nextId("briefing-value") }),
    questionRepository: new PostgresBriefingQuestionRepository(db.pool, { idGenerator: () => nextId("briefing-question") }),
    preparedCommandRepository: new PostgresPreparedCommandRepository(db.pool, { idGenerator: () => nextId("prepared-command") }),
    companyKnowledgeSource: createNotConnectedCompanyKnowledgeSource(),
    assetMetadataSource: createAssetLibraryAssetMetadataSource(workspaceRepository, assetLibraryRepository),
  };
}

before(async () => {
  db = await startTestPostgres({ port: 55480 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

// ---------------------------------------------------------------------------------------------
// Criação de conversa (isolamento por tenant/workspace)
// ---------------------------------------------------------------------------------------------

test("createConversation: fluxo válido cria com status active e state idle", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-1", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-1", workspaceId: workspace.id, title: "Conversa 1" });
  assert.equal(conversation.status, "active");
  assert.equal(conversation.state, "idle");
});

test("createConversation: workspace de outro tenant lança CONVERSATION_WORKSPACE_NOT_FOUND", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-owner", name: "W" });
  await assert.rejects(
    () => createConversation(deps, { tenantId: "tenant-eng-invasor", workspaceId: workspace.id }),
    /CONVERSATION_WORKSPACE_NOT_FOUND/,
  );
});

test("listConversations: nunca vaza conversas de outro tenant/workspace", async () => {
  const deps = makeDeps();
  const workspaceA = await deps.workspaceRepository.create({ tenantId: "tenant-eng-2a", name: "A" });
  const workspaceB = await deps.workspaceRepository.create({ tenantId: "tenant-eng-2b", name: "B" });
  await createConversation(deps, { tenantId: "tenant-eng-2a", workspaceId: workspaceA.id });
  await createConversation(deps, { tenantId: "tenant-eng-2b", workspaceId: workspaceB.id });

  const listA = await listConversations(deps, { tenantId: "tenant-eng-2a", workspaceId: workspaceA.id });
  assert.equal(listA.length, 1);
});

test("getConversation: acesso cross-tenant lança CONVERSATION_NOT_FOUND (nunca 403)", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-3a", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-3a", workspaceId: workspace.id });

  await assert.rejects(
    () => getConversation(deps, { tenantId: "tenant-eng-3b", workspaceId: workspace.id, id: conversation.id }),
    /CONVERSATION_NOT_FOUND/,
  );
});

// ---------------------------------------------------------------------------------------------
// sendMessage / Engine — mudança de estado + integração com Arthur
// ---------------------------------------------------------------------------------------------

test("sendMessage: mensagem vazia lança CONVERSATION_VALIDATION_ERROR", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-4", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-4", workspaceId: workspace.id });

  await assert.rejects(
    () => sendMessage(deps, { tenantId: "tenant-eng-4", workspaceId: workspace.id, conversationId: conversation.id, content: "   " }),
    /CONVERSATION_VALIDATION_ERROR/,
  );
});

test("sendMessage: 'oi' (free_chat) resolve o turno e Arthur decide responder", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-5", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-5", workspaceId: workspace.id });

  const result = await sendMessage(deps, { tenantId: "tenant-eng-5", workspaceId: workspace.id, conversationId: conversation.id, content: "oi" });
  assert.equal(result.intent.type, "free_chat");
  assert.equal(result.decision.action, "respond");
  assert.equal(result.conversation.state, "resolved");
  assert.equal(result.systemMessageText, "Arthur decidiu responder diretamente.");
});

test("sendMessage: free_chat sem nenhum contexto ainda resolve normalmente (não é a mesma coisa que baixa confiança)", async () => {
  // "unknown" (confiança 0.1, abaixo do limiar do Arthur) só é alcançável com texto vazio, e
  // sendMessage já rejeita conteúdo vazio antes de chegar ao Engine (ver teste de validação
  // acima) — a regra de "confiança baixa" do Arthur é coberta diretamente em
  // conversation-arthur-decision.test.mjs (nível de domínio puro), não é alcançável por aqui.
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-6", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-6", workspaceId: workspace.id });

  const result = await sendMessage(deps, {
    tenantId: "tenant-eng-6",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    content: "só passando para dizer oi",
  });
  assert.equal(result.intent.type, "free_chat");
  assert.equal(result.decision.action, "respond");
  assert.equal(result.conversation.state, "resolved");
});

test("sendMessage: intenção de Knowledge, com contexto suficiente (segundo turno), delega para Clara", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-7", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-7", workspaceId: workspace.id });

  // Primeiro turno estabelece contexto (turnCount passa a > 0 a partir do segundo).
  await sendMessage(deps, { tenantId: "tenant-eng-7", workspaceId: workspace.id, conversationId: conversation.id, content: "oi, tudo bem?" });

  const result = await sendMessage(deps, {
    tenantId: "tenant-eng-7",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    content: "qual é o nosso público-alvo?",
  });
  assert.equal(result.intent.type, "query_knowledge");
  assert.equal(result.decision.action, "call_clara");
  assert.equal(result.conversation.state, "waiting_action");
  assert.equal(result.systemMessageText, "Arthur decidiu consultar Knowledge.");
});

test("sendMessage: primeira mensagem já delegando (sem contexto nenhum) faz Arthur pedir mais contexto mesmo com alta confiança", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-8", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-8", workspaceId: workspace.id });

  const result = await sendMessage(deps, {
    tenantId: "tenant-eng-8",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    content: "quais assets vocês têm?",
  });
  assert.equal(result.intent.type, "query_assets");
  assert.equal(result.decision.action, "request_more_context");
  assert.equal(result.conversation.state, "awaiting_context");
});

// ---------------------------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------------------------

test("getHistory: registra todos os eventos do turno, em ordem (user_message -> ... -> state_changed)", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-9", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-9", workspaceId: workspace.id });
  await sendMessage(deps, { tenantId: "tenant-eng-9", workspaceId: workspace.id, conversationId: conversation.id, content: "oi" });

  const history = await getHistory(deps, { tenantId: "tenant-eng-9", workspaceId: workspace.id, conversationId: conversation.id });
  assert.deepEqual(
    history.map((event) => event.type),
    ["user_message", "intent_classified", "context_updated", "decision_made", "system_message", "state_changed"],
  );
});

test("getHistory: cross-tenant lança CONVERSATION_NOT_FOUND", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-10a", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-10a", workspaceId: workspace.id });

  await assert.rejects(
    () => getHistory(deps, { tenantId: "tenant-eng-10b", workspaceId: workspace.id, conversationId: conversation.id }),
    /CONVERSATION_NOT_FOUND/,
  );
});

test("getHistory: várias mensagens acumulam eventos em ordem cronológica sem perder turnos anteriores", async () => {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-eng-11", name: "W" });
  const conversation = await createConversation(deps, { tenantId: "tenant-eng-11", workspaceId: workspace.id });

  await sendMessage(deps, { tenantId: "tenant-eng-11", workspaceId: workspace.id, conversationId: conversation.id, content: "oi" });
  await sendMessage(deps, { tenantId: "tenant-eng-11", workspaceId: workspace.id, conversationId: conversation.id, content: "tudo bem?" });

  const history = await getHistory(deps, { tenantId: "tenant-eng-11", workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(history.length, 12); // 6 eventos por turno x 2 turnos
  assert.equal(history.filter((event) => event.type === "user_message").length, 2);
});
