import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import sharp from "sharp";

import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { ensureRuntimeForPlanning } from "../dist/application/runtime/runtime-engine.js";
import { createExecutionRun, startExecutionRun, decideExecutionGate } from "../dist/application/execution/execution-engine.js";
import { DeterministicExecutionTaskHandler } from "../dist/application/execution/deterministic-handlers.js";
import { ExecutionHandlerRegistry } from "../dist/application/execution/handler-registry.js";
import { ExecutionHandlerResolver } from "../dist/application/execution/handler-resolver.js";
import { mapExecutionCapabilityToSkillCapability } from "../dist/application/execution/capability-mapping.js";
import { createDefaultExecutionContractRegistry } from "../dist/application/execution/execution-contract-registry.js";
import { SideEffectGuard, createExecutionEnvironmentPolicy } from "../dist/application/execution/execution-operational-policy.js";
import { InMemoryHandlerCircuitBreaker } from "../dist/application/execution/handler-circuit-breaker.js";
import { collectExecutionMetrics } from "../dist/application/execution/execution-observability.js";
import { SingleSkillExecutionTaskHandler, VisualPipelineExecutionTaskHandler } from "../dist/infrastructure/execution/real-skill-execution-handlers.js";
import { EXECUTION_CAPABILITIES } from "../dist/domain/planning/planning.model.js";
import { InMemoryPlanningRepository } from "../dist/infrastructure/storage/in-memory-planning-repository.js";
import { InMemoryExecutionTaskRepository } from "../dist/infrastructure/storage/in-memory-execution-task-repository.js";
import { InMemoryExecutionGraphRepository } from "../dist/infrastructure/storage/in-memory-execution-graph-repository.js";
import { InMemoryPlanningArtifactRepository } from "../dist/infrastructure/storage/in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "../dist/infrastructure/storage/in-memory-planning-decision-repository.js";
import { InMemoryRuntimeRepository } from "../dist/infrastructure/storage/in-memory-runtime-repository.js";
import { InMemoryExecutionRepository } from "../dist/infrastructure/storage/in-memory-execution-repository.js";

const FIXED_NOW = "2026-01-01T00:00:00.000Z";
const REAL_FLAGS = {
  realExecutionEnabled: true,
  realExecutionResearchEnabled: true,
  realPlanningEnabled: true,
  realCopyEnabled: true,
  realVisualEnabled: true,
  realDistributionEnabled: true,
};
const OFF_FLAGS = {
  realExecutionEnabled: false,
  realExecutionResearchEnabled: false,
  realPlanningEnabled: false,
  realCopyEnabled: false,
  realVisualEnabled: false,
  realDistributionEnabled: false,
};

