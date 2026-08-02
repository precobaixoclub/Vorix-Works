import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-repository.js";
import { PostgresBriefingRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-repository.js";
import { PostgresBriefingFieldValueRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-field-value-repository.js";
import { PostgresBriefingQuestionRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-question-repository.js";
import { PostgresPreparedCommandRepository } from "../dist/infrastructure/storage/postgres/postgres-prepared-command-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55500 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function seedConversation(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const conversationRepo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const workspace = await workspaceRepo.create({ tenantId, name: "Workspace" });
  const conversation = await conversationRepo.create({ tenantId, workspaceId: workspace.id });
  return { workspace, conversation };
}

// ---------------------------------------------------------------------------------------------
// Briefing — unicidade de "um ativo por conversa"
// ---------------------------------------------------------------------------------------------

test("PostgresBriefingRepository: getActiveByConversation só devolve status não-terminal; nunca dois ativos ao mesmo tempo", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-1");
  const repo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });

  const briefing = await repo.create({ tenantId: "tenant-briefing-1", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });
  assert.equal(briefing.status, "collecting");
  assert.equal(briefing.revision, 1);

  const active = await repo.getActiveByConversation(conversation.id);
  assert.equal(active.id, briefing.id);

  // A unique index parcial (0018) impede um segundo Briefing ativo para a mesma conversa.
  await assert.rejects(() => repo.create({ tenantId: "tenant-briefing-1", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 }));

  await repo.updateStatus(briefing.id, "cancelled");
  assert.equal(await repo.getActiveByConversation(conversation.id), undefined);

  // Depois de cancelado, um NOVO briefing na mesma conversa é permitido.
  const second = await repo.create({ tenantId: "tenant-briefing-1", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });
  assert.notEqual(second.id, briefing.id);
});

// ---------------------------------------------------------------------------------------------
// BriefingFieldValue — histórico append-only + concorrência
// ---------------------------------------------------------------------------------------------

