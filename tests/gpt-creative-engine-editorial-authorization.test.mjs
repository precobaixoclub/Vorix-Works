import test from "node:test";
import assert from "node:assert/strict";

import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import {
  GptCreativeEngineVisualTaskHandler,
  resolveTrustedEditorialExperimentalAuthorization,
} from "../dist/infrastructure/execution/gpt-creative-engine-execution-handlers.js";

const ALLOWLIST = [{ tenantId: "tenant-qa", workspaceId: "workspace-qa" }];

test("Creative Engine editorial experimental: config parseia allowlist explicita de QA", () => {
  const config = loadApiConfig({
    AUTH_MODE: "noop",
    CREATIVE_ENGINE: "gpt",
    CREATIVE_ENGINE_EDITORIAL_EXPERIMENTAL_ENABLED: "true",
    CREATIVE_ENGINE_EDITORIAL_QA_ALLOWLIST: "tenant-qa:workspace-qa, tenant-2:workspace-2, invalido, tenant-3:workspace-3:extra",
  });

  assert.equal(config.execution.creativeEngineEditorialExperimentalEnabled, true);
  assert.deepEqual(config.execution.creativeEngineEditorialExperimentalQaAllowlist, [
    { tenantId: "tenant-qa", workspaceId: "workspace-qa" },
    { tenantId: "tenant-2", workspaceId: "workspace-2" },
  ]);
});

test("Creative Engine editorial experimental: autorizacao usa run persistido e permissoes atuais", async () => {
  const deps = trustedDeps();

  assert.deepEqual(await authorize(deps, { requested: false, contextTenantId: "tenant-other", contextWorkspaceId: "workspace-other" }), { ok: true, enabled: false });
  assert.equal((await authorize(deps, { enabled: false })).code, "EDITORIAL_CREATIVE_ENGINE_DISABLED");
  assert.deepEqual(await authorize(deps), { ok: true, enabled: true, trustedPrincipalId: "user-a", run: deps.runs.get("run-qa") });

  assert.equal((await authorize(deps, { contextTenantId: "tenant-b", contextWorkspaceId: "workspace-qa" })).code, "EDITORIAL_EXECUTION_CONTEXT_MISMATCH");
  assert.equal((await authorize(deps, { runId: "run-same-workspace-other-tenant", contextTenantId: "tenant-b", contextWorkspaceId: "workspace-qa" })).code, "EDITORIAL_EXECUTION_WORKSPACE_INVALID");

  deps.memberships.delete("user-a:tenant-qa");
  assert.equal((await authorize(deps)).code, "EDITORIAL_EXECUTION_MEMBERSHIP_NOT_FOUND");

  deps.memberships.set("user-a:tenant-qa", membership("user-a", "tenant-qa", "viewer"));
  assert.equal((await authorize(deps)).code, "EDITORIAL_CREATIVE_ENGINE_ACTOR_FORBIDDEN");

  deps.memberships.set("user-a:tenant-qa", membership("user-a", "tenant-qa", "editor"));
  deps.users.set("user-a", user("user-a", "disabled"));
  assert.equal((await authorize(deps)).code, "EDITORIAL_EXECUTION_TRUSTED_ACTOR_UNRESOLVED");

  deps.users.set("user-a", user("user-a", "active"));
  assert.equal((await authorize(deps, { allowlist: [] })).code, "EDITORIAL_CREATIVE_ENGINE_WORKSPACE_NOT_AUTHORIZED");
  assert.equal((await authorize(deps, { runId: "run-legacy" })).code, "EDITORIAL_EXECUTION_TRUSTED_ACTOR_UNRESOLVED");
});

