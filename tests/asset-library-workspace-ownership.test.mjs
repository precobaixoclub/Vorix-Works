import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { InMemoryAssetLibraryRepository } from "../dist/infrastructure/storage/in-memory-asset-library-repository.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { registerAssetsRoutes } from "../dist/interfaces/api/routes/v1/assets.route.js";
import { registerProductionRoutes } from "../dist/interfaces/api/routes/v1/production.route.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

test("Asset Library: listar workspace de outro tenant responde 404", async () => {
  const ctx = await createAssetRouteContext({ tenantId: TENANT_A });
  const response = await ctx.app.inject({ method: "GET", url: `/assets?workspaceId=${encodeURIComponent(ctx.workspaceB.id)}` });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");
  await ctx.app.close();
});

test("Asset Library: registrar asset exige storageRef do mesmo tenant/workspace e nega qa-assets", async () => {
  const ctx = await createAssetRouteContext({ tenantId: TENANT_A });

  const foreignStorage = await ctx.app.inject({
    method: "POST",
    url: "/assets",
    payload: {
      workspaceId: ctx.workspaceA.id,
      kind: "logo",
      name: "Logo externo",
      storageRef: { provider: "object_storage", objectKey: `assets/${TENANT_B}/${ctx.workspaceB.id}/logo.png` },
    },
  });
  assert.equal(foreignStorage.statusCode, 403);
  assert.equal(foreignStorage.json().error.code, "FORBIDDEN");

  const qaStorage = await ctx.app.inject({
    method: "POST",
    url: "/assets",
    payload: {
      workspaceId: ctx.workspaceA.id,
      kind: "product",
      name: "Produto QA",
      storageRef: { provider: "object_storage", objectKey: "qa-assets/editorial-smoke-a/product.jpg" },
    },
  });
  assert.equal(qaStorage.statusCode, 403);

  const ownStorage = await ctx.app.inject({
    method: "POST",
    url: "/assets",
    payload: {
      workspaceId: ctx.workspaceA.id,
      kind: "logo",
      name: "Logo propria",
      storageRef: { provider: "object_storage", objectKey: `assets/${TENANT_A}/${ctx.workspaceA.id}/logo.png` },
    },
  });
  assert.equal(ownStorage.statusCode, 200);
  assert.equal(ownStorage.json().data.name, "Logo propria");
  await ctx.app.close();
});

test("Asset Library: update/archive/delete exigem asset no mesmo workspace declarado", async () => {
  const ctx = await createAssetRouteContext({ tenantId: TENANT_A });
  const libraryA = await ctx.assetLibraryRepository.createLibrary({ workspaceId: ctx.workspaceA.id });
  const libraryA2 = await ctx.assetLibraryRepository.createLibrary({ workspaceId: ctx.workspaceA2.id });
  const assetA = await ctx.assetLibraryRepository.registerAsset({ libraryId: libraryA.id, kind: "logo", name: "Logo A" });
  const assetA2 = await ctx.assetLibraryRepository.registerAsset({ libraryId: libraryA2.id, kind: "logo", name: "Logo A2" });

  const crossWorkspaceUpdate = await ctx.app.inject({
    method: "POST",
    url: `/assets/${encodeURIComponent(assetA2.id)}/update`,
    payload: { workspaceId: ctx.workspaceA.id, name: "Hack" },
  });
  assert.equal(crossWorkspaceUpdate.statusCode, 404);
  assert.equal((await ctx.assetLibraryRepository.getAsset(assetA2.id)).name, "Logo A2");

  const ownUpdate = await ctx.app.inject({
    method: "POST",
    url: `/assets/${encodeURIComponent(assetA.id)}/update`,
    payload: { workspaceId: ctx.workspaceA.id, name: "Logo A atualizada" },
  });
  assert.equal(ownUpdate.statusCode, 200);
  assert.equal(ownUpdate.json().data.name, "Logo A atualizada");

  const crossWorkspaceArchive = await ctx.app.inject({
    method: "POST",
    url: `/assets/${encodeURIComponent(assetA2.id)}/archive`,
    payload: { workspaceId: ctx.workspaceA.id },
  });
  assert.equal(crossWorkspaceArchive.statusCode, 404);
  assert.equal((await ctx.assetLibraryRepository.getAsset(assetA2.id)).status, "active");

  const crossWorkspaceDelete = await ctx.app.inject({
    method: "POST",
    url: `/assets/${encodeURIComponent(assetA2.id)}/delete`,
    payload: { workspaceId: ctx.workspaceA.id },
  });
  assert.equal(crossWorkspaceDelete.statusCode, 404);
  assert.ok(await ctx.assetLibraryRepository.getAsset(assetA2.id));

  await ctx.app.close();
});

