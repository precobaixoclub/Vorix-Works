import type { CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";
import type { RegionPixelStats } from "../../infrastructure/image-processing/region-pixel-stats.js";
import { rectsOverlap } from "./evaluate-creative-quality-gate.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — lógica PURA e determinística de "safe area
 * real" e tratamento de fundo de texto. Deliberadamente separado de qualquer chamada de IA/sharp:
 * recebe dados JÁ computados (análise semântica de visão + estatística de pixel determinística) e
 * decide. Isso é o que torna esta lógica barata de testar (sem mockar visão nem gerar imagens
 * reais em cada teste) e o que impede o motor de "desperdiçar" uma geração de imagem nova por um
 * problema que o renderer já sabe resolver sozinho (brief, ponto 22) — nada aqui consome o
 * orçamento de `MAX_CREATIVE_REPAIR_ROUNDS`, porque nada aqui é um "repair": é um ajuste de
 * composição que sempre acontece, silenciosamente, antes de desenhar texto.
 */

export const SAFE_AREA_CANDIDATE_REGIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center-left", "center-right"] as const;
export type SafeAreaCandidateRegion = (typeof SAFE_AREA_CANDIDATE_REGIONS)[number];

/** Geometria fixa de cada região candidata (percentual do canvas) — deliberadamente conservadora
 * (não cobre a peça inteira) pra nunca colidir estruturalmente com a margem de segurança de borda
 * (`SAFE_AREA_MARGIN_PCT`, `evaluate-creative-quality-gate.ts`). */
export const CANDIDATE_REGION_RECTS: Record<SafeAreaCandidateRegion, CreativePlanRect> = {
  "top-left": { xPct: 5, yPct: 5, widthPct: 40, heightPct: 20 },
  "top-right": { xPct: 55, yPct: 5, widthPct: 40, heightPct: 20 },
  "center-left": { xPct: 5, yPct: 40, widthPct: 40, heightPct: 20 },
  "center-right": { xPct: 55, yPct: 40, widthPct: 40, heightPct: 20 },
  "bottom-left": { xPct: 5, yPct: 75, widthPct: 40, heightPct: 20 },
  "bottom-right": { xPct: 55, yPct: 75, widthPct: 40, heightPct: 20 },
};

export const REGION_COMPLEXITY_LEVELS = ["low", "medium", "high"] as const;
export type RegionComplexity = (typeof REGION_COMPLEXITY_LEVELS)[number];

/** Sinal semântico (de visão) sobre uma região candidata — ver `analyze-pre-composition-image.ts`. */
export type RegionSemanticFlags = {
  hasText: boolean;
  hasProduct: boolean;
  hasFace: boolean;
  complexity: RegionComplexity;
};

export function isRegionSafeForText(flags: RegionSemanticFlags): boolean {
  return !flags.hasText && !flags.hasProduct && !flags.hasFace && flags.complexity !== "high";
}

const COMPLEXITY_RANK: Record<RegionComplexity, number> = { low: 0, medium: 1, high: 2 };

/** Escolhe a MELHOR região candidata ainda livre (sem texto/produto/rosto, complexidade não-alta,
 * e sem sobrepor nenhum retângulo já ocupado — outras zonas de texto já resolvidas ou assets
 * reais). `undefined` = nenhuma região candidata está genuinamente livre (o chamador mantém o
 * retângulo planejado e deixa o tratamento de fundo mais forte compensar — nunca regenera só por
 * isso, ver `chooseTextBackingTreatment`). */
export function pickBestAlternateRegion(
  regionFlags: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>>,
  occupiedRects: readonly CreativePlanRect[],
): SafeAreaCandidateRegion | undefined {
  const safeCandidates = SAFE_AREA_CANDIDATE_REGIONS.filter((region) => {
    const flags = regionFlags[region];
    if (!flags || !isRegionSafeForText(flags)) return false;
    return !occupiedRects.some((rect) => rectsOverlap(CANDIDATE_REGION_RECTS[region], rect));
  });
  if (safeCandidates.length === 0) return undefined;
  return [...safeCandidates].sort((a, b) => COMPLEXITY_RANK[regionFlags[a]!.complexity] - COMPLEXITY_RANK[regionFlags[b]!.complexity])[0];
}

export type ActualSafeAreaDecision = {
  /** Retângulo final a usar — o planejado (se livre) ou o de uma região alternativa (se livre e
   * disponível) — NUNCA o retângulo planejado quando ele está genuinamente ocupado e existe
   * alternativa livre. */
  rect: CreativePlanRect;
  relocated: boolean;
  relocatedTo?: SafeAreaCandidateRegion;
};

/** `plannedRectIsClear: false` + nenhuma alternativa livre = mantém o retângulo planejado mesmo
 * assim (`relocated: false`) — a função que escolhe o TRATAMENTO de fundo
 * (`chooseTextBackingTreatment`) é quem compensa isso com um tratamento mais forte, nunca esta. */
export function resolveActualTextZoneRect(input: {
  plannedRect: CreativePlanRect;
  plannedRectIsClear: boolean;
  regionFlags: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>>;
  occupiedRects: readonly CreativePlanRect[];
}): ActualSafeAreaDecision {
  if (input.plannedRectIsClear) return { rect: input.plannedRect, relocated: false };
  const alternate = pickBestAlternateRegion(input.regionFlags, input.occupiedRects);
  if (!alternate) return { rect: input.plannedRect, relocated: false };
  return { rect: CANDIDATE_REGION_RECTS[alternate], relocated: true, relocatedTo: alternate };
}

export const TEXT_BACKING_TREATMENTS = ["direct_text", "gradient_scrim", "local_blur", "card_fallback"] as const;
export type TextBackingTreatment = (typeof TEXT_BACKING_TREATMENTS)[number];

/** Acima disto, a região é considerada "visualmente ocupada/ruidosa" (textura, múltiplos objetos)
 * o bastante para precisar de algum tratamento de fundo — abaixo, já tem contraste/limpeza
 * suficiente pra texto direto. Calibrado sobre desvio-padrão de luminância 0-255 (ver
 * `region-pixel-stats.ts`); valor conservador, nunca "achismo visual" solto. */
const BUSY_STDDEV_THRESHOLD = 35;
/** Desvio-padrão acima disto é tratado como "caótico" — nem blur isolado é garantidamente seguro,
 * precisa do tratamento mais forte disponível (card_fallback). */
const CHAOTIC_STDDEV_THRESHOLD = 60;

/**
 * Decide o tratamento de fundo de UMA zona de texto, a partir de dados REAIS (nunca "achismo
 * visual" do Director sozinho): estatística de pixel determinística da região final (depois de
 * eventual realocação) + se há texto fantasma/espúrio especificamente nessa região.
 *
 * Mapeamento pro vocabulário do brief (ETAPA 3, Rodada 4): `direct_text` = DIRECT_TEXT,
 * `gradient_scrim` = GRADIENT_SCRIM, `local_blur` = LOCAL_BLUR, `card_fallback` cobre tanto
 * EDITORIAL_BAND quanto CARD_FALLBACK — o renderer determinístico
 * (`render-creative-plan-text-zones.ts`) só tem 3 primitivas reais de desenho (`"none"`/`"scrim"`/
 * `"solid"`), então os dois tratamentos "fortes" do brief convergem na mesma primitiva (`"solid"`)
 * nesta rodada — simplificação deliberada, documentada, para não construir um designer de
 * regras gigante (brief, ponto 20/32).
 *
 * `hasGhostTextHere: true` SEMPRE força pelo menos `local_blur` — nunca confia em scrim semi-
 * transparente sozinho pra esconder texto fantasma já desenhado (um scrim de 55% ainda deixa
 * letras parcialmente visíveis por baixo).
 */
export function chooseTextBackingTreatment(input: {
  pixelStats: RegionPixelStats | undefined;
  hasGhostTextHere: boolean;
  plannedBackingStyle?: "scrim" | "solid" | "none";
}): TextBackingTreatment {
  if (input.hasGhostTextHere) return "local_blur";

  // Sem estatística confiável (falha de leitura) — nunca arrisca "direct_text" às cegas; cai no
  // tratamento histórico mais seguro (scrim), que já funciona sobre qualquer fundo fotográfico
  // imprevisível.
  if (!input.pixelStats) return "gradient_scrim";

  if (input.pixelStats.stdDevLuminance > CHAOTIC_STDDEV_THRESHOLD) return "card_fallback";
  if (input.pixelStats.stdDevLuminance > BUSY_STDDEV_THRESHOLD) return "gradient_scrim";

  // Região limpa/de baixa complexidade — respeita a preferência do plano quando ele já pediu um
  // tratamento mais forte de propósito (ex.: "solid" porque o Director quis um bloco de cor
  // deliberado na direção de arte); sem preferência, usa o ganho real (texto direto, sem caixa).
  if (input.plannedBackingStyle === "solid") return "card_fallback";
  if (input.plannedBackingStyle === "scrim") return "gradient_scrim";
  return "direct_text";
}

// ---------------------------------------------------------------------------------------------
// ETAPA 3.1 (Rodada 4) — achado do smoke real de produção: `local_blur` com sigma FIXO (18) às
// vezes não foi suficiente pra esconder texto fantasma de alto contraste (preço fantasma
// continuou parcialmente legível em 2 tentativas seguidas). Detecção/roteamento estavam corretos;
// só o TRATAMENTO VISUAL precisava de intensidade adaptativa + confirmação — ver
// `neutralize-ghost-text.ts` pra a orquestração completa (blur+scrim+reverificação+escalonamento).
// ---------------------------------------------------------------------------------------------

export const GHOST_TEXT_INTENSITIES = ["low", "medium", "high"] as const;
export type GhostTextIntensity = (typeof GHOST_TEXT_INTENSITIES)[number];

/** Calibrado sobre o mesmo desvio-padrão de luminância (0-255) já usado por
 * `chooseTextBackingTreatment` — mas com limiares PRÓPRIOS: aqui a pergunta não é "esta região
 * precisa de algum tratamento" (resposta já é sim, é texto fantasma), é "quão FORTE o tratamento
 * precisa ser". Sem estatística confiável, cai no nível intermediário — nunca o mais fraco (não
 * arrisca deixar texto fantasma visível só por falta de dado) nem automaticamente o mais forte
 * (evita destruir a composição sem necessidade real). */
export function classifyGhostTextIntensity(pixelStats: RegionPixelStats | undefined): GhostTextIntensity {
  if (!pixelStats) return "medium";
  if (pixelStats.stdDevLuminance > 70) return "high";
  if (pixelStats.stdDevLuminance > 40) return "medium";
  return "low";
}

/** Máximo de 2 passes (brief, ponto 9) — nunca um loop infinito. Na 2ª escalada, "high" já é o
 * teto: satura ali, nunca inventa um 4º nível. */
export function escalateGhostTextIntensity(current: GhostTextIntensity): GhostTextIntensity {
  if (current === "low") return "medium";
  return "high";
}

export type GhostTextTreatmentParams = {
  blurSigma: number;
  scrimOpacity: number;
};

const GHOST_TEXT_INTENSITY_PARAMS: Record<GhostTextIntensity, GhostTextTreatmentParams> = {
  // Blur sozinho (achado real): sigma 18 não bastou pra um preço de alto contraste. Os 3 níveis
  // abaixo escalam TANTO o blur quanto a opacidade do véu junto — nunca só um dos dois.
  low: { blurSigma: 16, scrimOpacity: 0.4 },
  medium: { blurSigma: 26, scrimOpacity: 0.55 },
  high: { blurSigma: 40, scrimOpacity: 0.7 },
};

export function resolveGhostTextTreatmentParams(intensity: GhostTextIntensity): GhostTextTreatmentParams {
  return GHOST_TEXT_INTENSITY_PARAMS[intensity];
}

/** Tradução do vocabulário de tratamento pra primitiva real do renderer determinístico — ver
 * `render-creative-plan-text-zones.ts`. `local_blur` vira `"scrim"` no nível do renderer porque o
 * blur em si é aplicado ANTES, como pré-processamento de pixel (`applyLocalBlur`,
 * `region-pixel-stats.ts`) — o scrim por cima é uma segunda camada de segurança (duas defesas,
 * nunca uma só, contra texto fantasma já desenhado). */
export function textBackingTreatmentToRendererStyle(treatment: TextBackingTreatment): "none" | "scrim" | "solid" {
  switch (treatment) {
    case "direct_text": return "none";
    case "gradient_scrim": return "scrim";
    case "local_blur": return "scrim";
    case "card_fallback": return "solid";
  }
}
