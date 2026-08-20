import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionHandlerResolver } from "../dist/infrastructure/execution/build-execution-handler-resolver.js";

/**
 * Migração "GPT como motor criativo único" (PR 6/9) — prova de exclusão mútua no ponto real de
 * composição (`buildExecutionHandlerResolver`), não só nos tipos. Nenhum teste existente no
 * repositório chamava esta função diretamente antes desta migração (achado durante o PR 6) — os
 * testes de handler (`execution-real-handlers.test.mjs`) constroem os handlers reais
 * manualmente, sem passar pelo portão de gating que este arquivo implementa.
 */

const BASE_FLAGS = {
  realExecutionEnabled: true,
  realExecutionResearchEnabled: false,
  realPlanningEnabled: true,
  realCopyEnabled: true,
  realVisualEnabled: true,
  realDistributionEnabled: false,
};

function fakeRuntimeRepository() {
  return { getById: async () => undefined };
}
function fakePreparedCommandRepository() {
  return { getById: async () => undefined };
}
function fakeGptCreativeEngineDeps() {
  return {
    creativeBrain: { request: async () => ({ status: "failed" }) },
    objectStorage: { put: async () => ({ url: "https://x/fake.jpg" }) },
    compositeLogo: async ({ imageBuffer }) => imageBuffer,
    compositeScreenshot: async ({ imageBuffer }) => imageBuffer,
    renderTextZones: async ({ baseImageBuffer }) => ({ buffer: baseImageBuffer, renderedZones: [] }),
    readImageDimensions: async () => ({ width: 1080, height: 1350 }),
  };
}

async function findCandidateIds(resolver, capability, taskType, featureFlags) {
  const resolution = resolver.resolve({ capability, taskType, executionMode: "real", featureFlags });
  return resolution.ok ? [resolution.descriptor.id] : [];
}

test("buildExecutionHandlerResolver: legacyCreativeEngineEnabled=true registra os handlers legados (João/Maria/visual-pipeline/quality-gate) e NÃO registra os do motor GPT", async () => {
  const featureFlags = { ...BASE_FLAGS, creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: true };
  const resolver = await buildExecutionHandlerResolver({
    featureFlags,
    runtimeRepository: fakeRuntimeRepository(),
    preparedCommandRepository: fakePreparedCommandRepository(),
  });

  assert.deepEqual(await findCandidateIds(resolver, "strategic_planning", "campaign_structure", featureFlags), ["helena-skill-planning-handler"]);
  assert.deepEqual(await findCandidateIds(resolver, "copywriting", "copy_generation", featureFlags), ["helena-skill-copy-handler"]);
  assert.deepEqual(await findCandidateIds(resolver, "visual_design", "visual_generation", featureFlags), ["helena-skill-visual-pipeline-handler"]);
  assert.deepEqual(await findCandidateIds(resolver, "human_review", "quality_review", featureFlags), ["helena-skill-quality-gate-handler"]);
});

test("buildExecutionHandlerResolver: creativeEngineGptEnabled=true registra SÓ os handlers do motor GPT para visual_design/human_review — NEGATIVO: strategic_planning/copywriting não resolvem nenhum handler", async () => {
  const featureFlags = { ...BASE_FLAGS, creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: false };
  const resolver = await buildExecutionHandlerResolver({
    featureFlags,
    runtimeRepository: fakeRuntimeRepository(),
    preparedCommandRepository: fakePreparedCommandRepository(),
    gptCreativeEngine: fakeGptCreativeEngineDeps(),
  });

  assert.deepEqual(await findCandidateIds(resolver, "visual_design", "visual_generation", featureFlags), ["gpt-creative-engine-visual-handler"]);
  assert.deepEqual(await findCandidateIds(resolver, "human_review", "quality_review", featureFlags), ["gpt-creative-engine-quality-handler"]);

  // Prova estrutural: com o motor GPT ativo, NENHUM handler resolve para as capabilities que só
  // o motor legado usa — João/Maria nunca são agendáveis nesta configuração.
  assert.deepEqual(await findCandidateIds(resolver, "strategic_planning", "campaign_structure", featureFlags), []);
  assert.deepEqual(await findCandidateIds(resolver, "copywriting", "copy_generation", featureFlags), []);
});

