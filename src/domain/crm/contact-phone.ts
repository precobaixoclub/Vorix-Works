import { canonicalizeBrazilianPhone } from "../inbox/brazilian-phone-identity.js";

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
  return digitsOf(value).length >= 14;
}

function asPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/@(g\.us|newsletter|lid)\b/i.test(value) || value.startsWith("LID_")) return undefined;
  const digits = digitsOf(value);
  // Código de país explícito diferente do Brasil (+1, +351...): telefone internacional como veio.
  if (value.trim().startsWith("+") && !digits.startsWith("55")) return digits.length >= 10 && digits.length <= 13 ? `+${digits}` : undefined;
  const brazilian = canonicalizeBrazilianPhone(value);
  if (brazilian?.isValidBrazilian) return brazilian.e164;
  return digits.length >= 10 && digits.length <= 13 ? `+${digits}` : undefined;
}

export function classifyContactPhone(sources: readonly ContactPhoneSource[]): ContactPhoneSummary {
  let sawLid = false;
  for (const source of sources) {
    const pn = asPhone(source.whatsappPn);
    if (pn) return { kind: "phone", phone: pn };
  }
  for (const source of sources) {
    const normalized = source.phoneNormalized;
    if (normalized) {
      const isTheLid = Boolean(source.whatsappLid && digitsOf(source.whatsappLid) === digitsOf(normalized));
      if (isTheLid || looksLikeLid(normalized)) sawLid = true;
      else {
        const phone = asPhone(normalized);
        if (phone) return { kind: "phone", phone };
      }
    }
    if (source.whatsappLid) sawLid = true;
    if (source.manualExternalId) {
      if (looksLikeLid(source.manualExternalId)) sawLid = true;
      else {
        const phone = asPhone(source.manualExternalId);
        if (phone) return { kind: "phone", phone };
      }
    }
  }
  return { kind: sawLid ? "lid_only" : "none" };
}
