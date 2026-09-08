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
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresAutomationRuleRepository } from "../dist/infrastructure/storage/postgres/postgres-automation-rule-repository.js";
import { PostgresAutomationRunLogRepository } from "../dist/infrastructure/storage/postgres/postgres-automation-run-log-repository.js";
import { createContact } from "../dist/application/crm/contact-use-cases.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, moveDealStage } from "../dist/application/crm/deal-use-cases.js";
import { createTeam, addTeamMember } from "../dist/application/identity/team-use-cases.js";
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRunLogs,
  mustAutomationRuleBelongToTenantAndWorkspace,
  updateAutomationRule,
} from "../dist/application/crm/automation-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 6 (Automação). Foco: (1) CRUD de regras + isolamento cross-tenant; (2)
 * condições E-lógico (só dispara quando TODAS batem); (3) cada tipo de ação, incluindo o
 * roteamento por menor carga (`assign_owner_least_loaded_in_team`); (4) `move_deal_stage` nunca
 * entra em ciclo (usa o repositório direto, não `moveDealStage`) e nunca move pra uma etapa de
 * perda; (5) falha de uma ação nunca derruba a ação de negócio que disparou o gatilho; (6) toda
 * avaliação gera um `AutomationRunLog`, mesmo quando as condições não batem.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55705 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function automationDeps() {
  return {
    automationRuleRepository: new PostgresAutomationRuleRepository(db.pool),
    automationRunLogRepository: new PostgresAutomationRunLogRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
    dealRepository: new PostgresDealRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

function contactDeps(automation) {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    automation,
  };
}

function dealDeps(automation) {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    automation,
  };
}

async function makePipelineWithStages(tenantId, workspaceId) {
  const deps = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const pipeline = await createPipeline(deps, { tenantId, workspaceId, name: "Vendas" });
  const novo = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Novo", position: 0 });
  const negociacao = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Negociação", position: 1 });
  const ganho = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Ganho", position: 2, isWon: true });
  const perdido = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Perdido", position: 3, isLost: true });
  return { pipeline, novo, negociacao, ganho, perdido };
}

