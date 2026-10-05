import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_AREA_CANDIDATE_REGIONS,
  CANDIDATE_REGION_RECTS,
  isRegionSafeForText,
  pickBestAlternateRegion,
  resolveActualTextZoneRect,
  chooseTextBackingTreatment,
  textBackingTreatmentToRendererStyle,
  classifyGhostTextIntensity,
  escalateGhostTextIntensity,
  resolveGhostTextTreatmentParams,
} from "../dist/application/creative-engine/resolve-actual-safe-area.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — testes da lógica PURA e determinística de
 * "safe area real". Deliberadamente sem mockar visão nem gerar imagens reais (ver comentário no
 * topo de `resolve-actual-safe-area.ts`) — recebe dados já computados e decide.
 */

function flags(overrides = {}) {
  return { hasText: false, hasProduct: false, hasFace: false, complexity: "low", ...overrides };
}

test("SAFE_AREA_CANDIDATE_REGIONS: exatamente as 6 regiões pedidas pelo brief", () => {
  assert.deepEqual([...SAFE_AREA_CANDIDATE_REGIONS].sort(), ["bottom-left", "bottom-right", "center-left", "center-right", "top-left", "top-right"]);
  for (const region of SAFE_AREA_CANDIDATE_REGIONS) assert.ok(CANDIDATE_REGION_RECTS[region]);
});

test("isRegionSafeForText: região limpa (sem texto/produto/rosto, complexidade não-alta) é segura", () => {
  assert.equal(isRegionSafeForText(flags()), true);
});

test("isRegionSafeForText: hasText/hasProduct/hasFace cada um sozinho já torna a região insegura", () => {
  assert.equal(isRegionSafeForText(flags({ hasText: true })), false);
  assert.equal(isRegionSafeForText(flags({ hasProduct: true })), false);
  assert.equal(isRegionSafeForText(flags({ hasFace: true })), false);
});

test("isRegionSafeForText: complexidade 'high' torna insegura mesmo sem texto/produto/rosto", () => {
  assert.equal(isRegionSafeForText(flags({ complexity: "high" })), false);
});

test("isRegionSafeForText: complexidade 'medium' ainda é segura (só 'high' reprova)", () => {
  assert.equal(isRegionSafeForText(flags({ complexity: "medium" })), true);
});

test("pickBestAlternateRegion: escolhe a região segura de MENOR complexidade entre várias candidatas", () => {
  const regionFlags = {
    "top-left": flags({ complexity: "medium" }),
    "top-right": flags({ complexity: "low" }),
    "bottom-left": flags({ hasText: true }),
  };
  assert.equal(pickBestAlternateRegion(regionFlags, []), "top-right");
});

test("pickBestAlternateRegion: devolve undefined quando NENHUMA região candidata está livre", () => {
  const regionFlags = Object.fromEntries(SAFE_AREA_CANDIDATE_REGIONS.map((region) => [region, flags({ hasText: true })]));
  assert.equal(pickBestAlternateRegion(regionFlags, []), undefined);
});

test("pickBestAlternateRegion: exclui região que se sobrepõe a um retângulo já ocupado (asset real ou outra zona)", () => {
  const regionFlags = { "top-left": flags(), "top-right": flags() };
  // top-left colide com um asset já posicionado exatamente ali.
  const occupied = [CANDIDATE_REGION_RECTS["top-left"]];
  assert.equal(pickBestAlternateRegion(regionFlags, occupied), "top-right");
});

test("resolveActualTextZoneRect: planejado livre -> mantém o retângulo planejado, relocated=false", () => {
  const plannedRect = { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 };
  const decision = resolveActualTextZoneRect({ plannedRect, plannedRectIsClear: true, regionFlags: {}, occupiedRects: [] });
  assert.deepEqual(decision.rect, plannedRect);
  assert.equal(decision.relocated, false);
});

test("resolveActualTextZoneRect: planejado ocupado + existe alternativa livre -> realoca", () => {
  const plannedRect = { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 };
  const regionFlags = { "top-right": flags() };
  const decision = resolveActualTextZoneRect({ plannedRect, plannedRectIsClear: false, regionFlags, occupiedRects: [] });
  assert.equal(decision.relocated, true);
  assert.equal(decision.relocatedTo, "top-right");
  assert.deepEqual(decision.rect, CANDIDATE_REGION_RECTS["top-right"]);
});

test("resolveActualTextZoneRect: planejado ocupado SEM nenhuma alternativa livre -> mantém o planejado mesmo assim (nunca regenera só por isso)", () => {
  const plannedRect = { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 };
  const decision = resolveActualTextZoneRect({ plannedRect, plannedRectIsClear: false, regionFlags: {}, occupiedRects: [] });
  assert.deepEqual(decision.rect, plannedRect);
  assert.equal(decision.relocated, false);
});

