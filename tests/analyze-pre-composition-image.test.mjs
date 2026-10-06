import test from "node:test";
import assert from "node:assert/strict";
import { analyzePreCompositionImage, checkGlobalTextLegibility } from "../dist/application/creative-engine/analyze-pre-composition-image.js";

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

// ---------------------------------------------------------------------------------------------
// ETAPA 3.2 (Rodada 4) — bbox/confidence por achado, e a checagem GLOBAL pós-tratamento.
// ---------------------------------------------------------------------------------------------

test("analyzePreCompositionImage: parseia bbox/confidence por achado de texto espúrio", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({
        spuriousTexts: [{ text: "R$ 149,00", classification: "duplicated_text", bbox: { xPct: 60, yPct: 70, widthPct: 20, heightPct: 8 }, confidence: 0.85 }],
      }),
    }),
  };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.deepEqual(result.spuriousTexts[0].bbox, { xPct: 60, yPct: 70, widthPct: 20, heightPct: 8 });
  assert.equal(result.spuriousTexts[0].confidence, 0.85);
});

test("analyzePreCompositionImage: bbox malformada (fora dos limites/campo faltando) vira undefined, nunca derruba o achado inteiro", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ spuriousTexts: [{ text: "x", classification: "unauthorized_text", bbox: { xPct: -5, yPct: 0, widthPct: 10, heightPct: 10 } }] }),
    }),
  };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result.spuriousTexts.length, 1);
  assert.equal(result.spuriousTexts[0].bbox, undefined);
});

test("analyzePreCompositionImage: confidence fora de 0-1 é clampado, nunca rejeitado", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({ spuriousTexts: [{ text: "x", classification: "unauthorized_text", confidence: 1.5 }] }) }) };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result.spuriousTexts[0].confidence, 1);
});

test("analyzePreCompositionImage: múltiplas ocorrências do MESMO texto viram entradas SEPARADAS, cada uma com sua própria bbox", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({
        spuriousTexts: [
          { text: "R$ 149,00", classification: "duplicated_text", bbox: { xPct: 10, yPct: 10, widthPct: 20, heightPct: 8 } },
          { text: "R$ 149,00", classification: "duplicated_text", bbox: { xPct: 60, yPct: 70, widthPct: 20, heightPct: 8 } },
        ],
      }),
    }),
  };
  const result = await analyzePreCompositionImage(icaro, baseInput());
  assert.equal(result.spuriousTexts.length, 2);
  assert.notDeepEqual(result.spuriousTexts[0].bbox, result.spuriousTexts[1].bbox);
});

test("checkGlobalTextLegibility: hasUnresolvedText=false explícito -> limpo, sem achados residuais", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({ hasUnresolvedText: false }) }) };
  const result = await checkGlobalTextLegibility(icaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" });
  assert.equal(result.hasUnresolvedText, false);
  assert.deepEqual(result.residualFindings, []);
});

test("checkGlobalTextLegibility: hasUnresolvedText=true -> ainda tem problema", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({ hasUnresolvedText: true }) }) };
  const result = await checkGlobalTextLegibility(icaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" });
  assert.equal(result.hasUnresolvedText, true);
});

test("checkGlobalTextLegibility: conservador — resposta falha/ambígua conta como 'ainda tem problema', nunca declara limpo sem confirmação", async () => {
  const failedIcaro = { request: async () => ({ status: "failed" }) };
  assert.equal((await checkGlobalTextLegibility(failedIcaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" })).hasUnresolvedText, true);

  const ambiguousIcaro = { request: async () => ({ status: "completed", content: JSON.stringify({}) }) };
  assert.equal((await checkGlobalTextLegibility(ambiguousIcaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" })).hasUnresolvedText, true);
});

test("checkGlobalTextLegibility: exceção na chamada nunca lança — conservador (true)", async () => {
  const icaro = { request: async () => { throw new Error("timeout"); } };
  const result = await checkGlobalTextLegibility(icaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" });
  assert.equal(result.hasUnresolvedText, true);
});

// ---------------------------------------------------------------------------------------------
// ETAPA 3.3.3 (Rodada 4) — achado da auditoria de falsos positivos: texto legível DENTRO da logo
// real colada (ex.: um wordmark/placeholder do próprio asset, confirmado contra uma imagem real
// de produção) estava sendo flagrado como "não autorizado". `logoRegion` passa a geometria REAL
// do asset — nunca uma whitelist de palavras — pra visão poder excluir especificamente aquela
// área, preservando a detecção normal fora dela.
// ---------------------------------------------------------------------------------------------

test("checkGlobalTextLegibility: com logoRegion informada, o prompt menciona a geometria exata do asset real e instrui a exceção", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => { capturedPrompt = request.prompt; return { status: "completed", content: JSON.stringify({ hasUnresolvedText: false }) }; },
  };
  await checkGlobalTextLegibility(icaro, {
    imageUrl: "https://x/base.png",
    allowedRenderedTexts: ["x"],
    specialistId: "gpt-creative-director",
    logoRegion: { xPct: 5, yPct: 5, widthPct: 20, heightPct: 10 },
  });
  assert.match(capturedPrompt, /x=5%-25%/);
  assert.match(capturedPrompt, /y=5%-15%/);
  assert.match(capturedPrompt, /NUNCA invenção do modelo/);
});

test("checkGlobalTextLegibility: sem logoRegion (peça sem logo), o prompt nunca menciona a exceção de logo", async () => {
  let capturedPrompt;
  const icaro = {
    request: async (request) => { capturedPrompt = request.prompt; return { status: "completed", content: JSON.stringify({ hasUnresolvedText: false }) }; },
  };
  await checkGlobalTextLegibility(icaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" });
  assert.doesNotMatch(capturedPrompt, /LOGO OFICIAL da marca foi colada/);
});

test("checkGlobalTextLegibility: achado residual com bbox/classification/confidence é parseado (ETAPA 3.3 — nunca só um booleano)", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({
        hasUnresolvedText: true,
        spuriousTexts: [{ text: "R$ 149,00", classification: "duplicated_text", bbox: { xPct: 60, yPct: 70, widthPct: 20, heightPct: 8 }, confidence: 0.77 }],
      }),
    }),
  };
  const result = await checkGlobalTextLegibility(icaro, { imageUrl: "https://x/base.png", allowedRenderedTexts: ["x"], specialistId: "gpt-creative-director" });
  assert.equal(result.hasUnresolvedText, true);
  assert.equal(result.residualFindings.length, 1);
  assert.equal(result.residualFindings[0].text, "R$ 149,00");
  assert.deepEqual(result.residualFindings[0].bbox, { xPct: 60, yPct: 70, widthPct: 20, heightPct: 8 });
  assert.equal(result.residualFindings[0].confidence, 0.77);
});
