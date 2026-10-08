import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";

export const EDITORIAL_CREATIVE_FAMILIES = ["product_offer", "premium_institutional", "digital_service"] as const;
export type EditorialCreativeFamily = (typeof EDITORIAL_CREATIVE_FAMILIES)[number];

export type EditorialCreativeAssetBuffer = {
  role: CreativePlanAssetRole;
  url: string;
  buffer: Buffer;
};

export type EditorialGeometryIssue = {
  code:
    | "TEXT_OVERFLOW"
    | "COMPONENT_OVERFLOW"
    | "COLLISION"
    | "MASK_VIOLATION"
    | "ASSET_RATIO_MISMATCH"
    // Asset critico (ou sua sombra) fora da safe area real do canvas — mesma regra de
    // `checkAssetSafeAreaCompliance`, aplicada ANTES de publicar, nunca descoberta so pelo gate.
    | "SAFE_AREA_VIOLATION"
    // Achado do Smoke A (cer-runtime-muyx4qzs-hoinur): bbox declarada, pixels ausentes. Medido sobre
    // a imagem final rasterizada, nunca sobre a geometria declarada.
    | "ASSET_NOT_VISIBLE"
    | "ASSET_FIDELITY_MISMATCH";
  message: string;
};

/** Falhas do compositor editorial que nunca podem virar "frame vazio silencioso" — o run mapeia
 * `code` direto para `errorCode`, sem diluir em `EDITORIAL_COMPOSITION_FAILED`. */
export const EDITORIAL_COMPOSITION_ERROR_CODES = [
  "PRODUCT_ASSET_DECODE_FAILED",
  "EDITORIAL_ASSET_DECODE_FAILED",
  "PRODUCT_ASSET_EMPTY",
  "EDITORIAL_REQUIRED_TEXT_MISSING",
] as const;
export type EditorialCompositionErrorCode = (typeof EDITORIAL_COMPOSITION_ERROR_CODES)[number];

export class EditorialCompositionError extends Error {
  readonly code: EditorialCompositionErrorCode;

  constructor(code: EditorialCompositionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "EditorialCompositionError";
    this.code = code;
  }
}

export function isEditorialCompositionError(error: unknown): error is EditorialCompositionError {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && (EDITORIAL_COMPOSITION_ERROR_CODES as readonly string[]).includes(code);
}

/** Prova em pixel de que um asset composto apareceu na arte final (não só na bbox). */
export type EditorialAssetVerification = {
  role: CreativePlanAssetRole;
  /** Tipo real detectado por magic bytes + decode do sharp, nunca pela extensão da URL. */
  detectedMime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  visible: boolean;
  /** Fração da região verificada em que fonte e frame-sem-asset diferem — sem isso não há como
   * distinguir "produto desenhado" de "fundo parecido com o produto". */
  informativePixelRatio: number;
  /** Entre os pixels informativos, fração em que a arte final está mais perto do asset do que do
   * frame sem asset. ~0 = asset sumiu; ~1 = asset presente. */
  assetMatchRatio: number;
  /** Diferença média (0-255) entre a região final e o asset original no mesmo encaixe. */
  fidelityMeanAbsDiff: number;
  fidelityPass: boolean;
  reason?: string;
};

export type EditorialGeometryBox = {
  id: string;
  kind: "text" | "asset";
  role?: CreativePlanAssetRole;
  rect: CreativePlanTextZone["rect"];
  text?: string;
  fontSizePx?: number;
  lineCount?: number;
};

export type EditorialRenderedGeometryManifest = {
  source: "final_rendered_geometry";
  family: EditorialCreativeFamily;
  textBoxes: EditorialGeometryBox[];
  assetBoxes: EditorialGeometryBox[];
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
  renderedAssetPlacements: CreativePlan["assetPlacements"];
  compositedAssetRoles: CreativePlanAssetRole[];
  renderedGeometry: EditorialRenderedGeometryManifest;
  assetVerification: EditorialAssetVerification[];
  geometry: {
    valid: boolean;
    boxes: EditorialGeometryBox[];
    issues: EditorialGeometryIssue[];
  };
};