function preparedCommand(overrides = {}) {
  return {
    id: "command-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    briefingRevision: 1,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: { channel: "instagram", contentFormat: "carousel" },
    sourceReferences: {},
    unresolvedOptionalFields: [],
    status: "prepared",
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function fakeHelena({ invalidCapability } = {}) {
  const calls = { find: [], execute: [] };
  const capabilities = ["editorial_planning", "marketing_strategy", "copywriting", "art_direction", "social_media_design", "image_generation", "social_publishing"];
  return {
    calls,
    manager: {
      discoverAndLoadSkills: async () => [],
      findSkillByCapability: async (capability) => {
        calls.find.push(capability);
        if (!capabilities.includes(capability)) return undefined;
        return {
          source: { sourceId: `fake-${capability}`, location: `memory://${capability}`, manifest: {} },
          state: "READY",
          manifest: { id: `fake-${capability}`, version: "1.0.0", capabilities: [capability] },
          skill: { manifest: { id: `fake-${capability}` }, execute: async () => ({ status: "completed", artifacts: [], warnings: [] }) },
          validationErrors: [],
          updatedAt: FIXED_NOW,
        };
      },
      executeSkill: async (request) => {
        calls.execute.push(request);
        const output = outputForCapability(request.capability, invalidCapability === request.capability);
        return {
          skillId: `fake-${request.capability}`,
          state: "COMPLETED",
          response: {
            skillId: `fake-${request.capability}`,
            taskId: request.context.taskId,
            status: "completed",
            output,
            artifacts: [{ id: `skill-artifact-${request.capability}`, type: "text", name: `${request.capability} artifact`, status: "ready" }],
            warnings: [`warning-${request.capability}`],
          },
        };
      },
    },
  };
}

function outputForCapability(capability, invalid = false) {
  if (invalid) return { invalid: true };
  if (capability === "editorial_planning") {
    return {
      campaignObjective: "Criar campanha",
      recommendedFormatLabel: "carrossel",
      recommendedChannel: "instagram",
      recommendedCta: "Saiba mais",
      recommendedSlideCount: 3,
      keyInsights: ["insight"],
    };
  }
  if (capability === "marketing_strategy") {
    return {
      overallStrategy: "Estratégia real",
      objective: "Criar campanha",
      targetAudience: "público",
      channel: "instagram",
      format: "carrossel",
      toneOfVoice: "claro",
      centralPromise: "promessa",
      recommendedCta: "Saiba mais",
      mariaBriefing: { objective: "Criar campanha", channel: "instagram", format: "carrossel", targetAudience: "público", toneOfVoice: "claro", cta: "Saiba mais", keyMessage: "mensagem" },
      sofiaBriefing: { status: "preliminary", channel: "instagram", format: "carrossel", angle: "ângulo", centralPromise: "promessa", keyMessages: ["mensagem"], visualDirectionNotes: [], brandIdentityNotes: [], notes: [] },
    };
  }
  if (capability === "copywriting") return { title: "Título", caption: "Legenda", cta: "Saiba mais", hashtags: ["#zuno"] };
  if (capability === "art_direction") return { visualConcept: "Conceito", recommendedStyle: "premium", emotionalTone: "confiança", suggestedPalette: ["azul"], typography: ["sans"], moodboard: [], designReferences: [], recommendedFormat: "carrossel", recommendedAspectRatio: "1:1", visualConstraints: [], biancaBriefing: { status: "preliminary" } };
  if (capability === "social_media_design") return { designConcept: "Design", recommendedAspectRatio: "1:1", pedroBriefing: { status: "structured" } };
  if (capability === "image_generation") return { generationSummary: "Imagem gerada", imageCount: 1, images: [{ id: "img-1", uri: "memory://img-1" }] };
  if (capability === "social_publishing") return { overallStatus: "dry_run", publishMode: "dry_run", requestedChannels: ["instagram"], publishedChannels: [], failedChannels: [], results: [], externalIds: {}, externalUrls: {}, payloadSentToPublisher: [], warnings: [], observations: ["nenhuma publicação"], nextSteps: [] };
  return {};
}

function createResolver({ helena, featureFlags = REAL_FLAGS } = {}) {
  const registry = new ExecutionHandlerRegistry();
  registry.register({
    id: "deterministic-handler",
    provider: "deterministic",
    version: "1",
    priority: 0,
    handler: new DeterministicExecutionTaskHandler(),
    executionModes: ["dry_run"],
    enabled: true,
    supportedCapabilities: EXECUTION_CAPABILITIES,
    fallbackPolicy: "deterministic_fallback",
  });
  if (helena) {
    registry.register(realSingle("helena-research-handler", helena, "editorial_research", "research", "editorial_planning", "context", ["realExecutionEnabled", "realExecutionResearchEnabled"]));
    registry.register(realSingle("helena-planning-handler", helena, "strategic_planning", "campaign_structure", "marketing_strategy", "structure", ["realExecutionEnabled", "realPlanningEnabled"]));
    registry.register(realSingle("helena-copy-handler", helena, "copywriting", "copy_generation", "copywriting", "copy", ["realExecutionEnabled", "realCopyEnabled"]));
    registry.register({
      id: "helena-visual-handler",
      provider: "helena",
      version: "1",
      priority: 100,
      handler: new VisualPipelineExecutionTaskHandler({ helena, provider: "helena" }),
      executionModes: ["real"],
      enabled: true,
      supportedCapabilities: ["visual_design"],
      requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled"],
      fallbackPolicy: "fail_closed",
      retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
    });
    registry.register(realSingle("helena-distribution-handler", helena, "distribution", "publication", "social_publishing", "manifest", ["realExecutionEnabled", "realDistributionEnabled"]));
  }
  return { resolver: new ExecutionHandlerResolver(registry), featureFlags };
}

function realSingle(id, helena, capability, taskType, skillCapability, outputPort, requiredFeatureFlags) {
  return {
    id,
    provider: "helena",
    version: "1",
    priority: 100,
    handler: new SingleSkillExecutionTaskHandler({ helena, capability, taskType, skillCapability, outputPort, provider: "helena" }),
    executionModes: ["real"],
    enabled: true,
    supportedCapabilities: [capability],
    requiredFeatureFlags,
    fallbackPolicy: "fail_closed",
    retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
  };
}

function makeDeps({ handlerResolver, featureFlags = OFF_FLAGS } = {}) {
  let counter = 0;
  const shared = {
    planningRepository: new InMemoryPlanningRepository(),
    executionTaskRepository: new InMemoryExecutionTaskRepository(),
    executionGraphRepository: new InMemoryExecutionGraphRepository(),
    artifactRepository: new InMemoryPlanningArtifactRepository(),
    decisionRepository: new InMemoryPlanningDecisionRepository(),
    runtimeRepository: new InMemoryRuntimeRepository({ now: () => new Date(FIXED_NOW) }),
    executionRepository: new InMemoryExecutionRepository({ now: () => new Date(FIXED_NOW) }),
  };
  return {
    shared,
    planningDeps: { ...shared, idGenerator: () => `planning-id-${++counter}`, now: () => new Date(FIXED_NOW) },
    runtimeDeps: { ...shared, idGenerator: () => `runtime-id-${++counter}`, now: () => new Date(FIXED_NOW) },
    executionDeps: {
      ...shared,
      handlers: [new DeterministicExecutionTaskHandler()],
      handlerResolver,
      featureFlags,
      idGenerator: () => `execution-id-${++counter}`,
      now: () => new Date(FIXED_NOW),
    },
  };
}

function makeOperationalDeps({ handler, descriptor = {}, featureFlags = REAL_FLAGS, circuitBreaker, sideEffectGuard } = {}) {
  const registry = new ExecutionHandlerRegistry();
  const helena = fakeHelena();
  registry.register({
    id: descriptor.id ?? "operational-handler",
    provider: descriptor.provider ?? "fake",
    version: "1",
    priority: 100,
    handler,
    executionModes: ["real"],
    enabled: true,
    supportedCapabilities: ["editorial_research"],
    requiredFeatureFlags: ["realExecutionEnabled", "realExecutionResearchEnabled"],
    fallbackPolicy: "fail_closed",
    sideEffectPolicy: descriptor.sideEffectPolicy ?? "none",
    retryPolicy: descriptor.retryPolicy ?? { supportsRetry: false, maxAttempts: 1, backoffStrategy: "none" },
    executionTimeoutMs: descriptor.executionTimeoutMs ?? 5_000,
  });
  registry.register(realSingle("helena-planning-operational", helena.manager, "strategic_planning", "campaign_structure", "marketing_strategy", "structure", ["realExecutionEnabled", "realPlanningEnabled"]));
  registry.register(realSingle("helena-copy-operational", helena.manager, "copywriting", "copy_generation", "copywriting", "copy", ["realExecutionEnabled", "realCopyEnabled"]));
  registry.register({
    id: "helena-visual-operational",
    provider: "helena",
    version: "1",
    priority: 100,
    handler: new VisualPipelineExecutionTaskHandler({ helena: helena.manager, provider: "helena" }),
    executionModes: ["real"],
    enabled: true,
    supportedCapabilities: ["visual_design"],
    requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled"],
    fallbackPolicy: "fail_closed",
    sideEffectPolicy: "external_write",
    retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
    executionTimeoutMs: 30_000,
  });
  registry.register(realSingle("helena-distribution-operational", helena.manager, "distribution", "publication", "social_publishing", "manifest", ["realExecutionEnabled", "realDistributionEnabled"]));
  const deps = makeDeps({ handlerResolver: new ExecutionHandlerResolver(registry), featureFlags });
  deps.executionDeps.contractRegistry = createDefaultExecutionContractRegistry();
  deps.executionDeps.sideEffectGuard = sideEffectGuard ?? new SideEffectGuard(createExecutionEnvironmentPolicy("development"));
  if (circuitBreaker) deps.executionDeps.circuitBreaker = circuitBreaker;
  return deps;
}

function fakeOperationalHandler(execute) {
  return {
    canHandle: (capability, taskType) => capability === "editorial_research" && taskType === "research",
    validateAvailability: async () => ({ ok: true }),
    execute,
  };
}

async function seedRuntime(deps) {
  const planning = await createPlanningFromPreparedCommand(deps.planningDeps, preparedCommand());
  const runtime = await ensureRuntimeForPlanning(deps.runtimeDeps, planning);
  return { planning, runtime };
}

test("ExecutionHandlerResolver: mapping versionado, flags independentes e fail_closed", () => {
  assert.deepEqual(mapExecutionCapabilityToSkillCapability("editorial_research"), {
    mappingVersion: 1,
    executionCapability: "editorial_research",
    skillCapability: "editorial_planning",
  });
  assert.throws(() => mapExecutionCapabilityToSkillCapability("capability_inexistente"), /EXECUTION_CAPABILITY_MAPPING_MISSING/);

  const helena = fakeHelena();
  const { resolver } = createResolver({ helena: helena.manager });
  const disabled = resolver.resolve({
    capability: "copywriting",
    taskType: "copy_generation",
    executionMode: "real",
    featureFlags: { ...REAL_FLAGS, realCopyEnabled: false },
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "REAL_CAPABILITY_DISABLED");
  assert.equal(disabled.error.fallbackPolicy, "fail_closed");
});

test("Execution real ponta a ponta: research, planning, copy, visual e distribution usam Skills reais sem publicação", async () => {
  const helena = fakeHelena();
  const { resolver, featureFlags } = createResolver({ helena: helena.manager });
  const deps = makeDeps({ handlerResolver: resolver, featureFlags });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    runtimePlanId: runtime.id,
    idempotencyKey: "real-idem-full",
    executionMode: "real",
  });

  const waiting = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  assert.equal(waiting.state, "waiting_for_approval");
  assert.deepEqual(helena.calls.execute.map((call) => call.capability), ["editorial_planning", "marketing_strategy", "copywriting", "art_direction", "social_media_design", "image_generation"]);

  let detail = await deps.shared.executionRepository.getDetail(run.id);
  const completed = await decideExecutionGate(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id, gateId: detail.gates[0].id, decision: "approved" });
  detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(completed.state, "completed");
  assert.ok(helena.calls.execute.some((call) => call.capability === "social_publishing"));
  const manifest = detail.artifacts.find((artifact) => artifact.outputPort === "manifest");
  assert.equal(manifest.payload.output.publishMode, "dry_run");
  assert.equal(manifest.payload.output.overallStatus, "dry_run");
  assert.ok(detail.handlerResolution.some((event) => event.capability === "distribution" && event.provider === "helena"));
  assert.equal(detail.traces.filter((trace) => trace.provider === "helena").length, 5);
  assert.equal(detail.artifacts.every((artifact) => Array.isArray(artifact.parentArtifactIds)), true);
  assert.ok(detail.artifacts.find((artifact) => artifact.outputPort === "copy").parentArtifactIds.length > 0);
});

