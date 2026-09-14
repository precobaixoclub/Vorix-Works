import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyWhatsAppJid, isPersonJid, normalizeAliasValue, resolveWhatsAppPersonIdentity } from "../dist/domain/inbox/whatsapp-identity.js";

/**
 * Bloco "Identity UX" (ver docs/conversas-whatsapp-experience-completion.md) — telefone como pivô
 * central da pessoa, LID/PN só como aliases técnicos, resolvidos SOMENTE a partir de dado real do
 * provider (`SenderAlt`/`RecipientAlt`), nunca por heurística.
 */

test("classifyWhatsAppJid: reconhece pn/lid/group/newsletter/unknown pelo sufixo", () => {
  assert.equal(classifyWhatsAppJid("5511999998888@s.whatsapp.net"), "pn");
  assert.equal(classifyWhatsAppJid("123456789012345@lid"), "lid");
  assert.equal(classifyWhatsAppJid("120363999999999999@g.us"), "group");
  assert.equal(classifyWhatsAppJid("120363111222333444@newsletter"), "newsletter");
  assert.equal(classifyWhatsAppJid("algo-inesperado"), "unknown");
});

test("isPersonJid: só pn/lid são pessoa — grupo e canal nunca são", () => {
  assert.equal(isPersonJid("5511999998888@s.whatsapp.net"), true);
  assert.equal(isPersonJid("123456789012345@lid"), true);
  assert.equal(isPersonJid("120363999999999999@g.us"), false);
  assert.equal(isPersonJid("120363111222333444@newsletter"), false);
});

test("normalizeAliasValue: extrai dígitos e prefixa +, remove sufixo de device", () => {
  assert.equal(normalizeAliasValue("5511999998888@s.whatsapp.net"), "+5511999998888");
  assert.equal(normalizeAliasValue("5511999998888.0:1@s.whatsapp.net"), "+5511999998888");
});

test("resolveWhatsAppPersonIdentity: só PN (sem LID) — telefone conhecido, lid ausente", () => {
  const result = resolveWhatsAppPersonIdentity("5511999998888@s.whatsapp.net");
  assert.equal(result.phoneE164, "+5511999998888");
  assert.equal(result.pn, "+5511999998888");
  assert.equal(result.lid, undefined);
});

test("resolveWhatsAppPersonIdentity: só LID, sem SenderAlt — telefone DESCONHECIDO (pivô degradado documentado)", () => {
  const result = resolveWhatsAppPersonIdentity("123456789012345@lid");
  assert.equal(result.phoneE164, undefined, "sem o *Alt do provider, não há como saber o telefone real — nunca inventar");
  assert.equal(result.lid, "+123456789012345");
  assert.equal(result.pn, undefined);
});

test("resolveWhatsAppPersonIdentity: LID com RecipientAlt/SenderAlt real (evidência do provider) — telefone resolvido com segurança", () => {
  const result = resolveWhatsAppPersonIdentity("123456789012345@lid", "5511999998888@s.whatsapp.net");
  assert.equal(result.phoneE164, "+5511999998888", "o *Alt real do provider é a ÚNICA fonte aceitável pra ligar LID a telefone — não heurística");
  assert.equal(result.lid, "+123456789012345");
  assert.equal(result.pn, "+5511999998888");
});

test("resolveWhatsAppPersonIdentity: ordem invertida (jid=PN, altJid=LID) produz o mesmo resultado — não assume qual slot é qual", () => {
  const result = resolveWhatsAppPersonIdentity("5511999998888@s.whatsapp.net", "123456789012345@lid");
  assert.equal(result.phoneE164, "+5511999998888");
  assert.equal(result.pn, "+5511999998888");
  assert.equal(result.lid, "+123456789012345");
});

test("resolveWhatsAppPersonIdentity: altJid vazio/ausente não quebra nada", () => {
  const result = resolveWhatsAppPersonIdentity("5511999998888@s.whatsapp.net", "");
  assert.equal(result.phoneE164, "+5511999998888");
  assert.equal(result.lid, undefined);
});
