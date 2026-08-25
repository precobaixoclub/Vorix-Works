import test from "node:test";
import assert from "node:assert/strict";
import { computeContrastRatio, isValidHexColor, pickReadableTextColor } from "../dist/shared/utils/color-contrast.js";

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

test("pickReadableTextColor: escolhe branco sobre fundo escuro (indigo — caso real que reprovou o quality gate)", () => {
  assert.equal(pickReadableTextColor("#4338CA"), "#FFFFFF");
});

test("pickReadableTextColor: escolhe preto sobre fundo claro (amarelo)", () => {
  assert.equal(pickReadableTextColor("#FACC15"), "#111111");
});

test("pickReadableTextColor: cor de fundo não-hex cai para o padrão escuro, nunca lança", () => {
  assert.equal(pickReadableTextColor("transparent"), "#111111");
});

test("pickReadableTextColor: aceita cores light/dark customizadas", () => {
  assert.equal(pickReadableTextColor("#000000", "#EEEEEE", "#222222"), "#EEEEEE");
});

// Achado ao vivo em produção: `brandColors[0]` era "verde" (nome de cor livre em português, não
// hex) — um consumidor que usa essa string direto como `backgroundColor` CSS sem validar antes
// (o renderer determinístico de zonas de texto) fazia o texto sair invisível: fundo indefinido +
// `pickReadableTextColor` caindo no texto escuro padrão, tudo sobre uma imagem de fundo escura.

test("isValidHexColor: aceita hex de 6 e 3 dígitos, com ou sem #", () => {
  assert.equal(isValidHexColor("#FACC15"), true);
  assert.equal(isValidHexColor("FACC15"), true);
  assert.equal(isValidHexColor("#FFF"), true);
});

test("isValidHexColor: rejeita nome de cor livre (ex.: 'verde', caso real de brandColors[0])", () => {
  assert.equal(isValidHexColor("verde"), false);
  assert.equal(isValidHexColor("transparent"), false);
  assert.equal(isValidHexColor(""), false);
});