// ---------------------------------------------------------------------------------------------
// chooseTextBackingTreatment
// ---------------------------------------------------------------------------------------------

test("chooseTextBackingTreatment: texto fantasma SEMPRE força local_blur, independente de contraste", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 200, stdDevLuminance: 2 }, hasGhostTextHere: true });
  assert.equal(treatment, "local_blur");
});

test("chooseTextBackingTreatment: sem estatística confiável, cai no tratamento histórico seguro (gradient_scrim)", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: undefined, hasGhostTextHere: false });
  assert.equal(treatment, "gradient_scrim");
});

test("chooseTextBackingTreatment: região limpa (stdDev baixo) sem preferência do plano -> direct_text (ganho real, sem caixa)", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 50, stdDevLuminance: 10 }, hasGhostTextHere: false });
  assert.equal(treatment, "direct_text");
});

test("chooseTextBackingTreatment: região medianamente ruidosa (acima do piso 'busy') -> gradient_scrim", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 128, stdDevLuminance: 40 }, hasGhostTextHere: false });
  assert.equal(treatment, "gradient_scrim");
});

test("chooseTextBackingTreatment: região caótica (stdDev muito alto) -> card_fallback (último recurso)", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 128, stdDevLuminance: 90 }, hasGhostTextHere: false });
  assert.equal(treatment, "card_fallback");
});

test("chooseTextBackingTreatment: região limpa mas o PLANO já pediu 'solid' de propósito -> respeita a decisão do Director (card_fallback)", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 50, stdDevLuminance: 5 }, hasGhostTextHere: false, plannedBackingStyle: "solid" });
  assert.equal(treatment, "card_fallback");
});

test("chooseTextBackingTreatment: região limpa mas o PLANO já pediu 'scrim' de propósito -> respeita a decisão do Director (gradient_scrim)", () => {
  const treatment = chooseTextBackingTreatment({ pixelStats: { meanLuminance: 50, stdDevLuminance: 5 }, hasGhostTextHere: false, plannedBackingStyle: "scrim" });
  assert.equal(treatment, "gradient_scrim");
});

test("textBackingTreatmentToRendererStyle: mapeia pro vocabulário real do renderer (none/scrim/solid)", () => {
  assert.equal(textBackingTreatmentToRendererStyle("direct_text"), "none");
  assert.equal(textBackingTreatmentToRendererStyle("gradient_scrim"), "scrim");
  assert.equal(textBackingTreatmentToRendererStyle("local_blur"), "scrim");
  assert.equal(textBackingTreatmentToRendererStyle("card_fallback"), "solid");
});

// ---------------------------------------------------------------------------------------------
// ETAPA 3.1 (Rodada 4) — intensidade adaptativa de neutralização de texto fantasma. Achado do
// smoke real: blur de sigma FIXO não bastou pra um preço fantasma de alto contraste.
// ---------------------------------------------------------------------------------------------

test("classifyGhostTextIntensity: sem estatística confiável, nível intermediário (nunca o mais fraco nem automaticamente o mais forte)", () => {
  assert.equal(classifyGhostTextIntensity(undefined), "medium");
});

test("classifyGhostTextIntensity: região de baixo desvio-padrão -> low", () => {
  assert.equal(classifyGhostTextIntensity({ meanLuminance: 128, stdDevLuminance: 20 }), "low");
});

test("classifyGhostTextIntensity: região de desvio-padrão moderado -> medium", () => {
  assert.equal(classifyGhostTextIntensity({ meanLuminance: 128, stdDevLuminance: 55 }), "medium");
});

test("classifyGhostTextIntensity: região de desvio-padrão alto (texto de alto contraste, caso real do smoke) -> high", () => {
  assert.equal(classifyGhostTextIntensity({ meanLuminance: 128, stdDevLuminance: 85 }), "high");
});

test("escalateGhostTextIntensity: low -> medium -> high, satura em high (nunca inventa um 4º nível)", () => {
  assert.equal(escalateGhostTextIntensity("low"), "medium");
  assert.equal(escalateGhostTextIntensity("medium"), "high");
  assert.equal(escalateGhostTextIntensity("high"), "high");
});

test("resolveGhostTextTreatmentParams: cada nível escala TANTO o blur quanto a opacidade do véu (nunca só um dos dois)", () => {
  const low = resolveGhostTextTreatmentParams("low");
  const medium = resolveGhostTextTreatmentParams("medium");
  const high = resolveGhostTextTreatmentParams("high");
  assert.ok(low.blurSigma < medium.blurSigma && medium.blurSigma < high.blurSigma);
  assert.ok(low.scrimOpacity < medium.scrimOpacity && medium.scrimOpacity < high.scrimOpacity);
});
