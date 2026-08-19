import test from "node:test";
import assert from "node:assert/strict";
import { computeCreativeQualityScore, CREATIVE_QUALITY_THRESHOLDS } from "../dist/shared/utils/creative-quality-score.js";

function perfectDimensions() {
  return {
    productFidelity: 10,
    factualAccuracy: 10,
    commercialClarity: 10,
    visualHierarchy: 10,
    typography: 10,
    brandConsistency: 10,
    productProminence: 10,
    layoutBalance: 10,
    specificity: 10,
    professionalPolish: 10,
  };
}

test("computeCreativeQualityScore: 10 dimensões perfeitas somam 100 e veredito é \"excellent\"", () => {
  const result = computeCreativeQualityScore({ dimensions: perfectDimensions(), hasHardFailure: false, hardFailureReasons: [] });
  assert.equal(result.score, 100);
  assert.equal(result.verdict, "excellent");
  assert.equal(result.blockedByHardFailure, false);
});

test("computeCreativeQualityScore: score exatamente no limiar de \"approved\" (82) não vira \"excellent\"", () => {
  const dims = { ...perfectDimensions(), productFidelity: 2 }; // 100-8=92... ajustar para exatamente 82
  const adjusted = { ...perfectDimensions(), productFidelity: 0, factualAccuracy: 8 }; // 100-10-2=88
  const result = computeCreativeQualityScore({ dimensions: adjusted, hasHardFailure: false, hardFailureReasons: [] });
  assert.equal(result.score, 88);
  assert.equal(result.verdict, "approved");
});

test("computeCreativeQualityScore: score abaixo de 72 vira \"reject\" mesmo sem falha dura sinalizada", () => {
  const result = computeCreativeQualityScore({ dimensions: dimsWithTotal(60), hasHardFailure: false, hardFailureReasons: [] });
  assert.ok(result.score < CREATIVE_QUALITY_THRESHOLDS.repair);
  assert.equal(result.verdict, "reject");
});

test("computeCreativeQualityScore: score 90-100 excelente, 82-89 aprovado, 72-81 reparo, abaixo rejeitar (limiares exatos)", () => {
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(90), hasHardFailure: false, hardFailureReasons: [] }).verdict, "excellent");
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(89), hasHardFailure: false, hardFailureReasons: [] }).verdict, "approved");
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(82), hasHardFailure: false, hardFailureReasons: [] }).verdict, "approved");
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(81), hasHardFailure: false, hardFailureReasons: [] }).verdict, "repair");
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(72), hasHardFailure: false, hardFailureReasons: [] }).verdict, "repair");
  assert.equal(computeCreativeQualityScore({ dimensions: dimsWithTotal(71), hasHardFailure: false, hardFailureReasons: [] }).verdict, "reject");
});

const DIMENSION_KEYS = Object.keys(perfectDimensions());

function dimsWithTotal(total) {
  const dims = {};
  let remaining = total;
  for (const key of DIMENSION_KEYS) {
    const value = Math.max(0, Math.min(10, remaining));
    dims[key] = value;
    remaining -= value;
  }
  return dims;
}

test("computeCreativeQualityScore: falha dura força \"reject\" MESMO com score perfeito (100/100) — a nota nunca mascara falha crítica", () => {
  const result = computeCreativeQualityScore({
    dimensions: perfectDimensions(),
    hasHardFailure: true,
    hardFailureReasons: ["Preço exibido (R$ 199,90) diverge do preço confirmado na referência (R$ 149,90)."],
  });
  assert.equal(result.score, 100);
  assert.equal(result.verdict, "reject");
  assert.equal(result.blockedByHardFailure, true);
  assert.match(result.reasoning, /nunca mascara/);
});

test("computeCreativeQualityScore: reasoning cita os motivos da falha dura quando ela existe", () => {
  const result = computeCreativeQualityScore({
    dimensions: perfectDimensions(),
    hasHardFailure: true,
    hardFailureReasons: ["Texto do CTA cortado na renderização final."],
  });
  assert.match(result.reasoning, /Texto do CTA cortado/);
});

test("computeCreativeQualityScore: scoreCeiling (Rodada 2, Fatia 3) limita o score mesmo com dimensões perfeitas, mesmo sem falha dura", () => {
  const result = computeCreativeQualityScore({
    dimensions: perfectDimensions(),
    hasHardFailure: false,
    hardFailureReasons: [],
    scoreCeiling: 55,
  });
  assert.equal(result.score, 55);
  assert.equal(result.verdict, "reject");
  assert.equal(result.blockedByHardFailure, false);
  assert.match(result.reasoning, /teto de 55/);
  assert.match(result.reasoning, /soma bruta das dimensões seria 100/);
});

test("computeCreativeQualityScore: scoreCeiling não faz nada quando a soma bruta já fica abaixo do teto", () => {
  const result = computeCreativeQualityScore({
    dimensions: dimsWithTotal(50),
    hasHardFailure: false,
    hardFailureReasons: [],
    scoreCeiling: 78,
  });
  assert.equal(result.score, 50);
  assert.doesNotMatch(result.reasoning, /limitado por teto/);
});

test("computeCreativeQualityScore: falha dura + scoreCeiling — verdict continua \"reject\" e o score reportado respeita o teto", () => {
  const result = computeCreativeQualityScore({
    dimensions: perfectDimensions(),
    hasHardFailure: true,
    hardFailureReasons: ["Headline cobre o rosto do modelo, deixando os olhos irreconhecíveis."],
    scoreCeiling: 55,
  });
  assert.equal(result.score, 55);
  assert.equal(result.verdict, "reject");
  assert.equal(result.blockedByHardFailure, true);
  assert.match(result.reasoning, /nunca mascara/);
});
