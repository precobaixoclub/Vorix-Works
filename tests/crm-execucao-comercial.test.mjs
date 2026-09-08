import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresProductRepository } from "../dist/infrastructure/storage/postgres/postgres-product-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import { cancelTask, completeTask, createTask, listTasks, mustTaskBelongToTenantAndWorkspace, updateTask } from "../dist/application/crm/task-use-cases.js";
import { createProduct, deleteProduct, listProducts, mustProductBelongToTenantAndWorkspace, updateProduct } from "../dist/application/crm/product-use-cases.js";
import {
  acceptPublicProposal,
  applyProposalAcceptanceToDeal,
  createProposal,
  getPublicProposal,
  mustProposalBelongToTenantAndWorkspace,
  rejectPublicProposal,
  sendProposal,
  updateProposal,
} from "../dist/application/crm/proposal-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 3 (Execução Comercial). Foco: (1) Tarefas — CRUD + concluir/cancelar;
 * (2) Catálogo de produtos simples (sem estoque); (3) Propostas — itens congelados, edição só em
 * rascunho, envio único, link público (`/p/:token`) com tracking de visualização/aceite/recusa,
 * expiração por `validUntil`, e o negócio ligado avançando pra Ganho automaticamente ao aceitar.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55702 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function taskDeps() {
  return { taskRepository: new PostgresTaskRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function productDeps() {
  return { productRepository: new PostgresProductRepository(db.pool) };
}

function proposalDeps() {
  return { proposalRepository: new PostgresProposalRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function dealLinkDeps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

async function makePipelineWithStages(tenantId, workspaceId) {
  const deps = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const pipeline = await createPipeline(deps, { tenantId, workspaceId, name: "Vendas" });
  const novo = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Novo", position: 0 });
  const ganho = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Ganho", position: 1, isWon: true });
  return { pipeline, novo, ganho };
}

test("Migrations 0096-0098 aplicam sem erro; tabelas de tarefa/produto/proposta existem", async () => {
  for (const id of ["0096_crm_tasks", "0097_crm_products", "0098_crm_proposals"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("Tarefa: criar, listar, atualizar, concluir e cancelar", async () => {
  const tenantId = "tenant-task-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = taskDeps();

  const task = await createTask(deps, { tenantId, workspaceId: workspace.id, type: "ligacao", title: "Ligar pro cliente" });
  assert.equal(task.status, "pending");

  const listed = await listTasks(deps, { tenantId, workspaceId: workspace.id });
  assert.equal(listed.length, 1);

  const updated = await updateTask(deps, { taskId: task.id, tenantId, workspaceId: workspace.id, patch: { title: "Ligar amanhã" } });
  assert.equal(updated.title, "Ligar amanhã");

  const done = await completeTask(deps, { taskId: task.id, tenantId, workspaceId: workspace.id });
  assert.equal(done.status, "done");
  assert.ok(done.completedAt);

  const other = await createTask(deps, { tenantId, workspaceId: workspace.id, type: "follow_up", title: "Outra tarefa" });
  const cancelled = await cancelTask(deps, { taskId: other.id, tenantId, workspaceId: workspace.id });
  assert.equal(cancelled.status, "cancelled");
});

test("Tarefa: isolamento cross-tenant nunca vaza existência (404)", async () => {
  const tenantA = "tenant-task-a";
  const tenantB = "tenant-task-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const deps = taskDeps();
  const task = await createTask(deps, { tenantId: tenantA, workspaceId: workspaceA.id, type: "whatsapp", title: "Só do Tenant A" });

  await assert.rejects(() => mustTaskBelongToTenantAndWorkspace(deps, task.id, tenantB, workspaceB.id), /TASK_NOT_FOUND/);
});

test("Produto: criar, listar, atualizar (inclusive desativar) e excluir", async () => {
  const tenantId = "tenant-product-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = productDeps();

  const product = await createProduct(deps, { tenantId, workspaceId: workspace.id, name: "Plano Mensal", priceCents: 9900 });
  assert.equal(product.active, true);

  const inactive = await updateProduct(deps, { productId: product.id, tenantId, workspaceId: workspace.id, patch: { active: false } });
  assert.equal(inactive.active, false);

  const activeOnly = await listProducts(deps, { tenantId, workspaceId: workspace.id, activeOnly: true });
  assert.equal(activeOnly.length, 0);

  await deleteProduct(deps, { productId: product.id, tenantId, workspaceId: workspace.id });
  await assert.rejects(() => mustProductBelongToTenantAndWorkspace(deps, product.id, tenantId, workspace.id), /PRODUCT_NOT_FOUND/);
});

test("Proposta: itens congelam quantidade x preço; total = subtotal - desconto", async () => {
  const tenantId = "tenant-proposal-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = proposalDeps();

  const { proposal } = await createProposal(deps, {
    tenantId, workspaceId: workspace.id, title: "Proposta A",
    items: [{ name: "Item 1", quantity: 2, unitPriceCents: 1000 }, { name: "Item 2", quantity: 1, unitPriceCents: 500 }],
    discountCents: 300,
  });
  assert.equal(proposal.items[0].subtotalCents, 2000);
  assert.equal(proposal.totalCents, 2200);
  assert.equal(proposal.status, "draft");
});

test("Proposta: só edita em rascunho; enviar uma vez só", async () => {
  const tenantId = "tenant-proposal-2";
  const workspace = await makeWorkspace(tenantId);
  const deps = proposalDeps();
  const { proposal } = await createProposal(deps, { tenantId, workspaceId: workspace.id, title: "Proposta B", items: [{ name: "Item", quantity: 1, unitPriceCents: 1000 }] });

  const edited = await updateProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id, patch: { title: "Proposta B Editada" } });
  assert.equal(edited.title, "Proposta B Editada");

  const sent = await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id });
  assert.equal(sent.status, "sent");
  assert.ok(sent.sentAt);

  await assert.rejects(() => sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id }), /PROPOSAL_ALREADY_SENT/);
  await assert.rejects(
    () => updateProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id, patch: { title: "Não pode" } }),
    /PROPOSAL_NOT_EDITABLE/,
  );
});

