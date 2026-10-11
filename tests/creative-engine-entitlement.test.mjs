import test from "node:test";
import assert from "node:assert/strict";

import { canUseCreativeEngine } from "../dist/application/creative-engine/creative-engine-entitlement.js";
import { InMemoryCreativeEngineEntitlementRepository } from "../dist/infrastructure/storage/in-memory-creative-engine-entitlement-repository.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

async function deps() {
  const workspaceRepository = new InMemoryWorkspaceRepository();
  const entitlementRepository = new InMemoryCreativeEngineEntitlementRepository();
  const workspaceA = await workspaceRepository.create({ tenantId: "tenant-1", name: "A" });
  const workspaceB = await workspaceRepository.create({ tenantId: "tenant-1", name: "B" });
  const otherTenantWorkspace = await workspaceRepository.create({ tenantId: "tenant-2", name: "C" });
  return { workspaceRepository, entitlementRepository, workspaceA, workspaceB, otherTenantWorkspace };
}

test("Creative Engine entitlement: feature ON + workspace entitlement ON permite", async () => {
  const shared = await deps();
  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-1", workspaceId: shared.workspaceA.id, enabled: true, actorUserId: "admin" });
  const decision = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceA.id, actor: { userId: "owner", role: "owner" }, requiredPermission: "execution:create" },
  );
  assert.equal(decision.ok, true);
});

test("Creative Engine entitlement: entitlement OFF, inexistente ou feature OFF bloqueiam fail-closed", async () => {
  const shared = await deps();
  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-1", workspaceId: shared.workspaceA.id, enabled: false, actorUserId: "admin" });

  const off = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceA.id },
  );
  assert.equal(off.ok, false);
  assert.equal(off.code, "CREATIVE_ENGINE_ENTITLEMENT_DENIED");

  const missing = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceB.id },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "CREATIVE_ENGINE_ENTITLEMENT_DENIED");

  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-1", workspaceId: shared.workspaceB.id, enabled: true, actorUserId: "admin" });
  const featureOff = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: false } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceB.id },
  );
  assert.equal(featureOff.ok, false);
  assert.equal(featureOff.code, "CREATIVE_ENGINE_TECHNICAL_FEATURE_DISABLED");
});

test("Creative Engine entitlement: workspace A enabled e B disabled no mesmo tenant", async () => {
  const shared = await deps();
  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-1", workspaceId: shared.workspaceA.id, enabled: true, actorUserId: "admin" });

  const a = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceA.id },
  );
  const b = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceB.id },
  );

  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(b.code, "CREATIVE_ENGINE_ENTITLEMENT_DENIED");
});

test("Creative Engine entitlement: tenant errado e workspace inexistente retornam 404", async () => {
  const shared = await deps();
  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-2", workspaceId: shared.otherTenantWorkspace.id, enabled: true, actorUserId: "admin" });

  const crossTenant = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.otherTenantWorkspace.id },
  );
  const missing = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: "workspace-missing" },
  );

  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.httpStatus, 404);
  assert.equal(missing.ok, false);
  assert.equal(missing.httpStatus, 404);
});

test("Creative Engine entitlement: global kill switch bloqueia workspace enabled", async () => {
  const shared = await deps();
  await shared.entitlementRepository.setWorkspaceEntitlement({ tenantId: "tenant-1", workspaceId: shared.workspaceA.id, enabled: true, actorUserId: "admin" });
  await shared.entitlementRepository.setGlobalEnabled({ enabled: false, actorUserId: "admin" });

  const decision = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceA.id },
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "CREATIVE_ENGINE_GLOBAL_DISABLED");
});

test("Creative Engine entitlement: QA bypass autorizado preserva fluxo de homologacao", async () => {
  const shared = await deps();
  const decision = await canUseCreativeEngine(
    { workspaceRepository: shared.workspaceRepository, entitlementRepository: shared.entitlementRepository, featureFlags: { creativeEngineGptEnabled: true } },
    { tenantId: "tenant-1", workspaceId: shared.workspaceA.id, qaBypassAllowed: true },
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, "qa_allowed");
});

test("Creative Engine entitlement: admin sem platform admin nao altera entitlement", async () => {
  const app = await buildApp({
    config: loadApiConfig({
      AUTH_MODE: "noop",
      ZUNO_LOG_LEVEL: "silent",
      DEV_PRINCIPAL_TENANT_ID: "tenant-admin-test",
      DEV_PRINCIPAL_USER_ID: "user-owner",
      DEV_PRINCIPAL_ROLE: "owner",
      DEV_PRINCIPAL_PLATFORM_ADMIN: "false",
      CREATIVE_ENGINE: "gpt",
    }),
  });
  const workspace = await app.zunoContainer.workspaceRepository.create({ tenantId: "tenant-admin-test", name: "Admin test" });
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/creative-engine-entitlements/tenant-admin-test/${workspace.id}/enable`,
    payload: { reason: "test" },
  });
  assert.equal(response.statusCode, 403);
  const entitlement = await app.zunoContainer.creativeEngineEntitlementRepository.getWorkspaceEntitlement({ tenantId: "tenant-admin-test", workspaceId: workspace.id });
  assert.equal(entitlement, undefined);
  await app.close();
});

test("Creative Engine entitlement: POST direto sem entitlement nao cria run", async () => {
  const app = await buildApp({
    config: loadApiConfig({
      AUTH_MODE: "noop",
      ZUNO_LOG_LEVEL: "silent",
      DEV_PRINCIPAL_TENANT_ID: "tenant-direct-api",
      DEV_PRINCIPAL_USER_ID: "owner-direct-api",
      DEV_PRINCIPAL_ROLE: "owner",
      CREATIVE_ENGINE: "gpt",
      REAL_EXECUTION_ENABLED: "true",
      REAL_VISUAL_ENABLED: "true",
    }),
  });
  const workspace = await app.zunoContainer.workspaceRepository.create({ tenantId: "tenant-direct-api", name: "Direct API" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/production/ideas/generate",
    payload: {
      workspaceId: workspace.id,
      name: "blocked",
      objective: "Gerar conteudo",
      ideaText: "Gerar uma peca bloqueada por entitlement.",
      format: "single_image",
      channel: "instagram",
    },
  });
  assert.equal(response.statusCode, 403);
  const runs = await app.zunoContainer.executionRepository.listRuns({ tenantId: "tenant-direct-api", workspaceId: workspace.id });
  assert.equal(runs.length, 0);
  await app.close();
});
