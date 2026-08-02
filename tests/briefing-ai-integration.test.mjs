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
import { PostgresAiExecutionRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-execution-repository.js";
import { createNotConnectedCompanyKnowledgeSource } from "../dist/infrastructure/briefing/not-connected-company-knowledge-source.js";
import { createAssetLibraryAssetMetadataSource } from "../dist/infrastructure/briefing/asset-library-asset-metadata-source.js";
import { createConversation, sendMessage } from "../dist/application/conversation/index.js";
import { AiGateway } from "../dist/application/ai-gateway/ai-gateway.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { createNotConfiguredAiGateway } from "../dist/infrastructure/ai/not-configured-ai-gateway.js";
import { FakeAiModelProvider, fakeSuccess, fakeFailure } from "../dist/infrastructure/ai/fake-ai-model-provider.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55540 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

const EMPTY_EXTRACTION_OUTPUT = { schemaVersion: 1, candidates: [], ambiguities: [], unsupportedClaims: [], warnings: [] };

function targetAudienceCandidateOutput() {
  return {
    schemaVersion: 1,
    candidates: [
      {
        fieldKey: "targetAudience",
        originalText: "instagram",
        proposedValue: "jovens de 18 a 25 anos",
        normalizedValue: "jovens de 18 a 25 anos",
        confidence: 0.75,
        evidence: "instagram",
        requiresConfirmation: true,
        sensitivityDetected: false,
        rationaleCode: "inferred_from_context",
      },
    ],
    ambiguities: [],
    unsupportedClaims: [],
    warnings: [],
  };
}

/** `evidence` só pode ser aceito pela validação semântica quando aparece literalmente na mensagem
 * ATUAL (defesa contra alucinação, Fase 8) — a IA é chamada em vários turnos ao longo do fluxo
 * (sempre que sobra alguma lacuna, não só uma vez), então o script precisa decidir por conteúdo
 * em vez de por índice de chamada fixo. */
function scriptTargetAudienceWhenMessageMentionsInstagram(request) {
  return request.userInput.includes("instagram") ? fakeSuccess(targetAudienceCandidateOutput()) : fakeSuccess(EMPTY_EXTRACTION_OUTPUT);
}

function makeDeps({ aiExtractionEnabled = false, fakeProviderScript } = {}) {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetLibraryRepository = new PostgresAssetLibraryRepository(db.pool);

  let aiGateway = createNotConfiguredAiGateway();
  if (fakeProviderScript) {
    const provider = new FakeAiModelProvider({ id: "anthropic", script: fakeProviderScript });
    aiGateway = new AiGateway({
      providers: [provider],
      bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
      rateLimiter: new InMemoryAiRateLimiter(),
      circuitBreaker: new InMemoryAiCircuitBreaker(),
      executionRepository: new PostgresAiExecutionRepository(db.pool),
      telemetry: new InMemoryAiTelemetry(),
    });
  }

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
    aiGateway,
    aiExtractionEnabled,
  };
}

async function setup(tenantId, depsOptions) {
  const deps = makeDeps(depsOptions);
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "Workspace" });
  const conversation = await createConversation(deps, { tenantId, workspaceId: workspace.id });
  return { deps, workspace, conversation };
}

// ---------------------------------------------------------------------------------------------
// Gateway desligado — comportamento idêntico à Sprint 07 (Fase 19/37)
// ---------------------------------------------------------------------------------------------

