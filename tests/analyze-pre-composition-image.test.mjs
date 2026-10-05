import test from "node:test";
import assert from "node:assert/strict";
import { analyzePreCompositionImage } from "../dist/application/creative-engine/analyze-pre-composition-image.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — testes do módulo de análise de visão da
 * imagem BASE (antes de qualquer composição determinística). Mesmo padrão best-effort do resto do
 * motor: falha/resposta incompleta nunca lança, devolve `undefined`.
 */

function baseInput(overrides = {}) {
  return {
    imageUrl: "https://x/base.png",
    rendererOwnedZones: [{ kind: "headline", text: "TODAS AS OFERTAS", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" }],
    allowedRenderedTexts: ["TODAS AS OFERTAS", "ACESSE AGORA"],
    hasScreenshotSlot: false,
    specialistId: "gpt-creative-director",
    ...overrides,
  };
}

test("analyzePreCompositionImage: resposta completa — spuriousTexts/plannedZonesClear/regions parseados corretamente", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({
        spuriousTexts: [{ text: "OFERTA ESPECIAL", classification: "ghost_text", matchedZoneKind: "headline" }],
        plannedZonesClear: { headline: false },
        regions: {
          "top-left": { hasText: false, hasProduct: true, hasFace: false, complexity: "medium" },
          "top-right": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" },
          "center-left": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" },
          "center-right": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" },
          "bottom-left": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" },
          "bottom-right": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" },
        },
      }),
    }),
  };
  const result = await analyzePreCompositionImage(icaro, baseInput());

  assert.ok(result);
  assert.equal(result.spuriousTexts.length, 1);
  assert.equal(result.spuriousTexts[0].classification, "ghost_text");
  assert.equal(result.spuriousTexts[0].matchedZoneKind, "headline");
  assert.equal(result.plannedZonesClear.headline, false);
  assert.equal(result.regions["top-left"].hasProduct, true);
  assert.equal(result.regions["top-right"].complexity, "low");
});

test("analyzePreCompositionImage: screenshotSlotLooksFake só é parseado quando hasScreenshotSlot=true", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({ screenshotSlotLooksFake: true }) }) };
  const result = await analyzePreCompositionImage(icaro, baseInput({ hasScreenshotSlot: true }));
  assert.equal(result.screenshotSlotLooksFake, true);
});

test("analyzePreCompositionImage: campos ausentes viram valores neutros, nunca rejeitam a resposta inteira", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({}) }) };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.ok(result);
  assert.deepEqual(result.spuriousTexts, []);
  assert.deepEqual(result.plannedZonesClear, {});
  assert.deepEqual(result.regions, {});
  assert.equal(result.screenshotSlotLooksFake, undefined);
});

test("analyzePreCompositionImage: item de spuriousTexts com classification desconhecida é descartado, nunca derruba a resposta inteira", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ spuriousTexts: [{ text: "x", classification: "algo_novo" }, { text: "OFERTA", classification: "unauthorized_text" }] }),
    }),
  };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result.spuriousTexts.length, 1);
  assert.equal(result.spuriousTexts[0].text, "OFERTA");
});

test("analyzePreCompositionImage: resposta 'failed' nunca bloqueia (best-effort) — devolve undefined", async () => {
  const icaro = { request: async () => ({ status: "failed" }) };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result, undefined);
});

test("analyzePreCompositionImage: exceção na chamada (timeout, JSON ilegível) nunca lança — devolve undefined", async () => {
  const icaro = { request: async () => { throw new Error("timeout"); } };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result, undefined);
});

test("analyzePreCompositionImage: prompt inclui a lista fechada de textos autorizados e as zonas do renderer com retângulo", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => {
      capturedPrompt = request.prompt;
      return { status: "completed", content: JSON.stringify({}) };
    },
  };
  await analyzePreCompositionImage(icaro, baseInput());
  assert.match(capturedPrompt, /TODAS AS OFERTAS/);
  assert.match(capturedPrompt, /headline: x=5%-95%, y=5%-25%/);
});

test("analyzePreCompositionImage: sem screenshot slot, o prompt nunca menciona a pergunta de slot falso", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => {
      capturedPrompt = request.prompt;
      return { status: "completed", content: JSON.stringify({}) };
    },
  };
  await analyzePreCompositionImage(icaro, baseInput({ hasScreenshotSlot: false }));
  assert.doesNotMatch(capturedPrompt, /screenshotSlotLooksFake/);
});

test("analyzePreCompositionImage: com screenshot slot, o prompt pede o campo screenshotSlotLooksFake", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => {
      capturedPrompt = request.prompt;
      return { status: "completed", content: JSON.stringify({}) };
    },
  };
  await analyzePreCompositionImage(icaro, baseInput({ hasScreenshotSlot: true }));
  assert.match(capturedPrompt, /screenshotSlotLooksFake/);
});
