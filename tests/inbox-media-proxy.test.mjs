import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRangeHeader, sanitizeContentDispositionFileName } from "../dist/interfaces/api/routes/v1/inbox.route.js";

/**
 * Bloco "Mídia — proxy" (ver docs/conversas-inbox-organization-media-runtime.md) — suporte a HTTP
 * Range (essencial pra seek de áudio/vídeo, RFC 7233 forma simples) e sanitização de nome de
 * arquivo pro header Content-Disposition (nunca o `fileName` cru do usuário direto num header HTTP).
 */

test("parseRangeHeader: sem header Range devolve undefined (corpo inteiro)", () => {
  assert.equal(parseRangeHeader(undefined, 1000), undefined);
});

test("parseRangeHeader: bytes=0-499 (início do arquivo)", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-499", 1000), { start: 0, end: 499 });
});

test("parseRangeHeader: bytes=500- (do meio até o fim)", () => {
  assert.deepEqual(parseRangeHeader("bytes=500-", 1000), { start: 500, end: 999 });
});

test("parseRangeHeader: bytes=-500 (últimos 500 bytes)", () => {
  assert.deepEqual(parseRangeHeader("bytes=-500", 1000), { start: 500, end: 999 });
});

test("parseRangeHeader: range fora dos limites do arquivo nunca lança — cai pro corpo inteiro", () => {
  assert.equal(parseRangeHeader("bytes=0-9999", 1000), undefined);
  assert.equal(parseRangeHeader("bytes=2000-3000", 1000), undefined);
});

test("parseRangeHeader: start > end é inválido", () => {
  assert.equal(parseRangeHeader("bytes=500-100", 1000), undefined);
});

test("parseRangeHeader: header malformado nunca lança", () => {
  assert.equal(parseRangeHeader("not-a-range", 1000), undefined);
  assert.equal(parseRangeHeader("bytes=abc-def", 1000), undefined);
  assert.equal(parseRangeHeader("", 1000), undefined);
});

test("sanitizeContentDispositionFileName: remove aspas e quebras de linha (nunca quebra o header HTTP)", () => {
  assert.equal(sanitizeContentDispositionFileName('contrato "final".pdf'), "contrato final.pdf");
  assert.equal(sanitizeContentDispositionFileName("nome\r\ncom\nquebras.pdf"), "nomecomquebras.pdf");
});

test("sanitizeContentDispositionFileName: nome vazio cai no fallback", () => {
  assert.equal(sanitizeContentDispositionFileName(""), "documento");
});

test("sanitizeContentDispositionFileName: trunca nomes absurdamente longos", () => {
  const huge = "a".repeat(500) + ".pdf";
  assert.equal(sanitizeContentDispositionFileName(huge).length, 200);
});
