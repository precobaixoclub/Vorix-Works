import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifra segredos (ex.: API key da Anthropic guardada em `platform_ai_settings`) com AES-256-GCM.
 * A chave de 32 bytes é DERIVADA determinísticamente de um segredo mestre (ex.: `JWT_SECRET`) —
 * evita adicionar uma nova variável de ambiente, mas ainda garante que trocar `JWT_SECRET`
 * invalida os segredos em repouso (comportamento intencional: rotação obrigatória).
 *
 * Formato do ciphertext (armazenado como base64 único): `iv (12 bytes) | authTag (16) | ciphertext`.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(masterSecret: string): Buffer {
  if (!masterSecret) throw new Error("SECRET_ENCRYPTION_MASTER_MISSING: chave mestra vazia.");
  return createHash("sha256").update(masterSecret).digest();
}

export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error("SECRET_DECRYPT_INVALID_PAYLOAD");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function last4(value: string): string {
  return value.length <= 4 ? value : value.slice(-4);
}
