import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresCommercialSuggestionRepository } from "../dist/infrastructure/storage/postgres/postgres-commercial-suggestion-repository.js";
import { createContact } from "../dist/application/crm/contact-use-cases.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import { createTask } from "../dist/application/crm/task-use-cases.js";
import { computeLeadScore } from "../dist/application/crm/lead-scoring.js";
import { getLeadScore } from "../dist/application/crm/lead-scoring-use-cases.js";
import {
  acceptCommercialSuggestion,
  dismissCommercialSuggestion,
  generateCommercialSuggestions,
  listCommercialSuggestions,
  mustCommercialSuggestionBelongToTenantAndWorkspace,
} from "../dist/application/crm/commercial-copilot-use-cases.js";
import { applyCommercialCopilotSuggestionsSemanticValidation } from "../dist/application/ai-gateway/schemas/commercial-copilot-suggestions-result.v1.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 5 (Inteligência). Foco: (1) `computeLeadScore` é determinístico, nunca IA,
 * sempre com fatores explicando a composição; (2) validação semântica anti-alucinação do Copiloto
 * Comercial descarta sugestões cuja evidência não aparece literalmente nos dados; (3) aceitar uma
 * sugestão `follow_up_task`/`reach_out` cria a Tarefa de verdade (autorização humana explícita);
 * dispensar/aceitar uma vez só; (4) isolamento cross-tenant.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55704 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function contactDeps() {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

function pipelineDeps() {
  return { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
}

function dealDeps() {
  return { dealRepository: new PostgresDealRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function taskDeps() {
  return { taskRepository: new PostgresTaskRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function leadScoringDeps() {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    dealRepository: new PostgresDealRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
  };
}

function fakeGenerator(suggestions) {
  return { generateSuggestions: async () => ({ ok: true, suggestions, traceId: "trace-fake-1" }) };
}

function failingGenerator(message) {
  return { generateSuggestions: async () => ({ ok: false, category: "not_configured", message }) };
}

function copilotDeps(generator) {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    dealRepository: new PostgresDealRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    commercialSuggestionRepository: new PostgresCommercialSuggestionRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    generator,
  };
}

test("Migrations 0099-0100 aplicam sem erro; commercial_suggestions e a operação de IA existem", async () => {
  for (const id of ["0099_crm_commercial_suggestions", "0100_ai_commercial_copilot_operation"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
  const operation = await db.pool.query("select code from ai_operation_types where code = $1", ["commercial_copilot_suggestions"]);
  assert.equal(operation.rows.length, 1);
});

test("computeLeadScore: interação recente + negócio aberto de alto valor + histórico de negócio ganho pontua quente, com fatores explicados", () => {
  const now = new Date("2026-01-15T12:00:00Z");
  const contact = { lastInteractionAt: new Date("2026-01-13T12:00:00Z").toISOString() };
  const deals = [
    { wonAt: undefined, lostAt: undefined, valueCents: 500_000 },
    { wonAt: new Date("2025-06-01T12:00:00Z").toISOString(), lostAt: undefined, valueCents: 100_000 },
  ];
  const tasks = [{ status: "pending", dueAt: new Date("2026-01-20T12:00:00Z").toISOString() }];
  const result = computeLeadScore({ contact, deals, tasks, now });
  assert.equal(result.temperature, "quente");
  assert.ok(result.score >= 67);
  assert.ok(result.factors.some((f) => f.label.includes("Interação recente")));
  assert.ok(result.factors.some((f) => f.label.includes("alto valor")));
});

test("computeLeadScore: sem interação há mais de 30 dias e tarefa atrasada esfria o lead", () => {
  const now = new Date("2026-01-15T12:00:00Z");
  const contact = { lastInteractionAt: new Date("2025-11-01T12:00:00Z").toISOString() };
  const deals = [];
  const tasks = [{ status: "pending", dueAt: new Date("2026-01-01T12:00:00Z").toISOString() }];
  const result = computeLeadScore({ contact, deals, tasks, now });
  assert.equal(result.temperature, "frio");
  assert.ok(result.factors.some((f) => f.points < 0));
});

test("getLeadScore: calcula a partir dos dados reais do contato (negócio + tarefa) e nunca de outro tenant", async () => {
  const tenantId = "tenant-score-1";
  const workspace = await makeWorkspace(tenantId);
  const contact = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente Score" });
  const pipeline = await createPipeline(pipelineDeps(), { tenantId, workspaceId: workspace.id, name: "Vendas" });
  const stage = await createStage(pipelineDeps(), { pipelineId: pipeline.id, tenantId, workspaceId: workspace.id, name: "Novo", position: 0 });
  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stage.id, contactId: contact.id, title: "Negócio", valueCents: 200_000 });

  const score = await getLeadScore(leadScoringDeps(), { contactId: contact.id, tenantId, workspaceId: workspace.id });
  assert.ok(score.factors.some((f) => f.label.includes("negócio")));

  await assert.rejects(
    () => getLeadScore(leadScoringDeps(), { contactId: contact.id, tenantId: "outro-tenant", workspaceId: workspace.id }),
    /CONTACT_NOT_FOUND/,
  );
});

test("Validação semântica anti-alucinação: descarta sugestão cuja evidência não aparece no texto-fonte, mantém a que aparece", () => {
  const structural = {
    schemaVersion: 1,
    suggestions: [
      { title: "Follow-up", rationale: "Sem contato há dias", evidence: "última interação há 10 dia(s)", confidence: 0.7, suggestedAction: "follow_up_task" },
      { title: "Inventada", rationale: "Fato que não existe", evidence: "cliente pediu desconto de 50%", confidence: 0.9, suggestedAction: "send_proposal" },
    ],
    warnings: [],
  };
  const result = applyCommercialCopilotSuggestionsSemanticValidation({ structural, sourceText: "Contato: Cliente X\nÚltima interação há 10 dia(s).\n" });
  assert.equal(result.valid, true);
  assert.equal(result.data.suggestions.length, 1);
  assert.equal(result.data.suggestions[0].title, "Follow-up");
  assert.ok(result.data.warnings.some((w) => w.includes("Inventada")));
});

test("Copiloto Comercial: gera sugestões via generator (fake), aceitar follow_up_task cria a Tarefa de verdade", async () => {
  const tenantId = "tenant-copilot-1";
  const workspace = await makeWorkspace(tenantId);
  const contact = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente Copiloto" });

  const generator = fakeGenerator([
    { title: "Ligar para reengajar", rationale: "Sem contato recente", evidence: "evidência real", confidence: 0.6, suggestedAction: "follow_up_task" },
  ]);
  const deps = copilotDeps(generator);
  const created = await generateCommercialSuggestions(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id });
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "pending");

  const accepted = await acceptCommercialSuggestion(deps, { suggestionId: created[0].id, tenantId, workspaceId: workspace.id });
  assert.equal(accepted.status, "accepted");

  const tasks = await taskDeps().taskRepository.listByWorkspace({ tenantId, workspaceId: workspace.id, contactId: contact.id });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Ligar para reengajar");

  await assert.rejects(
    () => acceptCommercialSuggestion(deps, { suggestionId: created[0].id, tenantId, workspaceId: workspace.id }),
    /COMMERCIAL_SUGGESTION_ALREADY_RESOLVED/,
  );
});

test("Copiloto Comercial: dispensar marca 'dismissed' e nunca cria nada; falha do gateway propaga erro claro", async () => {
  const tenantId = "tenant-copilot-2";
  const workspace = await makeWorkspace(tenantId);
  const contact = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente Dispensa" });

  const generator = fakeGenerator([{ title: "Sugestão qualquer", rationale: "r", evidence: "evidência real", confidence: 0.5, suggestedAction: "none" }]);
  const deps = copilotDeps(generator);
  const created = await generateCommercialSuggestions(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id });

  const dismissed = await dismissCommercialSuggestion(deps, { suggestionId: created[0].id, tenantId, workspaceId: workspace.id });
  assert.equal(dismissed.status, "dismissed");
  const tasks = await taskDeps().taskRepository.listByWorkspace({ tenantId, workspaceId: workspace.id, contactId: contact.id });
  assert.equal(tasks.length, 0, "sugestão 'none' dispensada nunca deveria criar tarefa");

  const failingDeps = copilotDeps(failingGenerator("Gateway indisponível"));
  await assert.rejects(
    () => generateCommercialSuggestions(failingDeps, { contactId: contact.id, tenantId, workspaceId: workspace.id }),
    /COMMERCIAL_COPILOT_UNAVAILABLE/,
  );
});

test("Copiloto Comercial: isolamento cross-tenant nunca vaza existência (404)", async () => {
  const tenantA = "tenant-copilot-a";
  const tenantB = "tenant-copilot-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const contact = await createContact(contactDeps(), { tenantId: tenantA, workspaceId: workspaceA.id, name: "Só do Tenant A" });
  const deps = copilotDeps(fakeGenerator([{ title: "T", rationale: "r", evidence: "evidência real", confidence: 0.5, suggestedAction: "none" }]));
  const created = await generateCommercialSuggestions(deps, { contactId: contact.id, tenantId: tenantA, workspaceId: workspaceA.id });

  await assert.rejects(
    () => mustCommercialSuggestionBelongToTenantAndWorkspace(deps, created[0].id, tenantB, workspaceB.id),
    /COMMERCIAL_SUGGESTION_NOT_FOUND/,
  );

  const listForB = await listCommercialSuggestions(deps, { tenantId: tenantB, workspaceId: workspaceB.id });
  assert.equal(listForB.length, 0);
});
