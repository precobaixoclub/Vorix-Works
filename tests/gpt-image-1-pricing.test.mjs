import test from "node:test";
import assert from "node:assert/strict";
import { estimateGptImage1CostUsd } from "../dist/infrastructure/ai-providers/gpt-image-1-pricing.js";

/**
 * Auditoria de custo urgente do motor criativo — achado crítico: `OpenAiCreativeImageProvider`
 * sempre devolvia custo $0 para geração de imagem (o passo mais caro do pipeline). Estes testes
 * travam a estimativa nova — sempre uma ESTIMATIVA (a API de imagens não devolve uso real de
 * tokens), nunca $0, e sempre crescente com qualidade/tamanho/referência.
 */

test("estimateGptImage1CostUsd: nunca devolve zero para nenhuma combinação de tamanho/qualidade", () => {
  for (const size of ["1024x1024", "1024x1536", "1536x1024"]) {
    for (const quality of ["low", "medium", "high"]) {
      const cost = estimateGptImage1CostUsd({ size, quality, promptChars: 1000, hasReferenceImage: false });
      assert.ok(cost > 0, `${size}/${quality} deveria custar mais que zero, veio ${cost}`);
    }
  }
});

test("estimateGptImage1CostUsd: qualidade 'high' custa MUITO mais que 'low' (mesma proporção de mercado do gpt-image-1 — não é uma diferença sutil)", () => {
  const low = estimateGptImage1CostUsd({ size: "1024x1536", quality: "low", promptChars: 1000, hasReferenceImage: false });
  const high = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1000, hasReferenceImage: false });
  assert.ok(high > low * 10, `esperava "high" pelo menos 10x mais caro que "low", veio high=${high} low=${low}`);
});

test("estimateGptImage1CostUsd: tamanho retrato/paisagem (1024x1536 / 1536x1024) custa mais que quadrado (1024x1024) na mesma qualidade", () => {
  const square = estimateGptImage1CostUsd({ size: "1024x1024", quality: "high", promptChars: 1000, hasReferenceImage: false });
  const portrait = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1000, hasReferenceImage: false });
  assert.ok(portrait > square, `esperava 1024x1536 mais caro que 1024x1024, veio portrait=${portrait} square=${square}`);
});

test("estimateGptImage1CostUsd: imagem de referência (edits, produto real) sempre adiciona custo, nunca reduz", () => {
  const withoutRef = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1000, hasReferenceImage: false });
  const withRef = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1000, hasReferenceImage: true });
  assert.ok(withRef > withoutRef);
});

test("estimateGptImage1CostUsd: prompt mais longo custa mais (texto de entrada também é cobrado), mas nunca domina o custo (saída de imagem é o principal)", () => {
  const shortPrompt = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 200, hasReferenceImage: false });
  const longPrompt = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 4000, hasReferenceImage: false });
  assert.ok(longPrompt > shortPrompt);
  assert.ok(longPrompt < shortPrompt * 1.5, "o texto do prompt nunca deveria dominar o custo da imagem de saída");
});

test("estimateGptImage1CostUsd: 1024x1536 em qualidade 'high' (formato 4:5/9:16, config atual de produção) fica na faixa de ~$0.24-0.27 sem referência, ~$0.26-0.28 com referência", () => {
  const withoutRef = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1200, hasReferenceImage: false });
  const withRef = estimateGptImage1CostUsd({ size: "1024x1536", quality: "high", promptChars: 1200, hasReferenceImage: true });
  assert.ok(withoutRef > 0.2 && withoutRef < 0.3, `esperava ~$0.24-0.27, veio ${withoutRef}`);
  assert.ok(withRef > 0.2 && withRef < 0.3, `esperava ~$0.26-0.28, veio ${withRef}`);
});
