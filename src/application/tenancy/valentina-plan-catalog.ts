import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { TenantPlanCode, TenantPlanDefinition, TenantPlanLimits, TenantSocialNetwork } from "./valentina.types.js";

const BASIC_SPECIALISTS: SkillCapability[] = ["strategy", "copywriting", "quality_review"];
const PRO_SPECIALISTS: SkillCapability[] = [
  "strategy",
  "copywriting",
  "art_direction",
  "social_media_design",
  "image_generation",
  "quality_review",
  "social_publishing",
  "metrics_analysis",
  "optimization",
];

const BASIC_INTEGRATIONS: TenantSocialNetwork[] = ["instagram", "facebook", "threads"];
const PRO_INTEGRATIONS: TenantSocialNetwork[] = ["meta", "instagram", "facebook", "threads", "linkedin", "tiktok", "google_business"];

export const VALENTINA_PLAN_CATALOG: Record<TenantPlanCode, TenantPlanDefinition> = {
  FREE: {
    code: "FREE",
    name: "Free",
    description: "Plano gratuito para validação local e primeiros testes.",
    limits: {
      monthlyAiTokens: 10_000,
      dailyAiTokens: 1_000,
      specialists: BASIC_SPECIALISTS,
      features: ["knowledge_context", "copy_drafts"],
      integrations: [],
      monthlyPublications: 0,
      monthlyCampaigns: 0,
      monthlyImages: 0,
      monthlyVideos: 0,
    },
  },
  START: {
    code: "START",
    name: "Start",
    description: "Plano inicial para operação simples de conteúdo.",
    limits: {
      monthlyAiTokens: 100_000,
      dailyAiTokens: 8_000,
      specialists: BASIC_SPECIALISTS,
      features: ["knowledge_context", "copy_drafts", "editorial_calendar"],
      integrations: BASIC_INTEGRATIONS,
      monthlyPublications: 30,
      monthlyCampaigns: 0,
      monthlyImages: 20,
      monthlyVideos: 0,
    },
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    description: "Plano profissional para conteúdo, imagem e análise.",
    limits: {
      monthlyAiTokens: 500_000,
      dailyAiTokens: 35_000,
      specialists: PRO_SPECIALISTS,
      features: ["knowledge_context", "copy_drafts", "editorial_calendar", "image_generation", "analytics"],
      integrations: PRO_INTEGRATIONS,
      monthlyPublications: 120,
      monthlyCampaigns: 10,
      monthlyImages: 120,
      monthlyVideos: 10,
    },
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    description: "Plano para operação avançada com campanhas e múltiplos canais.",
    limits: {
      monthlyAiTokens: 2_000_000,
      dailyAiTokens: 120_000,
      specialists: "all",
      features: "all",
      integrations: "all",
      monthlyPublications: 600,
      monthlyCampaigns: 80,
      monthlyImages: 600,
      monthlyVideos: 80,
    },
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Plano corporativo sem limites operacionais pré-definidos.",
    limits: {
      monthlyAiTokens: "unlimited",
      dailyAiTokens: "unlimited",
      specialists: "all",
      features: "all",
      integrations: "all",
      monthlyPublications: "unlimited",
      monthlyCampaigns: "unlimited",
      monthlyImages: "unlimited",
      monthlyVideos: "unlimited",
    },
  },
};

export function getValentinaPlanDefinition(code: TenantPlanCode): TenantPlanDefinition {
  return clone(VALENTINA_PLAN_CATALOG[code]);
}

export function getValentinaPlanLimits(code: TenantPlanCode): TenantPlanLimits {
  return getValentinaPlanDefinition(code).limits;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
