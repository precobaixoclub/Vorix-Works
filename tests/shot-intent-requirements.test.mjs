import test from "node:test";
import assert from "node:assert/strict";
import { deriveShotIntentRequirements, rankCandidatesByShotIntent } from "../dist/infrastructure/footage-acquisition/shot-intent-requirements.js";

function baseIntent(overrides = {}) {
  return {
    sceneOrder: 1,
    narrativeGoal: "mostrar facilidade",
    mainAction: "casal usando celular",
    device: "none",
    deviceOrientation: "any",
    screenVisibleRequired: false,
    minDurationSeconds: 1,
    assetType: "video",
    compositingRequired: false,
    ...overrides,
  };
}

function hit(overrides = {}) {
  return {
    externalId: "1",
    previewUrl: "https://example.com/preview.jpg",
    downloadUrl: "https://example.com/video.mp4",
    author: "Author A",
    originPageUrl: "https://example.com/video/1",
    license: { name: "test", allowsCommercialUse: true, requiresAttribution: false },
    width: 1080,
    height: 1920,
    durationSeconds: 5,
    ...overrides,
  };
}

test("deriveShotIntentRequirements nunca exige screenVisible/frontScreen/interaction quando o Shot não pede dispositivo", () => {
  const requirements = deriveShotIntentRequirements(baseIntent({ device: "none" }));
  assert.ok(!requirements.mustHave.includes("screenVisible"));
  assert.ok(!requirements.mustHave.includes("frontScreen"));
  assert.ok(!requirements.mustHave.includes("interaction"));
});

test("deriveShotIntentRequirements exige screenVisible/frontScreen/interaction quando o Shot pede tela visível", () => {
  const requirements = deriveShotIntentRequirements(baseIntent({ device: "phone", screenVisibleRequired: true, protagonist: "casal" }));
  assert.ok(requirements.mustHave.includes("device"));
  assert.ok(requirements.mustHave.includes("screenVisible"));
  assert.ok(requirements.mustHave.includes("frontScreen"));
  assert.ok(requirements.mustHave.includes("interaction"));
  assert.ok(requirements.mustHave.includes("human"));
});

test("deriveShotIntentRequirements inclui niceToHave 'wedding' só quando o objetivo narrativo menciona casamento", () => {
  const withWedding = deriveShotIntentRequirements(baseIntent({ narrativeGoal: "cena de casamento" }));
  const withoutWedding = deriveShotIntentRequirements(baseIntent({ narrativeGoal: "cena de escritório" }));
  assert.ok(withWedding.niceToHave.includes("wedding"));
  assert.ok(!withoutWedding.niceToHave.includes("wedding"));
});

test("rankCandidatesByShotIntent prioriza resolução/orientação/duração/licença ANTES de qualquer sinal de tema", () => {
  const intent = baseIntent({ device: "phone", screenVisibleRequired: true });
  const strong = hit({ externalId: "strong", width: 1080, height: 1920, durationSeconds: 5, license: { name: "x", allowsCommercialUse: true, requiresAttribution: false } });
  const weak = hit({ externalId: "weak", width: 320, height: 240, durationSeconds: 0.2, license: { name: "x", allowsCommercialUse: false, requiresAttribution: false } });
  const ranked = rankCandidatesByShotIntent([weak, strong], intent, new Set());
  assert.equal(ranked[0].hit.externalId, "strong");
});

test("rankCandidatesByShotIntent favorece autores ainda não usados nesta execução (diversidade)", () => {
  const intent = baseIntent();
  const usedAuthorHit = hit({ externalId: "used", author: "Used Author" });
  const newAuthorHit = hit({ externalId: "new", author: "New Author" });
  const ranked = rankCandidatesByShotIntent([usedAuthorHit, newAuthorHit], intent, new Set(["Used Author"]));
  assert.equal(ranked[0].hit.externalId, "new");
});

