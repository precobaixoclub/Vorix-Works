import { RADAR_CATEGORY_WEIGHTS, type RadarKeywordCategory } from "./radar.model.js";

/**
 * Keywords do Radar — o Radar é ORIENTADO por palavra-chave: sem ao menos uma keyword crítica na
 * conversa, sinais estruturais (espera, SLA, transferências) nunca transformam uma conversa comum
 * em risco. As listas abaixo são só os DEFAULTS do sistema; cada workspace (e opcionalmente cada
 * equipe) ajusta por cima via `RadarKeywordOverride` — adicionar, desabilitar, trocar categoria ou
 * peso, sem alterar código.
 */

/** Marcador de fronteira de frase no texto normalizado — impede que uma negação de uma frase
 * "vaze" para a seguinte ("não. quero cancelar") e que uma keyword composta case atravessando
 * pontuação. Nunca aparece dentro de uma keyword. */
const SENTENCE_BOUNDARY = "|";

/** Variações previsíveis de digitação tratadas antes do matching. */
const TOKEN_ALIASES: Record<string, string> = {
  n: "nao",
  nn: "nao",
  naum: "nao",
  q: "que",
  vc: "voce",
  vcs: "voces",
  tb: "tambem",
  tbm: "tambem",
  pq: "porque",
  td: "tudo",
  mt: "muito",
  mto: "muito",
};

/**
 * Normaliza para matching: minúsculas, sem acento, pontuação de frase vira fronteira, demais
 * símbolos viram espaço, letras repetidas 3+ vezes colapsam ("péssssimo" → "pessimo") e
 * abreviações comuns são expandidas.
 */
export function normalizeRadarText(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?\n\r]+/g, ` ${SENTENCE_BOUNDARY} `)
    .replace(/[^a-z0-9| ]/g, " ")
    .replace(/([a-z])\1{2,}/g, "$1");
  return base
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .join(" ");
}

/** Normaliza uma keyword (configuração) — mesma regra do texto, mas sem fronteiras de frase. */
export function normalizeRadarKeyword(keyword: string): string {
  return normalizeRadarText(keyword)
    .split(" ")
    .filter((token) => token !== SENTENCE_BOUNDARY)
    .join(" ");
}

/** Índices onde `needle` ocorre em `haystack` começando em início de palavra. Sufixos são aceitos
 * de propósito ("cancelar" casa "cancelaria") — só o INÍCIO precisa ser fronteira. */
export function findWordStartIndexes(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  if (!needle) return indexes;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return indexes;
    if (index === 0 || haystack[index - 1] === " ") indexes.push(index);
    from = index + 1;
  }
}

const NEGATION_WORDS = new Set(["nao", "nunca", "jamais", "nem", "sem"]);

/** Palavras que podem ficar ENTRE a negação e o termo sem quebrar a negação ("não QUERO cancelar",
 * "não ESTOU insatisfeito"). Lista fechada de propósito: "não CONSIGO cancelar" não é uma negação
 * da intenção de cancelar, então "consigo" não está aqui. */
const NEGATION_BRIDGE_WORDS = new Set([
  "quero", "queria", "queremos", "vou", "vamos", "irei", "iremos", "pretendo", "penso", "pensei", "em", "preciso", "desejo", "gostaria", "de",
  "estou", "to", "tou", "estamos", "fiquei", "sou", "somos", "esta", "ta", "e", "foi", "era", "mais", "me", "nada", "tenho", "ha", "existe",
]);

const MAX_NEGATION_BRIDGE_WORDS = 2;

/**
 * `true` quando a ocorrência em `index` está negada: uma palavra de negação imediatamente antes,
 * ou separada por até duas palavras-ponte. Um termo que já COMEÇA com negação ("não resolveram",
 * "sem resposta") nunca é negado de novo.
 */
export function isNegatedAt(normalized: string, index: number, term: string): boolean {
  const firstWord = term.split(" ")[0];
  if (NEGATION_WORDS.has(firstWord) || firstWord === "ninguem") return false;
  const before = normalized.slice(0, index).trim().split(" ").filter(Boolean);
  let bridges = 0;
  for (let position = before.length - 1; position >= 0; position -= 1) {
    const word = before[position];
    // "sem" só nega o que vem imediatamente depois ("sem urgência"), nunca através de uma ponte.
    if (NEGATION_WORDS.has(word)) return word !== "sem" || bridges === 0;
    if (word === SENTENCE_BOUNDARY || !NEGATION_BRIDGE_WORDS.has(word)) return false;
    bridges += 1;
    if (bridges > MAX_NEGATION_BRIDGE_WORDS) return false;
  }
  return false;
}

/** `true` quando o termo aparece ao menos uma vez SEM estar negado. */
export function hasUnnegatedOccurrence(normalized: string, term: string): boolean {
  return findWordStartIndexes(normalized, term).some((index) => !isNegatedAt(normalized, index, term));
}

export type RadarKeyword = { keyword: string; category: RadarKeywordCategory; weight: number };

