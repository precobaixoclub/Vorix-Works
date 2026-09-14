/**
 * Canonicalização de telefone brasileiro — bloco "réplica de identidade" (ver relatório do usuário
 * sobre o CMDesk/desk-spark-ai, `server/src/utils/brazilianPhoneIdentity.ts`, adaptado aqui sem
 * dependência externa). Existe porque o WhatsApp entrega o mesmo número real ora COM o 9º dígito
 * do celular, ora SEM ele (depende da versão do app/agenda de quem mandou) — sem canonicalizar pra
 * uma única forma, `+5545999797500` e `+554599797500` virariam dois contatos diferentes pra mesma
 * pessoa.
 *
 * Regra central (N1-N5, mesmo invariante do sistema de referência): para o mesmo número real, esta
 * função SEMPRE devolve o mesmo `e164`, não importa qual variante (com/sem 9º dígito, com/sem DDI,
 * formato JID) foi usada como entrada.
 */

const VALID_BRAZILIAN_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

const MOBILE_THIRD_DIGITS = new Set(["9", "8", "7", "6"]);

export type BrazilianPhoneIdentity = {
  /** `+55<DDD><número, sempre com 9º dígito quando é celular>` — a forma canônica. */
  e164: string;
  /** Mesmo valor sem o `+`, usado como chave de comparação/lookup. */
  comparisonKey: string;
  ddd: number;
  isMobile: boolean;
  /** `false` quando o número não bateu o formato brasileiro esperado (DDD inválido, tamanho
   * errado) — `e164` ainda é preenchido, best-effort, mas não deve ser tratado como confiável. */
  isValidBrazilian: boolean;
};

/** JID de grupo/canal/LID nunca deve ser tratado como telefone — mesma detecção de
 * `whatsapp-identity.ts`/`wuzapi-event-mapper.ts`, replicada aqui só pra guarda defensiva de
 * entrada (este módulo não importa aqueles, pra não criar dependência circular de domínio). */
function looksLikeNonPhoneJid(value: string): boolean {
  return value.includes("@lid") || value.includes("@g.us") || value.includes("@newsletter") || value.startsWith("LID_");
}

/**
 * Canonicaliza um telefone brasileiro (ou string de onde extrair um) pra uma forma única. Aceita
 * dígitos crus, `+55...`, `55...`, ou um JID (`"...@s.whatsapp.net"`). `undefined` só quando não há
 * dígitos suficientes pra tentar (nunca lança).
 */
export function canonicalizeBrazilianPhone(raw: string): BrazilianPhoneIdentity | undefined {
  if (!raw || looksLikeNonPhoneJid(raw)) return undefined;

  const beforeAt = raw.split("@")[0] ?? raw;
  const digits = beforeAt.replace(/\D/g, "");
  if (digits.length < 10) return undefined;

  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) {
    return { e164: `+55${national}`, comparisonKey: national, ddd: Number(national.slice(0, 2)) || 0, isMobile: false, isValidBrazilian: false };
  }

  const ddd = Number(national.slice(0, 2));
  const isValidDdd = VALID_BRAZILIAN_DDDS.has(ddd);
  const thirdDigit = national.length === 11 ? national[2] : national[2];
  const isMobile = MOBILE_THIRD_DIGITS.has(thirdDigit ?? "");

  let canonicalNational = national;
  if (isMobile && national.length === 10) {
    canonicalNational = `${national.slice(0, 2)}9${national.slice(2)}`;
  }

  return {
    e164: `+55${canonicalNational}`,
    comparisonKey: canonicalNational,
    ddd,
    isMobile,
    isValidBrazilian: isValidDdd && canonicalNational.length === 11,
  };
}

/**
 * Gera todas as variantes conhecidas de um telefone brasileiro canônico, pra uso em lookups
 * (`WHERE phone_normalized = ANY($1)`) contra dados legados que nunca foram re-normalizados —
 * mesmo padrão do `generateBrazilianVariants` do sistema de referência.
 */
export function generateBrazilianPhoneVariants(e164OrNational: string): string[] {
  const digits = e164OrNational.replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) return [`+${digits}`];

  const thirdDigit = national[2];
  const isMobile = MOBILE_THIRD_DIGITS.has(thirdDigit ?? "") || national.length === 11;
  const withNine = national.length === 11 ? national : isMobile ? `${national.slice(0, 2)}9${national.slice(2)}` : national;
  const withoutNine = national.length === 11 && national[2] === "9" ? `${national.slice(0, 2)}${national.slice(3)}` : national;

  const bases = [...new Set([withNine, withoutNine])];
  const variants = new Set<string>();
  for (const base of bases) {
    variants.add(base);
    variants.add(`55${base}`);
    variants.add(`+55${base}`);
    variants.add(`${base}@s.whatsapp.net`);
    variants.add(`55${base}@s.whatsapp.net`);
  }
  return [...variants];
}

/** Compara dois telefones brasileiros por equivalência (mesma pessoa, formatos diferentes) — usado
 * pela lógica de merge (Fase 2) pra decidir "é o mesmo número de verdade". */
export function areBrazilianPhonesEquivalent(a: string, b: string): boolean {
  const canonicalA = canonicalizeBrazilianPhone(a);
  const canonicalB = canonicalizeBrazilianPhone(b);
  if (!canonicalA || !canonicalB) return false;
  return canonicalA.comparisonKey === canonicalB.comparisonKey;
}
