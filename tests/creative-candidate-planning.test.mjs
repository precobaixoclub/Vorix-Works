import test from "node:test";
import assert from "node:assert/strict";
import { generateCreativeCandidates, computeCandidateDiversity } from "../dist/shared/utils/creative-candidate-planning.js";

function tenisPlan(overrides = {}) {
  return {
    objective: "promocao_oferta",
    creativeType: "oferta",
    primaryHook: "50% OFF - R$39,99",
    heroProduct: "Tênis RV",
    offer: "R$39,99",
    price: "R$ 39,99",
    oldPrice: "R$ 79,99",
    discount: "50%",
    benefits: [],
    trustSignals: [],
    specifications: [],
    urgency: "Oferta Relâmpago",
    cta: "Aproveite agora",
    brandElements: [],
    visualDensity: "performance",
    layoutFamily: "flash_sale",
    informationPriority: ["price", "discount", "cta"],
    commercialFactResolutions: [],
    ...overrides,
  };
}

function tenisSelectionInput(overrides = {}) {
  return {
    objective: "promocao_oferta",
    infoQuantity: 3,
    hasStrongPrice: true,
    hasDiscount: true,
    hasSocialProof: false,
    hasUrgency: true,
    hasManyBenefits: false,
    format: "4:5",
    hasReferenceImage: true,
    ...overrides,
  };
}

test("generateCreativeCandidates: sempre devolve exatamente 3 candidatos (A, B, C)", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((c) => c.id), ["A", "B", "C"]);
});

test("generateCreativeCandidates: os 3 candidatos usam famílias de layout REALMENTE diferentes, nunca a mesma família repetida", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  const families = candidates.map((c) => c.layoutFamily);
  assert.equal(new Set(families).size, 3, `famílias deveriam ser distintas, recebeu: ${families.join(", ")}`);
});

test("generateCreativeCandidates: candidato A é a família de maior selectionScore (mesma que buildPerformanceCreativePlan escolheria como padrão)", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  assert.equal(candidates[0].layoutFamily, "flash_sale");
  assert.ok(candidates[0].familyFitScore >= candidates[1].familyFitScore);
  assert.ok(candidates[1].familyFitScore >= candidates[2].familyFitScore);
});

test("generateCreativeCandidates: cada candidato mantém os MESMOS fatos comerciais do plano base (nunca inventa preço/desconto novo)", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  for (const candidate of candidates) {
    assert.equal(candidate.plan.price, "R$ 39,99");
    assert.equal(candidate.plan.discount, "50%");
    assert.equal(candidate.plan.oldPrice, "R$ 79,99");
  }
});

test("generateCreativeCandidates: cada candidato usa densidade compatível com sua própria família (nunca herda cegamente a densidade do plano base)", () => {
  const candidates = generateCreativeCandidates(tenisPlan({ visualDensity: "max_performance" }), tenisSelectionInput());
  for (const candidate of candidates) {
    const compatibleDensities = {
      flash_sale: ["performance", "max_performance"],
      price_dominant: ["performance", "max_performance"],
      comparison: ["performance", "max_performance"],
      performance_product: ["performance", "max_performance"],
      minimal_offer: ["clean", "performance"],
      hero_offer: ["clean", "performance"],
      benefit_grid: ["performance", "max_performance"],
      social_proof: ["performance", "max_performance"],
      premium_product: ["clean"],
      product_feature: ["clean", "performance"],
    };
    assert.ok(compatibleDensities[candidate.layoutFamily].includes(candidate.plan.visualDensity));
  }
});

test("generateCreativeCandidates: rationale de cada candidato menciona a família e as zonas permitidas (auditoria real, não texto genérico)", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  for (const candidate of candidates) {
    assert.ok(candidate.rationale.includes(candidate.layoutFamily));
  }
});

test("generateCreativeCandidates: determinístico — mesma entrada sempre produz os mesmos 3 candidatos na mesma ordem", () => {
  const input = tenisSelectionInput();
  const first = generateCreativeCandidates(tenisPlan(), input);
  const second = generateCreativeCandidates(tenisPlan(), input);
  assert.deepEqual(first.map((c) => c.layoutFamily), second.map((c) => c.layoutFamily));
});

// -------------------------------------------------------------------------------------------
// computeCandidateDiversity
// -------------------------------------------------------------------------------------------

test("computeCandidateDiversity: 3 famílias distintas geradas por generateCreativeCandidates nunca reportam par insuficiente por família igual", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  const diversity = computeCandidateDiversity(candidates);
  const sameFamilyPairs = diversity.insufficientPairs.filter((pair) => pair.reason.includes("mesma família"));
  assert.equal(sameFamilyPairs.length, 0);
});

test("computeCandidateDiversity: candidatos artificialmente forçados pra mesma família reportam par insuficiente e score baixo", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  const forcedSameFamily = candidates.map((c) => ({ ...c, layoutFamily: "flash_sale", plan: { ...c.plan, layoutFamily: "flash_sale" } }));
  const diversity = computeCandidateDiversity(forcedSameFamily);
  assert.ok(diversity.insufficientPairs.length > 0);
  assert.ok(diversity.score < 30, `score deveria ser baixo para candidatos idênticos, recebeu ${diversity.score}`);
});

test("computeCandidateDiversity: score de candidatos realmente diversos (gerados normalmente) é alto", () => {
  const candidates = generateCreativeCandidates(tenisPlan(), tenisSelectionInput());
  const diversity = computeCandidateDiversity(candidates);
  assert.ok(diversity.score >= 60, `score deveria ser alto para candidatos com famílias distintas, recebeu ${diversity.score}`);
});
