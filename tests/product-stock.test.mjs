import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresProductRepository } from "../dist/infrastructure/storage/postgres/postgres-product-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { InMemoryNotificationRepository } from "../dist/infrastructure/storage/in-memory-notification-repository.js";
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import { addDealItem, reopenDeal, winDeal } from "../dist/application/sales/deal-commercial-use-cases.js";
import { setStockQuantity } from "../dist/application/sales/stock-use-cases.js";
import { isLowStock } from "../dist/domain/crm/crm.model.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Controle de estoque: baixa no ganho, devolução ao reabrir (uma vez só), alerta de reposição
 * para a gestão ao cruzar o ponto de compra, e produto sem controle nunca é tocado. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-stock-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

async function setup() {
  const tenantId = nextId("tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
  const workspaceId = workspace.id;
  const notificationRepository = new InMemoryNotificationRepository();
  const seller = { tenantId, userId: nextId("seller"), role: "editor" };
  const manager = { tenantId, userId: nextId("manager"), role: "admin" };
  const members = [seller, manager].map((actor) => ({ id: nextId("m"), userId: actor.userId, tenantId, role: actor.role }));
  const d = {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineRepository: new PostgresPipelineRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    productRepository: new PostgresProductRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    dealItemRepository: new PostgresDealItemRepository(db.pool),
    salesCatalogRepository: new PostgresSalesCatalogRepository(db.pool),
    salesConfigRepository: new PostgresSalesConfigRepository(db.pool),
    approvalRepository: new PostgresCommercialApprovalRepository(db.pool),
    membershipRepository: {
      getByUserAndTenant: async (userId, tenant) => members.find((member) => member.userId === userId && tenant === tenantId),
      listByTenant: async (tenant) => (tenant === tenantId ? members : []),
      listByUser: async () => [],
    },
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
    notification: { notificationRepository },
  };
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspaceId);
  const dealWith = async (product, quantity) => {
    const deal = await createDeal(d, { tenantId, workspaceId, pipelineId: pipeline.id, stageId: stages[1].id, title: nextId("deal"), ownerUserId: seller.userId });
    await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity });
    return deal;
  };
  return { d, tenantId, workspaceId, seller, manager, notificationRepository, dealWith };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("ESTOQUE: ganho dá baixa, cruzar o ponto de reposição alerta a gestão uma vez, reabrir devolve", async () => {
  const { d, tenantId, workspaceId, seller, manager, notificationRepository, dealWith } = await setup();
  const product = await d.productRepository.create({ tenantId, workspaceId, name: "Licença", priceCents: 10_000, unit: "un", trackStock: true, stockQuantity: 10, stockAlertThreshold: 5 });
  assert.equal(isLowStock(product), false);

  const deal = await dealWith(product, 6);
  await winDeal(d, seller, { workspaceId, dealId: deal.id });
  let current = await d.productRepository.getById(product.id);
  assert.equal(current.stockQuantity, 4);
  assert.equal(isLowStock(current), true);
  await settle();
  const alerts = await notificationRepository.listActive({ tenantId, workspaceId, userId: manager.userId, limit: 10 });
  assert.equal(alerts.filter((alert) => alert.sourceType === "product_low_stock").length, 1);
  assert.match(alerts[0].body, /Licença: 4 un em estoque/);
  const sellerAlerts = await notificationRepository.listActive({ tenantId, workspaceId, userId: seller.userId, limit: 10 });
  assert.equal(sellerAlerts.length, 0, "alerta de reposição é para a gestão");

  await reopenDeal(d, seller, { workspaceId, dealId: deal.id });
  current = await d.productRepository.getById(product.id);
  assert.equal(current.stockQuantity, 10, "reabrir devolve ao estoque");
  // Ganhar de novo dá baixa de novo (o saldo líquido da oportunidade voltou a zero).
  await winDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.equal((await d.productRepository.getById(product.id)).stockQuantity, 4);
  const movements = await d.productRepository.netStockByDeal(deal.id);
  assert.deepEqual(movements, [{ productId: product.id, delta: -6 }]);
});

test("ESTOQUE: produto sem controle não é tocado e não devolve o que nunca baixou", async () => {
  const { d, tenantId, workspaceId, seller, dealWith } = await setup();
  const service = await d.productRepository.create({ tenantId, workspaceId, name: "Consultoria", priceCents: 50_000 });
  const deal = await dealWith(service, 3);
  await winDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.equal((await d.productRepository.getById(service.id)).stockQuantity, 0);
  // Ativou o controle DEPOIS do ganho: reabrir não pode "devolver" 3 unidades.
  await d.productRepository.update(service.id, { trackStock: true, stockQuantity: 20 });
  await reopenDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.equal((await d.productRepository.getById(service.id)).stockQuantity, 20);
});

test("ESTOQUE: ajuste manual registra movimento e alerta ao cruzar o ponto de reposição", async () => {
  const { d, tenantId, workspaceId, manager, notificationRepository } = await setup();
  const product = await d.productRepository.create({ tenantId, workspaceId, name: "Cabo", priceCents: 1_000, trackStock: true, stockQuantity: 8, stockAlertThreshold: 3 });
  const after = await setStockQuantity(d, product, 2, manager.userId);
  assert.equal(after.stockQuantity, 2);
  await settle();
  assert.equal((await notificationRepository.listActive({ tenantId, workspaceId, userId: manager.userId, limit: 10 })).length, 1);
  const unchanged = await setStockQuantity(d, after, 2, manager.userId);
  assert.equal(unchanged.stockQuantity, 2);
});
