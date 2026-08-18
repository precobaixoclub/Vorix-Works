import type { ContentQualityProfile } from "../../shared/utils/content-quality-profile.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";

export type MariaSupportedChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business";

export type MariaCopyBriefing = {
  objective: string;
  channel: MariaSupportedChannel;
  /**
   * Rótulo do formato da peça (ex.: "post único", "carrossel", "reels", "vídeo", "story"),
   * herdado de `recommendedFormatLabel` do Eduardo via `strategy.format` do João. Opcional e
   * ausente em briefings antigos/testes que não o informam — nesse caso a avaliação de
   * qualidade cai no perfil "feed" (ver `resolveContentQualityProfile`), preservando o
   * comportamento universal anterior a esta separação por formato.
   */
  format?: string;
  targetAudience: string;
  toneOfVoice: string;
  cta: string;
  keyMessage: string;
  productName?: string;
  offer?: string;
  platformLimitations?: {
    maxCaptionLength?: number;
    maxHashtags?: number;
    requiredFormat?: string;
  };
  keywords?: string[];
  forbiddenTerms?: string[];
  mandatoryWords?: string[];
  preferredHashtags?: string[];
  language?: "pt-BR" | "en-US" | string;
  additionalContext?: string;
  /** Classificação de objetivo de marketing (João, ver `marketing-objective-classifier.ts`) —
   * influencia a estrutura pedida no prompt (ex.: prova social abre com resultado real, engajamento
   * evita tom de venda). Opcional para não quebrar chamadas antigas/testes que não a informam. */
  marketingObjective?: string;
  /** Memória editorial (headlines/CTAs/conceitos recentes deste workspace) — texto compacto pronto
   * para prompt, injetado por `ContentBriefExecutionTaskHandler`. Ausente = comportamento idêntico
   * ao atual. */
  avoidRepeating?: string;
  /** Fatos estruturados (produto, preço, desconto, oferta) extraídos das imagens de referência —
   * requisito de "copy baseada em evidência": Maria usa isto com prioridade sobre qualquer
   * benefício genérico, e nunca deve inventar um dado comercial que não esteja aqui. Ausente =
   * comportamento idêntico a antes desta funcionalidade existir. */
  referenceIntelligence?: ReferenceIntelligence;
};

export type MariaCopyStrategy = {
  objective: string;
  channel: MariaSupportedChannel;
  audience: string;
  tone: string;
  cta: string;
  hookAngle: string;
  valueProposition: string;
  platformGuidance: string[];
  constraints: string[];
};

export type MariaStructuredCopy = {
  title: string;
  /** Texto curto e único destinado a aparecer DENTRO da imagem gerada (Pedro lê isto via
   * `workflowContext.headline`/`extractVisibleTextContext`) — nunca um parágrafo, nunca repete
   * `title` literalmente. Requisito de "separar as funções de cada texto": texto da imagem ≠
   * título ≠ legenda. Opcional só por compatibilidade com respostas antigas do provider de IA
   * (`chooseBestAttempt` trata ausência como "sem texto autorizado na imagem", nunca como erro). */
  imageHeadline?: string;
  caption: string;
  cta: string;
  hashtags: string[];
  publication: string;
  keywords: string[];
  summary: string;
  objective: string;
  toneUsed: string;
  identifiedAudience: string;
  futureSuggestions: string[];
  observations: string[];
  /** Rastreabilidade `claim -> source` (requisito "toda afirmação relevante precisa ser
   * rastreável até uma fonte") — cada afirmação comercial/factual relevante da copy (preço,
   * desconto, condição) precisa de uma entrada aqui indicando de onde veio (ex.: dado do
   * workspace, `referenceIntelligence`, informação explicitamente autorizada). Vazio por padrão —
   * `evaluateCopyQuality`/Lucas tratam ausência de fonte para uma afirmação comercial como sinal
   * de possível alucinação. Opcional só por compatibilidade com respostas antigas do provider de
   * IA. */
  claims?: Array<{ text: string; source: string }>;
};

export type MariaQualityIssueCode =
  | "SPELLING_GRAMMAR_RISK"
  | "MISSING_TITLE"
  | "MISSING_CAPTION"
  | "MISSING_CTA"
  | "CAPTION_TOO_LONG"
  | "CAPTION_TOO_SHORT"
  | "WEAK_CTA"
  | "TONE_INCONSISTENT"
  | "EXCESSIVE_REPETITION"
  | "DUPLICATED_HASHTAGS"
  | "TOO_FEW_HASHTAGS"
  | "TOO_MANY_HASHTAGS"
  | "TOO_FEW_EMOJIS"
  | "MISSING_COMMENT_PROMPT"
  | "MISSING_SAVE_SHARE_PROMPT"
  | "MISSING_PUBLICATION"
  | "FORBIDDEN_TERM"
  | "MISSING_MANDATORY_WORD"
  // Critérios específicos de perfil (ver `resolveContentQualityProfile`/`MARIA_QUALITY_PROFILE_RULES`):
  // só são avaliados quando o perfil resolvido exige (Reels/Vídeo pedem gancho, Story pede
  // curiosidade e CTA curto) — nunca disparam para o perfil "feed" (comportamento anterior).
  | "MISSING_HOOK"
  | "MISSING_CURIOSITY_TRIGGER"
  | "CTA_TOO_LONG_FOR_FORMAT"
  // Requisitos de "eliminar conteúdo genérico" e "separar as funções de cada texto":
  | "GENERIC_CLICHE_PHRASE_DETECTED"
  | "IMAGE_HEADLINE_DUPLICATES_TITLE"
  // Requisito de "copy baseada em evidência" — uma afirmação comercial na copy (preço, desconto,
  // condição) sem fonte correspondente em `claims`/`referenceIntelligence`/`briefing.offer`.
  | "UNVERIFIED_COMMERCIAL_CLAIM";

export type MariaQualityIssue = {
  code: MariaQualityIssueCode;
  message: string;
  severity: "low" | "medium" | "high";
};

export type MariaQualityReport = {
  passed: boolean;
  score: number;
  attempt: number;
  issues: MariaQualityIssue[];
  /** Perfil de qualidade usado nesta avaliação (Feed/Story/Carrossel/Reels/Vídeo curto). */
  profile: ContentQualityProfile;
};

export type MariaAttemptReport = {
  attempt: number;
  prompt: string;
  providerModel?: string;
  copy?: MariaStructuredCopy;
  quality: MariaQualityReport;
};

export type MariaCopywritingOutput = MariaStructuredCopy & {
  quality: MariaQualityReport;
  attempts: MariaAttemptReport[];
  deliveredBestEffort: boolean;
  /** `provider.id` da tentativa escolhida — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};
