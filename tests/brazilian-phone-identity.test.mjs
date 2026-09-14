import { test } from "node:test";
import assert from "node:assert/strict";

import {
  areBrazilianPhonesEquivalent,
  canonicalizeBrazilianPhone,
  generateBrazilianPhoneVariants,
} from "../dist/domain/inbox/brazilian-phone-identity.js";

/**
 * Bloco "réplica de identidade" — canonicalização de telefone brasileiro (regra do 9º dígito),
 * adaptada do relatório do usuário sobre o CMDesk/desk-spark-ai. Mesmo invariante central: para o
 * mesmo número real, `canonicalizeBrazilianPhone` sempre devolve o mesmo `e164`, não importa a
 * variante de entrada.
 */

test("canonicalizeBrazilianPhone: celular sem 9º dígito ganha o 9º dígito", () => {
  const result = canonicalizeBrazilianPhone("554599797500");
  assert.equal(result?.e164, "+5545999797500");
  assert.equal(result?.isMobile, true);
  assert.equal(result?.isValidBrazilian, true);
});

test("canonicalizeBrazilianPhone: celular já com 9º dígito permanece igual", () => {
  const result = canonicalizeBrazilianPhone("+5545999797500");
  assert.equal(result?.e164, "+5545999797500");
});

test("canonicalizeBrazilianPhone: com/sem DDI e formato JID convergem pro mesmo e164", () => {
  const variants = ["45999797500", "554599797500", "+5545999797500", "5545999797500@s.whatsapp.net"];
  const results = variants.map((v) => canonicalizeBrazilianPhone(v)?.e164);
  assert.deepEqual(new Set(results), new Set(["+5545999797500"]));
});

test("canonicalizeBrazilianPhone: fixo (3º dígito fora de {6,7,8,9}) nunca ganha 9º dígito", () => {
  const result = canonicalizeBrazilianPhone("554532221100");
  assert.equal(result?.e164, "+55" + "4532221100");
  assert.equal(result?.isMobile, false);
});

test("canonicalizeBrazilianPhone: DDD inválido marca isValidBrazilian=false mas ainda devolve e164 best-effort", () => {
  const result = canonicalizeBrazilianPhone("5500999797500");
  assert.equal(result?.isValidBrazilian, false);
});

test("canonicalizeBrazilianPhone: undefined para JID de grupo/lid/canal — nunca tratado como telefone", () => {
  assert.equal(canonicalizeBrazilianPhone("123456789012345@lid"), undefined);
  assert.equal(canonicalizeBrazilianPhone("120363999999999999@g.us"), undefined);
  assert.equal(canonicalizeBrazilianPhone("120363111222333444@newsletter"), undefined);
  assert.equal(canonicalizeBrazilianPhone("LID_ABC123"), undefined);
});

test("canonicalizeBrazilianPhone: string vazia ou sem dígitos suficientes nunca lança, devolve undefined", () => {
  assert.equal(canonicalizeBrazilianPhone(""), undefined);
  assert.equal(canonicalizeBrazilianPhone("123"), undefined);
});

test("generateBrazilianPhoneVariants: gera com/sem 9º dígito e formas JID a partir do canônico", () => {
  const variants = generateBrazilianPhoneVariants("+5545999797500");
  assert.ok(variants.includes("45999797500"));
  assert.ok(variants.includes("4599797500"));
  assert.ok(variants.includes("5545999797500"));
  assert.ok(variants.includes("5545999797500@s.whatsapp.net"));
});

test("areBrazilianPhonesEquivalent: mesma pessoa em formatos diferentes é equivalente", () => {
  assert.equal(areBrazilianPhonesEquivalent("554599797500", "+5545999797500"), true);
  assert.equal(areBrazilianPhonesEquivalent("45999797500", "5545999797500@s.whatsapp.net"), true);
});

test("areBrazilianPhonesEquivalent: pessoas diferentes nunca são equivalentes", () => {
  assert.equal(areBrazilianPhonesEquivalent("+5545999797500", "+5545999797501"), false);
});
