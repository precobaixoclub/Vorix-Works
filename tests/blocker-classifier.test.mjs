import test from "node:test";
import assert from "node:assert/strict";
import { classifyBlocker, readPendingNarrations, readPendingVisualAssets } from "../dist/application/orchestration/autonomous/blocker-classifier.js";

function report({ state = "WAITING_ASSISTED_GENERATION", output, message = "pausado", stepId = "step-1", stepName = "Rafa — Renderização", skillId = "rafa-video-rendering" }) {
  return {
    executionId: "exec-test",
    state,
    waitingForStepId: stepId,
    message,
    steps: [
      { stepId, name: stepName, skillId, state: "WAITING_ASSISTED_GENERATION", response: output === undefined ? undefined : { status: "needs_assisted_generation", output } },
    ],
  };
}

test("classifyBlocker: fora do escopo (WAITING_HUMAN_APPROVAL / WAITING_DEVELOPER_AI / COMPLETED) devolve undefined", () => {
  assert.equal(classifyBlocker(report({ state: "WAITING_HUMAN_APPROVAL", output: {} })), undefined);
  assert.equal(classifyBlocker(report({ state: "WAITING_DEVELOPER_AI", output: {} })), undefined);
  assert.equal(classifyBlocker(report({ state: "COMPLETED", output: {} })), undefined);
});

test("classifyBlocker: sem step correspondente a waitingForStepId devolve undefined", () => {
  const r = report({ output: {} });
  r.waitingForStepId = "step-inexistente";
  assert.equal(classifyBlocker(r), undefined);
});

test("classifyBlocker: sem output no step -> unknown", () => {
  const blocker = classifyBlocker(report({ output: undefined }));
  assert.equal(blocker.kind, "unknown");
});

test("classifyBlocker: video_coverage_low tem prioridade mais alta", () => {
  const blocker = classifyBlocker(report({
    output: {
      diversitySummary: { videoRatio: 0.1, minVideoRatio: 0.3, distinctPhysicalFiles: 6, minDistinctPhysicalFiles: 5, totalShots: 8 },
      productionReadinessScore: { overall: 0.55, productCoverage: 0.1, sceneDiversity: 0.1 },
    },
  }));
  assert.equal(blocker.kind, "video_coverage_low");
  assert.equal(blocker.metrics.videoRatio, 0.1);
  assert.equal(blocker.metrics.minVideoRatio, 0.3);
});

test("classifyBlocker: product_coverage_low quando videoRatio já está OK", () => {
  const blocker = classifyBlocker(report({
    output: {
      diversitySummary: { videoRatio: 0.5, minVideoRatio: 0.3, distinctPhysicalFiles: 6, minDistinctPhysicalFiles: 5 },
      productionReadinessScore: { overall: 0.6, productCoverage: 0.2, sceneDiversity: 0.9 },
    },
  }));
  assert.equal(blocker.kind, "product_coverage_low");
  assert.equal(blocker.metrics.productCoverage, 0.2);
});

test("classifyBlocker: asset_diversity_low quando coverage de vídeo/produto já está OK", () => {
  const blocker = classifyBlocker(report({
    output: {
      diversitySummary: { videoRatio: 0.5, minVideoRatio: 0.3, distinctPhysicalFiles: 2, minDistinctPhysicalFiles: 5, totalShots: 8 },
      productionReadinessScore: { overall: 0.6, productCoverage: 0.9, sceneDiversity: 0.9 },
    },
  }));
  assert.equal(blocker.kind, "asset_diversity_low");
  assert.equal(blocker.metrics.distinctPhysicalFiles, 2);
});

test("classifyBlocker: scene_diversity_low quando as coberturas anteriores já estão OK", () => {
  const blocker = classifyBlocker(report({
    output: {
      diversitySummary: { videoRatio: 0.5, minVideoRatio: 0.3, distinctPhysicalFiles: 6, minDistinctPhysicalFiles: 5 },
      productionReadinessScore: { overall: 0.6, productCoverage: 0.9, sceneDiversity: 0.1 },
    },
  }));
  assert.equal(blocker.kind, "scene_diversity_low");
});

test("classifyBlocker: narration_invalid quando há pendingNarrations", () => {
  const blocker = classifyBlocker(report({
    stepId: "step-2", stepName: "Nora — Narração", skillId: "nora-video-narration",
    output: { pendingNarrations: [{ fileName: "narration.wav", expectedRelativePath: "audio/narration.wav" }] },
  }));
  assert.equal(blocker.kind, "narration_invalid");
  assert.equal(blocker.metrics.pendingCount, 1);
});

test("classifyBlocker: mockup_missing quando todos os assets pendentes são mockup/graphic/screenshot", () => {
  const blocker = classifyBlocker(report({
    output: { pendingVisualAssets: [{ requiredKind: "mockup" }, { requiredKind: "screenshot" }] },
  }));
  assert.equal(blocker.kind, "mockup_missing");
});

test("classifyBlocker: visual_asset_missing quando há pelo menos um asset pendente que não é mockup-like", () => {
  const blocker = classifyBlocker(report({
    output: { pendingImages: [{ requiredKind: "photo" }] },
  }));
  assert.equal(blocker.kind, "visual_asset_missing");
});

test("classifyBlocker: instruction do output vira a mensagem do bloqueio quando presente", () => {
  const blocker = classifyBlocker(report({ message: "mensagem genérica do report", output: { instruction: "instrução específica da Skill" } }));
  assert.equal(blocker.message, "instrução específica da Skill");
});

test("readPendingNarrations / readPendingVisualAssets: leem os campos certos sem lançar em outputs vazios", () => {
  const empty = report({ output: {} });
  assert.deepEqual(readPendingNarrations(empty).narrations, []);
  assert.deepEqual(readPendingVisualAssets(empty), []);

  const withData = report({ output: { pendingNarrations: [{ fileName: "a.wav" }], narrationScript: "roteiro completo", pendingImages: [{ requiredKind: "photo" }], pendingVideos: [{ requiredKind: "video" }] } });
  const narrations = readPendingNarrations(withData);
  assert.equal(narrations.narrations.length, 1);
  assert.equal(narrations.narrationScript, "roteiro completo");
  assert.equal(readPendingVisualAssets(withData).length, 2);
});
