import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";

export const EDITORIAL_CREATIVE_FAMILIES = ["product_offer", "premium_institutional", "digital_service"] as const;
export type EditorialCreativeFamily = (typeof EDITORIAL_CREATIVE_FAMILIES)[number];

export type EditorialCreativeAssetBuffer = {
  role: CreativePlanAssetRole;
  url: string;
  buffer: Buffer;
};

export type EditorialGeometryIssue = {
  code: "TEXT_OVERFLOW" | "COMPONENT_OVERFLOW" | "COLLISION" | "MASK_VIOLATION" | "ASSET_RATIO_MISMATCH";
  message: string;
};

export type EditorialGeometryBox = {
  id: string;
  rect: CreativePlanTextZone["rect"];
  text?: string;
  fontSizePx?: number;
  lineCount?: number;
};

export type RenderEditorialCreativeInput = {
  baseImageBuffer: Buffer;
  context: CreativeContext;
  plan: CreativePlan;
  assets: readonly EditorialCreativeAssetBuffer[];
};

export type RenderEditorialCreativeResult = {
  buffer: Buffer;
  family: EditorialCreativeFamily;
  renderedTextZones: CreativePlanTextZone[];
  compositedAssetRoles: CreativePlanAssetRole[];
  geometry: {
    valid: boolean;
    boxes: EditorialGeometryBox[];
    issues: EditorialGeometryIssue[];
  };
};
