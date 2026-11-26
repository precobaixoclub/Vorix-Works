import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildApiContainer } from "../dist/interfaces/api/di/container.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

// Regressão (25/11/2026): o container de PRODUÇÃO (com config + Postgres) não expunha o serviço de aprovação
// pelo WhatsApp — a regra segurava as publicações, mas nenhum pedido era enviado e a tela respondia 501.

let db;
before(async () => {
  db = await startTestPostgres({ port: 56010 });
  await applyMigrations(db.pool, join(process.cwd(), "db", "migrations"));
});
after(async () => { await db.stop(); });

test("container com Postgres expõe a aprovação por WhatsApp e lê a regra da marca", async () => {
  const container = buildApiContainer(loadApiConfig({
    AUTH_MODE: "jwt", JWT_SECRET: "test-secret-whatsapp-approvals", DATABASE_URL: db.connectionString, PERSISTENCE_DRIVER: "postgres", ZUNO_LOG_LEVEL: "silent",
  }));
  assert.ok(container.social, "módulo social montado");
  assert.ok(container.whatsappApprovals, "serviço de aprovação exposto ao app (rotas + agendador)");
  assert.equal(await container.whatsappApprovals.requiresApproval({ tenantId: "t-x", workspaceId: "ws-x" }), false);
  const overview = await container.whatsappApprovals.overview("t-x");
  assert.equal(overview.settings.enabled, false);
  await container.pool?.end?.().catch(() => undefined);
});
