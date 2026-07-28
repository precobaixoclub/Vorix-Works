import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyAuthenticity, isOfficial } from "../dist/shared/utils/asset-authenticity-policy/authenticity-classification.js";
import { deriveShotAuthenticityRole, appliesHardAuthenticityConstraint } from "../dist/shared/utils/asset-authenticity-policy/shot-role.js";
import { scoreAssetLayered, scoreTotalLayered, weightsForRole } from "../dist/shared/utils/asset-authenticity-policy/layered-scoring.js";
import { resolveWithAuthenticityPolicy } from "../dist/shared/utils/asset-authenticity-policy/hard-authenticity-constraint.js";
import { classifyComposite } from "../dist/shared/utils/asset-authenticity-policy/composite-provenance.js";
import { checkResolutionStaleness } from "../dist/shared/utils/asset-authenticity-policy/resolution-metadata.js";
import { RANKING_POLICY_VERSION } from "../dist/shared/utils/asset-authenticity-policy/ranking-policy-version.js";

// ---------------------------------------------------------------------------------------------
// fixtures — testes 1/2/3/10/11/12 constroem `ScoredCandidate` diretamente (score explícito) para
// testar `resolveWithAuthenticityPolicy` isoladamente, sem depender da calibração exata dos pesos
// de `scoreTotalLayered` (essa calibração é testada separadamente pelos testes 4/5/9).
// ---------------------------------------------------------------------------------------------