test("Production ideas: workspace de outro tenant aborta antes de reference assets, tenant profile e execucao", async () => {
  const workspaceRepository = new InMemoryWorkspaceRepository({ idGenerator: sequence(["workspace-a", "workspace-b"]) });
  const workspaceA = await workspaceRepository.create({ tenantId: TENANT_A, name: "A" });
  const workspaceB = await workspaceRepository.create({ tenantId: TENANT_B, name: "B" });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: principal(TENANT_A) };
  });

  let resolverCalls = 0;
  let tenantProfileCalls = 0;
  let executionCalls = 0;
  await registerProductionRoutes(app, {
    workspaceRepository,
    featureFlags: { realExecutionEnabled: true, realVisualEnabled: true, creativeEngineEditorialExperimentalEnabled: true },
    referenceAssetResolver: {
      authorize: () => {
        resolverCalls += 1;
        return { ok: true, category: "TENANT_MANAGED_ASSET", objectKey: "unused.png" };
      },
      load: async () => Buffer.from("unused"),
    },
    ensureHouseTenantProfile: async () => {
      tenantProfileCalls += 1;
    },
    idGenerator: () => "execution-test",
    executionRepository: {
      replaceRunState: async () => undefined,
      createRun: async () => {
        executionCalls += 1;
        return {};
      },
    },
    qualityFeedback: { record: async () => undefined },
  });

  const response = await app.inject({
    method: "POST",
    url: "/production/ideas/generate",
    payload: {
      workspaceId: workspaceB.id,
      name: "Smoke proibido",
      objective: "Validar ownership",
      ideaText: "Nao deve seguir adiante",
      format: "single_image",
      channel: "instagram",
      creativeEngineCompositionMode: "editorial_experimental",
      referenceAssets: [{ url: `https://api.vorixworks.com/uploads/assets/${TENANT_B}/${workspaceB.id}/produto.png`, role: "product_photo" }],
    },
  });

  assert.equal(workspaceA.tenantId, TENANT_A);
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");
  assert.equal(resolverCalls, 0);
  assert.equal(tenantProfileCalls, 0);
  assert.equal(executionCalls, 0);
  await app.close();
});

async function createAssetRouteContext({ tenantId }) {
  const workspaceRepository = new InMemoryWorkspaceRepository({ idGenerator: sequence(["workspace-a", "workspace-a2", "workspace-b"]) });
  const assetLibraryRepository = new InMemoryAssetLibraryRepository({ idGenerator: sequence(["library-a", "library-a2", "library-b", "asset-a", "asset-a2", "asset-b"]) });
  const workspaceA = await workspaceRepository.create({ tenantId: TENANT_A, name: "A" });
  const workspaceA2 = await workspaceRepository.create({ tenantId: TENANT_A, name: "A2" });
  const workspaceB = await workspaceRepository.create({ tenantId: TENANT_B, name: "B" });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: principal(tenantId) };
  });
  await registerAssetsRoutes(app, {
    assetLibraryRepository,
    workspaceRepository,
    objectStorage: storage(),
    maxUploadBytes: 1024 * 1024,
    removeImageBackground: async () => Buffer.from("unused"),
  });
  return { app, assetLibraryRepository, workspaceRepository, workspaceA, workspaceA2, workspaceB };
}

function principal(tenantId) {
  return { userId: "user-test", tenantId, role: "owner", sessionId: "session-test", isPlatformAdmin: false };
}

function storage() {
  const base = "https://api.vorixworks.com/uploads";
  return {
    health: async () => ({ ok: true }),
    put: async ({ key }) => ({ url: `${base}/${key}` }),
    delete: async () => undefined,
    resolvePublicUrl: (key) => (key ? `${base}/${key}` : `${base}/`),
  };
}

function sequence(values) {
  const ids = [...values];
  return () => ids.shift() ?? `id-${Date.now().toString(36)}`;
}
