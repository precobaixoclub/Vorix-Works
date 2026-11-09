// Server resource hotspots found in production (Nov/2026): workspace reads pulling inline logos,
// per-image workspace lookups when signing URLs, and per-variant work on public site pages.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { migrateInlineWorkspaceLogos } from "../dist/infrastructure/storage/postgres/inline-workspace-logo-migration.js";
import { createObjectKeyReadAuthorizer } from "../dist/interfaces/api/object-url-access.js";
import { presentPublicProducts } from "../dist/application/sites/site-use-cases.js";

let db, dir, storage, workspaces;
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db/migrations"));
  dir = await mkdtemp(join(tmpdir(), "vorix-hotspots-"));
  storage = new LocalObjectStorage({ rootDir: dir, publicBaseUrl: "http://127.0.0.1:9/uploads" });
  workspaces = new PostgresWorkspaceRepository(db.pool);
});
after(async () => { await db?.stop(); if (dir) await rm(dir, { recursive: true, force: true }); });

test("inline base64 logos move to object storage once; changed logos and URLs are left alone", async () => {
  const tenantId = `tenant-${randomUUID()}`;
  const png = await sharp({ create: { width: 1200, height: 900, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 0.5 } } }).png().toBuffer();
  const inline = await workspaces.create({ tenantId, name: "Inline" });
  const external = await workspaces.create({ tenantId, name: "External" });
  await db.pool.query("update workspaces set settings = jsonb_set(settings, '{logoUrl}', to_jsonb($2::text)) where id = $1", [inline.id, `data:image/png;base64,${png.toString("base64")}`]);
  await db.pool.query("update workspaces set settings = jsonb_set(settings, '{logoUrl}', to_jsonb($2::text)) where id = $1", [external.id, "https://cdn.example.com/logo.png"]);
  const logs = [];
  assert.equal(await migrateInlineWorkspaceLogos(db.pool, storage, (message) => logs.push(message)), 1);
  const migrated = (await workspaces.getById(inline.id)).settings.logoUrl;
  assert.match(migrated, new RegExp(`^http://127\\.0\\.0\\.1:9/uploads/assets/${tenantId}/${inline.id}/logo-[0-9a-f-]+\\.webp$`));
  const key = migrated.replace("http://127.0.0.1:9/uploads/", "");
  const meta = await sharp(await storage.read(key, { maxBytes: 5_000_000 })).metadata();
  assert.equal(meta.format, "webp"); assert.ok(meta.width <= 512 && meta.height <= 512); assert.equal(meta.hasAlpha, true);
  assert.equal((await workspaces.getById(external.id)).settings.logoUrl, "https://cdn.example.com/logo.png");
  const row = (await db.pool.query("select pg_column_size(settings) as bytes from workspaces where id = $1", [inline.id])).rows[0];
  assert.ok(row.bytes < 1024, `settings shrank to ${row.bytes} bytes`);
  assert.equal(await migrateInlineWorkspaceLogos(db.pool, storage), 0, "idempotent");
});

test("a broken inline logo is reported and kept, without stopping the others", async () => {
  const tenantId = `tenant-${randomUUID()}`;
  const broken = await workspaces.create({ tenantId, name: "Broken" });
  await db.pool.query("update workspaces set settings = jsonb_set(settings, '{logoUrl}', to_jsonb($2::text)) where id = $1", [broken.id, "data:image/png;base64,bm90IGFuIGltYWdl"]);
  const logs = [];
  await migrateInlineWorkspaceLogos(db.pool, storage, (message) => logs.push(message));
  assert.ok(logs.some((message) => message.includes("não migrado")));
  assert.match((await workspaces.getById(broken.id)).settings.logoUrl, /^data:/);
  await db.pool.query("update workspaces set settings = settings - 'logoUrl' where id = $1", [broken.id]);
});

test("signing image URLs reads each workspace once, not once per image, and keeps tenant isolation", async () => {
  const tenantId = `tenant-${randomUUID()}`, other = `tenant-${randomUUID()}`;
  const ws = await workspaces.create({ tenantId, name: "Catalog" });
  let reads = 0;
  const repository = { getById: async (id) => { reads += 1; return workspaces.getById(id); } };
  const authorize = createObjectKeyReadAuthorizer({ workspaceRepository: repository, qaTenantIds: [] });
  const principal = { tenantId, userId: "u", role: "owner", permissions: [] };
  const keys = Array.from({ length: 200 }, (_, i) => `assets/${tenantId}/${ws.id}/products/img-${i}.webp`);
  const decisions = await Promise.all(keys.map((key) => authorize(principal, key)));
  assert.ok(decisions.every(Boolean));
  assert.equal(reads, 1);
  assert.equal(await authorize({ ...principal, tenantId: other }, keys[0]), false, "another tenant never reads it");
  assert.equal(await authorize(principal, `assets/${tenantId}/workspace-missing/products/a.webp`), false);
  assert.equal(await authorize(principal, `assets/${tenantId}/workspace-missing/products/a.webp`), false);
  assert.equal(reads, 3, "unknown workspaces are not cached as known");
});