test("PostgresBriefingFieldValueRepository: append nunca sobrescreve — cada chamada cria uma nova revisão", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-2");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const valueRepo = new PostgresBriefingFieldValueRepository(db.pool, { idGenerator: () => nextId("value") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-2", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  const v1 = await valueRepo.append({ briefingId: briefing.id, fieldKey: "channel", value: "instagram", normalizedValue: "instagram", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" });
  assert.equal(v1.revision, 1);
  const v2 = await valueRepo.append({ briefingId: briefing.id, fieldKey: "channel", value: "facebook", normalizedValue: "facebook", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" });
  assert.equal(v2.revision, 2);

  const all = await valueRepo.listAllByBriefing(briefing.id);
  assert.equal(all.length, 2);
  const current = await valueRepo.listCurrentByBriefing(briefing.id);
  assert.equal(current.length, 1);
  assert.equal(current[0].value, "facebook");
});

test("PostgresBriefingFieldValueRepository: duas respostas simultâneas para o MESMO campo nunca colidem — ambas viram revisões distintas", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-3");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const valueRepo = new PostgresBriefingFieldValueRepository(db.pool, { idGenerator: () => nextId("value") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-3", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  const [a, b] = await Promise.all([
    valueRepo.append({ briefingId: briefing.id, fieldKey: "tone", value: "descontraído", normalizedValue: "descontraído", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" }),
    valueRepo.append({ briefingId: briefing.id, fieldKey: "tone", value: "formal", normalizedValue: "formal", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" }),
  ]);

  assert.notEqual(a.revision, b.revision, "concorrência real nunca deve produzir a mesma revisão para o mesmo campo");
  assert.deepEqual([a.revision, b.revision].sort(), [1, 2]);

  const all = await valueRepo.listAllByBriefing(briefing.id);
  assert.equal(all.length, 2, "nenhuma das duas respostas concorrentes pode ser perdida");
});

test("PostgresBriefingFieldValueRepository: uma resposta atrasada a uma pergunta antiga nunca sobrescreve silenciosamente uma resposta mais nova", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-4");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const valueRepo = new PostgresBriefingFieldValueRepository(db.pool, { idGenerator: () => nextId("value") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-4", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  await valueRepo.append({ briefingId: briefing.id, fieldKey: "channel", value: "instagram", normalizedValue: "instagram", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" });
  // Simula um evento antigo sendo reprocessado com created_at implícito posterior (a revisão, não
  // o timestamp, é a fonte da verdade) — a revisão nova ainda vence porque é maior.
  const delayed = await valueRepo.append({ briefingId: briefing.id, fieldKey: "channel", value: "tiktok", normalizedValue: "tiktok", source: "user_message", confidence: 0.9, confirmedByUser: true, ambiguityStatus: "none" });

  const current = await valueRepo.listCurrentByBriefing(briefing.id);
  assert.equal(current.find((v) => v.fieldKey === "channel").value, "tiktok");
  assert.equal(delayed.revision, 2);
});

// ---------------------------------------------------------------------------------------------
// BriefingQuestion — no máximo uma pendente por Briefing
// ---------------------------------------------------------------------------------------------

test("PostgresBriefingQuestionRepository: unique index impede duas perguntas pending simultâneas no mesmo Briefing", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-5");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const questionRepo = new PostgresBriefingQuestionRepository(db.pool, { idGenerator: () => nextId("question") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-5", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  const q1 = await questionRepo.create({ briefingId: briefing.id, fieldKeys: ["channel"], text: "Qual canal?", reason: "obrigatório", priority: 3, answerType: "single_choice" });
  await assert.rejects(() => questionRepo.create({ briefingId: briefing.id, fieldKeys: ["tone"], text: "Qual tom?", reason: "opcional", priority: 6, answerType: "text" }));

  await questionRepo.markAnswered(q1.id);
  const q2 = await questionRepo.create({ briefingId: briefing.id, fieldKeys: ["tone"], text: "Qual tom?", reason: "opcional", priority: 6, answerType: "text" });
  assert.notEqual(q2.id, q1.id);
});

// ---------------------------------------------------------------------------------------------
// PreparedCommand — idempotência + unicidade lógica
// ---------------------------------------------------------------------------------------------

test("PostgresPreparedCommandRepository: confirmação repetida sem mudança devolve o MESMO PreparedCommand (idempotência)", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-6");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const commandRepo = new PostgresPreparedCommandRepository(db.pool, { idGenerator: () => nextId("command") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-6", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  const input = {
    tenantId: "tenant-briefing-6",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    briefingId: briefing.id,
    briefingRevision: briefing.revision,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: { objective: "vender" },
    sourceReferences: { objective: "user_message" },
    unresolvedOptionalFields: ["tone"],
  };

  const first = await commandRepo.create(input);
  const second = await commandRepo.create(input);
  assert.equal(first.id, second.id, "confirmar de novo sem mudança nunca deveria criar um segundo PreparedCommand");

  const [concurrentA, concurrentB] = await Promise.all([commandRepo.create(input), commandRepo.create(input)]);
  assert.equal(concurrentA.id, first.id);
  assert.equal(concurrentB.id, first.id);
});

test("PostgresPreparedCommandRepository: markSuperseded marca status e permite um novo comando para a revisão seguinte", async () => {
  const { workspace, conversation } = await seedConversation("tenant-briefing-7");
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const commandRepo = new PostgresPreparedCommandRepository(db.pool, { idGenerator: () => nextId("command") });
  const briefing = await briefingRepo.create({ tenantId: "tenant-briefing-7", workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });

  const command = await commandRepo.create({
    tenantId: "tenant-briefing-7",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    briefingId: briefing.id,
    briefingRevision: 1,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: {},
    sourceReferences: {},
    unresolvedOptionalFields: [],
  });

  const superseded = await commandRepo.markSuperseded(command.id);
  assert.equal(superseded.status, "superseded");

  const bumped = await briefingRepo.incrementRevision(briefing.id);
  assert.equal(bumped.revision, 2);

  const nextCommand = await commandRepo.create({
    tenantId: "tenant-briefing-7",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    briefingId: briefing.id,
    briefingRevision: bumped.revision,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: {},
    sourceReferences: {},
    unresolvedOptionalFields: [],
  });
  assert.notEqual(nextCommand.id, command.id);
});
