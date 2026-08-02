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
import { createConversation, sendMessage } from "../dist/application/conversation/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55510 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

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

async function setup(tenantId) {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "Workspace" });
  const conversation = await createConversation(deps, { tenantId, workspaceId: workspace.id });
  return { deps, workspace, conversation };
}

// ---------------------------------------------------------------------------------------------
// Fluxo completo: pedido incompleto -> perguntas progressivas -> briefing pronto -> PreparedCommand
// ---------------------------------------------------------------------------------------------

test("Fluxo completo: create_campaign inicia Briefing, perguntas progressivas levam a awaiting_confirmation e depois a um PreparedCommand nunca executado", async () => {
  const { deps, conversation } = await setup("tenant-flow-1");
  const url = (content) => sendMessage(deps, { tenantId: "tenant-flow-1", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  const turn1 = await url("quero criar uma campanha para vender tênis novo");
  assert.equal(turn1.conversation.state, "collecting_briefing");
  assert.equal(turn1.confirmationRequired, false);
  assert.ok(turn1.nextQuestion.fieldKeys.includes("offerOrSubject"), "objetivo já foi extraído pela mensagem inicial (verbo 'vender'), só falta a oferta");

  const turn2 = await url("tênis de corrida modelo Speed X");
  assert.equal(turn2.conversation.state, "collecting_briefing");
  assert.ok(turn2.nextQuestion.fieldKeys.includes("channel"), "canal desbloqueia contentFormat (dependsOn) — prioridade 2");

  const turn3 = await url("instagram");
  assert.equal(turn3.conversation.state, "collecting_briefing");
  assert.ok(turn3.nextQuestion.fieldKeys.includes("targetAudience"));

  const turn4 = await url("jovens de 18 a 25 anos, praticantes de corrida");
  assert.equal(turn4.conversation.state, "collecting_briefing");
  assert.ok(turn4.nextQuestion.fieldKeys.includes("contentFormat"), "contentFormat só se torna obrigatório depois que channel é conhecido");

  const turn5 = await url("carrossel");
  assert.equal(turn5.conversation.state, "awaiting_confirmation");
  assert.equal(turn5.confirmationRequired, true);
  assert.ok(turn5.systemMessageText.includes("Nenhum conteúdo foi gerado ainda"));
  assert.ok(turn5.briefingSummary.knownFields.some((f) => f.fieldKey === "channel" && f.value === "instagram"));

  const turn6 = await url("sim");
  assert.equal(turn6.conversation.state, "resolved");
  assert.equal(turn6.confirmationRequired, false);
  assert.ok(turn6.preparedCommandSummary, "PreparedCommand deve existir depois da confirmação");
  assert.equal(turn6.preparedCommandSummary.status, "prepared");
  assert.equal(turn6.preparedCommandSummary.fieldCount, 5, "objective/offerOrSubject/targetAudience/channel/contentFormat");

  // Nunca conectamos IA/Skill/Caio — não deve existir NENHUM evento de execução real.
  const events = turn6.events.map((e) => e.type);
  assert.ok(!events.includes("decision_made"), "turno de Briefing nunca passa pelo Arthur legado");
});

// ---------------------------------------------------------------------------------------------
// Correção depois da confirmação: revisão incrementa, PreparedCommand antigo é superseded
// ---------------------------------------------------------------------------------------------

test("Correção depois da confirmação: incrementa revisão, supera o PreparedCommand antigo e exige nova confirmação", async () => {
  const { deps, conversation } = await setup("tenant-flow-2");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-flow-2", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  await send("tênis de corrida modelo Speed X");
  await send("instagram");
  await send("jovens de 18 a 25 anos");
  await send("carrossel");
  const confirmed = await send("sim");
  const firstCommandId = confirmed.preparedCommandSummary.id;
  assert.equal(confirmed.conversation.state, "resolved");

  const briefingBeforeCorrection = await deps.briefingRepository.getActiveByConversation(conversation.id);
  assert.equal(briefingBeforeCorrection.revision, 1);

  const corrected = await send("na verdade, corrigir o canal para facebook");
  assert.equal(corrected.conversation.state, "awaiting_confirmation", "correção volta o Briefing para o ciclo de confirmação");

  const reconfirmed = await send("sim");
  assert.equal(reconfirmed.conversation.state, "resolved");
  assert.notEqual(reconfirmed.preparedCommandSummary.id, firstCommandId, "uma correção deve gerar um PreparedCommand NOVO, nunca reaproveitar o antigo");

  const firstCommand = await deps.preparedCommandRepository.getById(firstCommandId);
  assert.equal(firstCommand.status, "superseded");
  assert.equal(reconfirmed.preparedCommandSummary.status, "prepared");

  const briefingAfterCorrection = await deps.briefingRepository.getActiveByConversation(conversation.id);
  assert.equal(briefingAfterCorrection.revision, 2);
});

// ---------------------------------------------------------------------------------------------
// Confirmação ambígua nunca é aceita
// ---------------------------------------------------------------------------------------------

test("Confirmação ambígua ('sim, mas...') nunca confirma o Briefing", async () => {
  const { deps, conversation } = await setup("tenant-flow-3");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-flow-3", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  await send("tênis de corrida modelo Speed X");
  await send("instagram");
  await send("jovens de 18 a 25 anos");
  const readyTurn = await send("carrossel");
  assert.equal(readyTurn.conversation.state, "awaiting_confirmation");

  const ambiguous = await send("sim, mas quero mudar o formato depois");
  assert.equal(ambiguous.conversation.state, "awaiting_confirmation", "continua aguardando confirmação — nunca aceita confirmação ambígua");
  assert.equal(ambiguous.confirmationRequired, true);
  assert.equal(ambiguous.preparedCommandSummary, undefined);
});

// ---------------------------------------------------------------------------------------------
// Suspensão (nunca cancelamento) por nova intenção inequívoca + retomada automática
// ---------------------------------------------------------------------------------------------

test("Suspensão: uma intenção incompatível e inequívoca suspende o Briefing (nunca cancela) e a próxima mensagem retoma", async () => {
  const { deps, conversation } = await setup("tenant-flow-4");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-flow-4", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  await send("tênis de corrida modelo Speed X");
  await send("instagram");
  await send("jovens de 18 a 25 anos");
  const readyTurn = await send("carrossel");
  assert.equal(readyTurn.conversation.state, "awaiting_confirmation");

  // Mensagem que NÃO é confirmação e classifica como intenção inequívoca incompatível (query_assets).
  const interrupted = await send("quais assets já temos disponíveis?");
  assert.equal(interrupted.command.action, "call_assets", "a mensagem foi processada pelo pipeline normal da Sprint 06, não pelo Briefing");
  assert.equal(interrupted.conversation.state, "waiting_action");

  const briefingAfterInterruption = await deps.briefingRepository.getActiveByConversation(conversation.id);
  assert.equal(briefingAfterInterruption.status, "awaiting_confirmation", "suspensão NUNCA muda o status do Briefing");

  const events = await deps.eventRepository.listByConversation(conversation.id);
  assert.ok(events.some((e) => e.type === "briefing_suspended"));

  // Próxima mensagem retoma automaticamente (é a mesma pergunta de confirmação, ainda pendente).
  const resumed = await send("sim");
  assert.equal(resumed.conversation.state, "resolved");
  assert.ok(resumed.preparedCommandSummary);

  const eventsAfterResume = await deps.eventRepository.listByConversation(conversation.id);
  assert.ok(eventsAfterResume.some((e) => e.type === "briefing_resumed"));
});

// ---------------------------------------------------------------------------------------------
// Cancelamento explícito
// ---------------------------------------------------------------------------------------------

test("Cancelamento explícito encerra o Briefing e libera a conversa para um novo", async () => {
  const { deps, conversation } = await setup("tenant-flow-5");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-flow-5", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  const cancelled = await send("na verdade não quero mais fazer isso, cancela");
  assert.equal(cancelled.conversation.state, "resolved");
  assert.ok(cancelled.systemMessageText.includes("cancelado"));

  const briefing = await deps.briefingRepository.getActiveByConversation(conversation.id);
  assert.equal(briefing, undefined, "um Briefing cancelado não é mais 'ativo'");

  // Uma nova campanha pode começar normalmente na mesma conversa.
  const restarted = await send("quero criar uma campanha para divulgar o lançamento");
  assert.equal(restarted.conversation.state, "collecting_briefing");
});
