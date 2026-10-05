import test from "node:test";
import assert from "node:assert/strict";
import {
  isTextZoneRequired,
  isLayoutOverdense,
  simplifyOverdenseTextZones,
  applyTextBudgetSimplification,
  degradeOptionalZonesOnUnresolvedOverlap,
  OVERDENSE_OVERLAP_COUNT_THRESHOLD,
} from "../dist/application/creative-engine/manage-text-budget.js";

/**
 * ETAPA 3.3 (Rodada 4, Creative Engine) — testes da lógica PURA e determinística do "VISUAL TEXT
 * BUDGET" (ver comentário no topo de `manage-text-budget.ts`). Mesmo princípio de
 * `resolve-actual-safe-area.ts`: sem mockar visão nem IA, só decide a partir de dados que já
 * existem (geometria do plano, resultado real da realocação).
 */

function zone(kind, overrides = {}) {
  return {
    kind,
    text: overrides.text ?? `texto-${kind}`,
    rect: overrides.rect ?? { xPct: 5, yPct: 5, widthPct: 20, heightPct: 10 },
    emphasis: "primary",
    renderedBy: "renderer",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return { requiredRenderedFacts: [], ...overrides };
}

function densePlacements(count) {
  return Array.from({ length: count }, (_, i) => ({ role: "logo", url: `https://x/${i}.png`, rect: { xPct: 60, yPct: 60, widthPct: 20, heightPct: 20 } }));
}

// ---------------------------------------------------------------------------------------------
// isTextZoneRequired
// ---------------------------------------------------------------------------------------------

test("isTextZoneRequired: headline é SEMPRE obrigatório", () => {
  assert.equal(isTextZoneRequired(zone("headline"), plan()), true);
});

test("isTextZoneRequired: cta com texto não-vazio é obrigatório", () => {
  assert.equal(isTextZoneRequired(zone("cta", { text: "Compre agora" }), plan()), true);
});

test("isTextZoneRequired: cta com texto vazio NÃO é obrigatório (peça institucional sem CTA)", () => {
  assert.equal(isTextZoneRequired(zone("cta", { text: "" }), plan()), false);
});

test("isTextZoneRequired: subheadline/preço/desconto/url/badge só são obrigatórios quando batem com requiredRenderedFacts", () => {
  const p = plan({ requiredRenderedFacts: ["R$ 149,00"] });
  assert.equal(isTextZoneRequired(zone("price", { text: "R$ 149,00" }), p), true);
  assert.equal(isTextZoneRequired(zone("subheadline", { text: "Oferta por tempo limitado" }), p), false);
  assert.equal(isTextZoneRequired(zone("badge", { text: "NOVO" }), p), false);
  assert.equal(isTextZoneRequired(zone("url", { text: "loja.com" }), p), false);
});

test("isTextZoneRequired: match é aproximado (mesmo princípio de textsMatchApproximately — variação de formatação do mesmo fato)", () => {
  const p = plan({ requiredRenderedFacts: ["R$ 149,00"] });
  assert.equal(isTextZoneRequired(zone("price", { text: "Por apenas R$ 149,00 hoje" }), p), true);
});

// ---------------------------------------------------------------------------------------------
// isLayoutOverdense
// ---------------------------------------------------------------------------------------------

test("isLayoutOverdense: cenário nomeado no brief (headline+subheadline+CTA+preço+logo = 5 elementos) já é denso por contagem", () => {
  const zones = [zone("headline"), zone("subheadline"), zone("cta", { text: "Compre" }), zone("price")];
  assert.equal(isLayoutOverdense(zones, densePlacements(1)), true);
});

test("isLayoutOverdense: poucos elementos pequenos não é denso", () => {
  const zones = [zone("headline", { rect: { xPct: 5, yPct: 5, widthPct: 30, heightPct: 10 } })];
  assert.equal(isLayoutOverdense(zones, []), false);
});

test("isLayoutOverdense: poucos elementos mas OCUPANDO área grande do canvas é denso por área", () => {
  const zones = [
    zone("headline", { rect: { xPct: 0, yPct: 0, widthPct: 90, heightPct: 40 } }),
    zone("cta", { text: "Compre", rect: { xPct: 0, yPct: 45, widthPct: 90, heightPct: 40 } }),
  ];
  assert.equal(isLayoutOverdense(zones, []), true);
});

// ---------------------------------------------------------------------------------------------
// simplifyOverdenseTextZones / applyTextBudgetSimplification — grupo (A) do brief: cenários de densidade
// ---------------------------------------------------------------------------------------------

test("simplifyOverdenseTextZones: headline+subheadline+CTA+preço+logo -> descarta só o subheadline (único opcional), nenhuma sobreposição de obrigatório", () => {
  const p = plan({ requiredRenderedFacts: ["R$ 149,00"] });
  const zones = [zone("headline"), zone("subheadline"), zone("cta", { text: "Compre agora" }), zone("price", { text: "R$ 149,00" })];
  const result = simplifyOverdenseTextZones(zones, p, densePlacements(1));
  assert.deepEqual(result.droppedZones.map((z) => z.kind), ["subheadline"]);
  assert.deepEqual(result.zones.map((z) => z.kind).sort(), ["cta", "headline", "price"]);
  assert.equal(isLayoutOverdense(result.zones, densePlacements(1)), false);
});

test("simplifyOverdenseTextZones: headline+CTA+preço+badge+logo -> descarta o badge (único opcional)", () => {
  const p = plan({ requiredRenderedFacts: ["R$ 149,00"] });
  const zones = [zone("headline"), zone("cta", { text: "Compre agora" }), zone("price", { text: "R$ 149,00" }), zone("badge", { text: "NOVO" })];
  const result = simplifyOverdenseTextZones(zones, p, densePlacements(1));
  assert.deepEqual(result.droppedZones.map((z) => z.kind), ["badge"]);
});

test("simplifyOverdenseTextZones: ordem de descarte é url -> badge -> discount -> subheadline (brief, prioridade 6 > 7 > 8)", () => {
  const p = plan();
  // 6 elementos + 1 placement (7 no total) — bem acima do limiar, obriga descartar mais de um.
  const zones = [
    zone("headline"),
    zone("cta", { text: "Compre agora" }),
    zone("url", { text: "loja.com" }),
    zone("badge", { text: "NOVO" }),
    zone("discount", { text: "10% OFF" }),
    zone("subheadline", { text: "Oferta por tempo limitado" }),
  ];
  const result = simplifyOverdenseTextZones(zones, p, densePlacements(1));
  // Só descarta o suficiente pra deixar de ser denso — nunca descarta a mais do que o necessário.
  assert.ok(result.droppedZones.length > 0);
  assert.equal(result.droppedZones[0].kind, "url");
  if (result.droppedZones.length > 1) assert.equal(result.droppedZones[1].kind, "badge");
});

test("simplifyOverdenseTextZones: layout pequeno (small story) com muitos elementos continua respeitando obrigatórios", () => {
  const p = plan({ requiredRenderedFacts: ["50% OFF"] });
  const zones = [
    zone("headline"),
    zone("cta", { text: "Arraste pra cima" }),
    zone("discount", { text: "50% OFF" }),
    zone("badge", { text: "ÚLTIMAS HORAS" }),
    zone("url", { text: "loja.com/promo" }),
  ];
  const result = simplifyOverdenseTextZones(zones, p, densePlacements(1));
  const remainingKinds = result.zones.map((z) => z.kind);
  assert.ok(remainingKinds.includes("headline"));
  assert.ok(remainingKinds.includes("discount"));
});

test("simplifyOverdenseTextZones: nunca descarta uma zona obrigatória, mesmo que o layout continue denso depois de esgotar as opcionais", () => {
  // Só zonas OBRIGATÓRIAS (headline + cta com texto + preço batendo requiredRenderedFacts) — nada
  // pra descartar, mesmo denso por contagem/área.
  const p = plan({ requiredRenderedFacts: ["R$ 10", "R$ 20", "R$ 30"] });
  const zones = [
    zone("headline"),
    zone("cta", { text: "Compre" }),
    zone("price", { text: "R$ 10" }),
    zone("price", { text: "R$ 20" }),
    zone("price", { text: "R$ 30" }),
  ];
  const result = simplifyOverdenseTextZones(zones, p, densePlacements(1));
  assert.equal(result.droppedZones.length, 0);
  assert.equal(result.zones.length, zones.length);
});

test("applyTextBudgetSimplification: remove o texto descartado de allowedRenderedTexts e limpa plan.subheadline (nunca deixa MISSING_REQUIRED_TEXT órfão)", () => {
  const fullPlan = {
    requiredRenderedFacts: ["R$ 149,00"],
    textZones: [zone("headline", { text: "Oferta" }), zone("subheadline", { text: "Só hoje" }), zone("cta", { text: "Compre agora" }), zone("price", { text: "R$ 149,00" })],
    assetPlacements: densePlacements(1),
    allowedRenderedTexts: ["Oferta", "Só hoje", "Compre agora", "R$ 149,00"],
    subheadline: "Só hoje",
  };
  const result = applyTextBudgetSimplification(fullPlan);
  assert.deepEqual(result.droppedZones.map((z) => z.kind), ["subheadline"]);
  assert.ok(!result.plan.allowedRenderedTexts.includes("Só hoje"));
  assert.equal(result.plan.subheadline, undefined);
  assert.equal(result.plan.textZones.length, 3);
});

test("applyTextBudgetSimplification: layout não-denso devolve o MESMO plano, sem descartar nada", () => {
  const fullPlan = {
    requiredRenderedFacts: [],
    textZones: [zone("headline")],
    assetPlacements: [],
    allowedRenderedTexts: ["texto-headline"],
  };
  const result = applyTextBudgetSimplification(fullPlan);
  assert.equal(result.droppedZones.length, 0);
  assert.equal(result.plan, fullPlan);
});

// ---------------------------------------------------------------------------------------------
// degradeOptionalZonesOnUnresolvedOverlap — grupo (B) do brief: obrigatório/opcional sob congestionamento real
// ---------------------------------------------------------------------------------------------

test("degradeOptionalZonesOnUnresolvedOverlap: abaixo do limiar de sobreposição (OVERDENSE_OVERLAP_COUNT_THRESHOLD), não descarta nada", () => {
  const p = plan();
  const zones = [zone("headline"), zone("badge", { text: "NOVO" })];
  const result = degradeOptionalZonesOnUnresolvedOverlap(zones, p, ["badge"]);
  assert.equal(result.overdenseLayoutDetected, false);
  assert.equal(result.droppedZones.length, 0);
  assert.equal(OVERDENSE_OVERLAP_COUNT_THRESHOLD, 2);
});

test("degradeOptionalZonesOnUnresolvedOverlap: 2+ zonas em sobreposição não resolvida -> descarta as OPCIONAIS entre elas, mantém headline/price/cta", () => {
  const p = plan({ requiredRenderedFacts: ["R$ 149,00"] });
  const zones = [
    zone("headline"),
    zone("cta", { text: "Compre agora" }),
    zone("price", { text: "R$ 149,00" }),
    zone("badge", { text: "NOVO" }),
    zone("url", { text: "loja.com" }),
  ];
  const result = degradeOptionalZonesOnUnresolvedOverlap(zones, p, ["headline", "badge", "url"]);
  assert.equal(result.overdenseLayoutDetected, true);
  // headline está no conjunto de sobreposição, mas é OBRIGATÓRIO — nunca descartado.
  assert.ok(!result.droppedZones.some((z) => z.kind === "headline"));
  assert.deepEqual(result.droppedZones.map((z) => z.kind).sort(), ["badge", "url"]);
  assert.ok(result.zones.some((z) => z.kind === "headline"));
  assert.ok(result.zones.some((z) => z.kind === "price"));
  assert.ok(result.zones.some((z) => z.kind === "cta"));
});

test("degradeOptionalZonesOnUnresolvedOverlap: só descarta zonas que estão DE FATO no conjunto de sobreposição não resolvida (nunca uma zona que já relocalizou com sucesso)", () => {
  const p = plan();
  const zones = [zone("headline"), zone("subheadline", { text: "Oferta" }), zone("badge", { text: "NOVO" })];
  // "subheadline" NÃO está em unresolvedOverlapKinds (já relocalizou com sucesso) — nunca descartada,
  // mesmo sendo opcional; só "headline"/"badge" contam como sobreposição real aqui.
  const result = degradeOptionalZonesOnUnresolvedOverlap(zones, p, ["headline", "badge"]);
  assert.ok(result.zones.some((z) => z.kind === "subheadline"));
  assert.deepEqual(result.droppedZones.map((z) => z.kind), ["badge"]);
});
