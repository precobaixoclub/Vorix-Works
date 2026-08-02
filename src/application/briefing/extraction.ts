import type { BriefingAmbiguityStatus, BriefingFieldDefinition, BriefingSchema } from "../../domain/briefing/briefing.model.js";

/**
 * Extração determinística — Sprint 07 (Fase 5). Só padrões razoavelmente seguros; nunca IA.
 * Preserva sempre o texto original (`value`) ao lado da forma normalizada (`normalizedValue`).
 * Ambiguidade nunca escolhe sozinha — vira `ambiguityStatus: "ambiguous"`, nunca um valor
 * silenciosamente aceito.
 */

export type ExtractedFieldValue = {
  fieldKey: string;
  value: string;
  normalizedValue: string;
  confidence: number;
  ambiguityStatus: BriefingAmbiguityStatus;
  matchedRule: string;
  /** Só presentes quando o candidato veio do AI Gateway (Sprint 08) — `undefined` para toda
   * extração determinística desta seção. */
  aiExecutionId?: string;
  rationaleCode?: string;
  evidence?: string;
};

const DATE_PATTERNS = [/\b(\d{4})-(\d{2})-(\d{2})\b/g, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g];

function extractDate(fieldKey: string, text: string): ExtractedFieldValue | undefined {
  const matches: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) matches.push(match[0]);
  }
  if (matches.length === 0) return undefined;
  const unique = Array.from(new Set(matches));
  return {
    fieldKey,
    value: unique[0],
    normalizedValue: unique[0],
    confidence: unique.length > 1 ? 0.5 : 0.85,
    ambiguityStatus: unique.length > 1 ? "ambiguous" : "none",
    matchedRule: "pattern:date",
  };
}

/** Sinônimos conhecidos por valor aceito — só para os dois campos enum do schema v1 (canal/formato). */
const ENUM_SYNONYMS: Record<string, string[]> = {
  instagram: ["instagram", "insta"],
  facebook: ["facebook", "face"],
  tiktok: ["tiktok", "tik tok"],
  website: ["site", "website", "página"],
  email: ["email", "e-mail"],
  other: [],
  image: ["imagem", "image", "foto"],
  carousel: ["carrossel", "carousel"],
  video: ["vídeo", "video"],
  story: ["story", "stories"],
  reel: ["reel", "reels"],
  text: ["texto", "text"],
};

function extractEnum(fieldKey: string, text: string, acceptedValues: readonly string[]): ExtractedFieldValue | undefined {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const accepted of acceptedValues) {
    const synonyms = ENUM_SYNONYMS[accepted] ?? [accepted];
    if (synonyms.some((synonym) => new RegExp(`\\b${escapeRegExp(synonym)}\\b`, "i").test(lower))) {
      hits.push(accepted);
    }
  }
  if (hits.length === 0) return undefined;
  const unique = Array.from(new Set(hits));
  return {
    fieldKey,
    value: unique[0],
    normalizedValue: unique[0],
    confidence: unique.length > 1 ? 0.5 : 0.85,
    ambiguityStatus: unique.length > 1 ? "ambiguous" : "none",
    matchedRule: "pattern:enum-keyword",
  };
}

/** Exportada para o Context Resolver (Fase 4) usar como `nameQuery` ao consultar a Asset
 * Metadata Source Port para `referencedAssetName`. */
export function extractQuotedPhrase(text: string): string | undefined {
  const match = text.match(/["']([^"']{2,80})["']/);
  return match ? match[1] : undefined;
}

function extractQuoted(fieldKey: string, text: string): ExtractedFieldValue | undefined {
  const phrase = extractQuotedPhrase(text);
  if (!phrase) return undefined;
  return {
    fieldKey,
    value: phrase,
    normalizedValue: phrase.trim().toLowerCase(),
    confidence: 0.9,
    ambiguityStatus: "none",
    matchedRule: "pattern:quoted-name",
  };
}

const OBJECTIVE_VERBS = ["lançar", "divulgar", "promover", "aumentar", "gerar", "vender", "captar", "engajar", "apresentar", "anunciar"];

function extractObjectiveByVerb(fieldKey: string, text: string): ExtractedFieldValue | undefined {
  const lower = text.toLowerCase();
  for (const verb of OBJECTIVE_VERBS) {
    const index = lower.indexOf(verb);
    if (index === -1) continue;
    const phrase = text.slice(index).split(/[.!?\n]/)[0].trim();
    if (phrase.length < 3) continue;
    return { fieldKey, value: phrase, normalizedValue: phrase.toLowerCase(), confidence: 0.7, ambiguityStatus: "none", matchedRule: "pattern:objective-verb" };
  }
  return undefined;
}

const FIELD_EXTRACTORS: Record<string, (fieldKey: string, text: string, field: BriefingFieldDefinition) => ExtractedFieldValue | undefined> = {
  date: (fieldKey, text) => extractDate(fieldKey, text),
  enum: (fieldKey, text, field) => extractEnum(fieldKey, text, field.acceptedValues ?? []),
};

