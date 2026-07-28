// Quality Feedback não é uma Skill: não possui manifesto, não é descoberta por Helena e nunca
// participa de um ExecutionPlan. É um módulo de aplicação (mesmo nível arquitetural de Clara e
// Valentina) que registra avaliações humanas sobre execuções já concluídas, para que o Eduardo
// possa consultar o histórico antes de montar um novo Editorial Brief — sem que o feedback jamais
// altere uma decisão automaticamente (ver `QualityFeedbackInsights` e `docs/quality-feedback.md`).
export const QUALITY_FEEDBACK_CATEGORIES = [
  "estrategia",
  "copy",
  "legenda",
  "cta",
  "hashtags",
  "layout",
  "design",
  "hierarquia_visual",
  "imagem",
  "video",
  "roteiro",
  "tempo",
  "reels",
  "qualidade_geral",
] as const;

export type QualityFeedbackCategory = (typeof QUALITY_FEEDBACK_CATEGORIES)[number];

/**
 * A nota geral aceita as duas formas de entrada citadas no pedido ("★★★★★" ou "nota de 1 a 10"),
 * normalizadas internamente para uma escala única de 1 a 10 (`QualityFeedbackRecord.overallScore`)
 * — `kind`/`value` originais são preservados para transparência e auditoria.
 */
export type QualityFeedbackRatingInput =
  | { kind: "stars"; value: number }
  | { kind: "score"; value: number };

export type QualityFeedbackCategoryRating = {
  category: QualityFeedbackCategory;
  score: number;
};

export type QualityFeedbackSubmitter = {
  id: string;
  type: "human" | "system";
  name?: string;
};

export type QualityFeedbackSubmissionInput = {
  executionId: string;
  clientId: string;
  contentType: string;
  format: string;
  skillsUsed: string[];
  campaignId?: string;
  rating: QualityFeedbackRatingInput;
  // Notas por categoria (opcional, granular) e categorias marcadas como "precisa melhorar"
  // (checklist, sem exigir uma nota) são conceitos independentes: o usuário pode marcar uma
  // categoria como precisando melhorar sem necessariamente atribuir uma nota a ela, e vice-versa.
  categoryScores?: QualityFeedbackCategoryRating[];
  categoriesNeedingImprovement?: QualityFeedbackCategory[];
  comment?: string;
  submittedBy?: QualityFeedbackSubmitter;
};

export type QualityFeedbackRecord = {
  id: string;
  executionId: string;
  clientId: string;
  contentType: string;
  format: string;
  skillsUsed: string[];
  campaignId?: string;
  overallScore: number;
  ratingInput: QualityFeedbackRatingInput;
  categoryScores: QualityFeedbackCategoryRating[];
  categoriesNeedingImprovement: QualityFeedbackCategory[];
  comment?: string;
  submittedBy?: QualityFeedbackSubmitter;
  submittedAt: string;
};

export type QualityFeedbackQuery = {
  clientId?: string;
  executionId?: string;
  format?: string;
  skillId?: string;
  campaignId?: string;
  since?: string;
  limit?: number;
};

export type QualityFeedbackAverageBucket = {
  key: string;
  averageScore: number;
  count: number;
};

export type QualityFeedbackTimelinePoint = {
  period: string;
  averageScore: number;
  count: number;
};

export type QualityFeedbackHighlightedContent = {
  executionId: string;
  clientId: string;
  format: string;
  overallScore: number;
  submittedAt: string;
  comment?: string;
};

export type QualityFeedbackComplaint = {
  category: QualityFeedbackCategory;
  count: number;
  ratio: number;
};

export type QualityFeedbackReport = {
  generatedAt: string;
  totalFeedbackCount: number;
  overallAverageScore?: number;
  averageByFormat: QualityFeedbackAverageBucket[];
  averageBySkill: QualityFeedbackAverageBucket[];
  averageByCampaign: QualityFeedbackAverageBucket[];
  qualityOverTime: QualityFeedbackTimelinePoint[];
  bestRatedContent: QualityFeedbackHighlightedContent[];
  worstRatedContent: QualityFeedbackHighlightedContent[];
  topRecurringComplaints: QualityFeedbackComplaint[];
};

export type QualityFeedbackFormatPerformance = {
  format: string;
  averageScore: number;
  count: number;
};

/**
 * Saída de `getInsightsForClient`, consumida exclusivamente pelo Eduardo. Nunca contém uma
 * decisão pronta (ex.: "use vídeo") — apenas sinais agregados que o Eduardo traduz em
 * recomendações de texto, sempre aditivas, nunca substituindo a decisão heurística de formato.
 */
export type QualityFeedbackInsights = {
  clientId: string;
  sampleSize: number;
  overallAverageScore?: number;
  lowScoringCategories: QualityFeedbackCategory[];
  recurringComplaints: QualityFeedbackCategory[];
  formatPerformance: QualityFeedbackFormatPerformance[];
};

export type QualityFeedbackIdGenerator = {
  create(prefix: string): string;
};
