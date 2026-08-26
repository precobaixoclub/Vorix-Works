import test from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_QUALITY_DIMENSIONS,
  VISUAL_QUALITY_MIN_OVERALL_SCORE,
  VISUAL_QUALITY_MIN_DIMENSION_SCORE,
  evaluateVisualQualityScore,
  buildAestheticRepairInstructions,
} from "../dist/application/creative-engine/evaluate-visual-quality-score.js";

/**
 * Auditoria "qualidade visual e direção de arte" — testes do Visual Quality Score, DELIBERADAMENTE
 * separado do quality gate técnico (`evaluate-creative-quality-gate.test.mjs`). Mesmo padrão de
 * fixture de `artDirection` concreta usado em `run-gpt-creative-engine.test.mjs` — a peça de teste
 * precisa ser uma `artDirection` de verdade porque `buildVisualQualityScorePrompt` a lê.
 */

function basePlan(overrides = {}) {
  return {
    objective: "x",
    angle: "x",
    targetAudience: "x",
    title: "",
    description: "",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    cta: "ACESSE AGORA",
    visualDirection: "x",
    compositionIntent: "x",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    requiredElements: [],
    forbiddenElements: [],
    visualDensity: "clean",
    styleNotes: "",
    rationale: "",
    allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "ACESSE AGORA"],
    artDirection: {
      concept: "Fundo grafite quase preto com feixe de luz verde neon diagonal, produto centralizado",
      visualFocus: "Mockup do celular exibindo o site, ocupando o terço central da peça",
      elementHierarchy: ["mockup do site", "headline", "cta", "logo"],
      primaryMassPct: 45,
      contrastStrategy: "Texto branco sólido sobre faixa preta semi-opaca",
      chromaticDirection: "Grafite quase preto dominante, verde neon como único acento",
      atmosphere: "Tecnológico e direto",
      backgroundTreatment: "Gradiente sutil de grafite para preto",
      productTextRelationship: "Texto sempre acima ou abaixo do mockup, nunca sobreposto",
      avoidedCliches: ["cards flutuantes"],
      justifiedCliches: [],
    },
    layoutPlan: [],
    ...overrides,
  };
}

function allDimensionsResponse(score, justification = "ok") {
  const body = {};
  for (const dimension of VISUAL_QUALITY_DIMENSIONS) body[dimension.key] = { score, justification: `${dimension.key}: ${justification}` };
  return body;
}

test("VISUAL_QUALITY_DIMENSIONS: exatamente 12 dimensões, chaves únicas", () => {
  assert.equal(VISUAL_QUALITY_DIMENSIONS.length, 12);
  assert.equal(new Set(VISUAL_QUALITY_DIMENSIONS.map((dimension) => dimension.key)).size, 12);
});

test("evaluateVisualQualityScore: resposta completa com notas altas — overallScore correto, belowThreshold false", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(allDimensionsResponse(8)) }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });

  assert.ok(result);
  assert.equal(result.overallScore, 8);
  assert.equal(result.belowThreshold, false);
  assert.equal(result.dimensions.length, 12);
  assert.equal(result.weakDimensions.length, 0);
});

test("evaluateVisualQualityScore: média abaixo do piso geral vira belowThreshold, mesmo sem nenhuma dimensão isoladamente crítica", async () => {
  // 5 está acima do piso individual (4) mas abaixo da média mínima (6.5) — testa o piso da MÉDIA,
  // não o piso por dimensão.
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(allDimensionsResponse(5)) }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });

  assert.ok(result.overallScore < VISUAL_QUALITY_MIN_OVERALL_SCORE);
  assert.equal(result.belowThreshold, true);
  assert.equal(result.weakDimensions.length, 0, "5 está acima do piso POR DIMENSÃO — nenhuma deveria entrar em weakDimensions");
});

test("evaluateVisualQualityScore: uma única dimensão abaixo do piso individual reprova sozinha, mesmo com média alta nas outras 11", async () => {
  const body = allDimensionsResponse(9);
  body.legibility = { score: 2, justification: "CTA ilegível sobre o fundo claro" };
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(body) }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });

  assert.ok(result.overallScore >= VISUAL_QUALITY_MIN_OVERALL_SCORE, "a média das outras 11 dimensões deveria compensar — o piso por dimensão é quem reprova aqui");
  assert.equal(result.belowThreshold, true);
  assert.equal(result.weakDimensions.length, 1);
  assert.equal(result.weakDimensions[0].key, "legibility");
  assert.ok(result.weakDimensions[0].score < VISUAL_QUALITY_MIN_DIMENSION_SCORE);
});

