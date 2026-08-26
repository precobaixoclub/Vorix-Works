import test from "node:test";
import assert from "node:assert/strict";
import { computeCropSafeMarginPct } from "../dist/shared/utils/image-crop-geometry.js";

// Auditoria "motor de geração de criativos" — achado ao vivo: um CTA saiu cortado na borda
// inferior do canvas mesmo com uma margem de segurança de 6% já instruída ao modelo de imagem —
// porque gpt-image-1 não suporta 4:5/9:16/16:9 nativamente (só quadrado/retrato/paisagem fixos),
// e o resultado é cortado, centralizado, pra proporção exata DEPOIS da geração
// (`cropToTargetAspectRatio`, infraestrutura). O modelo desenha sobre o canvas NATIVO (maior que
// o final) sem saber que uma faixa das bordas será removida — 6% era um valor arbitrário, nunca a
// margem real. Estes valores foram calculados à mão a partir da mesma matemática do corte real
// (ver comentário em `image-crop-geometry.ts`) e cross-checados manualmente nesta auditoria.

test("computeCropSafeMarginPct: 4:5 (nativo 1024x1536) precisa de 8.3% de margem vertical", () => {
  assert.equal(computeCropSafeMarginPct("4:5"), 8.3);
});

test("computeCropSafeMarginPct: 9:16 (nativo 1024x1536) precisa de 7.8% de margem horizontal", () => {
  assert.equal(computeCropSafeMarginPct("9:16"), 7.8);
});

test("computeCropSafeMarginPct: 16:9 (nativo 1536x1024) precisa de 7.8% de margem vertical", () => {
  assert.equal(computeCropSafeMarginPct("16:9"), 7.8);
});

test("computeCropSafeMarginPct: 1:1 (proporção nativa já bate, sem corte) devolve undefined", () => {
  assert.equal(computeCropSafeMarginPct("1:1"), undefined);
});

test("computeCropSafeMarginPct: formato desconhecido/ausente devolve undefined, nunca lança", () => {
  assert.equal(computeCropSafeMarginPct(undefined), undefined);
  assert.equal(computeCropSafeMarginPct(""), undefined);
  assert.equal(computeCropSafeMarginPct("banner"), undefined);
  assert.equal(computeCropSafeMarginPct("3:2"), undefined);
});
