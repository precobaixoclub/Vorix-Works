import { canonicalizeBrazilianPhone } from "../inbox/brazilian-phone-identity.js";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Telefone do contato do CRM — o celular é o pivô de tudo (conversa, oportunidade, proposta).
 * O WhatsApp às vezes só informa um LID (identificador técnico, ~15 dígitos, não é telefone);
 * contato que só tem LID não tem número de verdade.
 *
 * Fontes, por ordem de confiança:
 * 1. `whatsapp_pn` informado pelo próprio WhatsApp (alias telefone da pessoa);
 * 2. `phone_normalized` do contato da conversa, quando NÃO é o próprio LID;
 * 3. identidade cadastrada à mão (número digitado no CRM).
 */
export type ContactPhoneSource = { phoneNormalized?: string; whatsappPn?: string; whatsappLid?: string; manualExternalId?: string };
export type ContactPhoneKind = "phone" | "lid_only" | "none";
export type ContactPhoneSummary = { kind: ContactPhoneKind; phone?: string };

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** Valor parece LID (e não telefone): sufixo `@lid`, prefixo `LID_` ou 14+ dígitos sem formar celular brasileiro. */
export function looksLikeLid(value: string): boolean {
  if (/@lid\b/i.test(value) || value.startsWith("LID_")) return true;
  if (canonicalizeBrazilianPhone(value)?.isValidBrazilian) return false;
  return digitsOf(value).length >= 14 && !normalizeContactPhone(value);
}

export function normalizeContactPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().replace(/@s\.whatsapp\.net$/i, "");
  // Não extrair dígitos de nomes, UUIDs, LIDs ou outros identificadores técnicos.
  if (!/^\+?[\d\s().-]+$/.test(raw)) return undefined;
  const digits = digitsOf(raw);
  const explicitInternational = raw.startsWith("+") && !digits.startsWith("55");
  const brazilian = explicitInternational ? undefined : canonicalizeBrazilianPhone(raw);
  const candidate = brazilian?.isValidBrazilian ? brazilian.e164 : raw.startsWith("+") ? raw : digits.startsWith("55") ? `+${digits}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, { defaultCountry: "BR", extract: false });
  return parsed?.isValid() ? parsed.number : undefined;
}

export function requireContactPhone(value: unknown): string {
  const phone = normalizeContactPhone(value);
  if (!phone) throw new Error("CONTACT_PHONE_REQUIRED: informe um telefone válido com DDD e código do país. Identificadores do WhatsApp não são telefones.");
  return phone;
}

export function classifyContactPhone(sources: readonly ContactPhoneSource[]): ContactPhoneSummary {
  let sawLid = false;
  for (const source of sources) {
    const pn = source.whatsappLid && source.whatsappPn && digitsOf(source.whatsappLid) === digitsOf(source.whatsappPn) ? undefined : normalizeContactPhone(source.whatsappPn);
    if (pn) return { kind: "phone", phone: pn };
  }
  for (const source of sources) {
    const normalized = source.phoneNormalized;
    if (normalized) {
      const isTheLid = Boolean(source.whatsappLid && digitsOf(source.whatsappLid) === digitsOf(normalized));
      if (isTheLid || looksLikeLid(normalized)) sawLid = true;
      else {
        const phone = normalizeContactPhone(normalized);
        if (phone) return { kind: "phone", phone };
      }
    }
    if (source.whatsappLid) sawLid = true;
    if (source.manualExternalId) {
      if (looksLikeLid(source.manualExternalId)) sawLid = true;
      else {
        const phone = normalizeContactPhone(source.manualExternalId);
        if (phone) return { kind: "phone", phone };
      }
    }
  }
  return { kind: sawLid ? "lid_only" : "none" };
}
