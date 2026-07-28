import type { ContentQualityProfile } from "../../shared/utils/content-quality-profile.js";

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
  | "CTA_TOO_LONG_FOR_FORMAT";

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