test("Migrations 0101-0102 aplicam sem erro; tabelas de automação existem", async () => {
  for (const id of ["0101_crm_automation_rules", "0102_crm_automation_run_logs"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("Regra: criar, listar, atualizar, apagar e isolamento cross-tenant", async () => {
  const tenantId = "tenant-automation-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();

  const rule = await createAutomationRule(deps, {
    tenantId, workspaceId: workspace.id, name: "Nova tag pra origem WhatsApp", trigger: "contact_created",
    conditions: [{ field: "origin", equals: "whatsapp" }], action: "add_tag", actionConfig: { tag: "whatsapp-lead" },
  });
  assert.equal(rule.active, true);

  const listed = await listAutomationRules(deps, { tenantId, workspaceId: workspace.id });
  assert.equal(listed.length, 1);

  const updated = await updateAutomationRule(deps, { ruleId: rule.id, tenantId, workspaceId: workspace.id, patch: { active: false } });
  assert.equal(updated.active, false);

  await deleteAutomationRule(deps, { ruleId: rule.id, tenantId, workspaceId: workspace.id });
  await assert.rejects(() => mustAutomationRuleBelongToTenantAndWorkspace(deps, rule.id, tenantId, workspace.id), /AUTOMATION_RULE_NOT_FOUND/);

  const tenantB = "tenant-automation-b";
  const workspaceB = await makeWorkspace(tenantB);
  const ruleA = await createAutomationRule(deps, { tenantId, workspaceId: workspace.id, name: "Só do A", trigger: "contact_created", conditions: [], action: "add_tag", actionConfig: { tag: "x" } });
  await assert.rejects(() => mustAutomationRuleBelongToTenantAndWorkspace(deps, ruleA.id, tenantB, workspaceB.id), /AUTOMATION_RULE_NOT_FOUND/);
});

test("contact_created: regra com condição de origem só dispara quando a origem bate (E lógico)", async () => {
  const tenantId = "tenant-automation-2";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();
  const rule = await createAutomationRule(deps, {
    tenantId, workspaceId: workspace.id, name: "Tag WhatsApp", trigger: "contact_created",
    conditions: [{ field: "origin", equals: "whatsapp" }], action: "add_tag", actionConfig: { tag: "whatsapp-lead" },
  });

  const fromInstagram = await createContact(contactDeps(deps), { tenantId, workspaceId: workspace.id, name: "Cliente Instagram", origin: "instagram" });
  assert.deepEqual(fromInstagram.tags, []);

  const fromWhatsapp = await createContact(contactDeps(deps), { tenantId, workspaceId: workspace.id, name: "Cliente WhatsApp", origin: "whatsapp" });
  const reloaded = await deps.contactRepository.getById(fromWhatsapp.id);
  assert.deepEqual(reloaded.tags, ["whatsapp-lead"]);

  const logs = await listAutomationRunLogs(deps, { ruleId: rule.id, tenantId, workspaceId: workspace.id });
  assert.equal(logs.length, 2, "toda avaliação gera um log, mesmo quando não bate");
  assert.equal(logs.filter((l) => l.matched).length, 1);
  assert.equal(logs.filter((l) => !l.matched).length, 1);
});

test("contact_created: assign_owner atribui um responsável fixo", async () => {
  const tenantId = "tenant-automation-3";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();
  await createAutomationRule(deps, { tenantId, workspaceId: workspace.id, name: "Dono fixo", trigger: "contact_created", conditions: [], action: "assign_owner", actionConfig: { ownerUserId: "user-fixo" } });

  const contact = await createContact(contactDeps(deps), { tenantId, workspaceId: workspace.id, name: "Cliente" });
  const reloaded = await deps.contactRepository.getById(contact.id);
  assert.equal(reloaded.ownerUserId, "user-fixo");
});

test("contact_created: assign_owner_least_loaded_in_team distribui pro membro com menos contatos do time", async () => {
  const tenantId = "tenant-automation-4";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();
  const teamDeps = { teamRepository: new PostgresTeamRepository(db.pool), teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool) };
  const team = await createTeam(teamDeps, { tenantId, workspaceId: workspace.id, name: "Comercial" });
  await addTeamMember(teamDeps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor" });
  await addTeamMember(teamDeps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor" });

  // user-a já tem 1 contato deste time; user-b não tem nenhum — o próximo deveria ir pro user-b.
  await deps.contactRepository.create({ tenantId, workspaceId: workspace.id, name: "Existente", ownerUserId: "user-a", teamId: team.id });

  await createAutomationRule(deps, { tenantId, workspaceId: workspace.id, name: "Distribuir", trigger: "contact_created", conditions: [], action: "assign_owner_least_loaded_in_team", actionConfig: { teamId: team.id } });

  const newContact = await createContact(contactDeps(deps), { tenantId, workspaceId: workspace.id, name: "Novo Lead" });
  const reloaded = await deps.contactRepository.getById(newContact.id);
  assert.equal(reloaded.ownerUserId, "user-b");
});

test("deal_stage_changed: move_deal_stage usa o repositório direto (nunca reentra em moveDealStage) e nunca move pra etapa de perda", async () => {
  const tenantId = "tenant-automation-5";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();
  const { pipeline, novo, negociacao, ganho, perdido } = await makePipelineWithStages(tenantId, workspace.id);
  const deal = await createDeal(dealDeps(deps), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio Automação" });

  const rule = await createAutomationRule(deps, {
    tenantId, workspaceId: workspace.id, name: "Avançar pra Ganho", trigger: "deal_stage_changed",
    conditions: [{ field: "stageId", equals: negociacao.id }], action: "move_deal_stage", actionConfig: { targetStageId: ganho.id },
  });

  const moved = await moveDealStage(dealDeps(deps), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: negociacao.id });
  // A regra bate na condição (stageId da timeline é o stageId ANTIGO do deal no contexto do
  // disparo — a regra dispara com base no estado ATUALIZADO, então usamos a etapa alvo como
  // condição para simular "assim que chega em Negociação, avança pra Ganho automaticamente").
  const final = await deps.dealRepository.getById(deal.id);
  assert.equal(final.stageId, ganho.id, "a automação deveria ter avançado o negócio direto pra Ganho");
  assert.ok(final.wonAt);

  const logs = await listAutomationRunLogs(deps, { ruleId: rule.id, tenantId, workspaceId: workspace.id });
  assert.equal(logs.length, 1, "só UMA avaliação — mover via automação não reentra e dispara outra avaliação");
  assert.equal(logs[0].actionTaken, true);

  // Regra que tenta mover pra uma etapa de perda — sempre recusada (sem lossReason possível).
  // Workspace isolado da regra "Avançar pra Ganho" acima, pra não cruzar com o mesmo gatilho.
  const tenantId2 = "tenant-automation-5b";
  const workspace2 = await makeWorkspace(tenantId2);
  const stages2 = await makePipelineWithStages(tenantId2, workspace2.id);
  const dealB = await createDeal(dealDeps(deps), { tenantId: tenantId2, workspaceId: workspace2.id, pipelineId: stages2.pipeline.id, stageId: stages2.novo.id, title: "Negócio B" });
  const ruleLose = await createAutomationRule(deps, {
    tenantId: tenantId2, workspaceId: workspace2.id, name: "Tentar perder", trigger: "deal_stage_changed",
    conditions: [{ field: "stageId", equals: stages2.negociacao.id }], action: "move_deal_stage", actionConfig: { targetStageId: stages2.perdido.id },
  });
  await moveDealStage(dealDeps(deps), { dealId: dealB.id, tenantId: tenantId2, workspaceId: workspace2.id, targetStageId: stages2.negociacao.id });
  const dealBAfter = await deps.dealRepository.getById(dealB.id);
  assert.equal(dealBAfter.stageId, stages2.negociacao.id, "negócio deveria continuar em Negociação — automação nunca move pra Perdido");
  const loseLogs = await listAutomationRunLogs(deps, { ruleId: ruleLose.id, tenantId: tenantId2, workspaceId: workspace2.id });
  assert.equal(loseLogs[0].actionTaken, false);
  assert.ok(loseLogs[0].error.includes("AUTOMATION_ACTION_CANNOT_AUTO_LOSE"));
});

test("Falha de uma ação (config inválida) nunca derruba a ação de negócio que disparou o gatilho", async () => {
  const tenantId = "tenant-automation-6";
  const workspace = await makeWorkspace(tenantId);
  const deps = automationDeps();
  // actionConfig sem `tag` — inválido pra `add_tag`, criado direto no repositório (bypassa a
  // validação de schema da rota, simulando um estado de dados inconsistente).
  const rule = await deps.automationRuleRepository.create({ tenantId, workspaceId: workspace.id, name: "Regra quebrada", trigger: "contact_created", conditions: [], action: "add_tag", actionConfig: {} });

  const contact = await createContact(contactDeps(deps), { tenantId, workspaceId: workspace.id, name: "Cliente Resiliente" });
  assert.ok(contact.id, "createContact deveria ter sucesso mesmo com uma automação quebrada");

  const logs = await listAutomationRunLogs(deps, { ruleId: rule.id, tenantId, workspaceId: workspace.id });
  assert.equal(logs[0].matched, true);
  assert.equal(logs[0].actionTaken, false);
  assert.ok(logs[0].error.includes("AUTOMATION_ACTION_MISSING_TAG"));
});
