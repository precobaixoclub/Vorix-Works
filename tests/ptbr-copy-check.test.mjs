import test from "node:test";
import assert from "node:assert/strict";
import { describePtBrCopyWarnings, findPtBrMissingAccents } from "../dist/shared/utils/ptbr-copy-check.js";

test("copy pt-BR: aponta palavras óbvias sem acento (cenário B) sem corrigir", () => {
  const fields = {
    headline: "O casamento organizado como voces sonharam",
    subheadline: "Site, lista de presentes e confirmacao de presenca em um so lugar.",
    cta: "Conheca o Rumo ao Altar",
  };
  const warnings = findPtBrMissingAccents(fields);
  assert.deepEqual(warnings.map((item) => `${item.field}:${item.word}>${item.suggestion}`), [
    "headline:voces>vocês",
    "subheadline:confirmacao>confirmação",
    "subheadline:presenca>presença",
    "subheadline:so>só",
    "cta:Conheca>conheça",
  ]);
  assert.equal(fields.cta, "Conheca o Rumo ao Altar", "nunca autocorrige o texto de entrada");
  assert.match(describePtBrCopyWarnings(warnings), /cta: "Conheca" → "conheça"\?/);
});

test("copy pt-BR: copy acentuada correta não gera aviso", () => {
  assert.deepEqual(findPtBrMissingAccents({
    headline: "O casamento organizado como vocês sonharam",
    subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.",
    cta: "Conheça o Rumo ao Altar",
  }), []);
});

test("copy pt-BR: palavras que também são formas válidas sem acento não geram falso positivo", () => {
  assert.deepEqual(findPtBrMissingAccents({ headline: "Eu pratico, numero e pagina tudo até sexta", cta: "Comece agora" }), []);
});