test("Execution dry_run: mesmo com handlers reais registrados, nenhuma Skill é chamada", async () => {
  const helena = fakeHelena();
  const { resolver } = createResolver({ helena: helena.manager });
  const deps = makeDeps({ handlerResolver: resolver, featureFlags: REAL_FLAGS });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    runtimePlanId: runtime.id,
    idempotencyKey: "dry-idem-1",
    executionMode: "dry_run",
  });

  await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(run.mode, "dry_run");
  assert.equal(helena.calls.execute.length, 0);
  assert.equal(detail.handlerResolution.every((event) => event.provider === "deterministic"), true);
});

test("Execution real: output inválido falha como invalid_output sem produzir artefato da task", async () => {
  const helena = fakeHelena({ invalidCapability: "copywriting" });
  const { resolver, featureFlags } = createResolver({ helena: helena.manager });
  const deps = makeDeps({ handlerResolver: resolver, featureFlags });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    runtimePlanId: runtime.id,
    idempotencyKey: "real-idem-invalid-output",
    executionMode: "real",
  });

  const failed = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(failed.state, "failed");
  assert.ok(detail.events.some((event) => event.payload?.category === "invalid_output"));
  assert.equal(detail.artifacts.some((artifact) => artifact.outputPort === "copy"), false);
});

