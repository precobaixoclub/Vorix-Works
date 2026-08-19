import test from "node:test";
import assert from "node:assert/strict";
import { deriveVisualGrammar } from "../dist/shared/utils/visual-grammar.types.js";
import { buildConservativeDefaultProfile } from "../dist/shared/utils/brand-visual-profile.types.js";

function aggressiveProfile() {
  const base = buildConservativeDefaultProfile("ws-aggressive", "2026-08-16T00:00:00.000Z");
  return {
    ...base,
    personality: {
      visualEnergy: "high",
      commercialAggressiveness: "aggressive",
      sophistication: "casual",
      graphicDensityPreference: "dense",
      contrastPreference: "high",
    },
    shapeLanguage: { borderRadius: "sharp", shadowStyle: "pronounced", cardStyle: "elevated" },
  };
}

function premiumProfile() {
  const base = buildConservativeDefaultProfile("ws-premium", "2026-08-16T00:00:00.000Z");
  return {
    ...base,
    personality: {
      visualEnergy: "calm",
      commercialAggressiveness: "subtle",
      sophistication: "premium",
      graphicDensityPreference: "minimal",
      contrastPreference: "soft",
    },
    shapeLanguage: { borderRadius: "pill", shadowStyle: "none", cardStyle: "flat" },
  };
}

test("deriveVisualGrammar: marca agressiva/densa produz gramática de alta energia (assimétrica, tight, cards pesados, diagonal, escala dominante)", () => {
  const grammar = deriveVisualGrammar(aggressiveProfile());
  assert.equal(grammar.alignmentPreference, "asymmetric");
  assert.equal(grammar.whitespacePreference, "tight");
  assert.equal(grammar.cardUsage, "heavy");
  assert.equal(grammar.diagonalElements, true);
  assert.equal(grammar.hierarchyStyle, "scale_dominant");
  assert.equal(grammar.geometricLanguage, "sharp");
  assert.equal(grammar.labelTreatment, "pill");
  assert.equal(grammar.accentUsage, "bold");
});

test("deriveVisualGrammar: marca premium/minimalista produz gramática oposta (centrada, generosa, sem cards, sem diagonais, sutil)", () => {
  const grammar = deriveVisualGrammar(premiumProfile());
  assert.equal(grammar.alignmentPreference, "centered");
  assert.equal(grammar.whitespacePreference, "generous");
  assert.equal(grammar.cardUsage, "none");
  assert.equal(grammar.diagonalElements, false);
  assert.equal(grammar.hierarchyStyle, "subtle");
  assert.equal(grammar.geometricLanguage, "rounded");
  assert.equal(grammar.labelTreatment, "minimal");
  assert.equal(grammar.productFraming, "floating");
});

test("deriveVisualGrammar: perfil conservador padrão (sem sinal forte de marca) fica no meio-termo, nunca nos extremos", () => {
  const grammar = deriveVisualGrammar(buildConservativeDefaultProfile("ws-default", "2026-08-16T00:00:00.000Z"));
  assert.equal(grammar.diagonalElements, false);
  assert.equal(grammar.whitespacePreference, "balanced");
  assert.equal(grammar.hierarchyStyle, "balanced");
});

test("deriveVisualGrammar: determinístico — mesmo perfil sempre produz a mesma gramática", () => {
  const profile = aggressiveProfile();
  assert.deepEqual(deriveVisualGrammar(profile), deriveVisualGrammar(profile));
});

test("deriveVisualGrammar: backgroundComplexity espelha diretamente imagery.backgroundComplexity do perfil", () => {
  const profile = { ...buildConservativeDefaultProfile("ws-bg", "2026-08-16T00:00:00.000Z"), imagery: { backgroundComplexity: "rich", productTreatment: "editorial" } };
  assert.equal(deriveVisualGrammar(profile).backgroundComplexity, "rich");
});
