import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";

export type JoaoSupportedChannel =
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

export type JoaoMariaBriefingChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business";

/**
 * Espelha por convenção (ADR 0002 — nenhuma Skill importa outra Skill) o formato real de
 * `EduardoEditorialPlanningOutput`. Quando presente, é o Editorial Brief que o Eduardo decidiu
 * antes de João iniciar o trabalho — João deixa de decidir formato sozinho a partir daqui.
 */
export type JoaoEditorialBriefSummary = {
  campaignObjective: string;
  recommendedFormat: string;
  recommendedFormatLabel: string;
  formatJustification: string;
  recommendedSlideCount?: number;
  recommendedVideoDurationSeconds?: number;
  recommendedChannel: string;
  primaryEmotion: string;
  narrativeStructure: string[];
  recommendedCta: string;
  depthLevel: string;
  contentComplexity: string;
  conversionPriority: string;
  recommendationsForJoao: string[];
};

export type JoaoStrategyRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  desiredChannel: JoaoSupportedChannel;
  desiredFormat: string;
  desiredObjective: string;
  // Opcional para não quebrar quem ainda não roteia o Eduardo antes de João (ex.: testes
  // unitários de João isolado). Quando presente, sobrescreve a decisão de formato/CTA de João.
  editorialBrief?: JoaoEditorialBriefSummary;
  workflowContext?: Record<string, unknown>;
};

export type JoaoMariaBriefing = {
  objective: string;
  channel: JoaoMariaBriefingChannel;
  /** Rótulo do formato da peça (`strategy.format`, herdado de `recommendedFormatLabel` do Eduardo) — usado pela Maria para escolher o perfil de avaliação de qualidade correspondente. */
  format?: string;
  targetAudience: string;
  toneOfVoice: string;
  cta: string;
  keyMessage: string;
  productName?: string;
  offer?: string;
  keywords?: string[];
  forbiddenTerms?: string[];
  mandatoryWords?: string[];
  preferredHashtags?: string[];
  language?: string;
  additionalContext?: string;
};

export type JoaoSofiaBriefing = {
  status: "preliminary";
  channel: JoaoSupportedChannel;
  format: string;
  angle: string;
  centralPromise: string;
  keyMessages: string[];
  visualDirectionNotes: string[];
  brandIdentityNotes: string[];
  notes: string[];
};

export type JoaoMarketingStrategyCore = {
  overallStrategy: string;
  objective: string;
  targetAudience: string;
  channel: JoaoSupportedChannel;
  format: string;
  toneOfVoice: string;
  angle: string;
  centralPromise: string;
  valueProposition: string;
  keyMessages: string[];
  recommendedCta: string;
  observations: string[];
  risks: string[];
  nextSteps: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — enriquece o contexto entregue a Bruno/Vanessa/Diego/Nora/Rafa, nunca decide roteiro/direção sozinho. */
  creativeDna: CampaignCreativeDNA;
};

export type JoaoMarketingStrategyOutput = JoaoMarketingStrategyCore & {
  mariaBriefing: JoaoMariaBriefing;
  sofiaBriefing: JoaoSofiaBriefing;
  aiSupportUsed: boolean;
  /**
   * `provider.id` devolvido pelo Ícaro quando `aiSupportUsed` é `true` — permite ao relatório
   * final distinguir apoio de IA real (`"developer-ai-assisted"`) de conteúdo determinístico
   * (`"fake-icaro-provider"`, só em testes/demonstrações). `undefined` quando `aiSupportUsed` é
   * `false` (Ícaro não configurado ou apoio de IA não aplicado).
   */
  aiProviderId?: string;
};

export type JoaoStrategyEnhancement = {
  angle?: string;
  centralPromise?: string;
  valueProposition?: string;
  keyMessages?: string[];
  risks?: string[];
};