test("Execution real: Skill ausente falha nas pré-condições antes de iniciar tasks", async () => {
  const unavailableHelena = {
    discoverAndLoadSkills: async () => [],
    findSkillByCapability: async () => undefined,
    executeSkill: async () => {
      throw new Error("não deveria executar");
    },
  };
  const { resolver, featureFlags } = createResolver({ helena: unavailableHelena });
  const deps = makeDeps({ handlerResolver: resolver, featureFlags });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    runtimePlanId: runtime.id,
    idempotencyKey: "real-idem-missing-skill",
    executionMode: "real",
  });

  await assert.rejects(
    () => startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id }),
    /EXECUTION_REAL_PRECONDITION_FAILED: SKILL_NOT_FOUND/,
  );
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(detail.run.state, "created");
  assert.equal(detail.taskRuns.every((task) => task.state === "blocked"), true);
  assert.equal(detail.attempts.length, 0);
});

test("Execution contracts: schemas formais validam versão, output e limites", () => {
  const registry = createDefaultExecutionContractRegistry();
  const contract = registry.get({ capability: "copywriting", taskType: "copy_generation" });
  assert.ok(contract);
  assert.equal(registry.get({ capability: "copywriting", taskType: "copy_generation", schemaVersion: 999 }), undefined);
  assert.equal(registry.validateSkillOutput(contract, { title: "T", caption: "C", cta: "Ir", hashtags: ["#zuno"] }).ok, true);
  const invalid = registry.validateSkillOutput(contract, { title: "T" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "SKILL_OUTPUT_SCHEMA_INVALID");
  const oversized = registry.validateSkillOutput(contract, { title: "T", caption: "x".repeat(100_000), cta: "Ir", hashtags: ["#zuno"] });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "EXECUTION_OUTPUT_LIMIT_EXCEEDED");
});