test("Creative Engine editorial experimental: payload actor fabricado nao autoriza o worker nem consome IA", async () => {
  const deps = trustedDeps();
  deps.memberships.set("user-a:tenant-qa", membership("user-a", "tenant-qa", "viewer"));
  let buildContextCalls = 0;
  let engineCalls = 0;
  const handler = new GptCreativeEngineVisualTaskHandler({
    runtimeRepository: {
      getById: async () => ({ sourceContext: { preparedCommandId: "prepared-1" } }),
    },
    preparedCommandRepository: {
      getById: async () => ({
        validatedInputs: {
          brandName: "Marca QA",
          objective: "Validar compositor editorial",
          offerOrSubject: "Oferta QA",
          creativeEngineCompositionMode: "editorial_experimental",
        },
      }),
    },
    executionRepository: deps.executionRepository,
    workspaceRepository: deps.workspaceRepository,
    userRepository: deps.userRepository,
    membershipRepository: deps.membershipRepository,
    editorialExperimentalEnabled: true,
    editorialExperimentalQaAllowlist: ALLOWLIST,
    resolveBrandProfile: async () => {
      buildContextCalls += 1;
      return undefined;
    },
    creativeBrain: { request: async () => { engineCalls += 1; return { content: "{}" }; } },
  });

  const result = await handler.execute({
    task: { id: "task-1", runtimePlanId: "runtime-1", executionTaskId: "execution-task-1", capability: "visual_design", type: "visual_generation" },
    inputs: {},
    context: {
      executionRunId: "run-qa",
      tenantId: "tenant-qa",
      workspaceId: "workspace-qa",
      mode: "real",
      actor: { userId: "admin-b", role: "owner" },
    },
    attempt: { id: "attempt-1", executionRunId: "run-qa", taskRunId: "task-run-1", attemptNumber: 1, state: "running", startedAt: "2026-10-07T00:00:00.000Z", idempotencyKey: "idem", correlationId: "corr", traceId: "trace" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EDITORIAL_CREATIVE_ENGINE_ACTOR_FORBIDDEN");
  assert.equal(result.error.category, "policy_violation");
  assert.equal(buildContextCalls, 0);
  assert.equal(engineCalls, 0);
});

test("Creative Engine editorial experimental: engine normal sem opt-in nao exige trusted actor", async () => {
  const result = await resolveTrustedEditorialExperimentalAuthorization({
    requested: false,
    enabled: true,
    executionRunId: "run-legacy",
    contextTenantId: "tenant-qa",
    contextWorkspaceId: "workspace-qa",
    allowlist: [],
  });

  assert.deepEqual(result, { ok: true, enabled: false });
});

function authorize(deps, overrides = {}) {
  return resolveTrustedEditorialExperimentalAuthorization({
    requested: overrides.requested ?? true,
    enabled: overrides.enabled ?? true,
    executionRunId: overrides.runId ?? "run-qa",
    contextTenantId: overrides.contextTenantId ?? "tenant-qa",
    contextWorkspaceId: overrides.contextWorkspaceId ?? "workspace-qa",
    allowlist: overrides.allowlist ?? ALLOWLIST,
    executionRepository: deps.executionRepository,
    workspaceRepository: deps.workspaceRepository,
    userRepository: deps.userRepository,
    membershipRepository: deps.membershipRepository,
  });
}

function trustedDeps() {
  const runs = new Map([
    ["run-qa", run({ id: "run-qa", tenantId: "tenant-qa", workspaceId: "workspace-qa", initiatedByUserId: "user-a" })],
    ["run-legacy", run({ id: "run-legacy", tenantId: "tenant-qa", workspaceId: "workspace-qa" })],
    ["run-same-workspace-other-tenant", run({ id: "run-same-workspace-other-tenant", tenantId: "tenant-b", workspaceId: "workspace-qa", initiatedByUserId: "user-b" })],
  ]);
  const workspaces = new Map([
    ["workspace-qa", { id: "workspace-qa", tenantId: "tenant-qa", name: "QA", kind: "brand", status: "active", settings: {}, members: [], integrations: [], createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z" }],
  ]);
  const users = new Map([
    ["user-a", user("user-a", "active")],
    ["user-b", user("user-b", "active")],
  ]);
  const memberships = new Map([
    ["user-a:tenant-qa", membership("user-a", "tenant-qa", "editor")],
    ["user-b:tenant-b", membership("user-b", "tenant-b", "owner")],
  ]);

  return {
    runs,
    workspaces,
    users,
    memberships,
    executionRepository: { getRunById: async (id) => runs.get(id) },
    workspaceRepository: { getById: async (id) => workspaces.get(id) },
    userRepository: { getById: async (id) => users.get(id) },
    membershipRepository: { getByUserAndTenant: async (userId, tenantId) => memberships.get(`${userId}:${tenantId}`) },
  };
}

function run(overrides) {
  return {
    id: overrides.id,
    runtimePlanId: "runtime-1",
    planningId: "planning-1",
    tenantId: overrides.tenantId,
    workspaceId: overrides.workspaceId,
    state: "created",
    mode: "real",
    idempotencyKey: overrides.id,
    sourceGraphFingerprint: "source",
    runtimeFingerprint: "runtime",
    correlationId: overrides.id,
    traceId: overrides.id,
    initiatedByUserId: overrides.initiatedByUserId,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    version: 1,
  };
}

function user(id, status) {
  return { id, email: `${id}@qa.local`, passwordHash: "hash", name: id, status, createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", isPlatformAdmin: false };
}

function membership(userId, tenantId, role) {
  return { id: `${userId}:${tenantId}`, userId, tenantId, role, createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z" };
}

test("Creative Engine editorial experimental: tenant fora da allowlist nunca baixa nem faz preflight do product_photo", async () => {
  const deps = trustedDeps();
  let preflightCalls = 0;
  let engineCalls = 0;
  const downloads = [];
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    downloads.push(String(url));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  try {
    const handler = new GptCreativeEngineVisualTaskHandler({
      runtimeRepository: { getById: async () => ({ sourceContext: { preparedCommandId: "prepared-1" } }) },
      preparedCommandRepository: {
        getById: async () => ({
          validatedInputs: {
            brandName: "Marca B",
            objective: "Tentar usar o workspace de QA",
            creativeEngineCompositionMode: "editorial_experimental",
            referenceAssets: JSON.stringify([{ url: "https://tenant-b.example/product.jpg", role: "product_photo" }]),
          },
        }),
      },
      executionRepository: deps.executionRepository,
      workspaceRepository: deps.workspaceRepository,
      userRepository: deps.userRepository,
      membershipRepository: deps.membershipRepository,
      editorialExperimentalEnabled: true,
      editorialExperimentalQaAllowlist: ALLOWLIST,
      preflightEditorialAsset: async () => {
        preflightCalls += 1;
        return { detectedMime: "image/jpeg" };
      },
      creativeBrain: { request: async () => { engineCalls += 1; return { content: "{}" }; } },
    });

    const result = await handler.execute({
      task: { id: "task-1", runtimePlanId: "runtime-1", executionTaskId: "execution-task-1", capability: "visual_design", type: "visual_generation" },
      inputs: {},
      context: { executionRunId: "run-same-workspace-other-tenant", tenantId: "tenant-b", workspaceId: "workspace-qa", mode: "real" },
      attempt: { id: "attempt-1", executionRunId: "run-same-workspace-other-tenant", taskRunId: "task-run-1", attemptNumber: 1, state: "running", startedAt: "2026-10-07T00:00:00.000Z", idempotencyKey: "idem", correlationId: "corr", traceId: "trace" },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.category, "policy_violation");
    assert.equal(preflightCalls, 0);
    assert.equal(engineCalls, 0);
    assert.deepEqual(downloads, []);
  } finally {
    global.fetch = previousFetch;
  }
});

// ---------------------------------------------------------------------------------------------
// Reference assets no worker com a política REAL: negação antes de qualquer leitura ou IA.
// ---------------------------------------------------------------------------------------------

async function runHandlerWithReferences(referenceAssets, { editorial = true } = {}) {
  const { createReferenceAssetResolver } = await import("../dist/application/assets/reference-asset-policy.js");
  const deps = trustedDeps();
  const reads = [];
  let engineCalls = 0;
  let contextBuilds = 0;
  const previousFetch = global.fetch;
  let networkCalls = 0;
  global.fetch = async () => { networkCalls += 1; throw new Error("rede proibida"); };
  try {
    const handler = new GptCreativeEngineVisualTaskHandler({
      runtimeRepository: { getById: async () => ({ sourceContext: { preparedCommandId: "prepared-1" } }) },
      preparedCommandRepository: {
        getById: async () => ({
          validatedInputs: {
            brandName: "Marca QA",
            objective: "Validar referências",
            ...(editorial ? { creativeEngineCompositionMode: "editorial_experimental" } : {}),
            referenceAssets: JSON.stringify(referenceAssets),
          },
        }),
      },
      executionRepository: deps.executionRepository,
      workspaceRepository: deps.workspaceRepository,
      userRepository: deps.userRepository,
      membershipRepository: deps.membershipRepository,
      editorialExperimentalEnabled: true,
      editorialExperimentalQaAllowlist: ALLOWLIST,
      referenceAssetResolver: createReferenceAssetResolver({ publicBaseUrl: "https://api.vorixworks.com/uploads" }, { read: async (key) => { reads.push(key); return Buffer.from("x"); } }),
      resolveBrandProfile: async () => { contextBuilds += 1; return undefined; },
      creativeBrain: { request: async () => { engineCalls += 1; return { content: "{}" }; } },
    });
    const result = await handler.execute({
      task: { id: "task-1", runtimePlanId: "runtime-1", executionTaskId: "execution-task-1", capability: "visual_design", type: "visual_generation" },
      inputs: {},
      context: { executionRunId: "run-qa", tenantId: "tenant-qa", workspaceId: "workspace-qa", mode: "real" },
      attempt: { id: "attempt-1", executionRunId: "run-qa", taskRunId: "task-run-1", attemptNumber: 1, state: "running", startedAt: "2026-10-07T00:00:00.000Z", idempotencyKey: "idem", correlationId: "corr", traceId: "trace" },
    });
    return { result, reads, engineCalls, contextBuilds, networkCalls };
  } finally {
    global.fetch = previousFetch;
  }
}

test("worker: execução do tenant QA usando asset gerenciado de OUTRO tenant é negada antes de download e IA", async () => {
  const outcome = await runHandlerWithReferences([{ url: "https://api.vorixworks.com/uploads/assets/tenant-b/workspace-b/logo.png", role: "logo" }]);
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "REFERENCE_ASSET_FORBIDDEN");
  assert.doesNotMatch(outcome.result.error.message, /tenant-b/);
  assert.deepEqual(outcome.reads, []);
  assert.equal(outcome.engineCalls, 0);
  assert.equal(outcome.contextBuilds, 0, "buildCreativeContext (que chama visão) nunca roda");
  assert.equal(outcome.networkCalls, 0);
});

test("worker: URL arbitrária (metadata/rede interna) é negada antes de qualquer rede ou IA", async () => {
  for (const url of ["http://169.254.169.254/latest/meta-data/", "https://cdn.example.com/p.jpg", "file:///etc/passwd"]) {
    const outcome = await runHandlerWithReferences([{ url, role: "product_photo" }]);
    assert.equal(outcome.result.ok, false, url);
    assert.ok(["REFERENCE_ASSET_SOURCE_NOT_ALLOWED", "REFERENCE_ASSET_INVALID"].includes(outcome.result.error.code), `${url}: ${outcome.result.error.code}`);
    assert.deepEqual(outcome.reads, []);
    assert.equal(outcome.engineCalls, 0);
    assert.equal(outcome.networkCalls, 0);
  }
});

test("worker: qa-assets sem modo editorial (homologação não comprovada) é negado", async () => {
  const outcome = await runHandlerWithReferences([{ url: "https://api.vorixworks.com/uploads/qa-assets/editorial-smoke-a-d27d82a/product-ring-reminder.jpg", role: "product_photo" }], { editorial: false });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "REFERENCE_ASSET_FORBIDDEN");
  assert.equal(outcome.engineCalls, 0);
});
