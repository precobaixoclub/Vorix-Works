import { test } from "node:test";
import assert from "node:assert/strict";

import { encryptSecret, decryptSecret, last4 } from "../dist/infrastructure/crypto/secret-cipher.js";

test("secret-cipher: encrypt+decrypt round-trip", () => {
  const key = "master-secret-abcdef1234567890";
  const plaintext = "sk-ant-api03-abc123def456";
  const encoded = encryptSecret(plaintext, key);
  assert.notEqual(encoded, plaintext);
  assert.equal(decryptSecret(encoded, key), plaintext);
});

test("secret-cipher: cifras subsequentes são diferentes (IV aleatório) mas decifram no mesmo plaintext", () => {
  const key = "kkkkkkkkkkkkkkkkkk";
  const plaintext = "hello world";
  const a = encryptSecret(plaintext, key);
  const b = encryptSecret(plaintext, key);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, key), plaintext);
  assert.equal(decryptSecret(b, key), plaintext);
});

test("secret-cipher: chave mestra diferente falha na decifra", () => {
  const encoded = encryptSecret("segredo", "chave-1");
  assert.throws(() => decryptSecret(encoded, "chave-2"));
});

test("secret-cipher: last4 pega apenas os últimos 4 caracteres", () => {
  assert.equal(last4("sk-ant-api03-abc123def456"), "f456");
  assert.equal(last4("abc"), "abc");
});
