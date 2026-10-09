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
    | "ASSET_FIDELITY_MISMATCH"
    // Screenshot real exibido pequeno demais para continuar legível (escala mínima por classe).
    | "SCREENSHOT_ILLEGIBLE";
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
  /** Recorte de detalhe: região do asset original que foi verificada (pixels da fonte). */
  cropSourceRect?: { x: number; y: number; width: number; height: number };
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
  /** SOMENTE QA/fixtures locais: força uma variante da família para comparar composições da mesma
   * base. Nunca preenchido pelo motor de produção; registrado nas razões de seleção. */
  qaVariantOverride?: EditorialCompositionVariant;
  /** SOMENTE QA/fixtures locais: força a opção visual da variante digital. */
  qaVariantOption?: DigitalServiceOption;
};

/** Variantes internas da família product_offer (nunca uma família nova). */
export const PRODUCT_OFFER_VARIANTS = ["HERO_DOMINANT", "SPLIT_EDITORIAL", "OVERLAY_EDITORIAL"] as const;
export type ProductOfferVariant = (typeof PRODUCT_OFFER_VARIANTS)[number];
export type ProductOfferPriceTreatment = "INLINE_PRICE" | "COMMERCIAL_FOOTER";
export type EditorialLogoTreatment = "DIRECT" | "MULTIPLY_ON_LIGHT" | "CHIP" | "LOGO_DIRECT_LIGHT" | "LOGO_DIRECT_DARK" | "LOGO_SOFT_PLATE" | "LOGO_HAIRLINE_PLATE";

/** Tratamento editorial do CTA (institucional). */
export type EditorialCtaTreatment = "SOLID_PREMIUM" | "OUTLINE_EDITORIAL" | "TEXT_HAIRLINE" | "COMPACT_PILL";

/** Classe visual da base da IA (decide se é cena única, colagem etc. — nunca pela contagem de focos). */
export const EDITORIAL_BASE_VISUAL_CLASSES = ["SINGLE_SCENE_PHOTO", "COLLAGE", "MULTI_PANEL", "ASSET_SHEET", "ILLUSTRATION", "OTHER"] as const;
export type EditorialBaseVisualClass = (typeof EDITORIAL_BASE_VISUAL_CLASSES)[number];

/** Variantes internas da família premium_institutional (base da IA é a protagonista). */
/** PHOTO_DOMINANT/ASYMMETRIC/FULL_BLEED_STORY/MINIMAL são as variantes de cena única; COLLAGE_EDITORIAL
 * fica para bases realmente compostas de peças. FULL_BLEED_EDITORIAL/SPLIT_STORY são legado (só QA). */
export const INSTITUTIONAL_VARIANTS = ["PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY", "MINIMAL_PREMIUM", "COLLAGE_EDITORIAL", "FULL_BLEED_EDITORIAL", "SPLIT_STORY"] as const;
export type InstitutionalVariant = (typeof INSTITUTIONAL_VARIANTS)[number];

/** Variantes internas da família digital_service. MOBILE_DEVICE = screenshot de celular no mockup. */
export const DIGITAL_SERVICE_VARIANTS = ["UI_HERO", "UI_DETAIL_FOCUS", "FLOATING_PRODUCT", "MOBILE_DEVICE"] as const;
export type DigitalServiceVariant = (typeof DIGITAL_SERVICE_VARIANTS)[number];

export type EditorialCompositionVariant = ProductOfferVariant | InstitutionalVariant | DigitalServiceVariant;

/** Como a base entrou na área dela: nunca crop central cego. */
export type EditorialBaseFitStrategy = "FULL_BLEED" | "COVER_FOCAL_SAFE_CROP" | "CONTAIN_WITH_BACKGROUND";

export type EditorialBaseFit = {
  strategy: EditorialBaseFitStrategy;
  /** Fração da área da base que ficou fora do enquadramento (0 = base inteira visível). */
  cropLossPct: number;
  /** Fração do detalhe visual (mapa de gradiente local) preservada dentro do enquadramento. */
  detailRetainedPct: number;
  reasons: string[];
};

/** Análise local da base (sem IA): mapa de detalhe em grade. */
export type EditorialBaseAnalysis = {
  /** Detalhe médio normalizado 0..1 (gradiente local). */
  visualDensity: number;
  /** Fração das células quietas (detalhe baixo) — espaço negativo real. */
  negativeSpaceRatio: number;
  /** Fração do detalhe total concentrada nas 20% células mais detalhadas. */
  focalConcentration: number;
  /** Centroide do detalhe (% do canvas da base). */
  focalPoint: { xPct: number; yPct: number };
  /** Bbox das células de alto detalhe (% da base). */
  detailBox: { xPct: number; yPct: number; widthPct: number; heightPct: number };
  /** Quantidade de agrupamentos separados de alto detalhe (colagem/múltiplas fotos). */
  detailClusters: number;
  /** Faixa quieta mais alta no topo e na base (fração da altura). */
  quietTopPct: number;
  quietBottomPct: number;
  meanLuma: number;
  /** Fração da base com alfa < 50% (colagem/recorte): aparece o fundo da peça, nunca o RGB escondido. */
  transparentRatio: number;
  /** CANDIDATO a fundo separador: transparente + células de pouca borda ligadas à borda (auditoria). */
  backgroundSeparatorRatio?: number;
  /** Fundo separador CONFIRMADO: transparente + candidato opaco só se for liso (confiança >= 0,6). */
  flatSeparatorRatio?: number;
  /** 0..1 — quão liso (cor/luz constante) é o candidato opaco em toda a extensão. */
  separatorConfidence?: number;
  /** Variação global (p10–p90 das médias por célula, 0–255) de luz/cor do candidato opaco. */
  separatorColorVariation?: number;
  /** Mesma variação normalizada (0..1): gradiente de baixa frequência. */
  separatorGradientScore?: number;
  /** Desvio médio de luz DENTRO de cada célula candidata (variação local). */
  separatorLocalVariation?: number;
  /** Agrupamentos de detalhe (objetos ou painéis). */
  contentComponentCount?: number;
  /** Agrupamentos que preenchem o próprio retângulo (painéis de colagem). */
  contentPanelCount?: number;
  classificationReasons?: string[];
  /** Maior agrupamento de detalhe / total de células de detalhe. */
  largestClusterShare?: number;
  /** Divisórias retas de ponta a ponta (painéis). */
  straightDividers?: number;
  /** Quantos tons quantizados cobrem 90% dos pixels (ilustração chapada tem poucos). */
  colorBuckets90?: number;
  /** Pixels com gradiente ~0 (áreas exatamente planas, típicas de arte vetorial). */
  flatPixelRatio?: number;
  visualClass?: EditorialBaseVisualClass;
};

