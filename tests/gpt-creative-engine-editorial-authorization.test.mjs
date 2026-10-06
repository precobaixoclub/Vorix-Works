import test from "node:test";
import assert from "node:assert/strict";

import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import {
  GptCreativeEngineVisualTaskHandler,
  resolveEditorialExperimentalAuthorization,
} from "../dist/infrastructure/execution/gpt-creative-engine-execution-handlers.js";

const ALLOWLIST = [{ tenantId: "tenant-qa", workspaceId: "workspace-qa" }];

test("Creative Engine editorial experimental: allowlist exige flag, opt-in, tenant/workspace e permissao do ator", () => {
  assert.deepEqual(
    resolveEditorialExperimentalAuthorization({
      requested: false,
      enabled: true,
      tenantId: "tenant-other",
      workspaceId: "workspace-other",
      actor: { userId: "user-viewer", role: "viewer" },
      allowlist: [],
    }),
    { ok: true, enabled: false },
  );

  assert.equal(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: false,
      tenantId: "tenant-qa",
      workspaceId: "workspace-qa",
      actor: { userId: "user-owner", role: "owner" },
      allowlist: ALLOWLIST,
    }).code,
    "EDITORIAL_CREATIVE_ENGINE_DISABLED",
  );

  assert.equal(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: true,
      tenantId: "tenant-qa",
      workspaceId: "workspace-other",
      actor: { userId: "user-owner", role: "owner" },
      allowlist: ALLOWLIST,
    }).code,
    "EDITORIAL_CREATIVE_ENGINE_WORKSPACE_NOT_AUTHORIZED",
  );

  assert.equal(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: true,
      tenantId: "tenant-other",
      workspaceId: "workspace-qa",
      actor: { userId: "user-owner", role: "owner" },
      allowlist: ALLOWLIST,
    }).code,
    "EDITORIAL_CREATIVE_ENGINE_WORKSPACE_NOT_AUTHORIZED",
  );

  assert.equal(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: true,
      tenantId: "tenant-qa",
      workspaceId: "workspace-qa",
      allowlist: ALLOWLIST,
    }).code,
    "EDITORIAL_CREATIVE_ENGINE_ACTOR_REQUIRED",
  );

  assert.equal(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: true,
      tenantId: "tenant-qa",
      workspaceId: "workspace-qa",
      actor: { userId: "user-viewer", role: "viewer" },
      allowlist: ALLOWLIST,
    }).code,
    "EDITORIAL_CREATIVE_ENGINE_ACTOR_FORBIDDEN",
  );

  assert.deepEqual(
    resolveEditorialExperimentalAuthorization({
      requested: true,
      enabled: true,
      tenantId: "tenant-qa",
      workspaceId: "workspace-qa",
      actor: { userId: "user-editor", role: "editor" },
      allowlist: ALLOWLIST,
    }),
    { ok: true, enabled: true },
  );
});

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

test("Creative Engine editorial experimental: job reprocessado sem ator nao ultrapassa o worker", async () => {
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
    editorialExperimentalEnabled: true,
    editorialExperimentalQaAllowlist: ALLOWLIST,
  });

  const result = await handler.execute({
    task: { id: "task-1", runtimePlanId: "runtime-1", executionTaskId: "execution-task-1", capability: "visual_design", type: "visual_generation" },
    inputs: {},
    context: { executionRunId: "run-1", tenantId: "tenant-qa", workspaceId: "workspace-qa", mode: "real" },
    attempt: { id: "attempt-1", executionRunId: "run-1", taskRunId: "task-run-1", attemptNumber: 1, state: "running", startedAt: "2026-10-06T00:00:00.000Z", idempotencyKey: "idem", correlationId: "corr", traceId: "trace" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "EDITORIAL_CREATIVE_ENGINE_ACTOR_REQUIRED");
  assert.equal(result.error.category, "policy_violation");
});