test("SideEffectGuard: publication é bloqueado antes de chamar handler", async () => {
  let calls = 0;
  const handler = fakeOperationalHandler(async () => {
    calls += 1;
    return { ok: true, value: { outputs: [{ outputPort: "context", payload: { skillId: "x", taskId: "x", output: outputForCapability("editorial_planning"), artifacts: [], warnings: [], upstreamInputs: {}, provider: "fake", real: true } }] } };
  });
  const deps = makeOperationalDeps({ handler, descriptor: { sideEffectPolicy: "publication" } });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "side-effect-blocked", executionMode: "real" });

  const failed = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(failed.state, "failed");
  assert.equal(calls, 0);
  assert.ok(detail.events.some((event) => event.eventType === "side_effect_blocked"));
  const metrics = await collectExecutionMetrics(deps.shared.executionRepository, { tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(metrics.failuresByCategory.side_effect_blocked, 1);
});

test("Circuit breaker: falhas transitórias abrem circuito e bloqueiam nova execução", async () => {
  let calls = 0;
  const handler = fakeOperationalHandler(async () => {
    calls += 1;
    return { ok: false, error: { code: "PROVIDER_DOWN", message: "provider indisponível", category: "provider_unavailable", retryable: false } };
  });
  const circuitBreaker = new InMemoryHandlerCircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => new Date(FIXED_NOW) });
  const deps = makeOperationalDeps({ handler, circuitBreaker });
  const { runtime } = await seedRuntime(deps);

  for (const key of ["circuit-1", "circuit-2"]) {
    const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: key, executionMode: "real" });
    const failed = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
    assert.equal(failed.state, "failed");
  }
  assert.equal(circuitBreaker.list()[0].state, "open");

  const blockedRun = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "circuit-3", executionMode: "real" });
  const blocked = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: blockedRun.id });
  const detail = await deps.shared.executionRepository.getDetail(blockedRun.id);
  assert.equal(blocked.state, "failed");
  assert.equal(calls, 2);
  assert.ok(detail.events.some((event) => event.payload?.code === "HANDLER_CIRCUIT_OPEN"));
});

test("Timeout: resultado tardio é ignorado e nenhum artifact parcial é persistido", async () => {
  const handler = fakeOperationalHandler(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok: true, value: { outputs: [{ outputPort: "context", payload: { skillId: "late", taskId: "late", output: outputForCapability("editorial_planning"), artifacts: [], warnings: [], upstreamInputs: {}, provider: "fake", real: true } }] } };
  });
  const deps = makeOperationalDeps({ handler, descriptor: { executionTimeoutMs: 1, retryPolicy: { supportsRetry: false, maxAttempts: 1, backoffStrategy: "none" } } });
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "timeout-late", executionMode: "real" });

  const failed = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(failed.state, "failed");
  assert.equal(detail.attempts[0].failure.category, "timeout");
  assert.equal(detail.artifacts.length, 0);
  assert.equal(detail.traces[0].success, false);
});

