import { createHash } from "node:crypto";

/**
 * Normalização e hash de PII pra Custom Audiences / Conversions API — módulo Meta Ads Manager,
 * Fase 4. Regras de normalização são as da documentação da Marketing API (Meta Business Help
 * Center, "About hashing data"): valor SEMPRE normalizado ANTES do SHA-256, senão o hash não bate
 * com o que a Meta calcula do lado dela e o match simplesmente falha silenciosamente (nenhum erro,
 * só um `approximate_count`/match rate mais baixo do que deveria).
 *
 * Este módulo NUNCA loga nem persiste o valor original ou o hash — só devolve a string pro caller
 * enviar direto à Graph API. Ver `meta-capi-event-repository.port.ts` sobre por que o log de
 * auditoria guarda só os NOMES dos campos enviados, nunca o valor.
 */

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `trim` + minúsculas — regra padrão da Meta pra e-mail, nome e sobrenome antes do hash. */
function normalizeLowerTrim(value: string): string {
  return value.trim().toLowerCase();
}

/** Remove tudo que não é dígito e zeros à esquerda — a Meta espera o telefone em E.164 sem o `+`
 * (código do país + número, só dígitos). Não infere código de país: quem chama decide o formato
 * de entrada (ex.: sempre pedir o telefone já com DDI na UI). */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+/, "");
}

export function hashEmail(email: string): string {
  return sha256Hex(normalizeLowerTrim(email));
}

export function hashPhone(phone: string): string {
  return sha256Hex(normalizePhone(phone));
}

export function hashName(name: string): string {
  return sha256Hex(normalizeLowerTrim(name));
}

/** Código de país ISO 3166-1 alpha-2 em minúsculas (ex.: "br") — mesma regra de normalização de
 * `fn`/`ln`, só que sem espaço pra ambiguidade (2 letras fixas). */
export function hashCountryCode(countryCode: string): string {
  return sha256Hex(countryCode.trim().toLowerCase());
}

export type HashablePiiInput = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  countryCode?: string;
};

/** Hasheia todos os campos presentes em `input`, devolvendo só as chaves da Marketing API que
 * tiverem valor (`em`, `ph`, `fn`, `ln`, `country`) — nunca envia uma chave vazia, a Meta trata
 * `""` como um valor real e o hash correspondente nunca dá match. */
export function hashPiiFields(input: HashablePiiInput): Partial<Record<"em" | "ph" | "fn" | "ln" | "country", string>> {
  const result: Partial<Record<"em" | "ph" | "fn" | "ln" | "country", string>> = {};
  if (input.email) result.em = hashEmail(input.email);
  if (input.phone) result.ph = hashPhone(input.phone);
  if (input.firstName) result.fn = hashName(input.firstName);
  if (input.lastName) result.ln = hashName(input.lastName);
  if (input.countryCode) result.country = hashCountryCode(input.countryCode);
  return result;
}
