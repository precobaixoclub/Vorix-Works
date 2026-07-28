import type { ContentObjective, RecommendedContentFormat } from "../../shared/utils/content-format-classification.js";
import { RECOMMENDED_CONTENT_FORMATS } from "../../shared/utils/content-format-classification.js";
import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";

export type EduardoSupportedChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business"
  | "meta_ads"
  | "google_ads";

// Um carrossel, um Reels ou um Story não são capabilities separadas — são valores possíveis de
// recommendedFormat, decisão exclusiva do Eduardo (e, a partir da correção de divergência
// Eduardo/Arthur, também a única fonte da pipeline estrutural — ver
// `src/shared/utils/content-format-classification.ts`). "video" cobre vídeos verticais fora do
// rótulo comercial "Reels" (ex.: YouTube Shorts), mantendo a mesma pipeline de vídeo do Zuno.
export const EDUARDO_RECOMMENDED_FORMATS = RECOMMENDED_CONTENT_FORMATS;

export type EduardoRecommendedFormat = RecommendedContentFormat;

export type EduardoContentObjective = ContentObjective;

export type EduardoDepthLevel = "baixo" | "medio" | "alto";

export type EduardoComplexityLevel = "baixa" | "media" | "alta";

export type EduardoConversionPriority = "baixa" | "media" | "alta";

export type EduardoEditorialPlanningRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  desiredChannel: EduardoSupportedChannel;
  desiredObjective: string;
  workflowContext?: Record<string, unknown>;
};

/**
 * O Editorial Brief que orienta o João. Nenhum campo aqui decide layout, paleta ou tipografia
 * (isso continua sendo exclusivo da Sofia) nem cria mensagem/ângulo/copy (isso continua sendo
 * exclusivo do João/Maria) — Eduardo decide apenas a forma do conteúdo, não o conteúdo em si.
 */
export type EduardoEditorialPlanningOutput = {
  campaignObjective: string;
  contentObjective: EduardoContentObjective;
  recommendedFormat: EduardoRecommendedFormat;
  // Rótulo em texto livre ("carrossel", "reels", "post único", "story", "vídeo"), no mesmo
  // vocabulário de `format` já usado por João/Sofia/Bianca/Pedro.
  recommendedFormatLabel: string;
  formatJustification: string;
  recommendedSlideCount?: number;
  recommendedVideoDurationSeconds?: number;
  recommendedChannel: EduardoSupportedChannel;
  primaryEmotion: string;
  narrativeStructure: string[];
  recommendedCta: string;
  depthLevel: EduardoDepthLevel;
  contentComplexity: EduardoComplexityLevel;
  conversionPriority: EduardoConversionPriority;
  recommendationsForJoao: string[];
  aiSupportUsed: boolean;
  // Indica se o histórico de Quality Feedback foi consultado e continha avaliações suficientes
  // para influenciar `recommendationsForJoao`. Nunca reflete uma mudança de `recommendedFormat`,
  // `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` ou
  // `recommendedCta` — o feedback só acrescenta recomendações, nunca decide sozinho.
  feedbackInformed: boolean;
  /** Identidade criativa da campanha (Creative Director Engine) — enriquece o contexto entregue a João, nunca decide formato/objetivo sozinho. */
  creativeDna: CampaignCreativeDNA;
};

export type EduardoStrategyEnhancement = {
  formatJustification?: string;
  narrativeStructure?: string[];
  primaryEmotion?: string;
  recommendationsForJoao?: string[];
};