test("evaluateVisualQualityScore: dimensão ausente na resposta devolve undefined, nunca inventa uma nota", async () => {
  const body = allDimensionsResponse(8);
  delete body.commercialStrength;
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(body) }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });
  assert.equal(result, undefined);
});

test("evaluateVisualQualityScore: nota fora de 0-10 devolve undefined, nunca clampa silenciosamente", async () => {
  const body = allDimensionsResponse(8);
  body.legibility = { score: 15, justification: "x" };
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(body) }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });
  assert.equal(result, undefined);
});

test("evaluateVisualQualityScore: resposta não-completed devolve undefined, nunca bloqueia por conta própria (best-effort)", async () => {
  const icaro = { request: async () => ({ status: "failed" }) };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });
  assert.equal(result, undefined);
});

test("evaluateVisualQualityScore: exceção na chamada (timeout, JSON ilegível) devolve undefined, nunca lança", async () => {
  const icaro = { request: async () => { throw new Error("timeout"); } };
  const result = await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });
  assert.equal(result, undefined);
});

test("evaluateVisualQualityScore: prompt inclui a direção de arte planejada da peça (conceito, foco, hierarquia, paleta)", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => {
      capturedPrompt = request.prompt;
      return { status: "completed", content: JSON.stringify(allDimensionsResponse(8)) };
    },
  };
  await evaluateVisualQualityScore(icaro, {
    finalImageUrl: "https://x/final.jpg",
    plan: basePlan(),
    brandColors: ["preto", "verde", "amarelo"],
    specialistId: "gpt-creative-director",
  });
  assert.match(capturedPrompt, /Fundo grafite quase preto com feixe de luz verde neon diagonal/);
  assert.match(capturedPrompt, /mockup do site > headline > cta > logo/);
  assert.match(capturedPrompt, /preto, verde, amarelo/);
});

test("evaluateVisualQualityScore: sem brandColors configurado, o prompt nunca inventa uma paleta", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => {
      capturedPrompt = request.prompt;
      return { status: "completed", content: JSON.stringify(allDimensionsResponse(8)) };
    },
  };
  await evaluateVisualQualityScore(icaro, { finalImageUrl: "https://x/final.jpg", plan: basePlan(), specialistId: "gpt-creative-director" });
  assert.match(capturedPrompt, /Nenhuma paleta oficial configurada/);
});

test("buildAestheticRepairInstructions: com dimensões críticas (abaixo do piso individual), usa SÓ elas — nunca as 12", () => {
  const result = {
    overallScore: 7,
    belowThreshold: true,
    weakDimensions: [{ key: "legibility", label: "legibilidade", score: 2, justification: "CTA ilegível sobre o fundo claro" }],
    dimensions: VISUAL_QUALITY_DIMENSIONS.map((dimension) => ({ ...dimension, score: dimension.key === "legibility" ? 2 : 8, justification: "x" })),
  };
  const instructions = buildAestheticRepairInstructions(result);
  assert.equal(instructions.length, 1);
  assert.match(instructions[0], /legibilidade/);
  assert.match(instructions[0], /CTA ilegível sobre o fundo claro/);
});

test("buildAestheticRepairInstructions: sem dimensão crítica isolada mas média baixa, usa as 3 piores notas", () => {
  const dims = VISUAL_QUALITY_DIMENSIONS.map((dimension, index) => ({ ...dimension, score: 5 + (index % 3), justification: `nota ${5 + (index % 3)}` }));
  const result = { overallScore: 5.9, belowThreshold: true, weakDimensions: [], dimensions: dims };
  const instructions = buildAestheticRepairInstructions(result);
  assert.equal(instructions.length, 3);
  const sorted = [...dims].sort((a, b) => a.score - b.score).slice(0, 3);
  assert.deepEqual(instructions, sorted.map((dimension) => `[Qualidade visual — ${dimension.label}, nota ${dimension.score.toFixed(1)}/10] ${dimension.justification}`));
});
