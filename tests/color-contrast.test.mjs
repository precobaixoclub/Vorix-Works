import test from "node:test";
import assert from "node:assert/strict";
import { computeContrastRatio } from "../dist/shared/utils/color-contrast.js";

test("computeContrastRatio: preto sobre branco tem contraste máximo (21:1)", () => {
  const ratio = computeContrastRatio("#000000", "#FFFFFF");
  assert.ok(Math.abs(ratio - 21) < 0.01, `esperava ~21:1, veio ${ratio}`);
});

test("computeContrastRatio: mesma cor sobre si mesma tem contraste 1:1 (ilegível)", () => {
  const ratio = computeContrastRatio("#777777", "#777777");
  assert.ok(Math.abs(ratio - 1) < 0.01);
});

test("computeContrastRatio: amarelo claro sobre branco tem contraste baixo (caso real do PriceBlock em fundo claro)", () => {
  const ratio = computeContrastRatio("#FACC15", "#FFFFFF");
  assert.ok(ratio < 2, `esperava contraste bem baixo, veio ${ratio}`);
});

test("computeContrastRatio: cor não-hex (ex.: nome de cor livre da paleta da marca) nunca lança, devolve undefined", () => {
  assert.equal(computeContrastRatio("verde neon", "#FFFFFF"), undefined);
  assert.equal(computeContrastRatio("transparent", "#000000"), undefined);
});

test("computeContrastRatio: aceita hex de 3 dígitos", () => {
  const ratio = computeContrastRatio("#000", "#FFF");
  assert.ok(Math.abs(ratio - 21) < 0.01);
});
