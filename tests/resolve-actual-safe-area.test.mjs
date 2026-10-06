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
  expandBboxWithPadding,
  normalizeTextForMatching,
  textsMatchApproximately,
  sortTextZonesByPriority,
  TEXT_ZONE_KIND_PRIORITY,
  widenToCommercialBand,
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

// ---------------------------------------------------------------------------------------------
// ETAPA 3.2 (Rodada 4) — cobertura geométrica real: tratar só o retângulo PLANEJADO não é garantia
// de cobrir onde o texto espúrio REALMENTE apareceu. expandBboxWithPadding/textsMatchApproximately/
// sortTextZonesByPriority são as peças puras dessa correção.
// ---------------------------------------------------------------------------------------------

test("expandBboxWithPadding: expande proporcionalmente ao próprio tamanho da bbox, clampado aos limites do canvas", () => {
  const bbox = { xPct: 20, yPct: 20, widthPct: 20, heightPct: 10 };
  const expanded = expandBboxWithPadding(bbox, 20);
  assert.ok(expanded.xPct < bbox.xPct, "deveria expandir pra esquerda");
  assert.ok(expanded.yPct < bbox.yPct, "deveria expandir pra cima");
  assert.ok(expanded.widthPct > bbox.widthPct, "deveria ficar mais largo");
  assert.ok(expanded.heightPct > bbox.heightPct, "deveria ficar mais alto");
});

test("expandBboxWithPadding: nunca ultrapassa os limites do canvas (0-100)", () => {
  const bbox = { xPct: 2, yPct: 2, widthPct: 10, heightPct: 10 };
  const expanded = expandBboxWithPadding(bbox, 50);
  assert.ok(expanded.xPct >= 0);
  assert.ok(expanded.yPct >= 0);
  assert.ok(expanded.xPct + expanded.widthPct <= 100);
  assert.ok(expanded.yPct + expanded.heightPct <= 100);
});

test("normalizeTextForMatching: remove acento, caixa, espaço e pontuação/símbolo monetário", () => {
  assert.equal(normalizeTextForMatching("R$ 149,00"), normalizeTextForMatching("r$149.00"));
  assert.equal(normalizeTextForMatching("ÁÇÃO"), "acao");
});

test("textsMatchApproximately: 'R$ 149,00' / 'R$149' / '149,00' são reconhecidos como o MESMO fato (normalização simples, nunca fuzzy matching elaborado)", () => {
  assert.equal(textsMatchApproximately("R$ 149,00", "R$149"), true);
  assert.equal(textsMatchApproximately("R$ 149,00", "149,00"), true);
  assert.equal(textsMatchApproximately("R$ 149,00", "R$ 299,00"), false, "valores DIFERENTES nunca devem bater");
});

test("textsMatchApproximately: strings vazias nunca combinam com nada", () => {
  assert.equal(textsMatchApproximately("", "qualquer coisa"), false);
  assert.equal(textsMatchApproximately("qualquer coisa", ""), false);
});

test("TEXT_ZONE_KIND_PRIORITY: headline > price > cta > subheadline (ordem pedida pelo brief)", () => {
  assert.ok(TEXT_ZONE_KIND_PRIORITY.headline < TEXT_ZONE_KIND_PRIORITY.price);
  assert.ok(TEXT_ZONE_KIND_PRIORITY.price < TEXT_ZONE_KIND_PRIORITY.cta);
  assert.ok(TEXT_ZONE_KIND_PRIORITY.cta < TEXT_ZONE_KIND_PRIORITY.subheadline);
});

test("sortTextZonesByPriority: reordena zonas de MENOR prioridade (badge) pra DEPOIS de zonas de maior prioridade (headline), independente da ordem de entrada", () => {
  const zones = [{ kind: "badge" }, { kind: "headline" }, { kind: "cta" }];
  const sorted = sortTextZonesByPriority(zones);
  assert.deepEqual(sorted.map((z) => z.kind), ["headline", "cta", "badge"]);
});

test("sortTextZonesByPriority: nunca muta o array original", () => {
  const zones = [{ kind: "badge" }, { kind: "headline" }];
  const original = [...zones];
  sortTextZonesByPriority(zones);
  assert.deepEqual(zones, original);
});

// ---------------------------------------------------------------------------------------------
// ETAPA 3.3.2 (Rodada 4) — achado real do smoke de produção: o texto fantasma de uma zona
// comercial (headline/cta/price) pode sair muito mais LARGO do que a bbox que a visão reporta
// (confirmado por pixel: ghost text real em ~84% da largura do canvas, zona planejada com só
// 40%) — `widenToCommercialBand` garante estruturalmente a cobertura horizontal mínima do
// tratamento, nunca dependente só da precisão da visão.
// ---------------------------------------------------------------------------------------------

test("widenToCommercialBand: amplia um retângulo estreito pra largura segura do canvas (5%-95%), mantendo y/altura", () => {
  const widened = widenToCommercialBand({ xPct: 30, yPct: 70, widthPct: 20, heightPct: 10 });
  assert.equal(widened.xPct, 5);
  assert.equal(widened.widthPct, 90);
  assert.equal(widened.yPct, 70, "altura/posição vertical nunca muda — só a largura é ampliada");
  assert.equal(widened.heightPct, 10);
});

test("widenToCommercialBand: nunca ENCOLHE um retângulo que já é mais largo que a faixa comercial", () => {
  const alreadyWide = { xPct: 2, yPct: 20, widthPct: 96, heightPct: 15 };
  const widened = widenToCommercialBand(alreadyWide);
  assert.deepEqual(widened, alreadyWide);
});

test("widenToCommercialBand: retângulo parcialmente fora da faixa (só um dos lados precisa ampliar)", () => {
  const widened = widenToCommercialBand({ xPct: 1, yPct: 0, widthPct: 50, heightPct: 10 });
  assert.equal(widened.xPct, 1, "já está dentro da margem esquerda (5%), nunca move pra dentro");
  assert.equal(widened.xPct + widened.widthPct, 95, "lado direito ampliado até a margem segura");
});

test("widenToCommercialBand: aceita margem customizada", () => {
  const widened = widenToCommercialBand({ xPct: 40, yPct: 0, widthPct: 20, heightPct: 10 }, 10);
  assert.equal(widened.xPct, 10);
  assert.equal(widened.widthPct, 80);
});