export type RadarKeywordMatch = RadarKeyword;

const DEFAULT_KEYWORDS_BY_CATEGORY: Record<RadarKeywordCategory, readonly string[]> = {
  cancellation: [
    "cancelar", "cancelamento", "cancela meu", "cancela minha", "cancela o", "cancela a", "quero sair", "rescindir", "rescisao", "distrato",
    "vou trocar", "trocar de fornecedor", "trocar de empresa", "encerrar contrato", "encerrar o contrato", "quero encerrar", "nao quero mais",
    "vou embora", "desistir do servico", "ir para o concorrente", "ir pro concorrente",
  ],
  legal: [
    "procon", "advogado", "advogada", "judicial", "na justica", "entrar na justica", "vou processar", "processar voces", "processar a empresa",
    "reclame aqui", "boletim de ocorrencia", "dano moral", "danos morais", "delegacia", "meus direitos", "meu direito", "juizado", "extrajudicial",
  ],
  manager: [
    "falar com gerente", "falar com o gerente", "falar com a gerente", "quero gerente", "quero o gerente", "chama gerente", "chama o gerente",
    "chamar o gerente", "falar com supervisor", "falar com o supervisor", "falar com a supervisora", "quero supervisor", "quero o supervisor",
    "chama supervisor", "chama o supervisor", "falar com responsavel", "falar com o responsavel", "quero o responsavel", "chama o responsavel",
    "falar com o dono", "falar com a dona", "seu superior", "seu chefe",
  ],
  complaint: [
    "insatisfeito", "insatisfeita", "insatisfacao", "pessimo servico", "pessimo atendimento", "pessimo", "nao resolveram", "nao resolveu",
    "ninguem resolve", "ninguem responde", "sistema caiu", "fora do ar", "urgente", "urgencia", "cobranca errada", "cobranca indevida",
    "cobrado indevidamente", "cobrado a mais", "reclamacao", "reclamar", "absurdo", "vergonha", "descaso", "falta de respeito", "incompetente",
    "incompetencia", "horrivel", "decepcionado", "decepcionada", "frustrado", "frustrada", "ja falei varias vezes", "nao aguento mais",
    "prejuizo", "nao funciona", "nao esta funcionando", "sem resposta", "sem retorno", "atendimento ruim", "demora no atendimento",
    "propaganda enganosa", "meu dinheiro de volta", "quero reembolso", "quero estorno",
  ],
};

/** Defaults do sistema já normalizados, com o peso padrão da categoria. */
export const DEFAULT_RADAR_KEYWORDS: readonly RadarKeyword[] = (Object.keys(DEFAULT_KEYWORDS_BY_CATEGORY) as RadarKeywordCategory[]).flatMap((category) =>
  DEFAULT_KEYWORDS_BY_CATEGORY[category].map((keyword) => ({ keyword: normalizeRadarKeyword(keyword), category, weight: RADAR_CATEGORY_WEIGHTS[category] })),
);

/** Ajuste persistido (`radar_keywords`) sobre os defaults. `teamId` ausente = vale para o
 * workspace inteiro; `weight` ausente = peso padrão da categoria. */
export type RadarKeywordOverride = {
  id: string;
  tenantId: string;
  workspaceId: string;
  teamId?: string;
  keyword: string;
  category: RadarKeywordCategory;
  weight?: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Conjunto efetivo de keywords para uma conversa: defaults → ajustes do workspace → ajustes da
 * equipe da conversa (a equipe vence o workspace, que vence o default). `enabled: false` remove a
 * keyword do conjunto, inclusive uma keyword padrão.
 */
export function resolveRadarKeywords(overrides: readonly RadarKeywordOverride[], teamId?: string): RadarKeyword[] {
  const resolved = new Map<string, RadarKeyword>();
  for (const keyword of DEFAULT_RADAR_KEYWORDS) resolved.set(keyword.keyword, keyword);

  const apply = (override: RadarKeywordOverride) => {
    const keyword = normalizeRadarKeyword(override.keyword);
    if (!keyword) return;
    if (!override.enabled) {
      resolved.delete(keyword);
      return;
    }
    resolved.set(keyword, { keyword, category: override.category, weight: override.weight ?? RADAR_CATEGORY_WEIGHTS[override.category] });
  };

  overrides.filter((override) => !override.teamId).forEach(apply);
  if (teamId) overrides.filter((override) => override.teamId === teamId).forEach(apply);
  return [...resolved.values()];
}

/** Keywords presentes (e não negadas) no texto. Ordem estável: mais longas primeiro. */
export function matchRadarKeywords(text: string, keywords: readonly RadarKeyword[]): RadarKeywordMatch[] {
  const normalized = normalizeRadarText(text);
  if (!normalized) return [];
  return [...keywords]
    .sort((left, right) => right.keyword.length - left.keyword.length || left.keyword.localeCompare(right.keyword))
    .filter((keyword) => hasUnnegatedOccurrence(normalized, keyword.keyword));
}
