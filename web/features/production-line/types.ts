export type ProductionFormat = "single_image" | "carousel" | "video";
export type ProductionChannel = "instagram" | "facebook" | "tiktok" | "youtube";
export type ApprovalMode = "manual" | "auto";
export type IdeaStatus = "available" | "used";
export type IdeaProductionMode = "routine" | "standalone";
export type ProductionWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Migração "GPT como motor criativo único" (PR 7/9) — mesmo vocabulário de papel de asset que a
 * API aceita em `referenceAssets` (ver `production.route.ts`/`content-request.schema.ts`). */
export type ReferenceAssetRole = "product_photo" | "screenshot" | "logo" | "reference_style" | "other";
export type ProductionAspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

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
  /** Migração "GPT como motor criativo único" (PR 7/9) — papel real de cada URL em
   * `referenceImages` (indexado por URL). Aditivo e opcional: uma URL ausente aqui é tratada como
   * "product_photo", o mesmo comportamento de antes deste campo existir — só usado pelo motor GPT
   * (`GptCreativeEngineVisualTaskHandler`), nunca pelo motor legado. */
  referenceAssetRoles?: Record<string, ReferenceAssetRole>;
  /** Migração "GPT como motor criativo único" (PR 7/9) — proporção final pedida ao motor GPT; sem
   * isso, o motor cai para "4:5". Ignorado pelo motor legado. */
  aspectRatio?: ProductionAspectRatio;
  /** Migração "GPT como motor criativo único" (PR 7/9) — elementos que a peça nunca deve conter,
   * texto livre separado por vírgula (mesmo formato aceito pela API). Ignorado pelo motor legado. */
  forbiddenElements?: string;
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