test("Proposta pública: visualizar marca 'viewed', aceitar marca 'accepted' e move o negócio ligado pra Ganho", async () => {
  const tenantId = "tenant-proposal-3";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, ganho } = await makePipelineWithStages(tenantId, workspace.id);
  const deal = await createDeal(dealLinkDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio Ligado" });

  const deps = proposalDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: workspace.id, dealId: deal.id, title: "Proposta C", items: [{ name: "Item", quantity: 1, unitPriceCents: 5000 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id });

  const viewed = await getPublicProposal(deps, rawToken);
  assert.equal(viewed.status, "viewed");
  assert.ok(viewed.viewedAt);

  const accepted = await acceptPublicProposal(deps, rawToken);
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.respondedAt);

  await applyProposalAcceptanceToDeal(dealLinkDeps(), accepted);
  const dealAfter = await dealLinkDeps().dealRepository.getById(deal.id);
  assert.equal(dealAfter.stageId, ganho.id);
  assert.ok(dealAfter.wonAt);
});

test("Proposta pública: recusar marca 'rejected'; token inválido nunca vaza existência (404)", async () => {
  const tenantId = "tenant-proposal-4";
  const workspace = await makeWorkspace(tenantId);
  const deps = proposalDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: workspace.id, title: "Proposta D", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: workspace.id });

  const rejected = await rejectPublicProposal(deps, rawToken);
  assert.equal(rejected.status, "rejected");

  await assert.rejects(() => getPublicProposal(deps, "token-que-nao-existe"), /PROPOSAL_NOT_FOUND/);
});

test("Proposta: isolamento cross-tenant nunca vaza existência (404)", async () => {
  const tenantA = "tenant-proposal-a";
  const tenantB = "tenant-proposal-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const deps = proposalDeps();
  const { proposal } = await createProposal(deps, { tenantId: tenantA, workspaceId: workspaceA.id, title: "Só do Tenant A", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });

  await assert.rejects(() => mustProposalBelongToTenantAndWorkspace(deps, proposal.id, tenantB, workspaceB.id), /PROPOSAL_NOT_FOUND/);
});
