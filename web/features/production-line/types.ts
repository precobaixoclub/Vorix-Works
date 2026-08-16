export type ProductionFormat = "single_image" | "carousel" | "video";
export type ProductionChannel = "instagram" | "facebook" | "tiktok" | "youtube";
export type ApprovalMode = "manual" | "auto";
export type IdeaStatus = "available" | "used";
export type IdeaProductionMode = "routine" | "standalone";
export type ProductionWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ContentBlueprint = {
  id: string;
  name: string;
  format: ProductionFormat;
  ideaText: string;
  objective: string;
  theme: string;
  captionDirection: string;
  creativeDirection: string;
  /** Opcional — usado só quando a ideia é enviada para geração real (ver "Gerar imagem real").
   * Sem isso, a geração usa um público genérico como fallback. */
  targetAudience?: string;
  mediaCount: number;
  channels: ProductionChannel[];
  approvalMode: ApprovalMode;
  sourceLinks: string[];
  referenceImages: string[];
  status: IdeaStatus;
  productionMode?: IdeaProductionMode;
  usedAt?: string;
};

export type ProductionSequenceStep = {
  id: string;
  blueprintId: string;
  quantity: number;
  everyDays: number;
};

export type WeeklyFormatQuota = {
  id: string;
  format: ProductionFormat;
  quantity: number;
  weekdays: ProductionWeekday[];
  times: string[];
};

export type PostingRule = {
  id: string;
  name: string;
  channels: ProductionChannel[];
  timezone: string;
  times: string[];
  maxPostsPerDay: number;
  spacingMinutes: number;
  sequence: ProductionSequenceStep[];
  weeklyMix: WeeklyFormatQuota[];
  publishMode: ApprovalMode;
};

export type ProductionLineConfig = {
  blueprints: ContentBlueprint[];
  postingRules: PostingRule[];
};

export type ProductionSkillStage = {
  id: string;
  name: string;
  role: string;
  mode: "configured" | "automatic" | "review";
  inputs: string;
  outputs: string;
};