test("public products load all variants in one batch and keep rule prices per variant", async () => {
  const calls = { single: 0, batch: 0 };
  const variant = (productId, i, price) => ({ id: `${productId}-v${i}`, productId, name: `V${i}`, code: `C${i}`, optionValues: { size: `S${i}` }, active: true, listPriceCents: price, priceOverride: true, stockQuantity: 5, reservedQuantity: 1 });
  const products = Array.from({ length: 3 }, (_, p) => ({ id: `p${p}`, name: `P${p}`, active: true, priceCents: 6000, currency: "BRL", unit: "un", imageUrls: [], trackStock: true, stockQuantity: 0, itemType: "PRODUCT", categoryId: undefined, details: { type: "APPAREL", slug: `p${p}`, siteVisible: true, catalogVisible: true, media: [], attributes: {}, options: [{ key: "size", name: "Tam", values: ["S0", "S1", "S2"] }], apparel: {} } }));
  const repo = {
    listVariants: async (id) => { calls.single += 1; return [0, 1, 2].map((i) => variant(id, i, i === 2 ? 7000 : 6000)); },
    listVariantsForProducts: async (ids) => { calls.batch += 1; return new Map(ids.map((id) => [id, [0, 1, 2].map((i) => variant(id, i, i === 2 ? 7000 : 6000))])); },
  };
  const rule = { id: "r", tenantId: "t", workspaceId: "w", siteId: "s", revision: 1, createdAt: "", updatedAt: "", name: "Fixed 50", active: true, priority: 0, stackable: false, allowCoupon: false, currency: "BRL", channels: ["WHATSAPP"], scope: { type: "STORE", ids: [] }, trigger: { type: "QUANTITY", count: "ELIGIBLE", minimum: 1 }, benefit: { type: "UNIT_PRICE", tiers: [{ minimum: 1, unitPriceCents: 5000 }] } };
  const commerce = { settings: { mode: "WHATSAPP" }, hasWhatsapp: true, contactForm: true, checkoutReady: false, rules: [rule], now: new Date() };
  const metadata = { categories: [], brands: [], attributes: [] };
  const presented = await presentPublicProducts({ salesCatalogRepository: repo }, products, metadata, commerce);
  assert.deepEqual(calls, { single: 0, batch: 1 });
  assert.equal(presented.length, 3);
  for (const product of presented) {
    assert.deepEqual(product.variants.map((v) => v.originalPriceCents), [6000, 6000, 7000]);
    assert.deepEqual(product.variants.map((v) => v.priceCents), [5000, 5000, 5000]);
    assert.deepEqual(product.variants.map((v) => v.availableQuantity), [4, 4, 4]);
  }
  const fallback = await presentPublicProducts({ salesCatalogRepository: { listVariants: repo.listVariants } }, products, metadata, commerce);
  assert.equal(calls.single, 3); assert.deepEqual(fallback.map((p) => p.variants.length), [3, 3, 3]);
});

test("logo upload stores a compact file; settings refuse inline images and keep canonical URLs", async () => {
  const { default: Fastify } = await import("fastify");
  const { default: multipart } = await import("@fastify/multipart");
  const { registerErrorHandler } = await import("../dist/interfaces/api/http/error-handler.js");
  const { registerWorkspaceRoutes } = await import("../dist/interfaces/api/routes/v1/workspaces.route.js");
  const { InMemoryWorkspaceRepository } = await import("../dist/infrastructure/storage/in-memory-workspace-repository.js");
  const repo = new InMemoryWorkspaceRepository();
  const ws = await repo.create({ tenantId: "tenant-logo", name: "Logo" });
  const app = Fastify(); registerErrorHandler(app); await app.register(multipart);
  app.decorateRequest("zunoContext", null);
  app.addHook("onRequest", async (request) => { request.zunoContext = { principal: { tenantId: request.headers["x-tenant"] ?? "tenant-logo", userId: "u", role: "owner" } }; });
  await registerWorkspaceRoutes(app, { workspaceRepository: repo, objectStorage: storage });
  try {
    const png = await sharp({ create: { width: 2000, height: 2000, channels: 4, background: "#123456" } }).png().toBuffer();
    const boundary = "----vorixlogo";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const upload = await app.inject({ method: "POST", url: `/workspaces/${ws.id}/logo`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    assert.equal(upload.statusCode, 200, upload.body);
    const url = upload.json().data.url;
    assert.match(url, new RegExp(`/uploads/assets/tenant-logo/${ws.id}/logo-[0-9a-f-]+\.webp$`));
    const foreign = await app.inject({ method: "POST", url: `/workspaces/${ws.id}/logo`, payload, headers: { "x-tenant": "tenant-other", "content-type": `multipart/form-data; boundary=${boundary}` } });
    assert.equal(foreign.statusCode, 404);
    const inline = await app.inject({ method: "PATCH", url: `/workspaces/${ws.id}`, payload: { settings: { logoUrl: "data:image/png;base64,AAAA" } } });
    assert.equal(inline.statusCode, 400);
    const saved = await app.inject({ method: "PATCH", url: `/workspaces/${ws.id}`, payload: { settings: { logoUrl: `${url}?exp=1999999999&sig=abc` } } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await repo.getById(ws.id)).settings.logoUrl, url, "stored without the expiring signature");
    const stolen = await app.inject({ method: "PATCH", url: `/workspaces/${ws.id}`, payload: { settings: { logoUrl: "http://127.0.0.1:9/uploads/assets/tenant-other/workspace-x/logo-a.webp" } } });
    assert.equal(stolen.statusCode, 400);
  } finally { await app.close(); }
});