test("Traceability: correlationId e traceId propagam para run, task, attempt, events, resolution e trace", async () => {
  const helena = fakeHelena();
  const { resolver, featureFlags } = createResolver({ helena: helena.manager });
  const deps = makeDeps({ handlerResolver: resolver, featureFlags });
  deps.executionDeps.contractRegistry = createDefaultExecutionContractRegistry();
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    runtimePlanId: runtime.id,
    idempotencyKey: "traceability",
    executionMode: "real",
    correlationId: "corr-explicit",
  });

  await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(detail.run.correlationId, "corr-explicit");
  assert.equal(detail.taskRuns.every((task) => task.correlationId === "corr-explicit"), true);
  assert.equal(detail.attempts.every((attempt) => attempt.correlationId === "corr-explicit"), true);
  assert.equal(detail.events.every((event) => !event.correlationId || event.correlationId === "corr-explicit"), true);
  assert.equal(detail.handlerResolution.every((event) => event.traceId === detail.run.traceId), true);
  assert.equal(detail.traces.every((trace) => trace.traceId === detail.run.traceId), true);
});

test("VisualPipelineExecutionTaskHandler: cola a logo real da marca sobre a imagem gerada quando clara+objectStorage estão configurados", async () => {
  const baseImagePng = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const logoPng = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();

  const server = createServer((req, res) => {
    if (req.url === "/generated-image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(baseImagePng);
      return;
    }
    if (req.url === "/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(logoPng);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const helena = fakeHelena();
  const originalExecuteSkill = helena.manager.executeSkill;
  helena.manager.executeSkill = async (request) => {
    if (request.capability === "image_generation") {
      return {
        skillId: "fake-image_generation",
        state: "COMPLETED",
        response: {
          skillId: "fake-image_generation",
          taskId: request.context.taskId,
          status: "completed",
          output: { generationSummary: "ok", imageCount: 1, images: [{ id: "img-1", uri: `${baseUrl}/generated-image.png` }] },
          artifacts: [],
          warnings: [],
        },
      };
    }
    return originalExecuteSkill(request);
  };

  const putCalls = [];
  const fakeObjectStorage = {
    put: async (input) => {
      putCalls.push(input);
      return { url: `${baseUrl}/uploaded-with-logo.jpg` };
    },
    delete: async () => undefined,
    resolvePublicUrl: (key) => `${baseUrl}/${key}`,
    health: async () => ({ ok: true }),
  };
  const fakeClara = {
    requestContext: async () => ({
      clientId: "tenant-1",
      deliveredAt: FIXED_NOW,
      modules: { IdentityContext: [{ id: "id-1", module: "IdentityContext", clientId: "tenant-1", updatedAt: FIXED_NOW, payload: { clientId: "tenant-1", logoUri: `${baseUrl}/logo.png` } }] },
      records: [],
    }),
  };

  const handler = new (await import("../dist/infrastructure/execution/real-skill-execution-handlers.js")).VisualPipelineExecutionTaskHandler({
    helena: helena.manager,
    provider: "helena",
    clara: fakeClara,
    objectStorage: fakeObjectStorage,
  });

  const request = {
    task: { id: "task-1", runtimePlanId: "runtime-1", capability: "visual_design", type: "visual_generation" },
    inputs: {
      structure: [{ artifactId: "a-structure", checksum: "c1", payload: { output: { objective: "vender", channel: "instagram", format: "carrossel" } } }],
    },
    context: { executionRunId: "exec-1", tenantId: "tenant-1", workspaceId: "workspace-1", mode: "real" },
    attempt: { total: 1, providerAttempt: 1 },
  };

  try {
    const result = await handler.execute(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    const images = result.value.outputs[0].payload.output.images;
    assert.equal(images[0].uri, `${baseUrl}/uploaded-with-logo.jpg`);
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].contentType, "image/jpeg");
    // O buffer reenviado precisa ser uma imagem JPEG válida e diferente da original (logo colada) —
    // JPEG (não PNG) porque a peça é fotográfica e sem perdas deixava a Revisão lenta pra carregar.
    const uploadedMeta = await sharp(putCalls[0].body).metadata();
    assert.equal(uploadedMeta.format, "jpeg");
    assert.notEqual(Buffer.compare(putCalls[0].body, baseImagePng), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