export const SCREENSHOT_CLASSES = ["MOBILE", "DESKTOP", "TABLET", "OTHER"] as const;
export type ScreenshotClass = (typeof SCREENSHOT_CLASSES)[number];
/** EDITORIAL_SURFACE = screenshot inteiro como superfície (cantos + sombra), sem chrome de navegador. */
export type ScreenshotFrame = "EDITORIAL_SURFACE" | "FLOATING_SCREEN" | "PHONE_DEVICE";

/** Opção visual da variante digital (lado/tom/conjunto de recortes). */
export type DigitalServiceOption = "left" | "right" | "a" | "b" | "light" | "dark";

/** Recorte ampliado de uma região REAL do screenshot (nada inventado), rastreável à origem. */
export type EditorialScreenshotCrop = {
  source: "SCREENSHOT_SOURCE";
  url: string;
  /** Retângulo da região no screenshot ORIGINAL, em pixels da fonte. */
  cropSourceRect: { x: number; y: number; width: number; height: number };
  placedRect: { xPct: number; yPct: number; widthPct: number; heightPct: number };
  /** Ampliação relativa ao screenshot principal (>1 = detalhe ampliado). */
  zoomVsMain: number;
};

export type EditorialScreenshotDiagnostics = {
  classification: ScreenshotClass;
  sourceWidth: number;
  sourceHeight: number;
  aspect: number;
  frame: ScreenshotFrame;
  /** contain = screenshot inteiro, sem crop; top-crop só no mockup de celular legado. */
  fit: "contain" | "top_crop";
  /** Largura exibida / largura original (no espaço de design 1080). */
  displayScale: number;
  displayWidthPx: number;
  option?: DigitalServiceOption;
  /** Legibilidade da tela inteira medida para a seleção automática (sem IA). */
  legibility?: { heroScale: number; feedScale: number; edgeRetentionAtFeed: number; fullScreenLegible: boolean; featureEnergyShare?: number; featureAreaShare?: number; featureEdgeRetention?: number; smallFeatureCritical: boolean };
  floatingCopyFits?: boolean;
  /** Paleta aproximada extraída do screenshot (aplicada só ao fundo/superfícies). */
  palette?: { dominant: string; secondary: string; accent: string };
  crops?: EditorialScreenshotCrop[];
};

/** Diagnóstico da composição adaptativa — heurísticas registradas para revisão, nunca um gate. */
export type EditorialCompositionDiagnostics = {
  variant: EditorialCompositionVariant;
  selectionReasons: string[];
  priceTreatment?: ProductOfferPriceTreatment;
  logoTreatment?: EditorialLogoTreatment;
  pageTone: "light" | "dark";
  /** Fração do canvas ocupada pela bbox final do protagonista (produto, base ou screenshot). */
  productVisualProminence: number;
  /** Maior faixa horizontal sem nenhum elemento (fração da altura). */
  largestEmptyBandPct: number;
  /** Distância do centroide ponderado dos elementos ao centro do canvas (0 = centrado, 1 = canto). */
  contentCentroidOffset: number;
  /** Fração do canvas coberta por elementos. */
  occupiedAreaRatio: number;
  baseAnalysis?: EditorialBaseAnalysis;
  baseVisualClass?: EditorialBaseVisualClass;
  ctaTreatment?: EditorialCtaTreatment;
  baseFit?: EditorialBaseFit;
  screenshot?: EditorialScreenshotDiagnostics;
};

export type RenderEditorialCreativeResult = {
  buffer: Buffer;
  family: EditorialCreativeFamily;
  renderedTextZones: CreativePlanTextZone[];
  renderedAssetPlacements: CreativePlan["assetPlacements"];
  compositedAssetRoles: CreativePlanAssetRole[];
  renderedGeometry: EditorialRenderedGeometryManifest;
  assetVerification: EditorialAssetVerification[];
  /** Só no product_offer 4:5 (compositor adaptativo). */
  composition?: EditorialCompositionDiagnostics;
  geometry: {
    valid: boolean;
    boxes: EditorialGeometryBox[];
    issues: EditorialGeometryIssue[];
  };
};