test("buildExecutionHandlerResolver: com o motor GPT ativo, os handlers legados de visual_design/human_review NUNCA aparecem entre os candidatos (nunca os dois registrados ao mesmo tempo)", async () => {
  const featureFlags = { ...BASE_FLAGS, creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: false };
  const resolver = await buildExecutionHandlerResolver({
    featureFlags,
    runtimeRepository: fakeRuntimeRepository(),
    preparedCommandRepository: fakePreparedCommandRepository(),
    gptCreativeEngine: fakeGptCreativeEngineDeps(),
  });

  const visualResolution = resolver.resolve({ capability: "visual_design", taskType: "visual_generation", executionMode: "real", featureFlags });
  assert.equal(visualResolution.ok, true);
  assert.notEqual(visualResolution.descriptor.id, "helena-skill-visual-pipeline-handler");

  const reviewResolution = resolver.resolve({ capability: "human_review", taskType: "quality_review", executionMode: "real", featureFlags });
  assert.equal(reviewResolution.ok, true);
  assert.notEqual(reviewResolution.descriptor.id, "helena-skill-quality-gate-handler");
});

test("buildExecutionHandlerResolver: com o motor legado ativo, os handlers do motor GPT NUNCA aparecem entre os candidatos", async () => {
  const featureFlags = { ...BASE_FLAGS, creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: true };
  const resolver = await buildExecutionHandlerResolver({
    featureFlags,
    runtimeRepository: fakeRuntimeRepository(),
    preparedCommandRepository: fakePreparedCommandRepository(),
  });

  const visualResolution = resolver.resolve({ capability: "visual_design", taskType: "visual_generation", executionMode: "real", featureFlags });
  assert.equal(visualResolution.ok, true);
  assert.notEqual(visualResolution.descriptor.id, "gpt-creative-engine-visual-handler");
});

test("buildExecutionHandlerResolver: creativeEngineGptEnabled=true SEM gptCreativeEngine configurado falha alto (GPT_CREATIVE_ENGINE_DEPS_MISSING) — nunca cai silenciosamente pro motor legado", async () => {
  const featureFlags = { ...BASE_FLAGS, creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: false };
  await assert.rejects(
    () => buildExecutionHandlerResolver({
      featureFlags,
      runtimeRepository: fakeRuntimeRepository(),
      preparedCommandRepository: fakePreparedCommandRepository(),
      // gptCreativeEngine ausente de propósito
    }),
    /GPT_CREATIVE_ENGINE_DEPS_MISSING/,
  );
});

test("buildExecutionHandlerResolver: content_brief e research/distribution continuam registrados independente do motor criativo escolhido (nunca afetados pela migração)", async () => {
  for (const legacyOrGpt of [
    { creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: true },
    { creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: false },
  ]) {
    const featureFlags = { ...BASE_FLAGS, realExecutionResearchEnabled: true, realDistributionEnabled: true, ...legacyOrGpt };
    const resolver = await buildExecutionHandlerResolver({
      featureFlags,
      runtimeRepository: fakeRuntimeRepository(),
      preparedCommandRepository: fakePreparedCommandRepository(),
      gptCreativeEngine: legacyOrGpt.creativeEngineGptEnabled ? fakeGptCreativeEngineDeps() : undefined,
    });

    assert.deepEqual(await findCandidateIds(resolver, "content_brief", "content_brief", featureFlags), ["content-brief-deterministic-handler"]);
    assert.deepEqual(await findCandidateIds(resolver, "editorial_research", "research", featureFlags), ["helena-skill-research-handler"]);
    assert.deepEqual(await findCandidateIds(resolver, "distribution", "publication", featureFlags), ["helena-skill-distribution-handler"]);
  }
});
