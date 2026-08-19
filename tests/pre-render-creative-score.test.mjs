import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, selectWinningCandidate } from "../dist/shared/utils/pre-render-creative-score.js";

function zone(type, priority, position) {
  return { type, priority, position: { xPct: 6, yPct: 6, widthPct: 40, heightPct: 14, ...position } };
}

function candidate(overrides = {}) {
  return {
    id: "A",
    layoutFamily: "flash_sale",
    familyFitScore: 8,
    plan: {
      objective: "promocao_oferta",
      creativeType: "oferta",
      price: "R$ 39,99",
      discount: "50%",
      urgency: undefined,
      benefits: [],
      trustSignals: [],
      specifications: [],
      cta: "Aproveite agora",
      brandElements: [],
      visualDensity: "performance",
      layoutFamily: "flash_sale",
      informationPriority: ["price", "discount", "cta"],
      commercialFactResolutions: [],
      heroProductAssetUrl: undefined,
      ...overrides.plan,
    },
    adLayoutSpec: {
      format: "4:5",
      aspectRatio: "4:5",
      layoutFamily: "flash_sale",
      density: "performance",
      zones: [zone("price", 1), zone("discount", 1), zone("cta", 2)],
      ...overrides.adLayoutSpec,
    },
    familyFitScore: overrides.familyFitScore ?? 8,
    id: overrides.id ?? "A",
  };
}

function fullCandidate(overrides = {}) {
  const base = candidate();
  return { ...base, ...overrides, plan: { ...base.plan, ...(overrides.plan ?? {}) }, adLayoutSpec: { ...base.adLayoutSpec, ...(overrides.adLayoutSpec ?? {}) } };
}

const context = { aspectRatio: "4:5", preferredDensity: "performance" };

test("scoreCandidates: candidato bem formado (fatos fortes todos presentes, prioridade 1) recebe score alto", () => {
  const [entry] = scoreCandidates([fullCandidate()], context);
  assert.ok(entry.score >= 80, `score deveria ser alto, recebeu ${entry.score}`);
  assert.equal(entry.penalties.length, 0);
});

test("scoreCandidates: fato comercial forte disponível mas cortado do layout gera penalidade e commercialStrength reduzido", () => {
  const withoutDiscount = fullCandidate({ adLayoutSpec: { zones: [zone("price", 1), zone("cta", 2)] } });
  const [entry] = scoreCandidates([withoutDiscount], context);
  assert.ok(entry.dimensions.commercialStrength < 10);
  assert.ok(entry.penalties.some((p) => p.includes("fato(s) comercial")));
});

test("scoreCandidates: argumento mais forte (preço) sem prioridade 1 penaliza informationHierarchy", () => {
  const priceNotFirst = fullCandidate({ adLayoutSpec: { zones: [zone("price", 2), zone("discount", 1), zone("cta", 2)] } });
  const [entry] = scoreCandidates([priceNotFirst], context);
  assert.equal(entry.dimensions.informationHierarchy, 4);
  assert.ok(entry.penalties.some((p) => p.includes("prioridade máxima")));
});

test("scoreCandidates: recorte real de produto disponível mas família sem zona heroProduct penaliza productProminencePlan fortemente", () => {
  const wastedHero = fullCandidate({ plan: { heroProductAssetUrl: "https://cdn/hero.png" } });
  const [entry] = scoreCandidates([wastedHero], context);
  assert.equal(entry.dimensions.productProminencePlan, 2);
  assert.ok(entry.penalties.some((p) => p.includes("perde protagonismo")));
});

test("scoreCandidates: heroProduct planejado com zona real recebe productProminencePlan alto proporcional à área", () => {
  const withHero = fullCandidate({
    plan: { heroProductAssetUrl: "https://cdn/hero.png" },
    adLayoutSpec: { zones: [zone("price", 1), zone("cta", 2), zone("heroProduct", 0, { widthPct: 80, heightPct: 60 })] },
  });
  const [entry] = scoreCandidates([withHero], context);
  assert.ok(entry.dimensions.productProminencePlan >= 8, `esperado >=8, recebeu ${entry.dimensions.productProminencePlan}`);
});

test("scoreCandidates: densidade max_performance em 9:16 com muitas zonas penaliza formatFit", () => {
  const denseStory = fullCandidate({
    plan: { visualDensity: "max_performance" },
    adLayoutSpec: {
      zones: [zone("price", 1), zone("discount", 1), zone("cta", 2), zone("headline", 1), zone("benefits", 3), zone("specs", 3)],
    },
  });
  const [entry] = scoreCandidates([denseStory], { aspectRatio: "9:16", preferredDensity: "max_performance" });
  assert.ok(entry.dimensions.formatFit < 10);
  assert.ok(entry.penalties.some((p) => p.includes("9:16")));
});

test("scoreCandidates: brandFit alinha densidade do candidato com graphicDensityPreference do perfil de marca", () => {
  const cleanCandidate = fullCandidate({ plan: { visualDensity: "clean" } });
  const profile = { personality: { graphicDensityPreference: "minimal" } };
  const [entry] = scoreCandidates([cleanCandidate], { ...context, brandVisualProfile: profile });
  assert.equal(entry.dimensions.brandFit, 10);

  const mismatched = fullCandidate({ plan: { visualDensity: "max_performance" } });
  const [entry2] = scoreCandidates([mismatched], { ...context, brandVisualProfile: profile });
  assert.equal(entry2.dimensions.brandFit, 2);
});

test("scoreCandidates: sem brandVisualProfile, brandFit fica neutro (7) — nunca penaliza a ausência de perfil", () => {
  const [entry] = scoreCandidates([fullCandidate()], context);
  assert.equal(entry.dimensions.brandFit, 7);
});

test("selectWinningCandidate: escolhe o candidato de maior score total e explica a vantagem sobre o 2º colocado", () => {
  const strong = fullCandidate({ id: "A" });
  const weak = fullCandidate({ id: "B", adLayoutSpec: { zones: [zone("price", 3)] } });
  const result = selectWinningCandidate([strong, weak], context);
  assert.equal(result.winnerCandidateId, "A");
  assert.equal(result.candidateScores.length, 2);
  assert.ok(result.selectionReason.includes("A"));
});

test("selectWinningCandidate: empate técnico é resolvido pela ordem dos candidatos (determinístico, nunca aleatório)", () => {
  const a = fullCandidate({ id: "A" });
  const b = fullCandidate({ id: "B" });
  const result = selectWinningCandidate([a, b], context);
  assert.equal(result.winnerCandidateId, "A");
});

test("scoreCandidates: score total é sempre a soma das 10 dimensões (0-100)", () => {
  const [entry] = scoreCandidates([fullCandidate()], context);
  const sum = Object.values(entry.dimensions).reduce((total, value) => total + value, 0);
  assert.equal(entry.score, sum);
  assert.ok(entry.score >= 0 && entry.score <= 100);
});
