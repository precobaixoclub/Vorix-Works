import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresInstagramDmAccountRouteRepository } from "../dist/infrastructure/storage/postgres/postgres-instagram-dm-account-route-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Persistência real (Postgres via pglite) do que restou do módulo Instagram DM da Fase 5.
 *
 * c7d771b transformou o Instagram DM num canal do Inbox (conversas, mensagens e automação passaram
 * a viver no Inbox) e removeu os repositórios `PostgresInstagramDm{Conversation,Message,
 * AutomationRule}Repository`. Este arquivo continuava importando esses módulos e só "passava" no
 * Windows por causa de `.js` antigos esquecidos em `dist/` (o build não limpava a pasta — corrigido
 * com `build:clean`); no Linux, com `dist/` limpo, falhava com ERR_MODULE_NOT_FOUND. Os testes desses
 * repositórios saíram junto com eles; a cobertura do canal está nos testes do Inbox
 * (`inbox-*.test.mjs`). Ficam as migrations e o roteamento conta → workspace, ainda em uso pelo
 * webhook (`receive-instagram-dm-webhook.ts`).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55660 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("Migrations 0076-0079 aplicam sem erro; tabelas do módulo Instagram DM existem", async () => {
  for (const id of ["0076_instagram_dm_account_routes", "0077_instagram_dm_conversations", "0078_instagram_dm_messages", "0079_instagram_dm_automation_rules"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("PostgresInstagramDmAccountRouteRepository: upsert por instagramBusinessAccountId nunca duplica; reconectar noutro workspace atualiza a rota", async () => {
  const workspaceA = await makeWorkspace("tenant-route-1");
  const workspaceB = await makeWorkspace("tenant-route-1");
  const repo = new PostgresInstagramDmAccountRouteRepository(db.pool);

  await repo.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "tenant-route-1", workspaceId: workspaceA.id });
  let route = await repo.findByInstagramBusinessAccountId("ig_1");
  assert.equal(route.workspaceId, workspaceA.id);

  await repo.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "tenant-route-1", workspaceId: workspaceB.id });
  route = await repo.findByInstagramBusinessAccountId("ig_1");
  assert.equal(route.workspaceId, workspaceB.id, "reconectar a mesma conta em outro workspace deveria atualizar a rota, nunca duplicar");
});

test("Rota de conta Instagram: apagar o workspace apaga a rota em cascata (FK → workspaces)", async () => {
  const workspace = await makeWorkspace("tenant-route-2");
  const repo = new PostgresInstagramDmAccountRouteRepository(db.pool);
  await repo.upsertRoute({ instagramBusinessAccountId: "ig_cascade", tenantId: "tenant-route-2", workspaceId: workspace.id });
  assert.ok(await repo.findByInstagramBusinessAccountId("ig_cascade"));
  await db.pool.query("delete from workspaces where id = $1", [workspace.id]);
  assert.equal(await repo.findByInstagramBusinessAccountId("ig_cascade"), undefined);
});
