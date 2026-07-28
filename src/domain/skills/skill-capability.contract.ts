// Não existe "carousel_creation": um carrossel não é uma especialidade separada, é apenas
// image_generation com imageCount > 1 — decisão exclusiva do Pedro a partir da entrada que
// recebe. Ver arthur.orchestrator.ts (detectImageCount) para como isso é decidido a partir do
// texto do comando, sem nunca acionar uma capability própria para "criar carrossel".
export const SKILL_CAPABILITIES = [
  "editorial_planning",
  "strategy",
  "marketing_strategy",
  "copywriting",
  "art_direction",
  "social_media_design",
  "image_generation",
  "quality_review",
  "social_publishing",
  "campaign_management",
  "metrics_analysis",
  "optimization",
  "video_creation",
  "video_script",
  "video_direction",
  "video_editing",
  "video_narration",
  "video_rendering",
  "client_management",
  "motion_design",
] as const;

export type SkillCapability = (typeof SKILL_CAPABILITIES)[number];

export type SkillResponsibilityBoundary = {
  allowed: string[];
  forbidden: string[];
};
