import type { ShotIntent } from "../shot-intent.js";
import type { MicroShot } from "./microshot.model.js";
import type { MicroShotFraming } from "./microshot-vocabulary.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — QUERY EXPANSION (seção 5 da sprint): "nunca realizar apenas
 * uma busca". Determinístico (sem LLM disponível), por banco de sinônimos — mesmo espírito de
 * `shot-intent-query-generator.ts` (`buildShotIntentQueryPlan`, que já expande consultas para
 * dispositivo/tela), mas na granularidade do MICROPLANO, com um banco mais amplo de sinônimos de
 * sujeito/ação/emoção (não só dispositivo) — o próprio texto da seção 5 pede exatamente "young
 * couple / engaged couple / romantic couple / ...", que é sinônimo de SUJEITO, não de dispositivo.
 * As duas engines são complementares: para microplanos de tela/mão, delegamos ao banco de
 * dispositivo já existente; para microplanos humanos/reação, usamos este banco novo.
 */

export type RankedQuery = { text: string; score: number; source: "subject" | "action" | "emotion" | "framing" | "device" };

const COUPLE_SYNONYMS = ["young couple", "engaged couple", "romantic couple", "happy couple", "married couple", "relationship", "love"];

const ACTION_KEYWORD_SYNONYMS: Array<{ match: RegExp; synonyms: string[] }> = [
  { match: /planej|organiz|plan/i, synonyms: ["planning together", "making plans", "home office couple"] },
  { match: /celular|phone|smartphone/i, synonyms: ["using phone", "checking phone", "browsing phone"] },
  { match: /notebook|laptop|computador/i, synonyms: ["using laptop", "typing on laptop", "home office couple"] },
  { match: /caf[eé]|coffee/i, synonyms: ["drinking coffee"] },
  { match: /rindo|riso|laugh|sorri/i, synonyms: ["laughing", "smiling together"] },
  { match: /casamento|wedding|noiv/i, synonyms: ["wedding planning"] },
  { match: /site|website|app|aplicativo/i, synonyms: ["browsing website", "checking app"] },
];

const EMOTION_SYNONYMS: Record<string, string[]> = {
  leveza: ["relaxed", "joyful"],
  alivio: ["relieved", "content"],
  alívio: ["relieved", "content"],
  alegria: ["happy", "joyful"],
  confiança: ["confident"],
  confianca: ["confident"],
  surpresa: ["surprised", "amazed"],
  gratidao: ["grateful"],
  gratidão: ["grateful"],
};

const FRAMING_MODIFIERS: Record<MicroShotFraming, string[]> = {
  wide: ["wide shot", "establishing shot"],
  medium: ["medium shot"],
  close: ["close up"],
  extreme_close: ["extreme close up", "macro detail"],
  over_shoulder: ["over the shoulder"],
  pov: ["point of view"],
  detail: ["detail shot"],
  hands: ["hands close up", "hands using device"],
  reaction: ["candid reaction", "genuine smile"],
  screen: ["phone screen visible", "screen close up"],
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function dedupeRanked(queries: RankedQuery[]): RankedQuery[] {
  const seen = new Map<string, RankedQuery>();
  for (const query of queries) {
    const key = query.text.trim().toLowerCase();
    const existing = seen.get(key);
    if (!existing || existing.score < query.score) seen.set(key, query);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

const MAX_EXPANDED_QUERIES = 12;

export function expandQueries(microShot: MicroShot, intent: ShotIntent): RankedQuery[] {
  const queries: RankedQuery[] = [];
  const wantsHuman = microShot.requiredElements.includes("human");
  const actionText = `${intent.mainAction ?? ""} ${intent.secondaryAction ?? ""} ${intent.narrativeGoal ?? ""}`;

  if (wantsHuman) {
    for (const synonym of COUPLE_SYNONYMS) queries.push({ text: synonym, score: 0.9, source: "subject" });
  }

  for (const entry of ACTION_KEYWORD_SYNONYMS) {
    if (!entry.match.test(actionText)) continue;
    for (const synonym of entry.synonyms) queries.push({ text: synonym, score: 0.8, source: "action" });
  }

  const emotionKey = normalizeText(microShot.emotion);
  const emotionSynonyms = EMOTION_SYNONYMS[emotionKey] ?? EMOTION_SYNONYMS[emotionKey.replace(/[^a-z]/g, "")];
  if (emotionSynonyms) {
    for (const synonym of emotionSynonyms) queries.push({ text: synonym, score: 0.6, source: "emotion" });
  }

  const framingModifiers = FRAMING_MODIFIERS[microShot.preferredCamera] ?? [];
  const subjectWord = wantsHuman ? "couple" : "person";
  for (const modifier of framingModifiers) {
    queries.push({ text: `${modifier} ${subjectWord}`.trim(), score: 0.7, source: "framing" });
  }

  if (queries.length === 0) {
    // Sem nenhum sinal específico (microplano puramente de contexto/detalhe): cai para o próprio
    // propósito do microplano como única consulta, nunca vazio.
    queries.push({ text: microShot.purpose.replace(/_/g, " "), score: 0.4, source: "action" });
  }

  return dedupeRanked(queries).slice(0, MAX_EXPANDED_QUERIES);
}
