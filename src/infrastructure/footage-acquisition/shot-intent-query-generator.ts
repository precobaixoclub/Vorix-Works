import type { ShotIntent } from "../../shared/utils/shot-intent.js";

/**
 * INTENT-BASED FOOTAGE ACQUISITION — gera múltiplas consultas de busca a partir do objetivo real
 * do Shot, nunca apenas o tema da campanha. Em inglês porque o único provider real implementado
 * (Pexels) é internacional — pesquisado ao vivo na sprint de aquisição anterior.
 *
 * PRINCÍPIO DE HONESTIDADE: a API do Pexels (`PexelsVideo`) não devolve descrição nem tags de
 * texto por vídeo (só id/width/height/duration/url/image/user/video_files — confirmado lendo o
 * adapter antes de implementar) — não há CAMPO nenhum para aplicar `mustNotContain` como filtro
 * de busca no provider. Por isso os padrões negativos NUNCA são enviados como texto de busca
 * (a API não tem operador de negação documentado, e tentar "query -termo" arriscaria ser
 * interpretado como texto literal); eles só orientam a VALIDAÇÃO VISUAL pós-download
 * (`visual-candidate-validator.ts`) e são reportados para transparência (`--footage-search-report`).
 */

export type DiscardedQuery = { query: string; reason: string };

export type ShotIntentQueryPlan = {
  positiveQueries: string[];
  negativePatterns: string[];
  discardedQueries: DiscardedQuery[];
};

const PHONE_ACTION_TEMPLATES = [
  (subject: string) => `${subject} using smartphone`,
  (subject: string) => `${subject} looking at phone`,
  () => "woman holding smartphone",
  () => "man using smartphone",
  () => "phone screen visible",
  () => "phone facing camera",
  () => "hands using phone",
  () => "close up smartphone",
  () => "smartphone portrait",
  () => "touchscreen interaction",
  () => "person browsing phone",
  (subject: string, narrativeGoal: string) => (narrativeGoal ? `checking ${narrativeGoal} on phone` : "checking invitation on phone"),
];

const TABLET_ACTION_TEMPLATES = [
  (subject: string) => `${subject} using tablet`,
  () => "tablet screen visible",
  () => "hands holding tablet",
  () => "person browsing tablet",
  () => "tablet facing camera",
  () => "touchscreen tablet interaction",
];

const NOTEBOOK_ACTION_TEMPLATES = [
  (subject: string) => `${subject} using laptop`,
  () => "laptop screen visible",
  () => "typing on laptop",
  () => "person browsing website on laptop",
  () => "laptop screen facing camera",
];

const PHONE_NEGATIVE_PATTERNS = [
  "phone back", "rear camera", "phone pocket", "phone upside down", "phone face down", "screen hidden", "blurry phone", "empty hands",
];
const TABLET_NEGATIVE_PATTERNS = ["tablet closed", "screen hidden", "blurry phone", "empty hands"];
const NOTEBOOK_NEGATIVE_PATTERNS = ["laptop closed", "screen hidden", "blurry phone", "empty hands"];

function normalizeSubject(protagonist: string | undefined): string {
  if (!protagonist) return "person";
  const normalized = protagonist.toLowerCase();
  if (normalized.includes("casal") || normalized.includes("noivos") || normalized.includes("couple")) return "couple";
  if (normalized.includes("mulher") || normalized.includes("woman")) return "woman";
  if (normalized.includes("homem") || normalized.includes("man")) return "man";
  return "person";
}

/**
 * Gera o plano de consultas para UM Shot. `discardedQueries` documenta explicitamente o que o
 * sistema ANTIGO fazia (busca só por tema) e por que isso foi rebaixado a sinal secundário, para
 * que `--footage-search-report` mostre a mudança de filosofia com transparência.
 */
export function buildShotIntentQueryPlan(intent: ShotIntent): ShotIntentQueryPlan {
  const subject = normalizeSubject(intent.protagonist);
  const discardedQueries: DiscardedQuery[] = [];

  if (intent.narrativeGoal && intent.narrativeGoal !== "objetivo não especificado") {
    discardedQueries.push({
      query: intent.narrativeGoal,
      reason: "tema/objetivo da campanha sozinho é sinal fraco demais para a busca primária (retorna vídeos corretos para o tema, mas não para o Shot) — mantido apenas como contexto de ranking, nunca como consulta de texto.",
    });
  }

  if (intent.device === "none" || !intent.screenVisibleRequired) {
    // Shot não pede dispositivo — não há razão de negócio para gerar consultas de "tela visível"; a
    // busca cai de volta para ação+protagonista+emoção, ainda mais específica que "tema".
    const fallbackParts = [intent.mainAction, intent.protagonist, intent.emotion].filter((part): part is string => Boolean(part && part.trim().length > 0));
    const positiveQueries = fallbackParts.length > 0 ? [fallbackParts.join(" ")] : [intent.narrativeGoal];
    return { positiveQueries, negativePatterns: [], discardedQueries };
  }

  const templates = intent.device === "tablet" ? TABLET_ACTION_TEMPLATES : intent.device === "notebook" ? NOTEBOOK_ACTION_TEMPLATES : PHONE_ACTION_TEMPLATES;
  const negativePatterns = intent.device === "tablet" ? TABLET_NEGATIVE_PATTERNS : intent.device === "notebook" ? NOTEBOOK_NEGATIVE_PATTERNS : PHONE_NEGATIVE_PATTERNS;

  const positiveQueries = [...new Set(templates.map((template) => template(subject, intent.narrativeGoal)))];

  return { positiveQueries, negativePatterns, discardedQueries };
}