test("rankCandidatesByShotIntent nunca lança para candidatos sem author/license completos", () => {
  const intent = baseIntent();
  const incomplete = hit({ author: undefined });
  assert.doesNotThrow(() => rankCandidatesByShotIntent([incomplete], intent, new Set()));
});

test("scoreBreakdown de rankCandidatesByShotIntent expõe os componentes individuais (transparência para --footage-search-report)", () => {
  const intent = baseIntent({ device: "phone", screenVisibleRequired: true });
  const [scored] = rankCandidatesByShotIntent([hit()], intent, new Set());
  assert.ok("orientationFit" in scored.breakdown);
  assert.ok("resolutionFit" in scored.breakdown);
  assert.ok("durationFit" in scored.breakdown);
  assert.ok("licenseFit" in scored.breakdown);
  assert.ok("diversityFit" in scored.breakdown);
  assert.equal(scored.score, Object.values(scored.breakdown).reduce((sum, value) => sum + value, 0));
});

// -------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — Aprendizado de Rejeições integrado ao ranking: sem
// histórico é comportamento 100% preservado (parâmetro opcional); com histórico, candidatos
// semelhantes a rejeições conhecidas perdem pontuação.
// -------------------------------------------------------------------------------------------

test("rankCandidatesByShotIntent sem histórico de rejeição (parâmetro omitido) é idêntico ao comportamento anterior a esta sprint", () => {
  const intent = baseIntent();
  const candidateA = hit({ externalId: "a", author: "Author A" });
  const candidateB = hit({ externalId: "b", author: "Author B" });
  const withoutHistory = rankCandidatesByShotIntent([candidateA, candidateB], intent, new Set());
  const withEmptyHistory = rankCandidatesByShotIntent([candidateA, candidateB], intent, new Set(), []);
  assert.deepEqual(withoutHistory.map((entry) => entry.score), withEmptyHistory.map((entry) => entry.score));
});

test("rankCandidatesByShotIntent penaliza um candidato do MESMO AUTOR de uma rejeição conhecida (visual_false_positive), rebaixando sua posição no ranking", () => {
  const intent = baseIntent();
  const knownBadAuthor = hit({ externalId: "bad", author: "Anna Tarazevich", downloadUrl: "https://example.com/x.mp4" });
  const cleanAuthor = hit({ externalId: "clean", author: "Outro Autor", downloadUrl: "https://example.com/y.mp4" });
  const history = [{ author: "Anna Tarazevich", originPageUrl: "https://www.pexels.com/video/woman-using-smartphone-8066973/", rejectionPattern: "visual_false_positive" }];

  const ranked = rankCandidatesByShotIntent([knownBadAuthor, cleanAuthor], intent, new Set(), history);
  const badEntry = ranked.find((entry) => entry.hit.externalId === "bad");
  const cleanEntry = ranked.find((entry) => entry.hit.externalId === "clean");

  assert.ok(badEntry.breakdown.rejectionHistoryPenalty < 0);
  assert.equal(cleanEntry.breakdown.rejectionHistoryPenalty, 0);
  assert.ok(badEntry.score < cleanEntry.score);
});

test("rankCandidatesByShotIntent penaliza um candidato com título semanticamente parecido a uma rejeição conhecida (mesmo assunto, autor diferente)", () => {
  const intent = baseIntent();
  const similarTopic = hit({
    externalId: "similar", author: "Outro Fotógrafo",
    originPageUrl: "https://www.pexels.com/video/children-playing-trick-or-treating-parade-777/",
  });
  const history = [{ author: "Autor Original", originPageUrl: "https://www.pexels.com/video/children-out-in-the-street-trick-or-treating-5856446/", rejectionPattern: "semantic_false_positive" }];

  const ranked = rankCandidatesByShotIntent([similarTopic], intent, new Set(), history);
  assert.ok(ranked[0].breakdown.rejectionHistoryPenalty < 0);
});