test("Feature flag desligada: fluxo idêntico à Sprint 07 — aiAssisted nunca aparece, AI Gateway nunca é chamado", async () => {
  const { deps, conversation } = await setup("tenant-ai-int-1", { aiExtractionEnabled: false });
  const send = (content) => sendMessage(deps, { tenantId: "tenant-ai-int-1", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  const turn1 = await send("quero criar uma campanha para vender tênis novo");
  assert.equal(turn1.aiAssisted, false);
  assert.equal(turn1.aiFallbackUsed, false);
  assert.equal(turn1.conversation.state, "collecting_briefing");
});

// ---------------------------------------------------------------------------------------------
// IA encontra campo adicional (obrigatório) que exige confirmação — nunca satisfaz sozinha
// ---------------------------------------------------------------------------------------------

test("IA assistida: sugestão de campo obrigatório exige confirmação explícita; PreparedCommand só nasce na confirmação FINAL, nunca na confirmação de uma sugestão isolada", async () => {
  const { deps, conversation } = await setup("tenant-ai-int-2", {
    aiExtractionEnabled: true,
    fakeProviderScript: [scriptTargetAudienceWhenMessageMentionsInstagram],
  });
  const send = (content) => sendMessage(deps, { tenantId: "tenant-ai-int-2", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  const turn2 = await send("tênis de corrida modelo Speed X");
  assert.ok(turn2.nextQuestion.fieldKeys.includes("channel"));

  const turn3 = await send("instagram");
  assert.equal(turn3.aiAssisted, true, "a IA deveria ter sido chamada e encontrado um candidato para targetAudience");
  assert.ok(
    turn3.briefingSummary.knownFields.some((f) => f.fieldKey === "targetAudience" && f.value === "jovens de 18 a 25 anos" && f.requiresConfirmation && !f.confirmedByUser),
    "o valor sugerido pela IA deve aparecer como sugestão NÃO confirmada",
  );

  const turn4 = await send("carrossel");
  assert.equal(turn4.confirmationRequired, false, "ainda falta confirmar a sugestão de targetAudience — não deveria estar pedindo confirmação final ainda");

  const turn5 = await send("sim");
  assert.equal(turn5.preparedCommandSummary, undefined, "confirmar UMA sugestão isolada NUNCA deve criar um PreparedCommand");
  assert.equal(turn5.confirmationRequired, true, "agora sim deveria estar pedindo a confirmação FINAL do briefing inteiro");
  assert.ok(turn5.briefingSummary.knownFields.some((f) => f.fieldKey === "targetAudience" && f.confirmedByUser === true), "targetAudience deveria estar confirmado agora");

  const turn6 = await send("sim");
  assert.ok(turn6.preparedCommandSummary, "a confirmação FINAL deveria ter criado o PreparedCommand");
  assert.equal(turn6.preparedCommandSummary.status, "prepared");
});

// ---------------------------------------------------------------------------------------------
// Falha da IA nunca quebra o fluxo — fallback funcional obrigatório
// ---------------------------------------------------------------------------------------------

test("IA falha (timeout) e o fluxo continua normalmente com extração determinística — aiFallbackUsed=true, nenhuma perda de estado", async () => {
  const { deps, conversation } = await setup("tenant-ai-int-3", {
    aiExtractionEnabled: true,
    fakeProviderScript: [fakeFailure("timeout", "timeout simulado"), fakeFailure("timeout", "timeout simulado")],
  });
  const send = (content) => sendMessage(deps, { tenantId: "tenant-ai-int-3", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  const turn2 = await send("tênis de corrida modelo Speed X");
  assert.equal(turn2.aiFallbackUsed, true);
  assert.ok(turn2.extractionWarnings.some((w) => w.startsWith("ai_extraction_failed:")));
  assert.equal(turn2.conversation.state, "collecting_briefing", "o Briefing continua coletando normalmente mesmo com a IA falhando");
  assert.ok(turn2.nextQuestion, "a próxima pergunta determinística continua sendo produzida normalmente");
});

// ---------------------------------------------------------------------------------------------
// IA nunca é chamada para confirmação/cancelamento
// ---------------------------------------------------------------------------------------------

test("IA nunca é chamada para processar uma mensagem de cancelamento", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess(EMPTY_EXTRACTION_OUTPUT)] });
  const { deps, conversation } = await setup("tenant-ai-int-4", { aiExtractionEnabled: true });
  deps.aiGateway = new AiGateway({
    providers: [provider],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    rateLimiter: new InMemoryAiRateLimiter(),
    circuitBreaker: new InMemoryAiCircuitBreaker(),
    executionRepository: new PostgresAiExecutionRepository(db.pool),
    telemetry: new InMemoryAiTelemetry(),
  });
  const send = (content) => sendMessage(deps, { tenantId: "tenant-ai-int-4", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  // A primeira mensagem legitimamente aciona a IA (faltam campos obrigatórios) — o que importa é
  // que a mensagem de CANCELAMENTO em si nunca gera uma chamada adicional.
  await send("quero criar uma campanha para vender tênis novo");
  const callCountBeforeCancellation = provider.callCount;
  await send("cancela, na verdade não quero mais fazer isso");
  assert.equal(provider.callCount, callCountBeforeCancellation, "a mensagem de cancelamento nunca deveria acionar a IA");
});
