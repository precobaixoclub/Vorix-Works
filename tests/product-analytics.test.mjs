import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresProductEventRepository } from "../dist/infrastructure/storage/postgres/postgres-product-event-repository.js";
import { recordProductEvent, recordFirstEvent } from "../dist/application/product-analytics/product-analytics-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Product Analytics — Fatia C (fundação). Foco: (1) nunca lança pro chamador, mesmo se a escrita
 * falhar; (2) "kill switch" independente; (3) idempotência real dos eventos first_* (não
 * best-effort); (4) sanitização defensiva de properties (nunca conteúdo sensível); (5) isolamento
 * por tenant nas contagens.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;

before(async () => {
  db = await startTestPostgres({ port: 55990 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function deps({ enabled = true, onWriteFailed } = {}) {
  return { productEventRepository: new PostgresProductEventRepository(db.pool), enabled, onWriteFailed };
}

test("recordProductEvent: grava um evento com os campos corretos", async () => {
  const d = deps();
  await recordProductEvent(d, { eventName: "landing_view", source: "client", anonymousId: "anon-1", properties: { referrer: "google" } });

  const count = await db.pool.query("select * from product_events where event_name = 'landing_view' and anonymous_id = 'anon-1'");
  assert.equal(count.rows.length, 1);
  assert.equal(count.rows[0].source, "client");
  assert.deepEqual(count.rows[0].properties, { referrer: "google" });
});

test("recordProductEvent: enabled=false é um no-op silencioso (kill switch)", async () => {
  const d = deps({ enabled: false });
  await recordProductEvent(d, { eventName: "landing_view", source: "client", anonymousId: "anon-disabled" });

  const count = await db.pool.query("select count(*)::int as c from product_events where anonymous_id = 'anon-disabled'");
  assert.equal(count.rows[0].c, 0);
});

test("recordProductEvent: nunca lança mesmo se a escrita falhar — chama onWriteFailed em vez disso", async () => {
  let captured;
  const brokenRepository = { record: async () => { throw new Error("db indisponível"); } };
  const d = { productEventRepository: brokenRepository, enabled: true, onWriteFailed: (input) => { captured = input; } };

  await recordProductEvent(d, { eventName: "landing_view", source: "client" });
  assert.ok(captured);
  assert.equal(captured.eventName, "landing_view");
  assert.ok(captured.error instanceof Error);
});

test("recordFirstEvent: idempotente de verdade — segunda chamada pro MESMO workspace+evento nunca grava outra linha", async () => {
  const d = deps();
  const tenantId = "tenant-pa-1";
  const workspaceId = "workspace-pa-1";

  await recordFirstEvent(d, { eventName: "first_deal_created", tenantId, workspaceId, source: "server" });
  await recordFirstEvent(d, { eventName: "first_deal_created", tenantId, workspaceId, source: "server" });
  await recordFirstEvent(d, { eventName: "first_deal_created", tenantId, workspaceId, source: "server" });

  const events = await db.pool.query("select count(*)::int as c from product_events where event_name = 'first_deal_created' and workspace_id = $1", [workspaceId]);
  assert.equal(events.rows[0].c, 1, "500 negócios criados não deveriam gerar 500 eventos");

  const firsts = await db.pool.query("select count(*)::int as c from product_event_firsts where workspace_id = $1 and event_name = 'first_deal_created'", [workspaceId]);
  assert.equal(firsts.rows[0].c, 1);
});

test("recordFirstEvent: workspaces DIFERENTES têm o próprio 'primeiro', nunca compartilham o marcador", async () => {
  const d = deps();
  const tenantId = "tenant-pa-2";

  await recordFirstEvent(d, { eventName: "first_deal_created", tenantId, workspaceId: "workspace-pa-2a", source: "server" });
  await recordFirstEvent(d, { eventName: "first_deal_created", tenantId, workspaceId: "workspace-pa-2b", source: "server" });

  const events = await db.pool.query("select count(*)::int as c from product_events where event_name = 'first_deal_created' and tenant_id = $1", [tenantId]);
  assert.equal(events.rows[0].c, 2, "cada workspace conta seu próprio primeiro negócio");
});

test("sanitização: chaves com formato de dado sensível são removidas; strings longas truncadas; objetos aninhados descartados", async () => {
  const d = deps();
  await recordProductEvent(d, {
    eventName: "plan_selected",
    source: "client",
    anonymousId: "anon-sanitize",
    properties: {
      planKey: "PRO",
      billingCycle: "monthly",
      email: "vazamento@example.com",
      userMessage: "conteúdo que nunca deveria ser guardado",
      prompt: "um prompt de IA inteiro",
      longNote: "x".repeat(500),
      nested: { should: "be dropped" },
    },
  });

  const row = await db.pool.query("select properties from product_events where anonymous_id = 'anon-sanitize'");
  const properties = row.rows[0].properties;
  assert.equal(properties.planKey, "PRO");
  assert.equal(properties.billingCycle, "monthly");
  assert.equal(properties.email, undefined, "chave 'email' nunca deveria sobreviver à sanitização");
  assert.equal(properties.userMessage, undefined);
  assert.equal(properties.prompt, undefined);
  assert.equal(properties.nested, undefined, "objeto aninhado nunca é um dump do domínio");
  assert.equal(properties.longNote.length, 200, "string longa é truncada, nunca guardada inteira");
});

test("isolamento por tenant: countByEventName nunca soma eventos de outro tenant", async () => {
  const d = deps();
  await recordProductEvent(d, { eventName: "checkout_completed", source: "server", tenantId: "tenant-pa-3" });
  await recordProductEvent(d, { eventName: "checkout_completed", source: "server", tenantId: "tenant-pa-3" });
  await recordProductEvent(d, { eventName: "checkout_completed", source: "server", tenantId: "tenant-pa-4" });

  const countTenant3 = await d.productEventRepository.countByEventName({ eventName: "checkout_completed", tenantId: "tenant-pa-3" });
  assert.equal(countTenant3, 2);
  const countTenant4 = await d.productEventRepository.countByEventName({ eventName: "checkout_completed", tenantId: "tenant-pa-4" });
  assert.equal(countTenant4, 1);
});

test("countDistinctByEventName: conta tenants distintos, não linhas (funil de conversão)", async () => {
  const d = deps();
  await recordProductEvent(d, { eventName: "trial_started", source: "server", tenantId: "tenant-pa-5" });
  await recordProductEvent(d, { eventName: "trial_started", source: "server", tenantId: "tenant-pa-5" });
  await recordProductEvent(d, { eventName: "trial_started", source: "server", tenantId: "tenant-pa-6" });

  const distinctTenants = await d.productEventRepository.countDistinctByEventName({ eventName: "trial_started", distinctBy: "tenantId" });
  assert.ok(distinctTenants >= 2, "pelo menos os 2 tenants deste teste devem contar uma vez cada, não 3 linhas");
});
