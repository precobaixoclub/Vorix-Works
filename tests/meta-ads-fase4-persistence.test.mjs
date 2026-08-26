import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMetaAdsCredentialRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-ads-credential-repository.js";
import { PostgresMetaAdAccountRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-ad-account-repository.js";
import { PostgresMetaCustomAudienceRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-custom-audience-repository.js";
import { PostgresMetaPixelRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-pixel-repository.js";
import { PostgresMetaCapiEventRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-capi-event-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Persistência real (Postgres via pglite) da Fase 4 do módulo Meta Ads Manager: públicos
 * customizados/semelhantes, pixels e log de auditoria da Conversions API. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55655 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeAdAccount(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const credentialRepo = new PostgresMetaAdsCredentialRepository(db.pool);
  const credentialReferenceId = nextId("cred");
  await credentialRepo.upsertCredentialReference({ credentialReferenceId, tenantId, workspaceId: workspace.id, providerId: "meta_ads", status: "active" });
  const accountRepo = new PostgresMetaAdAccountRepository(db.pool);
  const account = await accountRepo.upsertAccount({ tenantId, workspaceId: workspace.id, credentialReferenceId, accountId: "act_1", name: "Conta", currency: "BRL", isActive: true });
  return { workspace, account };
}

test("Migrations 0073-0075 aplicam sem erro; meta_custom_audiences/meta_pixels/meta_capi_events existem", async () => {
  for (const id of ["0073_meta_custom_audiences", "0074_meta_pixels", "0075_meta_capi_events"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("PostgresMetaCustomAudienceRepository: upsert por (adAccountId, audienceId) nunca duplica; subtype livre (sem check constraint)", async () => {
  const { workspace, account } = await makeAdAccount("tenant-mca-1");
  const repo = new PostgresMetaCustomAudienceRepository(db.pool);
  const base = { tenantId: "tenant-mca-1", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_1", subtype: "SOME_FUTURE_SUBTYPE_NEVER_SEEN_BEFORE" };
  await repo.upsertAudience({ ...base, name: "Público A" });
  await repo.upsertAudience({ ...base, name: "Público A Renomeado", approximateCount: 1000 });

  const audiences = await repo.listByWorkspace({ tenantId: "tenant-mca-1", workspaceId: workspace.id });
  assert.equal(audiences.length, 1, "upsert deveria atualizar a linha existente, nunca duplicar");
  assert.equal(audiences[0].name, "Público A Renomeado");
  assert.equal(audiences[0].approximateCount, 1000);
  assert.equal(audiences[0].subtype, "SOME_FUTURE_SUBTYPE_NEVER_SEEN_BEFORE", "subtype desconhecido nunca deveria quebrar o insert");
});

test("PostgresMetaCustomAudienceRepository: lookalike aponta pro público de origem via FK interno; apagar a origem faz SET NULL, nunca apaga o lookalike", async () => {
  const { workspace, account } = await makeAdAccount("tenant-mca-2");
  const repo = new PostgresMetaCustomAudienceRepository(db.pool);
  const origin = await repo.upsertAudience({ tenantId: "tenant-mca-2", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_origin", name: "Origem", subtype: "CUSTOM" });
  const lookalike = await repo.upsertAudience({
    tenantId: "tenant-mca-2", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_lookalike", name: "Semelhante 1%",
    subtype: "LOOKALIKE", lookalikeOriginAudienceId: origin.id, lookalikeRatio: 0.01, lookalikeCountry: "BR",
  });
  assert.equal(lookalike.lookalikeOriginAudienceId, origin.id);
  assert.equal(lookalike.lookalikeRatio, 0.01);

  await db.pool.query("delete from meta_custom_audiences where id = $1", [origin.id]);

  const stillThere = await repo.getById(lookalike.id);
  assert.ok(stillThere, "apagar a origem nunca deveria apagar o lookalike em cascata");
  assert.equal(stillThere.lookalikeOriginAudienceId, undefined, "FK deveria virar null (ON DELETE SET NULL), nunca deixar um id órfão");
});

test("PostgresMetaCustomAudienceRepository.markDeletedMissing: soft delete, nunca DELETE físico", async () => {
  const { workspace, account } = await makeAdAccount("tenant-mca-3");
  const repo = new PostgresMetaCustomAudienceRepository(db.pool);
  await repo.upsertAudience({ tenantId: "tenant-mca-3", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_a", name: "A", subtype: "CUSTOM" });
  await repo.upsertAudience({ tenantId: "tenant-mca-3", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_b", name: "B", subtype: "CUSTOM" });

  await repo.markDeletedMissing({ adAccountId: account.id, keepAudienceIds: ["aud_a"] });

  const active = await repo.listByWorkspace({ tenantId: "tenant-mca-3", workspaceId: workspace.id });
  const all = await repo.listByWorkspace({ tenantId: "tenant-mca-3", workspaceId: workspace.id, includeDeleted: true });
  assert.equal(active.length, 1);
  assert.equal(all.length, 2, "a linha nunca deveria ser deletada, só marcada");
});

test("FK conta → workspace: apagar o workspace apaga em cascata públicos/pixels/eventos CAPI (nunca deixa órfão)", async () => {
  const { workspace, account } = await makeAdAccount("tenant-mca-4");
  const audienceRepo = new PostgresMetaCustomAudienceRepository(db.pool);
  const pixelRepo = new PostgresMetaPixelRepository(db.pool);
  const capiRepo = new PostgresMetaCapiEventRepository(db.pool);

  await audienceRepo.upsertAudience({ tenantId: "tenant-mca-4", workspaceId: workspace.id, adAccountId: account.id, audienceId: "aud_1", name: "A", subtype: "CUSTOM" });
  const pixel = await pixelRepo.upsertPixel({ tenantId: "tenant-mca-4", workspaceId: workspace.id, adAccountId: account.id, pixelId: "px_1", name: "Pixel", isActive: true });
  await capiRepo.record({
    tenantId: "tenant-mca-4", workspaceId: workspace.id, metaPixelId: pixel.id, pixelId: "px_1", eventName: "Purchase",
    eventTime: new Date().toISOString(), actionSource: "website", userDataFields: ["em"], status: "sent", eventsReceived: 1,
  });

  await db.pool.query("delete from workspaces where id = $1", [workspace.id]);

  const audiences = await db.pool.query("select 1 from meta_custom_audiences where ad_account_id = $1", [account.id]);
  const pixels = await db.pool.query("select 1 from meta_pixels where ad_account_id = $1", [account.id]);
  const events = await db.pool.query("select 1 from meta_capi_events where meta_pixel_id = $1", [pixel.id]);
  assert.equal(audiences.rows.length, 0);
  assert.equal(pixels.rows.length, 0);
  assert.equal(events.rows.length, 0);
});

test("PostgresMetaPixelRepository: upsert por (adAccountId, pixelId) nunca duplica ao resincronizar", async () => {
  const { workspace, account } = await makeAdAccount("tenant-mpx-1");
  const repo = new PostgresMetaPixelRepository(db.pool);
  const base = { tenantId: "tenant-mpx-1", workspaceId: workspace.id, adAccountId: account.id, pixelId: "px_1", isActive: true };
  await repo.upsertPixel({ ...base, name: "Pixel Original" });
  await repo.upsertPixel({ ...base, name: "Pixel Renomeado" });

  const pixels = await repo.listByWorkspace({ tenantId: "tenant-mpx-1", workspaceId: workspace.id });
  assert.equal(pixels.length, 1);
  assert.equal(pixels[0].name, "Pixel Renomeado");
});

test("PostgresMetaCapiEventRepository: log é append-only (cada record() é uma linha nova) e listByPixel ordena do mais recente pro mais antigo", async () => {
  const { workspace, account } = await makeAdAccount("tenant-capi-1");
  const pixelRepo = new PostgresMetaPixelRepository(db.pool);
  const pixel = await pixelRepo.upsertPixel({ tenantId: "tenant-capi-1", workspaceId: workspace.id, adAccountId: account.id, pixelId: "px_1", name: "Pixel", isActive: true });
  const repo = new PostgresMetaCapiEventRepository(db.pool);

  await repo.record({ tenantId: "tenant-capi-1", workspaceId: workspace.id, metaPixelId: pixel.id, pixelId: "px_1", eventName: "PageView", eventTime: "2026-01-01T00:00:00.000Z", actionSource: "website", userDataFields: [], status: "sent", eventsReceived: 1 });
  await repo.record({ tenantId: "tenant-capi-1", workspaceId: workspace.id, metaPixelId: pixel.id, pixelId: "px_1", eventName: "Purchase", eventTime: "2026-01-02T00:00:00.000Z", actionSource: "website", userDataFields: ["em", "ph"], status: "sent", eventsReceived: 1 });
  await repo.record({ tenantId: "tenant-capi-1", workspaceId: workspace.id, metaPixelId: pixel.id, pixelId: "px_1", eventName: "Purchase", eventTime: "2026-01-03T00:00:00.000Z", actionSource: "website", userDataFields: ["em"], status: "failed", errorMessage: "OAuthException" });

  const events = await repo.listByPixel({ tenantId: "tenant-capi-1", workspaceId: workspace.id, metaPixelId: pixel.id });
  assert.equal(events.length, 3);
  assert.equal(events[0].eventName, "Purchase");
  assert.equal(events[0].status, "failed");
  assert.equal(events[0].errorMessage, "OAuthException");
  assert.deepEqual(events[1].userDataFields, ["em", "ph"], "userDataFields nunca deveria guardar o hash, só os nomes dos campos");
  assert.equal(events[2].eventName, "PageView");
});
