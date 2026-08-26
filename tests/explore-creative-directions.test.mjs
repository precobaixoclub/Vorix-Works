import test from "node:test";
import assert from "node:assert/strict";
import { exploreCreativeDirections } from "../dist/application/creative-engine/explore-creative-directions.js";

/**
 * Auditoria "qualidade visual e direção de arte", pontos 9 (exploração barata de 2-3
 * micro-direções antes da geração cara) e 10 (detecção de repetição visual entre gerações — via
 * `context.recentHistory`, já existente antes desta auditoria).
 */

function baseContext(overrides = {}) {
  return {
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

function validExplorationResponse(overrides = {}) {
  return {
    candidates: [
      { name: "Editorial", coreIdea: "Fundo grafite com tipografia grande, sem mockup", whyItFits: "Foca na mensagem, não no produto", originalityScore: 6 },
      { name: "Produto protagonista", coreIdea: "Mockup do site ocupando 60% do canvas, headline pequena acima", whyItFits: "Deixa o site falar por si", originalityScore: 7 },
    ],
    chosenIndex: 1,
    chosenReasoning: "Melhor equilíbrio entre originalidade e clareza do produto",
    ...overrides,
  };
}

test("exploreCreativeDirections: resposta válida devolve os candidatos e a direção escolhida", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(validExplorationResponse()) }) };
  const result = await exploreCreativeDirections(icaro, baseContext(), { specialistId: "gpt-creative-director" });

  assert.ok(result);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.chosenIndex, 1);
  assert.equal(result.candidates[result.chosenIndex].name, "Produto protagonista");
  assert.match(result.chosenReasoning, /equilíbrio/);
});

test("exploreCreativeDirections: usa taskType text_generation — nunca colide com a contagem de chamadas do plano (analysis) nem dos gates (review)", async () => {
  let capturedTaskType;
  const icaro = { request: async (request) => { capturedTaskType = request.taskType; return { status: "completed", content: JSON.stringify(validExplorationResponse()) }; } };
  await exploreCreativeDirections(icaro, baseContext(), { specialistId: "gpt-creative-director" });
  assert.equal(capturedTaskType, "text_generation");
});

test("exploreCreativeDirections: propaga executionId/correlationId (rastreabilidade, mesmo padrão do resto do motor)", async () => {
  let captured;
  const icaro = { request: async (request) => { captured = request; return { status: "completed", content: JSON.stringify(validExplorationResponse()) }; } };
  await exploreCreativeDirections(icaro, baseContext(), { specialistId: "gpt-creative-director", executionId: "exec-1", correlationId: "cer-1" });
  assert.equal(captured.executionId, "exec-1");
  assert.equal(captured.correlationId, "cer-1");
});

test("exploreCreativeDirections: menos de 2 ou mais de 3 candidatos devolve undefined, nunca aceita fora do intervalo pedido", async () => {
  const tooFew = { request: async () => ({ status: "completed", content: JSON.stringify(validExplorationResponse({ candidates: [validExplorationResponse().candidates[0]] })) }) };
  assert.equal(await exploreCreativeDirections(tooFew, baseContext(), { specialistId: "x" }), undefined);

  const four = validExplorationResponse().candidates;
  const tooMany = { request: async () => ({ status: "completed", content: JSON.stringify(validExplorationResponse({ candidates: [...four, four[0], four[1]] })) }) };
  assert.equal(await exploreCreativeDirections(tooMany, baseContext(), { specialistId: "x" }), undefined);
});

test("exploreCreativeDirections: chosenIndex fora do range dos candidatos devolve undefined, nunca escolhe por conta própria", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(validExplorationResponse({ chosenIndex: 5 })) }) };
  assert.equal(await exploreCreativeDirections(icaro, baseContext(), { specialistId: "x" }), undefined);
});

test("exploreCreativeDirections: candidato sem coreIdea/whyItFits/originalityScore devolve undefined, nunca inventa o campo ausente", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify(validExplorationResponse({ candidates: [{ name: "x", coreIdea: "y" }, validExplorationResponse().candidates[1]] })) }) };
  assert.equal(await exploreCreativeDirections(icaro, baseContext(), { specialistId: "x" }), undefined);
});

test("exploreCreativeDirections: resposta não-completed ou exceção devolve undefined, nunca bloqueia (best-effort)", async () => {
  const failed = { request: async () => ({ status: "failed" }) };
  assert.equal(await exploreCreativeDirections(failed, baseContext(), { specialistId: "x" }), undefined);

  const throws = { request: async () => { throw new Error("timeout"); } };
  assert.equal(await exploreCreativeDirections(throws, baseContext(), { specialistId: "x" }), undefined);
});

// Ponto 10 da auditoria — o prompt de exploração é o mecanismo real de "evitar repetição visual
// entre gerações": recebe os conceitos recentes do workspace (`context.recentHistory`, já
// existente) e instrui explicitamente a nunca repeti-los.

test("exploreCreativeDirections: com recentHistory, o prompt lista os conceitos visuais recentes e instrui a NUNCA repeti-los", async () => {
  let capturedPrompt;
  const icaro = { request: async (request) => { capturedPrompt = request.prompt; return { status: "completed", content: JSON.stringify(validExplorationResponse()) }; } };
  const context = baseContext({ recentHistory: [{ headline: "x", cta: "y", visualConcept: "Fundo grafite com feixe de luz verde neon diagonal" }] });
  await exploreCreativeDirections(icaro, context, { specialistId: "x" });
  assert.match(capturedPrompt, /NUNCA repita/);
  assert.match(capturedPrompt, /Fundo grafite com feixe de luz verde neon diagonal/);
});

test("exploreCreativeDirections: sem recentHistory, o prompt nunca menciona direções recentes (nada a evitar)", async () => {
  let capturedPrompt;
  const icaro = { request: async (request) => { capturedPrompt = request.prompt; return { status: "completed", content: JSON.stringify(validExplorationResponse()) }; } };
  await exploreCreativeDirections(icaro, baseContext(), { specialistId: "x" });
  assert.doesNotMatch(capturedPrompt, /JÁ USADAS recentemente/);
});