/**
 * Extração oportunista (Fase 5/Ordem de interpretação, passo 6) — roda contra TODOS os campos do
 * schema ainda sem valor, tentando preencher o que der de forma segura. `objective` usa o
 * detector de verbo; campos `string` livres sem padrão seguro (`offerOrSubject`,
 * `targetAudience`, `desiredAction`, `tone`) só usam o nome entre aspas (quando existir) — nunca
 * o texto inteiro (isso só acontece via resposta a pergunta pendente, ver `extractDirectAnswer`).
 */
export function extractOpportunistic(schema: BriefingSchema, text: string, alreadyKnownKeys: ReadonlySet<string>): ExtractedFieldValue[] {
  const results: ExtractedFieldValue[] = [];
  for (const field of schema.fields) {
    if (alreadyKnownKeys.has(field.key)) continue;

    if (field.key === "objective") {
      const extracted = extractObjectiveByVerb(field.key, text);
      if (extracted) results.push(extracted);
      continue;
    }

    const byDataType = FIELD_EXTRACTORS[field.dataType];
    if (byDataType) {
      const extracted = byDataType(field.key, text, field);
      if (extracted) results.push(extracted);
      continue;
    }

    if (field.dataType === "string") {
      const quoted = extractQuoted(field.key, text);
      if (quoted) results.push(quoted);
    }
  }
  return results;
}

/** Resposta direta a uma pergunta pendente (Fase 5/Ordem, passo 3) — o texto inteiro (aparado)
 * vira o valor, sem tentar adivinhar mais nada. É o único jeito seguro de preencher campos sem
 * padrão de extração próprio (`targetAudience`/`tone`/`desiredAction`/`offerOrSubject`). Para
 * campos `enum`/`date`, ainda tenta o padrão específico primeiro (mais confiável que aceitar
 * texto livre); só cai para "texto inteiro" quando o padrão não bate. */
export function extractDirectAnswer(field: BriefingFieldDefinition, text: string): ExtractedFieldValue {
  if (field.dataType === "enum") {
    const extracted = extractEnum(field.key, text, field.acceptedValues ?? []);
    if (extracted) return extracted;
  }
  if (field.dataType === "date") {
    const extracted = extractDate(field.key, text);
    if (extracted) return extracted;
  }
  const trimmed = text.trim();
  return {
    fieldKey: field.key,
    value: trimmed,
    normalizedValue: trimmed.toLowerCase(),
    confidence: 0.9,
    ambiguityStatus: "none",
    matchedRule: "direct-answer:pending-question",
  };
}

// -------------------------------------------------------------------------------------------
// Cancelamento / correção / confirmação — Ordem de interpretação, passos 1/2/4
// -------------------------------------------------------------------------------------------

const CANCELLATION_PATTERN = /\b(cancele?|cancelar|desist[oi]|deixa (pra|para) (depois|l[áa])|esquece isso|n[ãa]o quero mais)\b/i;

export function detectCancellation(text: string): boolean {
  return CANCELLATION_PATTERN.test(text);
}

const CORRECTION_PATTERN = /\b(corrig(?:e|ir|ido)?|na verdade|quis dizer|trocar?|mudar?)\b/i;

/** Detecta um pedido de correção E tenta identificar o campo pelo rótulo — devolve `undefined`
 * quando a frase "cheira" a correção mas não há como saber qual campo (nunca adivinha). */
export function detectCorrection(schema: BriefingSchema, text: string): { fieldKey: string; remainder: string } | undefined {
  if (!CORRECTION_PATTERN.test(text)) return undefined;
  const lower = text.toLowerCase();
  for (const field of schema.fields) {
    if (lower.includes(field.label.toLowerCase()) || lower.includes(field.key.toLowerCase())) {
      const labelIndex = lower.indexOf(field.label.toLowerCase());
      const remainder = labelIndex >= 0 ? text.slice(labelIndex + field.label.length).replace(/^[:\s-]+/, "") : text;
      return { fieldKey: field.key, remainder: remainder.trim() || text.trim() };
    }
  }
  return undefined;
}

const AFFIRMATIVE_PHRASES = new Set([
  "sim",
  "confirmo",
  "pode seguir",
  "esta correto",
  "está correto",
  "pode continuar",
  "ta certo",
  "tá certo",
  "isso mesmo",
  "correto",
  "confirmado",
  "ok",
  "certo",
]);

function normalizeForConfirmation(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "");
}

export type ConfirmationSignal = "affirmative" | "ambiguous" | "none";

/** Só aceita confirmação com correspondência estrita (whitelist) — "sim, mas muda o formato" NUNCA
 * confirma sozinho (tem conteúdo além da afirmação, fica `ambiguous`). */
export function detectConfirmation(text: string): ConfirmationSignal {
  const normalized = normalizeForConfirmation(text);
  if (AFFIRMATIVE_PHRASES.has(normalized)) return "affirmative";
  const containsAffirmativeWord = Array.from(AFFIRMATIVE_PHRASES).some((phrase) => normalized.includes(phrase));
  return containsAffirmativeWord ? "ambiguous" : "none";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