function candidate(assetId, authenticityClass, score, overrides = {}) {
  return {
    asset: { id: assetId, provider: "test", origin: "local_library", visualValidationStage: authenticityClass.startsWith("official") ? "compositing_ready" : undefined, ...overrides },
    authenticityClass,
    score,
    breakdown: { eligibility: 100, authenticity: 100, requirementCoverage: 100, visualQuality: 100, semanticMatch: 100, freshness: 100, creativeFitness: 100, ...(overrides.breakdown ?? {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// 1. oficial validado vence mockup fictício equivalente (via Hard Authenticity Constraint)
// ---------------------------------------------------------------------------------------------
test("1. oficial validado vence mockup fictício equivalente, mesmo quando o fictício pontuou mais", () => {
  const fictional = candidate("fictional-1", "synthetic_unverified", 90);
  const official = candidate("official-1", "official_original", 80, { breakdown: { requirementCoverage: 80, eligibility: 90 } });
  const resolution = resolveWithAuthenticityPolicy({
    scoredDescending: [fictional, official], role: "product", minimumScore: 62, sceneOrder: 1, shotId: "s1",
  });
  assert.equal(resolution.winner.asset.id, "official-1");
  assert.ok(resolution.hardConstraintApplied);
  assert.equal(resolution.conflict.resolvedInFavorOf, "official");
});

// ---------------------------------------------------------------------------------------------
// 2. oficial incompatível (baixa cobertura de requisito) não vence mockup compatível
// ---------------------------------------------------------------------------------------------
test("2. oficial com cobertura de requisito insuficiente não é promovido pela Hard Authenticity Constraint", () => {
  const fictional = candidate("fictional-1", "synthetic_unverified", 90);
  // eligibility/requirementCoverage abaixo do piso de adequação (seção 5: "o oficial tiver qualidade suficiente").
  const incompatibleOfficial = candidate("official-1", "official_original", 65, { breakdown: { requirementCoverage: 30, eligibility: 100 } });
  const resolution = resolveWithAuthenticityPolicy({
    scoredDescending: [fictional, incompatibleOfficial], role: "product", minimumScore: 62, sceneOrder: 1,
  });
  assert.equal(resolution.winner.asset.id, "fictional-1");
  assert.equal(resolution.hardConstraintApplied, undefined);
  assert.equal(resolution.conflict.resolvedInFavorOf, "synthetic");
});

// ---------------------------------------------------------------------------------------------
// 3. oficial reprovado não vence candidato aprovado
// ---------------------------------------------------------------------------------------------
test("3. oficial reprovado (visualValidationStage ausente = nunca validado) não é promovido", () => {
  const approvedFictional = candidate("fictional-1", "synthetic_approved", 85);
  const rejectedOfficial = candidate("official-1", "official_original", 80, { visualValidationStage: undefined });
  const resolution = resolveWithAuthenticityPolicy({
    scoredDescending: [approvedFictional, rejectedOfficial], role: "product", minimumScore: 62, sceneOrder: 1,
  });
  assert.equal(resolution.winner.asset.id, "fictional-1");
});

// ---------------------------------------------------------------------------------------------
// 4. stock vence asset oficial em Shot emocional quando tiver melhor adequação (pipeline real de scoring)
// ---------------------------------------------------------------------------------------------
test("4. stock de qualidade vence asset oficial em Shot humano/emocional (scoring real, sem Hard Constraint)", () => {
  const q = { executionId: "e", sceneOrder: 1, sceneName: "c", theme: "casal", emotion: "alegria", narrativeFunction: "contexto", desiredKind: "photo", requiredTags: ["pessoa", "contexto-humano"], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16", humanRequirement: { subject: "casal", strict: false } };
  const stockPhoto = { id: "stock-1", origin: "free_provider", kind: "photo", tags: ["pessoa", "contexto-humano", "casal"], width: 3840, height: 2160, license: { name: "x", allowsCommercialUse: true, requiresAttribution: false } };
  const weakOfficial = { id: "official-weak", origin: "local_library", kind: "photo", tags: ["pessoa"], width: 640, height: 480, ingestionSource: "campaign_intelligence", capabilities: ["human_context"], license: { name: "x", allowsCommercialUse: true, requiresAttribution: false } };

  const role = deriveShotAuthenticityRole(q);
  assert.equal(role, "human_emotional");
  assert.equal(appliesHardAuthenticityConstraint(role), false);

  const weights = weightsForRole(role);
  const stockScore = scoreTotalLayered(scoreAssetLayered(stockPhoto, q, classifyAuthenticity({ ...stockPhoto })), weights);
  const officialScore = scoreTotalLayered(scoreAssetLayered(weakOfficial, q, classifyAuthenticity({ ...weakOfficial })), weights);
  assert.ok(stockScore > officialScore, `esperado stock (${stockScore}) > official fraco (${officialScore})`);
});

// ---------------------------------------------------------------------------------------------
// 5. synthetic_approved pode ser usado quando não existe oficial suficiente
// ---------------------------------------------------------------------------------------------
test("5. synthetic_approved é aceito normalmente quando não há oficial concorrente", () => {
  const approvedSynthetic = candidate("fictional-1", "synthetic_approved", 75);
  const resolution = resolveWithAuthenticityPolicy({ scoredDescending: [approvedSynthetic], role: "product", minimumScore: 62, sceneOrder: 1 });
  assert.equal(resolution.winner.asset.id, "fictional-1");
  assert.equal(resolution.conflict, undefined);
});

// ---------------------------------------------------------------------------------------------
// 6. synthetic_unverified não se apresenta como oficial
// ---------------------------------------------------------------------------------------------
test("6. synthetic_unverified nunca é classificado como oficial, mesmo armazenado localmente", () => {
  const localMockup = { origin: "local_library", kind: "mockup", tags: ["mockup", "interface", "produto-real"] };
  const authenticityClass = classifyAuthenticity(localMockup);
  assert.equal(authenticityClass, "synthetic_unverified");
  assert.equal(isOfficial(authenticityClass), false);
});

// ---------------------------------------------------------------------------------------------
// 7. composite oficial preserva proveniência
// ---------------------------------------------------------------------------------------------
test("7. composite construído sobre fontes 100% oficiais recebe official_derived", () => {
  assert.equal(classifyComposite({ sourceFootage: "official_original", screen: "official_original" }), "official_derived");
});

// ---------------------------------------------------------------------------------------------
// 8. composite sobre mockup fictício não vira official_derived
// ---------------------------------------------------------------------------------------------
test("8. composite construído sobre tela fictícia nunca vira official_derived", () => {
  assert.equal(classifyComposite({ sourceFootage: "official_original", screen: "synthetic_unverified" }), "synthetic_unverified");
});

// ---------------------------------------------------------------------------------------------
// 9. ranking independe do provider técnico
// ---------------------------------------------------------------------------------------------
test("9. score não depende do provider/origin — só dos metadados canônicos do asset", () => {
  const q = { executionId: "e", sceneOrder: 1, sceneName: "c", theme: "rsvp", emotion: "confianca", narrativeFunction: "prova", desiredKind: "mockup", requiredTags: ["rsvp"], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16" };
  const base = { id: "x", kind: "video", tags: ["rsvp"], width: 1080, height: 1920, ingestionSource: "campaign_intelligence", capabilities: ["product_screen"], approvalStatus: "approved", screenVisible: true, compositingReady: true, humanInteractionScore: 0.5, visualValidationStage: "compositing_ready", license: { name: "x", allowsCommercialUse: true, requiresAttribution: false } };
  const fromCatalog = { ...base, provider: "media-catalog", origin: "local_library" };
  const fromLibrary = { ...base, provider: "local-visual-library", origin: "free_provider" };
  const classA = classifyAuthenticity(fromCatalog);
  const classB = classifyAuthenticity(fromLibrary);
  assert.equal(classA, classB);
  const breakdownA = scoreAssetLayered(fromCatalog, q, classA);
  const breakdownB = scoreAssetLayered(fromLibrary, q, classB);
  assert.deepEqual(breakdownA, breakdownB);
});

// ---------------------------------------------------------------------------------------------
// 10. tags não dominam autenticidade em Shot de produto
// ---------------------------------------------------------------------------------------------
test("10. vantagem de Semantic Match de um mockup fictício não supera a Hard Authenticity Constraint", () => {
  // Fictício pontua MAIS no total (ex.: semanticMatch perfeito) mas continua synthetic_unverified.
  const fictionalWithPerfectTags = candidate("fictional-1", "synthetic_unverified", 95);
  const official = candidate("official-1", "official_original", 78, { breakdown: { requirementCoverage: 75, eligibility: 90 } });
  const resolution = resolveWithAuthenticityPolicy({
    scoredDescending: [fictionalWithPerfectTags, official], role: "product", minimumScore: 62, sceneOrder: 1,
  });
  assert.equal(resolution.winner.asset.id, "official-1");
});

// ---------------------------------------------------------------------------------------------
// 11. relatório explica a escolha
// ---------------------------------------------------------------------------------------------
test("11. a resolução produz um motivo humano-legível quando aplica a Hard Authenticity Constraint", () => {
  const fictional = candidate("fictional-1", "synthetic_unverified", 90);
  const official = candidate("official-1", "official_original", 80, { breakdown: { requirementCoverage: 80, eligibility: 90 } });
  const resolution = resolveWithAuthenticityPolicy({ scoredDescending: [fictional, official], role: "product", minimumScore: 62, sceneOrder: 1, shotId: "s1-shot-1" });
  assert.ok(resolution.hardConstraintApplied.reason.length > 0);
  assert.ok(resolution.conflict.reason.length > 0);
  assert.equal(resolution.conflict.shotId, "s1-shot-1");
});

// ---------------------------------------------------------------------------------------------
// 12. conflito de autenticidade é detectado
// ---------------------------------------------------------------------------------------------
test("12. AUTHENTICITY_RANKING_CONFLICT é emitido sempre que um não-oficial pontua mais que um oficial elegível", () => {
  const fictional = candidate("fictional-1", "synthetic_unverified", 90);
  const official = candidate("official-1", "official_original", 80, { breakdown: { requirementCoverage: 80, eligibility: 90 } });
  const resolution = resolveWithAuthenticityPolicy({ scoredDescending: [fictional, official], role: "product", minimumScore: 62, sceneOrder: 1 });
  assert.equal(resolution.conflict.type, "AUTHENTICITY_RANKING_CONFLICT");
  assert.equal(resolution.conflict.officialAssetId, "official-1");
  assert.equal(resolution.conflict.syntheticAssetId, "fictional-1");
});

test("12b. nenhum conflito é emitido quando o oficial já vence por score puro", () => {
  const official = candidate("official-1", "official_original", 95);
  const fictional = candidate("fictional-1", "synthetic_unverified", 60);
  const resolution = resolveWithAuthenticityPolicy({ scoredDescending: [official, fictional], role: "product", minimumScore: 62, sceneOrder: 1 });
  assert.equal(resolution.conflict, undefined);
});

// ---------------------------------------------------------------------------------------------
// 13. resolução antiga é marcada como stale
// ---------------------------------------------------------------------------------------------
test("13. checkResolutionStaleness detecta ASSET_RESOLUTION_STALE quando o catálogo muda", () => {
  const persisted = { catalogHash: "hash-a", rankingPolicyVersion: RANKING_POLICY_VERSION, validatorVersion: "v1", resolvedAt: "2026-01-01" };
  const staleResult = checkResolutionStaleness(persisted, { catalogHash: "hash-b", rankingPolicyVersion: RANKING_POLICY_VERSION, validatorVersion: "v1" });
  assert.equal(staleResult.stale, true);
  assert.ok(staleResult.reasons[0].includes("Catálogo mudou"));

  const freshResult = checkResolutionStaleness(persisted, { catalogHash: "hash-a", rankingPolicyVersion: RANKING_POLICY_VERSION, validatorVersion: "v1" });
  assert.equal(freshResult.stale, false);
});

// ---------------------------------------------------------------------------------------------
// 14/15. --rerun-asset-resolution: escopo (reexecuta só quando pausado em Renderização de vídeo;
// preserva o resto da execução por construção, já que só toca a etapa pausada) — testado via a
// guarda real da função, com um arquivo de execução persistida real, isolado por ZUNO_DATA_DIR.
// ---------------------------------------------------------------------------------------------
test("14/15. --rerun-asset-resolution só reexecuta quando a execução está pausada em Renderização de vídeo (Rafa) — nunca um alias de --continue", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "zuno-rerun-test-"));
  const originalDataDir = process.env.ZUNO_DATA_DIR;
  process.env.ZUNO_DATA_DIR = dataDir;
  try {
    const executionsDir = join(dataDir, "executions");
    await mkdir(executionsDir, { recursive: true });

    const wrongStateExecution = {
      executionId: "exec-wrong-state", planId: "p1", clientId: "c1", state: "WAITING_DEVELOPER_AI",
      startedAt: "2026-01-01", waitingForStepId: "step-0003", message: "", steps: [
        { stepId: "step-0003", order: 2, name: "Estratégia de marketing", type: "skill", skillCapability: "strategy", state: "WAITING" },
      ], artifactSummary: {}, planSnapshot: {}, locale: "pt-BR", dryRun: false, mode: "LOCAL_PRODUCTION", correlationId: "c",
    };
    await writeFile(join(executionsDir, "exec-wrong-state.json"), JSON.stringify(wrongStateExecution), "utf8");

    const { rerunAssetResolution } = await import("../dist/interfaces/cli/run-command.js");
    await assert.rejects(() => rerunAssetResolution("exec-wrong-state"), /só funciona quando a execução está pausada/);

    const wrongStepExecution = {
      ...wrongStateExecution, executionId: "exec-wrong-step", state: "WAITING_ASSISTED_GENERATION", waitingForStepId: "step-0007",
      steps: [{ stepId: "step-0007", order: 6, name: "Criação da copy", type: "skill", skillCapability: "copywriting", state: "WAITING" }],
    };
    await writeFile(join(executionsDir, "exec-wrong-step.json"), JSON.stringify(wrongStepExecution), "utf8");
    await assert.rejects(() => rerunAssetResolution("exec-wrong-step"), /só se aplica à etapa de renderização de vídeo/);
  } finally {
    if (originalDataDir === undefined) delete process.env.ZUNO_DATA_DIR; else process.env.ZUNO_DATA_DIR = originalDataDir;
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});
