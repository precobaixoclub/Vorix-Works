import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Sharp } from "sharp";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanRect, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";
import {
  EditorialCompositionError,
  type EditorialAssetVerification,
  type EditorialBaseAnalysis,
  type EditorialBaseVisualClass,
  type EditorialCtaTreatment,
  type EditorialBaseFit,
  type EditorialCompositionDiagnostics,
  type EditorialLogoTreatment,
  type DigitalServiceVariant,
  type InstitutionalVariant,
  type ScreenshotClass,
  type DigitalServiceOption,
  type EditorialScreenshotCrop,
  INSTITUTIONAL_VARIANTS,
  type ProductOfferPriceTreatment,
  type ProductOfferVariant,
  type EditorialCreativeAssetBuffer,
  type EditorialCreativeFamily,
  type EditorialGeometryBox,
  type EditorialGeometryIssue,
  type EditorialRenderedGeometryManifest,
  type RenderEditorialCreativeInput,
  type RenderEditorialCreativeResult,
} from "../../application/creative-engine/editorial-composition.types.js";
export { EDITORIAL_CREATIVE_FAMILIES } from "../../application/creative-engine/editorial-composition.types.js";
export type {
  EditorialAssetVerification,
  EditorialCreativeAssetBuffer,
  EditorialCreativeFamily,
  EditorialGeometryBox,
  EditorialGeometryIssue,
  EditorialRenderedGeometryManifest,
  RenderEditorialCreativeInput,
  RenderEditorialCreativeResult,
} from "../../application/creative-engine/editorial-composition.types.js";
import {
  describeEditorialTextGaps,
  findEditorialRequiredTextsMissingFromZones,
  resolveEditorialConfirmedPrice,
  resolveEditorialRequiredTexts,
} from "../../application/creative-engine/editorial-text-contract.js";
import { SAFE_AREA_MARGIN_PCT } from "../../application/creative-engine/evaluate-creative-quality-gate.js";
import { computeContrastRatio, isValidHexColor } from "../../shared/utils/color-contrast.js";

/** Espaço de design fixo por formato. Achado do Smoke A: as coordenadas das famílias foram
 * desenhadas para 1080 de largura, mas o canvas era a dimensão da imagem base (1024x1280) — o
 * frame do produto e o rodapé vazavam a borda. O SVG agora usa viewBox no espaço de design e é
 * rasterizado direto no tamanho de saída, então a geometria em % é a mesma nos dois. */
type Canvas = { width: number; height: number; format: "4:5" | "9:16" };
type OutputSize = { width: number; height: number };
type PxRect = { x: number; y: number; width: number; height: number };
type TextFit = { lines: string[]; fontSize: number; lineHeight: number; height: number; fits: boolean };
type DetectedImageMime = EditorialAssetVerification["detectedMime"];

/** Asset já decodificado e normalizado para PNG — o SVG nunca recebe os bytes originais com um
 * MIME presumido (causa raiz do JPEG que sumia: `data:image/png` com bytes JPEG é descartado em
 * silêncio pelo rasterizador). */
type PreparedAsset = EditorialCreativeAssetBuffer & {
  detectedMime: DetectedImageMime;
  png: Buffer;
  href: string;
  width: number;
  height: number;
  stats: AssetContentStats;
};

type FamilyRender = { svg: string; zones: CreativePlanTextZone[]; assets: CreativePlan["assetPlacements"]; roles: CreativePlanAssetRole[]; verify: AssetVerifySpec[]; composition?: EditorialCompositionDiagnostics };

type AssetVerifySpec = {
  role: CreativePlanAssetRole;
  rect: PxRect;
  fit: "cover" | "contain";
  position: "centre" | "top";
  /** Frações da região ignoradas por borda (cantos arredondados/clip) — só comparamos pixels que o
   * layout garante estar dentro do clip. */
  inset: { left: number; right: number; top: number; bottom: number };
  checkFidelity: boolean;
  /** Mistura usada na composição. `multiply`: o esperado é fonte × fundo (logo com caixa branca
   * sobre fundo claro) — a verificação reproduz exatamente essa conta, nunca afrouxa. */
  blend?: "multiply";
  /** Recorte de detalhe: a região do asset original (px da fonte) que esta bbox mostra ampliada. */
  crop?: { x: number; y: number; width: number; height: number };
};

const DESIGN_CANVAS: Record<Canvas["format"], { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

const DEFAULT_BRAND = {
  rose: "#B15B6C",
  roseDark: "#7A3543",
  ink: "#24171A",
  cream: "#FFF8F1",
  champagne: "#E8C785",
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(moduleDir, "assets", "geist-regular.ttf");
const FONT_FAMILY = "GeistEditorial";
const AVG_CHAR_WIDTH = 0.54;
let cachedFontBuffer: Buffer | undefined;

/** Limiares da verificação de pixel. Um pixel é "informativo" quando asset e frame-sem-asset
 * diferem acima de `INFORMATIVE_DIFF`; o asset é considerado presente quando a grande maioria
 * desses pixels está mais perto do asset do que do frame vazio. */
const INFORMATIVE_DIFF = 24;
const MIN_INFORMATIVE_RATIO = 0.01;
const MIN_ASSET_MATCH_RATIO = 0.8;
const MAX_FIDELITY_MEAN_ABS_DIFF = 22;
const MIN_ASSET_ALPHA_COVERAGE = 0.02;
const MIN_ASSET_LUMA_STDEV = 1.5;
const VERIFY_BLOCK = 3;

async function loadEditorialFont(): Promise<Buffer> {
  if (!cachedFontBuffer) cachedFontBuffer = await readFile(FONT_PATH);
  return cachedFontBuffer;
}

export async function assertEditorialRuntimeFontAvailable(): Promise<{ family: string; path: string; bytes: number }> {
  const font = await loadEditorialFont();
  return { family: FONT_FAMILY, path: FONT_PATH, bytes: font.length };
}

export async function buildEditorialFontFaceCss(): Promise<string> {
  await loadEditorialFont();
  return `<style>text{font-family:${FONT_FAMILY};}</style>`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pctRect(rect: PxRect, canvas: Canvas): CreativePlanRect {
  return {
    xPct: Number(((rect.x / canvas.width) * 100).toFixed(3)),
    yPct: Number(((rect.y / canvas.height) * 100).toFixed(3)),
    widthPct: Number(((rect.width / canvas.width) * 100).toFixed(3)),
    heightPct: Number(((rect.height / canvas.height) * 100).toFixed(3)),
  };
}

function rectsOverlap(a: PxRect, b: PxRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function within(inner: PxRect, outer: PxRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function pngDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Tipo real pelo conteúdo (magic bytes), nunca pela extensão/URL. */
export function detectImageMime(buffer: Buffer): DetectedImageMime | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  const head = buffer.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if ((head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) && head.includes("<svg")) return "image/svg+xml";
  return undefined;
}

const SHARP_FORMAT_BY_MIME: Record<DetectedImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

type AssetContentStats = { alphaCoverage: number; lumaStdev: number; meanLuma: number; borderLuma: number; borderOpaqueRatio: number };

async function measureAssetContent(png: Buffer): Promise<AssetContentStats> {
  const { data, info } = await sharp(png).resize(128, 128, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let sum = 0;
  let sumSq = 0;
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    if (data[offset + 3] <= 16) continue;
    const luma = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    opaque += 1;
    sum += luma;
    sumSq += luma * luma;
  }
  const total = info.width * info.height;
  const mean = opaque > 0 ? sum / opaque : 0;
  // Borda (1px): diz se o asset tem fundo opaco claro "embutido" (ex.: logo em caixa branca).
  let borderCount = 0;
  let borderOpaque = 0;
  let borderLumaSum = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== info.width - 1 && y !== info.height - 1) continue;
      const offset = (y * info.width + x) * 4;
      borderCount += 1;
      if (data[offset + 3] > 240) {
        borderOpaque += 1;
        borderLumaSum += 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
      }
    }
  }
  return {
    alphaCoverage: opaque / total,
    lumaStdev: opaque > 0 ? Math.sqrt(Math.max(0, sumSq / opaque - mean * mean)) : 0,
    meanLuma: mean,
    borderLuma: borderOpaque > 0 ? borderLumaSum / borderOpaque : 0,
    borderOpaqueRatio: borderCount > 0 ? borderOpaque / borderCount : 0,
  };
}

/** Decodifica de verdade (sharp) e normaliza para PNG. Falha explícita, nunca frame vazio. */
async function prepareAsset(asset: EditorialCreativeAssetBuffer): Promise<PreparedAsset> {
  const failCode = asset.role === "product_photo" ? "PRODUCT_ASSET_DECODE_FAILED" : "EDITORIAL_ASSET_DECODE_FAILED";
  const detectedMime = detectImageMime(asset.buffer);
  if (!detectedMime) {
    throw new EditorialCompositionError(failCode, `asset "${asset.role}" (${asset.url}) não é PNG, JPEG, WEBP nem SVG reconhecível pelo conteúdo (primeiros bytes ${asset.buffer.subarray(0, 4).toString("hex") || "vazio"}).`);
  }
  let png: Buffer;
  let width: number | undefined;
  let height: number | undefined;
  try {
    const decoder = sharp(asset.buffer, detectedMime === "image/svg+xml" ? { density: 288 } : {});
    const meta = await decoder.metadata();
    if (meta.format !== SHARP_FORMAT_BY_MIME[detectedMime]) {
      throw new Error(`conteúdo declarado ${detectedMime} decodificou como ${meta.format ?? "desconhecido"}`);
    }
    png = await decoder.rotate().ensureAlpha().png().toBuffer();
    const normalized = await sharp(png).metadata();
    width = normalized.width;
    height = normalized.height;
  } catch (error) {
    throw new EditorialCompositionError(failCode, `asset "${asset.role}" (${asset.url}, ${detectedMime}) não pôde ser decodificado: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
  }
  if (!width || !height) {
    throw new EditorialCompositionError(failCode, `asset "${asset.role}" (${asset.url}) decodificou sem dimensões válidas.`);
  }
  const content = await measureAssetContent(png);
  if (asset.role === "product_photo") {
    if (content.alphaCoverage < MIN_ASSET_ALPHA_COVERAGE || content.lumaStdev < MIN_ASSET_LUMA_STDEV) {
      throw new EditorialCompositionError(
        "PRODUCT_ASSET_EMPTY",
        `foto do produto (${asset.url}) não tem conteúdo visual utilizável (cobertura opaca ${(content.alphaCoverage * 100).toFixed(1)}%, variação ${content.lumaStdev.toFixed(2)}).`,
      );
    }
  }
  return { ...asset, detectedMime, png, href: pngDataUri(png), width, height, stats: content };
}

/** Preflight de asset editorial — EXATAMENTE a mesma decodificação que o renderer aplica
 * (`prepareAsset`), exposta para o motor validar antes de qualquer IA. Nunca uma segunda
 * implementação: se o preflight passa, o renderer decodifica o mesmo buffer do mesmo jeito. */
export async function preflightEditorialAsset(asset: EditorialCreativeAssetBuffer): Promise<{ detectedMime: DetectedImageMime; width: number; height: number }> {
  const prepared = await prepareAsset(asset);
  return { detectedMime: prepared.detectedMime, width: prepared.width, height: prepared.height };
}

function pickAccent(context: CreativeContext): string {
  // Acento só é usado como fundo de CTA/cor de preço sobre creme — exige contraste real com os dois.
  const hex = context.brandColors?.find((color) => isValidHexColor(color) && (computeContrastRatio(color, "#FFFFFF") ?? 0) >= 4.5);
  return hex ?? DEFAULT_BRAND.roseDark;
}

function firstAsset(assets: readonly PreparedAsset[], role: CreativePlanAssetRole): PreparedAsset | undefined {
  return assets.find((asset) => asset.role === role);
}

function resolveFamily(assets: readonly PreparedAsset[], priceText?: string): EditorialCreativeFamily {
  if (firstAsset(assets, "screenshot")) return "digital_service";
  if (firstAsset(assets, "product_photo") || priceText) return "product_offer";
  return "premium_institutional";
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitText(text: string, widthPx: number, maxHeightPx: number, options: { maxFontSize: number; minFontSize: number; maxLines: number; lineHeight?: number }): TextFit {
  const lineHeight = options.lineHeight ?? 1.08;
  for (let fontSize = options.maxFontSize; fontSize >= options.minFontSize; fontSize -= 1) {
    const maxChars = Math.max(5, Math.floor(widthPx / (fontSize * AVG_CHAR_WIDTH)));
    const lines = wrapText(text, maxChars);
    const height = lines.length * fontSize * lineHeight;
    if (lines.length <= options.maxLines && height <= maxHeightPx) {
      return { lines, fontSize, lineHeight, height, fits: true };
    }
  }
  const fontSize = options.minFontSize;
  const maxChars = Math.max(5, Math.floor(widthPx / (fontSize * AVG_CHAR_WIDTH)));
  const lines = wrapText(text, maxChars).slice(0, options.maxLines);
  return { lines, fontSize, lineHeight, height: lines.length * fontSize * lineHeight, fits: false };
}

type TextSvgInput = {
  text: string;
  x: number;
  y: number;
  width: number;
  maxHeight: number;
  maxFontSize: number;
  minFontSize: number;
  maxLines: number;
  fill: string;
  weight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  anchor?: "start" | "middle" | "end";
  uppercase?: boolean;
  id: string;
  /** Quando informado, `top` é o topo real do bloco (a bbox registrada é exatamente a área que o
   * texto ocupa) e `y` é ignorado. `valign: "center"` centraliza o bloco em `maxHeight`. */
  top?: number;
  valign?: "top" | "center";
  /** Só existe Geist Regular no runtime (BOLD_FONT_BACKLOG): contorno da própria cor engrossa o
   * traço de forma controlada, sem trocar fonte nem fontconfig. Em px de traço. */
  embolden?: number;
};

function textSvg(input: TextSvgInput, canvas: Canvas, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): string {
  const value = input.uppercase ? input.text.toUpperCase() : input.text;
  const fit = fitText(value, input.width, input.maxHeight, {
    maxFontSize: input.maxFontSize,
    minFontSize: input.minFontSize,
    maxLines: input.maxLines,
    lineHeight: input.lineHeight,
  });
  const rectX = input.anchor === "middle" ? input.x - input.width / 2 : input.anchor === "end" ? input.x - input.width : input.x;
  let baseline = input.y;
  let rect: PxRect;
  if (input.top !== undefined) {
    const blockTop = input.valign === "center" ? input.top + Math.max(0, (input.maxHeight - fit.height) / 2) : input.top;
    // Primeira baseline: topo do bloco + ascendente visual da fonte (~0.8em) + metade do leading.
    baseline = blockTop + fit.fontSize * (0.8 + (fit.lineHeight - 1) / 2);
    rect = { x: rectX, y: input.top, width: input.width, height: input.valign === "center" ? Math.max(input.maxHeight, fit.height) : fit.height };
  } else {
    rect = { x: rectX, y: input.y - input.maxFontSize, width: input.width, height: Math.max(input.maxHeight, fit.height) };
  }
  boxes.push({ id: input.id, kind: "text", rect: pctRect(rect, canvas), text: value, fontSizePx: fit.fontSize, lineCount: fit.lines.length });
  if (!fit.fits) {
    issues.push({ code: "TEXT_OVERFLOW", message: `Texto "${input.id}" não coube no bloco editorial sem quebrar a hierarquia.` });
  }
  return `<text x="${input.x}" y="${baseline}" fill="${input.fill}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="${input.weight ?? 800}" text-anchor="${input.anchor ?? "start"}" letter-spacing="${input.letterSpacing ?? 0}"${input.embolden ? ` stroke="${input.fill}" stroke-width="${input.embolden}" stroke-linejoin="round" paint-order="stroke"` : ""}>${fit.lines.map((line, index) => `<tspan x="${input.x}" dy="${index === 0 ? 0 : fit.fontSize * fit.lineHeight}">${xmlEscape(line)}</tspan>`).join("")}</text>`;
}

function assetBox(role: CreativePlanAssetRole, rect: PxRect, canvas: Canvas, boxes: EditorialGeometryBox[]): void {
  boxes.push({ id: role, kind: "asset", role, rect: pctRect(rect, canvas) });
}

function assetPlacement(asset: EditorialCreativeAssetBuffer, rect: PxRect, canvas: Canvas, treatment: string): CreativePlan["assetPlacements"][number] {
  return { role: asset.role, url: asset.url, rect: pctRect(rect, canvas), frame: "none", treatment };
}

/** `data-asset-role` marca a tag do asset real para o render de controle (mesmo SVG sem o asset)
 * usado na verificação de pixel. */
function imageTag(asset: PreparedAsset | undefined, fallback: string, rect: PxRect, options?: { clipId?: string; maskId?: string; opacity?: number; preserveAspectRatio?: string; style?: string }): string {
  const href = asset ? asset.href : fallback;
  if (!href) return "";
  return `<image${asset ? ` data-asset-role="${asset.role}"` : ""} href="${href}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="${options?.preserveAspectRatio ?? "xMidYMid slice"}"${options?.clipId ? ` clip-path="url(#${options.clipId})"` : ""}${options?.maskId ? ` mask="url(#${options.maskId})"` : ""}${options?.opacity !== undefined ? ` opacity="${options.opacity}"` : ""}${options?.style ? ` style="${options.style}"` : ""}/>`;
}

async function blankFallback(width: number, height: number, color: string): Promise<string> {
  const buffer = await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
  return pngDataUri(buffer);
}

function buildTextZones(plan: CreativePlan, price: string | undefined, layout: { headline: PxRect; subheadline?: PxRect; cta?: PxRect; price?: PxRect }, canvas: Canvas): CreativePlanTextZone[] {
  const zones: CreativePlanTextZone[] = [
    { kind: "headline", text: plan.headline, rect: pctRect(layout.headline, canvas), emphasis: "primary", renderedBy: "renderer", backingStyle: "none", align: "left" },
  ];
  if (plan.subheadline && layout.subheadline) {
    zones.push({ kind: "subheadline", text: plan.subheadline, rect: pctRect(layout.subheadline, canvas), emphasis: "secondary", renderedBy: "renderer", backingStyle: "none", align: "left" });
  }
  if (price && layout.price) {
    zones.push({ kind: "price", text: price, rect: pctRect(layout.price, canvas), emphasis: "secondary", renderedBy: "renderer", backingStyle: "solid", align: "left" });
  }
  if (plan.cta.trim() && layout.cta) {
    zones.push({ kind: "cta", text: plan.cta, rect: pctRect(layout.cta, canvas), emphasis: "secondary", renderedBy: "renderer", backingStyle: "solid", align: "center" });
  }
  return zones;
}

function verifySpec(role: CreativePlanAssetRole, rect: PxRect, options: Partial<Omit<AssetVerifySpec, "role" | "rect">> = {}): AssetVerifySpec {
  return {
    role,
    rect,
    fit: options.fit ?? "cover",
    position: options.position ?? "centre",
    inset: options.inset ?? { left: 0, right: 0, top: 0, bottom: 0 },
    checkFidelity: options.checkFidelity ?? false,
    ...(options.blend ? { blend: options.blend } : {}),
  };
}

/** Geometria fixa da família product_offer no espaço de design. Todo asset respeita a safe area
 * (`SAFE_AREA_MARGIN_PCT`) e a sombra do produto cabe inteira no canvas. */
const PRODUCT_OFFER_LAYOUT = {
  "4:5": {
    product: { x: 470, y: 84, width: 548, height: 872 },
    productRadius: 40,
    echoOffset: { x: -18, y: 18 },
    logo: { x: 72, y: 84, width: 300, height: 64 },
    column: { x: 72, width: 352, top: 196, bottom: 960, centreY: 520 },
    headline: { maxHeight: 380, maxFontSize: 80, minFontSize: 40, maxLines: 5 },
    subheadline: { maxHeight: 210, maxFontSize: 30, minFontSize: 22, maxLines: 5 },
    textGap: 72,
    pedestal: "M0 1052C238 1004 492 1012 742 1030C884 1040 990 1020 1080 1000V1350H0Z",
    pedestalLine: "M0 1052C238 1004 492 1012 742 1030C884 1040 990 1020 1080 1000",
    price: { x: 72, y: 1148, width: 580, height: 108, maxFontSize: 104, minFontSize: 44 },
    cta: { x: 690, y: 1154, width: 318, height: 96, maxFontSize: 26, minFontSize: 16 },
  },
  "9:16": {
    product: { x: 150, y: 120, width: 780, height: 1000 },
    productRadius: 48,
    echoOffset: { x: -18, y: 18 },
    logo: { x: 92, y: 1180, width: 300, height: 60 },
    column: { x: 92, width: 880, top: 1272, bottom: 1610, centreY: 0 },
    headline: { maxHeight: 220, maxFontSize: 84, minFontSize: 44, maxLines: 3 },
    subheadline: { maxHeight: 112, maxFontSize: 32, minFontSize: 22, maxLines: 3 },
    textGap: 36,
    pedestal: "M0 1636C260 1600 520 1606 780 1620C900 1626 1000 1612 1080 1598V1920H0Z",
    pedestalLine: "M0 1636C260 1600 520 1606 780 1620C900 1626 1000 1612 1080 1598",
    price: { x: 92, y: 1696, width: 540, height: 110, maxFontSize: 96, minFontSize: 44 },
    cta: { x: 660, y: 1703, width: 328, height: 96, maxFontSize: 27, minFontSize: 16 },
  },
} as const;

/** Sombra do frame do produto — faz parte da área visível do componente, então sua extensão
 * também precisa caber no canvas (ver `checkProductOfferSafeArea`). */
const PRODUCT_SHADOW = { dx: 0, dy: 26, blur: 26, opacity: 0.26 };

export function productShadowExtent(rect: PxRect): PxRect {
  const spread = PRODUCT_SHADOW.blur * 2;
  return {
    x: rect.x + PRODUCT_SHADOW.dx - spread,
    y: rect.y + PRODUCT_SHADOW.dy - spread,
    width: rect.width + spread * 2,
    height: rect.height + spread * 2,
  };
}

async function renderProductOffer(input: RenderEditorialCreativeInput, canvas: Canvas, price: string | undefined, logo: PreparedAsset | undefined, product: PreparedAsset | undefined, ambientHref: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<FamilyRender> {
  const accent = pickAccent(input.context);
  const layout = PRODUCT_OFFER_LAYOUT[canvas.format];
  const photoRect: PxRect = { ...layout.product };
  const logoRect: PxRect = { ...layout.logo };
  const column = layout.column;

  // Coluna editorial em fluxo: headline e subheadline medidos de verdade e posicionados juntos (o
  // bloco centraliza contra o produto no 4:5), nunca caixas fixas com vazios aleatórios entre si.
  const headlineFit = fitText(input.plan.headline, column.width, layout.headline.maxHeight, layout.headline);
  const subheadlineText = input.plan.subheadline?.trim() ? input.plan.subheadline : undefined;
  const subFit = subheadlineText ? fitText(subheadlineText, column.width, layout.subheadline.maxHeight, { ...layout.subheadline, lineHeight: 1.3 }) : undefined;
  const blockHeight = headlineFit.height + (subFit ? layout.textGap + subFit.height : 0);
  const blockTop = canvas.format === "4:5"
    ? Math.round(Math.min(Math.max(column.centreY - blockHeight / 2, column.top), column.bottom - blockHeight))
    : column.top;
  const headlineRect: PxRect = { x: column.x, y: blockTop, width: column.width, height: headlineFit.height };
  const subRect: PxRect | undefined = subFit ? { x: column.x, y: blockTop + headlineFit.height + layout.textGap, width: column.width, height: subFit.height } : undefined;
  const ruleY = blockTop + headlineFit.height + layout.textGap / 2 - 2;
  const priceRect: PxRect = { x: layout.price.x, y: layout.price.y, width: layout.price.width, height: layout.price.height };
  const ctaRect: PxRect = { x: layout.cta.x, y: layout.cta.y, width: layout.cta.width, height: layout.cta.height };

  if (rectsOverlap(headlineRect, photoRect)) issues.push({ code: "MASK_VIOLATION", message: "Headline de produto atravessa a fotografia." });
  const zones = buildTextZones(input.plan, price, { headline: headlineRect, subheadline: subRect, cta: ctaRect, price: priceRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  if (product) {
    roles.push("product_photo");
    assets.push(assetPlacement(product, photoRect, canvas, "final rendered product photo"));
    assetBox("product_photo", photoRect, canvas, boxes);
    const cornerInset = (layout.productRadius + 4) / Math.min(photoRect.width, photoRect.height);
    verify.push(verifySpec("product_photo", photoRect, { inset: { left: cornerInset, right: cornerInset, top: cornerInset, bottom: cornerInset }, checkFidelity: true }));
  }
  if (logo) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, "final rendered logo"));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain" }));
  }

  const echo = { x: photoRect.x + layout.echoOffset.x, y: photoRect.y + layout.echoOffset.y, width: photoRect.width, height: photoRect.height };
  const photoCentreX = photoRect.x + photoRect.width / 2;
  const photoCentreY = photoRect.y + photoRect.height * 0.46;
  const r = layout.productRadius;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${fontFaceCss}
    <defs>
      <clipPath id="productPhoto"><rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="${r}"/></clipPath>
      <linearGradient id="veil" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FBF5EE" stop-opacity="0.97"/>
        <stop offset="0.38" stop-color="#FBF5EE" stop-opacity="0.93"/>
        <stop offset="0.62" stop-color="#F8EEE5" stop-opacity="0.62"/>
        <stop offset="1" stop-color="#F4E7DC" stop-opacity="0.42"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="pedestal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F5E4D8"/>
        <stop offset="1" stop-color="#ECD3C5"/>
      </linearGradient>
      <linearGradient id="ctaFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}"/>
        <stop offset="1" stop-color="#5E2533"/>
      </linearGradient>
      <filter id="productShadow" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="${PRODUCT_SHADOW.dx}" dy="${PRODUCT_SHADOW.dy}" stdDeviation="${PRODUCT_SHADOW.blur}" flood-color="#3B121B" flood-opacity="${PRODUCT_SHADOW.opacity}"/></filter>
      <filter id="ctaShadow" x="-20%" y="-30%" width="140%" height="190%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#3B121B" flood-opacity="0.28"/></filter>
    </defs>
    <rect width="${canvas.width}" height="${canvas.height}" fill="${DEFAULT_BRAND.cream}"/>
    ${imageTag(undefined, ambientHref, { x: 0, y: 0, width: canvas.width, height: canvas.height })}
    <rect width="${canvas.width}" height="${canvas.height}" fill="url(#veil)"/>
    <ellipse cx="${photoCentreX}" cy="${photoCentreY}" rx="${photoRect.width * 0.82}" ry="${photoRect.height * 0.62}" fill="url(#glow)"/>
    <path d="${layout.pedestal}" fill="url(#pedestal)"/>
    <path d="${layout.pedestalLine}" fill="none" stroke="${DEFAULT_BRAND.champagne}" stroke-opacity="0.9" stroke-width="2"/>
    <rect x="${echo.x}" y="${echo.y}" width="${echo.width}" height="${echo.height}" rx="${r}" fill="none" stroke="#C9A35E" stroke-opacity="0.85" stroke-width="2"/>
    <g filter="url(#productShadow)"><rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="${r}" fill="#EFE3D8"/></g>
    ${imageTag(product, "", photoRect, { clipId: "productPhoto" })}
    <rect x="${photoRect.x + 0.75}" y="${photoRect.y + 0.75}" width="${photoRect.width - 1.5}" height="${photoRect.height - 1.5}" rx="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.5"/>
    ${logo ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: 0, top: headlineRect.y, width: column.width, maxHeight: layout.headline.maxHeight, maxFontSize: layout.headline.maxFontSize, minFontSize: layout.headline.minFontSize, maxLines: layout.headline.maxLines, fill: DEFAULT_BRAND.ink, weight: 850, letterSpacing: -1 }, canvas, boxes, issues)}
    ${subRect && subheadlineText ? `<rect x="${column.x}" y="${ruleY}" width="56" height="4" rx="2" fill="#C9A35E"/>
    ${textSvg({ id: "subheadline", text: subheadlineText, x: subRect.x, y: 0, top: subRect.y, width: column.width, maxHeight: layout.subheadline.maxHeight, maxFontSize: layout.subheadline.maxFontSize, minFontSize: layout.subheadline.minFontSize, maxLines: layout.subheadline.maxLines, lineHeight: 1.3, fill: "#6B5254", weight: 500 }, canvas, boxes, issues)}` : ""}
    ${price ? textSvg({ id: "price", text: price, x: priceRect.x, y: 0, top: priceRect.y, valign: "center", width: priceRect.width, maxHeight: priceRect.height, maxFontSize: layout.price.maxFontSize, minFontSize: layout.price.minFontSize, maxLines: 1, fill: accent, weight: 850, letterSpacing: -0.5 }, canvas, boxes, issues) : ""}
    ${input.plan.cta.trim() ? `<g filter="url(#ctaShadow)"><rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="url(#ctaFill)"/></g>
    ${textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: 0, top: ctaRect.y, valign: "center", width: ctaRect.width - 48, maxHeight: ctaRect.height, maxFontSize: layout.cta.maxFontSize, minFontSize: layout.cta.minFontSize, maxLines: 1, fill: "#FFF8F1", weight: 850, letterSpacing: 1.5, anchor: "middle" }, canvas, boxes, issues)}` : ""}
  </svg>`;
  return { svg, zones, assets, roles, verify };
}

// =================================================================================================
// product_offer 4:5 — compositor editorial ADAPTATIVO (não um template de slots). O produto real é
// o elemento principal; headline, subheadline, preço, CTA e logo se organizam ao redor dele, em uma
// de três variantes da MESMA família, escolhida de forma determinística. Toda bbox continua sendo a
// geometria final renderizada (fonte de verdade do gate), dentro da safe area e sem sobreposição
// de texto sobre o produto (`TEXT_ZONE_OVERLAPS_ASSET` não é afrouxado).
// =================================================================================================

export type ProductOfferSelectionSignals = {
  productAspect: number;
  productComplexity: number;
  productIsCutout: boolean;
  headlineChars: number;
  subheadlineChars: number;
  priceChars: number;
  hasCta: boolean;
  primaryMassPct?: number;
  visualDensity?: string;
};

/** Mesmo input → mesma variante. Ordem das regras = prioridade. */
export function selectProductOfferVariant(signals: ProductOfferSelectionSignals): { variant: ProductOfferVariant; reasons: string[] } {
  if ((signals.primaryMassPct ?? 0) >= 60) {
    return { variant: "HERO_DOMINANT", reasons: [`diretor pediu massa visual do produto de ${signals.primaryMassPct}% (>= 60): produto protagonista, copy secundária`] };
  }
  if (signals.visualDensity === "clean" && signals.headlineChars <= 26 && !signals.productIsCutout) {
    return { variant: "OVERLAY_EDITORIAL", reasons: ["densidade clean + headline curta (<= 26) + foto de cena: produto domina e a copy usa a extensão desfocada da própria cena"] };
  }
  const splitReasons = [
    signals.headlineChars > 34 ? `headline longa (${signals.headlineChars} > 34) precisa de coluna própria` : undefined,
    signals.priceChars > 10 ? `preço largo (${signals.priceChars} > 10) pede rodapé comercial` : undefined,
    signals.subheadlineChars > 72 ? `subheadline longa (${signals.subheadlineChars} > 72)` : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  if (splitReasons.length > 0) return { variant: "SPLIT_EDITORIAL", reasons: splitReasons };
  if (signals.productAspect >= 1.15) {
    return { variant: "HERO_DOMINANT", reasons: [`produto horizontal (proporção ${signals.productAspect.toFixed(2)} >= 1.15) ocupa bem uma faixa larga`] };
  }
  return { variant: "SPLIT_EDITORIAL", reasons: ["conteúdo equilibrado: produto e copy dividem a composição"] };
}

type ProductOfferPalette = {
  tone: "light" | "dark";
  page: string;
  ink: string;
  muted: string;
  price: string;
  ctaFill: string;
  ctaFillEnd: string;
  ctaText: string;
  hairline: string;
};

function productOfferPalette(tone: "light" | "dark", accent: string): ProductOfferPalette {
  return tone === "dark"
    ? { tone, page: "#120B0D", ink: "#FFF6EC", muted: "#E6D6CB", price: "#EBCB8B", ctaFill: "#EBCB8B", ctaFillEnd: "#C9A35E", ctaText: "#24160F", hairline: "#EBCB8B" }
    : { tone, page: "#F5EEE6", ink: "#1E1315", muted: "#5B4648", price: accent, ctaFill: accent, ctaFillEnd: "#5E2533", ctaText: "#FFF8F1", hairline: "#C9A35E" };
}

type TextSpec = {
  id: "headline" | "subheadline" | "price" | "cta";
  text: string;
  width: number;
  maxHeight: number;
  maxFontSize: number;
  minFontSize: number;
  maxLines: number;
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
};

function measureSpec(spec: TextSpec): TextFit {
  return fitText(spec.uppercase ? spec.text.toUpperCase() : spec.text, spec.width, spec.maxHeight, spec);
}

/** Largura estimada de uma linha (mesma métrica do wrap, com folga para tracking). */
function estimateLineWidth(text: string, fontSize: number, letterSpacing = 0): number {
  return Math.ceil(text.length * fontSize * 0.56 + Math.max(0, letterSpacing) * text.length);
}

function fitAspectInto(area: PxRect, aspect: number): PxRect {
  let width = area.width;
  let height = width / aspect;
  if (height > area.height) {
    height = area.height;
    width = height * aspect;
  }
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width: Math.round(width), height: Math.round(height) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Logo horizontal fica baixa e larga; logo compacta/quadrada ganha altura para ter presença. */
function logoSize(logo: PreparedAsset, maxWidth: number, horizontalHeight: number): { width: number; height: number } {
  const aspect = logo.width / logo.height;
  if (aspect >= 2.2) return { width: Math.round(Math.min(maxWidth, horizontalHeight * aspect)), height: horizontalHeight };
  const height = Math.round(horizontalHeight * 1.55);
  return { width: Math.round(Math.min(maxWidth, height * aspect)), height };
}

/** Backing só quando necessário: logo com caixa branca embutida em fundo claro some por multiply
 * (pixels do asset intactos, só a mistura muda); em fundo escuro, ou logo escura sem caixa, vira um
 * chip discreto; logo transparente com contraste suficiente entra direto. */
function resolveLogoTreatment(logo: PreparedAsset, tone: "light" | "dark"): EditorialLogoTreatment {
  const hasOpaqueLightBox = logo.stats.borderOpaqueRatio > 0.9 && logo.stats.borderLuma > 228;
  if (tone === "light") return hasOpaqueLightBox ? "MULTIPLY_ON_LIGHT" : "DIRECT";
  return hasOpaqueLightBox || logo.stats.meanLuma < 120 ? "CHIP" : "DIRECT";
}

function compositionMetrics(boxes: readonly EditorialGeometryBox[], canvas: Canvas, productRect: PxRect | undefined, extraRects: readonly PxRect[] = []): Pick<EditorialCompositionDiagnostics, "productVisualProminence" | "largestEmptyBandPct" | "contentCentroidOffset" | "occupiedAreaRatio"> {
  const cell = 20;
  const cols = Math.ceil(canvas.width / cell);
  const rows = Math.ceil(canvas.height / cell);
  const covered = new Uint8Array(cols * rows);
  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;
  for (const rect of [...boxes.map((box) => boxPxRect(box, canvas)), ...extraRects]) {
    const area = rect.width * rect.height;
    weightedX += (rect.x + rect.width / 2) * area;
    weightedY += (rect.y + rect.height / 2) * area;
    totalArea += area;
    for (let row = Math.floor(rect.y / cell); row < Math.min(rows, Math.ceil((rect.y + rect.height) / cell)); row += 1) {
      for (let col = Math.floor(rect.x / cell); col < Math.min(cols, Math.ceil((rect.x + rect.width) / cell)); col += 1) covered[row * cols + col] = 1;
    }
  }
  let longestEmpty = 0;
  let currentEmpty = 0;
  const marginRows = Math.ceil(64 / cell);
  for (let row = marginRows; row < rows - marginRows; row += 1) {
    let any = false;
    for (let col = 0; col < cols && !any; col += 1) any = covered[row * cols + col] === 1;
    currentEmpty = any ? 0 : currentEmpty + 1;
    longestEmpty = Math.max(longestEmpty, currentEmpty);
  }
  const occupied = covered.reduce((sum, value) => sum + value, 0) / covered.length;
  const cx = totalArea > 0 ? weightedX / totalArea : canvas.width / 2;
  const cy = totalArea > 0 ? weightedY / totalArea : canvas.height / 2;
  const halfDiagonal = Math.hypot(canvas.width / 2, canvas.height / 2);
  return {
    productVisualProminence: productRect ? Number(((productRect.width * productRect.height) / (canvas.width * canvas.height)).toFixed(3)) : 0,
    largestEmptyBandPct: Number(((longestEmpty * cell) / canvas.height).toFixed(3)),
    contentCentroidOffset: Number((Math.hypot(cx - canvas.width / 2, cy - canvas.height / 2) / halfDiagonal).toFixed(3)),
    occupiedAreaRatio: Number(occupied.toFixed(3)),
  };
}

/** Limiares de revisão (heurística registrada, não gate): produto com presença real e sem faixa
 * morta grande. */
export const PRODUCT_OFFER_MIN_PROMINENCE = 0.28;
export const PRODUCT_OFFER_MAX_EMPTY_BAND = 0.12;

type ProductOfferLayout = {
  productRect?: PxRect;
  productFeather: number;
  logoRect?: PxRect;
  head: { spec: TextSpec; rect: PxRect; anchor: "start" | "middle" };
  sub?: { spec: TextSpec; rect: PxRect; anchor: "start" | "middle" };
  price?: { spec: TextSpec; rect: PxRect; valign: "top" | "center" };
  cta?: { spec: TextSpec; pill: PxRect };
  hairline?: { x1: number; x2: number; y: number };
  scrimTop?: number;
};

async function renderProductOfferAdaptive(
  input: RenderEditorialCreativeInput,
  canvas: Canvas,
  price: string | undefined,
  logo: PreparedAsset | undefined,
  product: PreparedAsset | undefined,
  backdrop: { ambientHref: string; productAmbientHref?: string; baseTone: "light" | "dark" },
  fontFaceCss: string,
  boxes: EditorialGeometryBox[],
  issues: EditorialGeometryIssue[],
): Promise<FamilyRender> {
  const W = canvas.width;
  const H = canvas.height;
  const M = 64;
  const plan = input.plan;
  const headline = plan.headline;
  const subheadline = plan.subheadline?.trim() ? plan.subheadline : undefined;
  const cta = plan.cta.trim() ? plan.cta : undefined;
  const productAspect = product ? product.width / product.height : 1;
  const productIsCutout = product ? product.stats.alphaCoverage < 0.95 : false;
  const selectedOffer = selectProductOfferVariant({
    productAspect,
    productComplexity: product?.stats.lumaStdev ?? 0,
    productIsCutout,
    headlineChars: headline.length,
    subheadlineChars: subheadline?.length ?? 0,
    priceChars: price?.length ?? 0,
    hasCta: Boolean(cta),
    primaryMassPct: plan.artDirection?.primaryMassPct,
    visualDensity: plan.visualDensity,
  });
  // Override só para fixtures locais de QA (mesmo contrato das outras famílias).
  const offerOverride = input.qaVariantOverride && (["HERO_DOMINANT", "SPLIT_EDITORIAL", "OVERLAY_EDITORIAL"] as const).includes(input.qaVariantOverride as ProductOfferVariant) ? (input.qaVariantOverride as ProductOfferVariant) : undefined;
  // 9:16: lado a lado num canvas estreito e alto deixa o produto pequeno e sobra vazio — o
  // equivalente vertical do split é produto em cima + copy embaixo (HERO_DOMINANT).
  const verticalOffer = isVerticalCanvas(canvas) && !offerOverride && selectedOffer.variant === "SPLIT_EDITORIAL";
  const variant: ProductOfferVariant = offerOverride ?? (verticalOffer ? "HERO_DOMINANT" : selectedOffer.variant);
  const reasons = offerOverride
    ? [`QA_VARIANT_OVERRIDE=${offerOverride} (fixture local; regra escolheria ${selectedOffer.variant})`, ...selectedOffer.reasons]
    : verticalOffer
      ? [...selectedOffer.reasons, "9:16: split lateral vira empilhado (HERO_DOMINANT) — produto em largura total, copy embaixo"]
      : selectedOffer.reasons;
  const tone: "light" | "dark" = variant === "OVERLAY_EDITORIAL" || backdrop.baseTone === "dark" ? "dark" : "light";
  const palette = productOfferPalette(tone, pickAccent(input.context));
  const priceTreatment: ProductOfferPriceTreatment = variant === "HERO_DOMINANT" || (variant === "SPLIT_EDITORIAL" && (price?.length ?? 0) > 10) ? "COMMERCIAL_FOOTER" : "INLINE_PRICE";
  const logoTreatment = logo ? resolveLogoTreatment(logo, tone) : undefined;
  const ctaFont = 23;
  const ctaH = 78;
  const ctaW = cta ? clamp(estimateLineWidth(cta.toUpperCase(), ctaFont, 2) + 88, 240, 430) : 0;
  const ctaSpec = (pill: PxRect): TextSpec => ({ id: "cta", text: cta!, width: pill.width - 56, maxHeight: pill.height, maxFontSize: ctaFont, minFontSize: 15, maxLines: 1, letterSpacing: 2, uppercase: true });
  // 9:16: topo/base de texto e logo dentro da safe area vertical; no 4:5 os mesmos valores de sempre.
  const vertical = isVerticalCanvas(canvas);
  const safe = storySafeInsets(canvas);
  const topEdge = (y: number): number => (vertical ? Math.max(y, safe.top) : y);
  const bottomEdge = vertical ? H - safe.bottom : H - M;
  const photoAspect = (min: number, max: number): number => (productIsCutout ? productAspect : clamp(productAspect, min, max));

  const layout: ProductOfferLayout = (() => {
    if (variant === "HERO_DOMINANT") {
      const logoBox = logo ? logoSize(logo, 300, 50) : undefined;
      const logoRect = logoBox ? { x: Math.round((W - logoBox.width) / 2), y: topEdge(58), ...logoBox } : undefined;
      const top = logoRect ? logoRect.y + logoRect.height + 34 : topEdge(M + 8);
      const rowH = 88;
      const rowTop = bottomEdge - rowH;
      const priceSpec: TextSpec | undefined = price ? { id: "price", text: price, width: 600, maxHeight: rowH, maxFontSize: 76, minFontSize: 34, maxLines: 1, letterSpacing: 0 } : undefined;
      const priceFont = priceSpec ? measureSpec(priceSpec).fontSize : 0;
      const priceW = price ? Math.min(600, estimateLineWidth(price, priceFont)) : 0;
      const gap = cta && price ? 44 : 0;
      const startX = Math.round((W - (priceW + gap + (cta ? ctaW : 0))) / 2);
      const priceRect = price ? { x: startX, y: rowTop, width: priceW, height: rowH } : undefined;
      const pill = cta ? { x: startX + priceW + gap, y: rowTop + Math.round((rowH - ctaH) / 2), width: ctaW, height: ctaH } : undefined;
      const headTwo: TextSpec = { id: "headline", text: headline, width: 920, maxHeight: 176, maxFontSize: 82, minFontSize: 40, maxLines: 2, lineHeight: 1.04, letterSpacing: -0.4 };
      const headSpec = measureSpec(headTwo).fits ? headTwo : { ...headTwo, maxLines: 3, maxHeight: 210 };
      const headFit = measureSpec(headSpec);
      const subSpec: TextSpec | undefined = subheadline ? { id: "subheadline", text: subheadline, width: 760, maxHeight: subheadline.length > 90 ? 120 : 84, maxFontSize: 28, minFontSize: 20, maxLines: subheadline.length > 90 ? 3 : 2, lineHeight: 1.38, letterSpacing: 0.2 } : undefined;
      const subFit = subSpec ? measureSpec(subSpec) : undefined;
      const textBottom = rowTop - 58;
      const subRect = subFit ? { x: Math.round((W - 760) / 2), y: Math.round(textBottom - subFit.height), width: 760, height: subFit.height } : undefined;
      const headRect = { x: Math.round((W - 920) / 2), y: Math.round((subRect ? subRect.y - 22 : textBottom) - headFit.height), width: 920, height: headFit.height };
      const area = { x: M, y: top, width: W - 2 * M, height: headRect.y - 38 - top };
      return {
        productRect: product ? fitAspectInto(area, photoAspect(0.8, 1.45)) : undefined,
        productFeather: productIsCutout ? 0 : 40,
        logoRect,
        head: { spec: headSpec, rect: headRect, anchor: "middle" },
        sub: subSpec && subRect ? { spec: subSpec, rect: subRect, anchor: "middle" } : undefined,
        price: priceSpec && priceRect ? { spec: { ...priceSpec, width: priceW }, rect: priceRect, valign: "center" } : undefined,
        cta: pill ? { spec: ctaSpec(pill), pill } : undefined,
        hairline: { x1: W / 2 - 90, x2: W / 2 + 90, y: rowTop - 30 },
      };
    }

    if (variant === "SPLIT_EDITORIAL") {
      const logoBox = logo ? logoSize(logo, 260, 46) : undefined;
      const logoRect = logoBox ? { x: M, y: topEdge(64), ...logoBox } : undefined;
      const footer = priceTreatment === "COMMERCIAL_FOOTER";
      const rowH = 88;
      const rowTop = bottomEdge - rowH;
      const productArea = { x: 400, y: M + 8, width: W - M - 400, height: (footer ? rowTop - 44 : bottomEdge - 8) - (M + 8) };
      const productRect = product ? fitAspectInto(productArea, photoAspect(0.64, 0.7)) : undefined;
      const colX = M;
      const colW = 304;
      const headSpec: TextSpec = { id: "headline", text: headline, width: colW, maxHeight: 380, maxFontSize: 74, minFontSize: 38, maxLines: 5, lineHeight: 1.04, letterSpacing: -0.2 };
      const headFit = measureSpec(headSpec);
      const subSpec: TextSpec | undefined = subheadline ? { id: "subheadline", text: subheadline, width: colW, maxHeight: 190, maxFontSize: 25, minFontSize: 19, maxLines: 6, lineHeight: 1.42, letterSpacing: 0.2 } : undefined;
      const subFit = subSpec ? measureSpec(subSpec) : undefined;
      const priceSpec: TextSpec | undefined = price ? { id: "price", text: price, width: footer ? 600 : colW, maxHeight: footer ? rowH : 84, maxFontSize: footer ? 72 : 70, minFontSize: 32, maxLines: 1, letterSpacing: 0 } : undefined;
      const priceFit = priceSpec ? measureSpec(priceSpec) : undefined;
      const inlinePill = cta && !footer ? Math.min(colW, ctaW) : 0;
      const colHeight = headFit.height + (subFit ? 26 + subFit.height : 0) + (!footer && priceFit ? 44 + priceFit.height : 0) + (inlinePill ? 24 + ctaH : 0);
      const centre = productRect ? productRect.y + productRect.height / 2 : H / 2;
      const minTop = (logoRect ? logoRect.y + logoRect.height : M) + 56;
      const maxBottom = footer ? rowTop - 44 : bottomEdge;
      const colTop = Math.round(clamp(centre - colHeight / 2, minTop, maxBottom - colHeight));
      const headRect = { x: colX, y: colTop, width: colW, height: headFit.height };
      const subRect = subFit ? { x: colX, y: headRect.y + headRect.height + 26, width: colW, height: subFit.height } : undefined;
      let cursor = (subRect ?? headRect).y + (subRect ?? headRect).height;
      let priceRect: PxRect | undefined;
      let pill: PxRect | undefined;
      if (footer) {
        const priceW = price && priceFit ? Math.min(600, estimateLineWidth(price, priceFit.fontSize)) : 0;
        priceRect = price ? { x: M, y: rowTop, width: priceW, height: rowH } : undefined;
        pill = cta ? { x: W - M - ctaW, y: rowTop + Math.round((rowH - ctaH) / 2), width: ctaW, height: ctaH } : undefined;
      } else {
        if (priceFit) {
          priceRect = { x: colX, y: cursor + 44, width: colW, height: priceFit.height };
          cursor = priceRect.y + priceRect.height;
        }
        pill = inlinePill ? { x: colX, y: cursor + 24, width: inlinePill, height: ctaH } : undefined;
      }
      return {
        productRect,
        productFeather: productIsCutout ? 0 : 36,
        logoRect,
        head: { spec: headSpec, rect: headRect, anchor: "start" },
        sub: subSpec && subRect ? { spec: subSpec, rect: subRect, anchor: "start" } : undefined,
        price: priceSpec && priceRect ? { spec: { ...priceSpec, width: priceRect.width }, rect: priceRect, valign: footer ? "center" : "top" } : undefined,
        cta: pill ? { spec: ctaSpec(pill), pill } : undefined,
        hairline: footer ? { x1: M, x2: W - M, y: rowTop - 24 } : undefined,
      };
    }

    // OVERLAY_EDITORIAL
    const logoBox = logo ? logoSize(logo, 260, 46) : undefined;
    const logoRect = logoBox ? { x: M + 8, y: topEdge(60), ...logoBox } : undefined;
    const rowH = 86;
    const rowTop = bottomEdge - rowH;
    const priceSpec: TextSpec | undefined = price ? { id: "price", text: price, width: 520, maxHeight: rowH, maxFontSize: 68, minFontSize: 32, maxLines: 1, letterSpacing: 0 } : undefined;
    const priceFont = priceSpec ? measureSpec(priceSpec).fontSize : 0;
    const priceW = price ? Math.min(520, estimateLineWidth(price, priceFont)) : 0;
    const priceRect = price ? { x: M, y: rowTop, width: priceW, height: rowH } : undefined;
    const pill = cta ? { x: M + priceW + (price ? 40 : 0), y: rowTop + Math.round((rowH - ctaH) / 2), width: ctaW, height: ctaH } : undefined;
    const subSpec: TextSpec | undefined = subheadline ? { id: "subheadline", text: subheadline, width: 780, maxHeight: 118, maxFontSize: 27, minFontSize: 19, maxLines: 3, lineHeight: 1.4, letterSpacing: 0.2 } : undefined;
    const subFit = subSpec ? measureSpec(subSpec) : undefined;
    const headSpec: TextSpec = { id: "headline", text: headline, width: 900, maxHeight: 196, maxFontSize: 94, minFontSize: 48, maxLines: 2, lineHeight: 1.0, letterSpacing: -0.6 };
    const headFit = measureSpec(headSpec);
    const subRect = subFit ? { x: M, y: Math.round(rowTop - 42 - subFit.height), width: 780, height: subFit.height } : undefined;
    const headRect = { x: M, y: Math.round((subRect ? subRect.y - 20 : rowTop - 42) - headFit.height), width: 900, height: headFit.height };
    const areaTop = (logoRect ? logoRect.y + logoRect.height : M) + 30;
    const area = { x: M, y: areaTop, width: W - 2 * M, height: headRect.y - 46 - areaTop };
    return {
      productRect: product ? fitAspectInto(area, photoAspect(0.8, 1.5)) : undefined,
      productFeather: productIsCutout ? 0 : 56,
      logoRect,
      head: { spec: headSpec, rect: headRect, anchor: "start" },
      sub: subSpec && subRect ? { spec: subSpec, rect: subRect, anchor: "start" } : undefined,
      price: priceSpec && priceRect ? { spec: { ...priceSpec, width: priceW }, rect: priceRect, valign: "center" } : undefined,
      cta: pill ? { spec: ctaSpec(pill), pill } : undefined,
      scrimTop: headRect.y - 170,
    };
  })();

  const { productRect, productFeather, logoRect } = layout;
  if (productRect && rectsOverlap(layout.head.rect, productRect)) issues.push({ code: "MASK_VIOLATION", message: "Headline de produto atravessa a fotografia." });
  const zones = buildTextZones(plan, price, {
    headline: layout.head.rect,
    subheadline: layout.sub?.rect,
    price: layout.price?.rect,
    cta: layout.cta ? { x: layout.cta.pill.x + 28, y: layout.cta.pill.y, width: layout.cta.pill.width - 56, height: layout.cta.pill.height } : undefined,
  }, canvas);

  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  if (product && productRect) {
    roles.push("product_photo");
    assets.push(assetPlacement(product, productRect, canvas, `final rendered product photo (${variant})`));
    assetBox("product_photo", productRect, canvas, boxes);
    const inset = productFeather > 0 ? (productFeather * 2.1 + 6) / Math.min(productRect.width, productRect.height) : 0.02;
    verify.push(verifySpec("product_photo", productRect, { fit: productIsCutout ? "contain" : "cover", inset: { left: inset, right: inset, top: inset, bottom: inset }, checkFidelity: true }));
  }
  if (logo && logoRect) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, `final rendered logo (${logoTreatment})`));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { blend: "multiply" as const } : {}) }));
  }

  const isDark = palette.tone === "dark";
  const productTag = product && productRect
    ? imageTag(product, "", productRect, {
        preserveAspectRatio: productIsCutout ? "xMidYMid meet" : "xMidYMid slice",
        ...(productFeather > 0 ? { maskId: "productFeather" } : {}),
      })
    : "";
  const logoTag = logo && logoRect ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { style: "mix-blend-mode:multiply" } : {}) }) : "";
  const chip = logo && logoRect && logoTreatment === "CHIP"
    ? `<rect x="${logoRect.x - 14}" y="${logoRect.y - 10}" width="${logoRect.width + 28}" height="${logoRect.height + 20}" rx="${Math.min(18, (logoRect.height + 20) / 2)}" fill="#FFF8F1" opacity="0.96" filter="url(#softShadow)"/>`
    : "";
  const glow = productRect
    ? `<ellipse cx="${productRect.x + productRect.width / 2}" cy="${productRect.y + productRect.height * 0.48}" rx="${productRect.width * 0.75}" ry="${productRect.height * 0.7}" fill="url(#glow)"/>`
    : "";
  const cutoutShadow = product && productRect && productIsCutout
    ? `<ellipse cx="${productRect.x + productRect.width / 2}" cy="${productRect.y + productRect.height - 8}" rx="${productRect.width * 0.36}" ry="18" fill="#2A1A14" opacity="0.28" filter="url(#contactBlur)"/>`
    : "";
  const textFill = (id: TextSpec["id"]): string => (id === "headline" ? palette.ink : id === "subheadline" ? palette.muted : id === "price" ? palette.price : palette.ctaText);
  const renderText = (block: { spec: TextSpec; rect: PxRect; anchor?: "start" | "middle"; valign?: "top" | "center" }, weight: number, embolden: (size: number) => number): string => {
    const fit = measureSpec(block.spec);
    const anchor = block.anchor ?? "start";
    return textSvg({
      id: block.spec.id,
      text: block.spec.text,
      x: anchor === "middle" ? block.rect.x + block.rect.width / 2 : block.rect.x,
      y: 0,
      top: block.rect.y,
      valign: block.valign,
      width: block.spec.width,
      maxHeight: block.valign === "center" ? block.rect.height : block.spec.maxHeight,
      maxFontSize: block.spec.maxFontSize,
      minFontSize: block.spec.minFontSize,
      maxLines: block.spec.maxLines,
      lineHeight: block.spec.lineHeight,
      letterSpacing: block.spec.letterSpacing,
      uppercase: block.spec.uppercase,
      anchor,
      fill: textFill(block.spec.id),
      weight,
      embolden: embolden(fit.fontSize),
    }, canvas, boxes, issues);
  };

  const headSvg = renderText(layout.head, 850, (size) => Number((size * 0.026).toFixed(2)));
  const subSvg = layout.sub ? renderText(layout.sub, 500, () => 0) : "";
  const priceSvg = layout.price ? renderText({ spec: layout.price.spec, rect: layout.price.rect, valign: layout.price.valign }, 850, (size) => Number((size * 0.024).toFixed(2))) : "";
  const ctaSvg = layout.cta
    ? `<g filter="url(#ctaShadow)"><rect x="${layout.cta.pill.x}" y="${layout.cta.pill.y}" width="${layout.cta.pill.width}" height="${layout.cta.pill.height}" rx="${layout.cta.pill.height / 2}" fill="url(#ctaFill)"/></g>
      <rect x="${layout.cta.pill.x + 1}" y="${layout.cta.pill.y + 1}" width="${layout.cta.pill.width - 2}" height="${layout.cta.pill.height - 2}" rx="${(layout.cta.pill.height - 2) / 2}" fill="none" stroke="#FFFFFF" stroke-opacity="${isDark ? 0.35 : 0.22}" stroke-width="1.5"/>
      ${renderText({ spec: layout.cta.spec, rect: { x: layout.cta.pill.x + 28, y: layout.cta.pill.y, width: layout.cta.pill.width - 56, height: layout.cta.pill.height }, anchor: "middle", valign: "center" }, 850, () => 0.4)}`
    : "";
  const hairline = layout.hairline ? `<line x1="${layout.hairline.x1}" y1="${layout.hairline.y}" x2="${layout.hairline.x2}" y2="${layout.hairline.y}" stroke="${palette.hairline}" stroke-opacity="0.7" stroke-width="2"/>` : "";
  const f = productFeather;
  const featherMask = productRect && f > 0
    ? `<filter id="featherBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${f / 2.2}"/></filter>
      <mask id="productFeather" maskUnits="userSpaceOnUse" x="${productRect.x}" y="${productRect.y}" width="${productRect.width}" height="${productRect.height}"><rect x="${productRect.x}" y="${productRect.y}" width="${productRect.width}" height="${productRect.height}" fill="black"/><rect x="${productRect.x + f}" y="${productRect.y + f}" width="${productRect.width - 2 * f}" height="${productRect.height - 2 * f}" rx="${f}" fill="white" filter="url(#featherBlur)"/></mask>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${fontFaceCss}
    <defs>
      ${featherMask}
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${isDark ? "#EBCB8B" : "#FFFFFF"}" stop-opacity="${isDark ? 0.16 : 0.7}"/>
        <stop offset="1" stop-color="${isDark ? "#EBCB8B" : "#FFFFFF"}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0E0809" stop-opacity="0"/>
        <stop offset="0.45" stop-color="#0E0809" stop-opacity="0.62"/>
        <stop offset="1" stop-color="#0E0809" stop-opacity="0.84"/>
      </linearGradient>
      <linearGradient id="copyVeil" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${palette.page}" stop-opacity="0.94"/>
        <stop offset="0.42" stop-color="${palette.page}" stop-opacity="0.82"/>
        <stop offset="0.7" stop-color="${palette.page}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${palette.page}" stop-opacity="0.18"/>
      </linearGradient>
      <linearGradient id="footVeil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.page}" stop-opacity="0.25"/>
        <stop offset="0.55" stop-color="${palette.page}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${palette.page}" stop-opacity="0.95"/>
      </linearGradient>
      <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
        <stop offset="0.6" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="${isDark ? 0.45 : 0.08}"/>
      </radialGradient>
      <linearGradient id="ctaFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette.ctaFill}"/>
        <stop offset="1" stop-color="${palette.ctaFillEnd}"/>
      </linearGradient>
      <filter id="ctaShadow" x="-20%" y="-30%" width="140%" height="190%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#2A1014" flood-opacity="${isDark ? 0.45 : 0.24}"/></filter>
      <filter id="softShadow" x="-20%" y="-30%" width="140%" height="190%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#000000" flood-opacity="0.28"/></filter>
      <filter id="contactBlur" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="${palette.page}"/>
    ${imageTag(undefined, backdrop.ambientHref, { x: 0, y: 0, width: W, height: H }, { opacity: isDark ? 0.45 : 0.85 })}
    ${backdrop.productAmbientHref ? imageTag(undefined, backdrop.productAmbientHref, { x: 0, y: 0, width: W, height: H }, { opacity: isDark ? 0.95 : 0.5 }) : ""}
    <rect width="${W}" height="${H}" fill="${palette.page}" opacity="${isDark ? 0.38 : 0.45}"/>
    ${variant === "SPLIT_EDITORIAL" ? `<rect width="${W}" height="${H}" fill="url(#copyVeil)"/>` : ""}
    ${variant === "HERO_DOMINANT" ? `<rect y="${Math.round(layout.head.rect.y - 120)}" width="${W}" height="${Math.round(H - layout.head.rect.y + 120)}" fill="url(#footVeil)"/>` : ""}
    ${glow}
    ${cutoutShadow}
    ${productTag}
    ${layout.scrimTop !== undefined ? `<rect y="${Math.round(layout.scrimTop)}" width="${W}" height="${Math.round(H - layout.scrimTop)}" fill="url(#scrim)"/>` : ""}
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    ${chip}
    ${logoTag}
    ${hairline}
    ${headSvg}
    ${subSvg}
    ${priceSvg}
    ${ctaSvg}
  </svg>`;

  const metrics = compositionMetrics(boxes, canvas, productRect);
  return {
    svg,
    zones,
    assets,
    roles,
    verify,
    composition: { variant, selectionReasons: reasons, priceTreatment, logoTreatment, pageTone: palette.tone, ...metrics },
  };
}

async function renderPremiumInstitutional(input: RenderEditorialCreativeInput, canvas: Canvas, logo: PreparedAsset | undefined, baseFallback: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<FamilyRender> {
  const photoRect = canvas.format === "9:16" ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : { x: 470, y: 96, width: 520, height: 1028 };
  const panelRect = canvas.format === "9:16" ? { x: 146, y: 1008, width: 790, height: 520 } : { x: 96, y: 126, width: 330, height: 1118 };
  const headlineRect = canvas.format === "9:16" ? { x: 196, y: 1118, width: 610, height: 210 } : { x: 112, y: 372, width: 292, height: 310 };
  const subRect = canvas.format === "9:16" ? { x: 200, y: 1372, width: 550, height: 120 } : { x: 112, y: 790, width: 292, height: 190 };
  const ctaRect = canvas.format === "9:16" ? { x: 196, y: 1600, width: 344, height: 84 } : { x: 112, y: 1110, width: 304, height: 80 };
  if (!within(headlineRect, { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height })) issues.push({ code: "COMPONENT_OVERFLOW", message: "Headline institucional saiu da coluna editorial." });
  const zones = buildTextZones(input.plan, undefined, { headline: headlineRect, subheadline: subRect, cta: ctaRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  const logoRect = canvas.format === "9:16" ? { x: 176, y: 110, width: 304, height: 68 } : { x: 112, y: 148, width: 306, height: 66 };
  if (logo) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, "final rendered logo"));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain" }));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${fontFaceCss}
    <defs>
      <clipPath id="photo"><rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="${canvas.format === "9:16" ? 0 : 46}"/></clipPath>
      <linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#261416"/><stop offset="0.58" stop-color="#783847"/><stop offset="1" stop-color="#C79270"/></linearGradient>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170809" stop-opacity="0.08"/><stop offset="1" stop-color="#170809" stop-opacity="0.76"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="28" stdDeviation="26" flood-color="#120607" flood-opacity="0.36"/></filter>
    </defs>
    <rect width="${canvas.width}" height="${canvas.height}" fill="url(#base)"/>
    ${imageTag(undefined, baseFallback, photoRect, { clipId: "photo" })}
    ${canvas.format === "9:16" ? `<rect width="${canvas.width}" height="${canvas.height}" fill="url(#shade)"/>` : `<rect x="72" y="72" width="936" height="1206" rx="58" fill="none" stroke="#F5DCC6" stroke-opacity="0.24" stroke-width="2"/>`}
    <rect x="${panelRect.x}" y="${panelRect.y}" width="${panelRect.width}" height="${panelRect.height}" rx="${canvas.format === "9:16" ? 44 : 0}" fill="${canvas.format === "9:16" ? "#6B3040" : "#5E2A36"}" opacity="${canvas.format === "9:16" ? 0.90 : 0.72}"/>
    ${logo ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: headlineRect.y + 80, width: headlineRect.width, maxHeight: headlineRect.height, maxFontSize: canvas.format === "9:16" ? 72 : 48, minFontSize: 30, maxLines: canvas.format === "9:16" ? 3 : 5, fill: "#FFFFFF", weight: 850 }, canvas, boxes, issues)}
    ${input.plan.subheadline ? textSvg({ id: "subheadline", text: input.plan.subheadline, x: subRect.x, y: subRect.y + 38, width: subRect.width, maxHeight: subRect.height, maxFontSize: canvas.format === "9:16" ? 30 : 24, minFontSize: 18, maxLines: 5, fill: "#FFEDE1", weight: 500 }, canvas, boxes, issues) : ""}
    ${input.plan.cta.trim() ? `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="#F8E6D8"/>${textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: ctaRect.y + ctaRect.height / 2 + 8, width: ctaRect.width - 30, maxHeight: ctaRect.height - 16, maxFontSize: 21, minFontSize: 15, maxLines: 1, fill: DEFAULT_BRAND.roseDark, weight: 850, anchor: "middle" }, canvas, boxes, issues)}` : ""}
  </svg>`;
  return { svg, zones, assets, roles, verify };
}

async function renderDigitalService(input: RenderEditorialCreativeInput, canvas: Canvas, price: string | undefined, logo: PreparedAsset | undefined, screenshot: PreparedAsset | undefined, baseFallback: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<FamilyRender> {
  const screen = canvas.format === "9:16" ? { x: 608, y: 344, width: 326, height: 562 } : { x: 642, y: 250, width: 296, height: 500 };
  const device = canvas.format === "9:16" ? { x: 570, y: 300, width: 406, height: 658 } : { x: 604, y: 202, width: 374, height: 604 };
  const headlineRect = canvas.format === "9:16" ? { x: 152, y: 474, width: 380, height: 260 } : { x: 150, y: 386, width: 382, height: 250 };
  const subRect = canvas.format === "9:16" ? { x: 156, y: 798, width: 354, height: 142 } : { x: 154, y: 660, width: 360, height: 142 };
  const priceRect = canvas.format === "9:16" ? { x: 152, y: 1080, width: 438, height: 82 } : { x: 150, y: 896, width: 430, height: 82 };
  const ctaRect = canvas.format === "9:16" ? { x: 152, y: 1222, width: 326, height: 80 } : { x: 150, y: 1028, width: 326, height: 80 };
  const zones = buildTextZones(input.plan, price, { headline: headlineRect, subheadline: subRect, price: priceRect, cta: ctaRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  // 9:16: logo abaixo da faixa superior da safe area vertical (UI do app no topo).
  const logoRect = canvas.format === "9:16" ? { x: 152, y: 232, width: 292, height: 56 } : { x: 150, y: 116, width: 270, height: 52 };
  if (screenshot) {
    roles.push("screenshot");
    assets.push(assetPlacement(screenshot, screen, canvas, "final rendered screenshot inside device"));
    assetBox("screenshot", screen, canvas, boxes);
    const inset = 40 / Math.min(screen.width, screen.height);
    verify.push(verifySpec("screenshot", screen, { position: "top", inset: { left: inset, right: inset, top: inset, bottom: inset }, checkFidelity: true }));
  }
  if (logo) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, "final rendered logo"));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain" }));
  }
  if (screenshot) {
    const sourceRatio = screenshot.width / screenshot.height;
    const targetRatio = screen.width / screen.height;
    if (Math.abs(sourceRatio - targetRatio) / targetRatio > 2.2) {
      issues.push({ code: "ASSET_RATIO_MISMATCH", message: "Screenshot real muito incompatível com a área do device mockup." });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${fontFaceCss}
    <defs>
      <clipPath id="screen"><rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="36"/></clipPath>
      <linearGradient id="photoShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16090A" stop-opacity="0.08"/><stop offset="1" stop-color="#16090A" stop-opacity="0.72"/></linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#000" flood-opacity="0.38"/></filter>
    </defs>
    ${imageTag(undefined, baseFallback, { x: 0, y: 0, width: canvas.width, height: canvas.height })}
    <rect width="${canvas.width}" height="${canvas.height}" fill="url(#photoShade)"/>
    <path d="${canvas.format === "9:16" ? "M0 0H572C500 282 520 574 650 830C780 1088 720 1488 518 1920H0Z" : "M0 0H594C520 194 526 386 628 558C746 754 708 1010 520 1350H0Z"}" fill="${DEFAULT_BRAND.cream}" opacity="0.97"/>
    <rect x="0" y="0" width="${canvas.format === "9:16" ? 104 : 102}" height="${canvas.height}" fill="${DEFAULT_BRAND.roseDark}"/>
    ${logo ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: headlineRect.y + 56, width: headlineRect.width, maxHeight: headlineRect.height, maxFontSize: canvas.format === "9:16" ? 58 : 54, minFontSize: 30, maxLines: 4, fill: DEFAULT_BRAND.ink, weight: 850 }, canvas, boxes, issues)}
    ${input.plan.subheadline ? textSvg({ id: "subheadline", text: input.plan.subheadline, x: subRect.x, y: subRect.y + 40, width: subRect.width, maxHeight: subRect.height, maxFontSize: 28, minFontSize: 18, maxLines: 4, fill: "#62484A", weight: 500 }, canvas, boxes, issues) : ""}
    ${price ? `<rect x="${priceRect.x}" y="${priceRect.y}" width="${priceRect.width}" height="${priceRect.height}" rx="20" fill="#F0DDC8"/>${textSvg({ id: "price", text: price, x: priceRect.x + 24, y: priceRect.y + 52, width: priceRect.width - 48, maxHeight: priceRect.height - 18, maxFontSize: 30, minFontSize: 18, maxLines: 1, fill: DEFAULT_BRAND.roseDark, weight: 850 }, canvas, boxes, issues)}` : ""}
    ${input.plan.cta.trim() ? `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="${DEFAULT_BRAND.roseDark}"/>${textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: ctaRect.y + ctaRect.height / 2 + 8, width: ctaRect.width - 34, maxHeight: ctaRect.height - 18, maxFontSize: 27, minFontSize: 16, maxLines: 1, fill: "#FFFFFF", weight: 850, anchor: "middle" }, canvas, boxes, issues)}` : ""}
    <g filter="url(#shadow)"><rect x="${device.x}" y="${device.y}" width="${device.width}" height="${device.height}" rx="64" fill="#171011"/><rect x="${device.x + 20}" y="${device.y + 20}" width="${device.width - 40}" height="${device.height - 40}" rx="48" fill="#FFFDF8"/>${imageTag(screenshot, baseFallback, screen, { clipId: "screen", preserveAspectRatio: "xMidYMin slice" })}</g>
  </svg>`;
  return { svg, zones, assets, roles, verify };
}

// =================================================================================================
// Bloco compartilhado institucional/digital (4:5): texto medido, CTA editorial, encaixe da base.
// =================================================================================================

type TextBlock = { spec: TextSpec; rect: PxRect; anchor?: "start" | "middle" | "end"; valign?: "top" | "center" };

function renderTextBlock(block: TextBlock, fill: string, weight: number, embolden: number, canvas: Canvas, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): string {
  const anchor = block.anchor ?? "start";
  return textSvg({
    id: block.spec.id,
    text: block.spec.text,
    x: anchor === "middle" ? block.rect.x + block.rect.width / 2 : anchor === "end" ? block.rect.x + block.rect.width : block.rect.x,
    y: 0,
    top: block.rect.y,
    valign: block.valign,
    width: block.spec.width,
    maxHeight: block.valign === "center" ? block.rect.height : block.spec.maxHeight,
    maxFontSize: block.spec.maxFontSize,
    minFontSize: block.spec.minFontSize,
    maxLines: block.spec.maxLines,
    lineHeight: block.spec.lineHeight,
    letterSpacing: block.spec.letterSpacing,
    uppercase: block.spec.uppercase,
    anchor,
    fill,
    weight,
    embolden,
  }, canvas, boxes, issues);
}

const EDITORIAL_CTA = { font: 20, height: 64, letterSpacing: 3, padding: 64 };

function editorialCtaWidth(cta: string, max = 460): number {
  return clamp(estimateLineWidth(cta.toUpperCase(), EDITORIAL_CTA.font, EDITORIAL_CTA.letterSpacing) + EDITORIAL_CTA.padding, 220, max);
}

function editorialCtaSpec(cta: string, pill: PxRect): TextSpec {
  return { id: "cta", text: cta, width: pill.width - 40, maxHeight: pill.height, maxFontSize: EDITORIAL_CTA.font, minFontSize: 14, maxLines: 1, letterSpacing: EDITORIAL_CTA.letterSpacing, uppercase: true };
}

/** CTA editorial: pílula fina (contorno + véu translúcido), caixa alta espaçada — sem botão pesado. */
function editorialCtaSvg(cta: string, pill: PxRect, colors: { line: string; veil: string; veilOpacity: number; text: string }, canvas: Canvas, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): string {
  const inner = { x: pill.x + 20, y: pill.y, width: pill.width - 40, height: pill.height };
  return `<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${colors.veil}" fill-opacity="${colors.veilOpacity}" stroke="${colors.line}" stroke-opacity="0.9" stroke-width="1.6"/>
      ${renderTextBlock({ spec: editorialCtaSpec(cta, pill), rect: inner, anchor: "middle", valign: "center" }, colors.text, 700, 0.35, canvas, boxes, issues)}`;
}

function ctaZoneRect(pill: PxRect): PxRect {
  return { x: pill.x + 20, y: pill.y, width: pill.width - 40, height: pill.height };
}

// ---------------------------------- Análise local da base (sem IA) -------------------------------

type BaseDetailGrid = { cols: number; rows: number; cells: Float64Array; quietThreshold: number; highThreshold: number };

const BASE_ANALYSIS_SIZE = { width: 128, height: 160 };
const BASE_CELL = 8;

/** Mapa de detalhe em grade (gradiente local) da base: densidade, espaço negativo, foco, colagem.
 * Determinístico — mesma base → mesma análise. Nunca chama IA. */
export async function analyzeEditorialBase(png: Buffer, backdrop = INSTITUTIONAL_BACKDROP): Promise<EditorialBaseAnalysis> {
  return (await analyzeBaseWithGrid(png, backdrop)).analysis;
}

/** A base é analisada como vai aparecer: achatada sobre o fundo real da peça. Achado do cenário B
 * (execution-muzqmi4q-f7qx3f): a base OpenAI veio como colagem recortada com 45% de alfa 0 — o RGB
 * escondido sob o alfa nunca é usado. */
async function analyzeBaseWithGrid(png: Buffer, backdrop = INSTITUTIONAL_BACKDROP): Promise<{ analysis: EditorialBaseAnalysis; grid: BaseDetailGrid }> {
  const { width: AW, height: AH } = BASE_ANALYSIS_SIZE;
  const rgba = await sharp(png).ensureAlpha().resize(AW, AH, { fit: "fill" }).raw().toBuffer();
  let transparent = 0;
  for (let index = 3; index < rgba.length; index += 4) if (rgba[index]! < 128) transparent += 1;
  const { data } = await sharp(png).flatten({ background: backdrop }).resize(AW, AH, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): number => data[clamp(y, 0, AH - 1) * AW + clamp(x, 0, AW - 1)]!;
  const cols = AW / BASE_CELL;
  const rows = AH / BASE_CELL;
  const cells = new Float64Array(cols * rows);
  let lumaSum = 0;
  let flatPixels = 0;
  for (let y = 0; y < AH; y += 1) {
    for (let x = 0; x < AW; x += 1) {
      const gradient = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
      if (gradient <= 1) flatPixels += 1;
      cells[Math.floor(y / BASE_CELL) * cols + Math.floor(x / BASE_CELL)] += gradient;
      lumaSum += at(x, y);
    }
  }
  for (let index = 0; index < cells.length; index += 1) cells[index] = cells[index]! / (BASE_CELL * BASE_CELL);
  const sorted = [...cells].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0) || 1;
  // Limiares absolutos (gradiente médio por pixel na escala de análise): fundo liso/desfocado < 6;
  // fotografia com textura > 14. O limiar "alto" acompanha o p70 para bases inteiras detalhadas.
  const quietThreshold = 6;
  const highThreshold = Math.max(14, sorted[Math.floor(sorted.length * 0.7)]!);
  const quiet = (value: number): boolean => value < quietThreshold;
  const high = (value: number): boolean => value >= highThreshold;
  let weightX = 0;
  let weightY = 0;
  let weight = 0;
  let minCol = cols;
  let maxCol = -1;
  let minRow = rows;
  let maxRow = -1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = cells[row * cols + col]!;
      const excess = Math.max(0, value - quietThreshold);
      weightX += (col + 0.5) * excess;
      weightY += (row + 0.5) * excess;
      weight += excess;
      if (high(value)) {
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
    }
  }
  // Agrupamentos de alto detalhe (vizinhança 4) com pelo menos 3 células.
  const seen = new Uint8Array(cells.length);
  let clusters = 0;
  const clusterSizes: number[] = [];
  const clusterBoxes: { size: number; c0: number; c1: number; r0: number; r1: number }[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (seen[index] || !high(cells[index]!)) continue;
    let size = 0;
    let bc0 = cols;
    let bc1 = -1;
    let br0 = rows;
    let br1 = -1;
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop()!;
      size += 1;
      const col = current % cols;
      const row = Math.floor(current / cols);
      bc0 = Math.min(bc0, col);
      bc1 = Math.max(bc1, col);
      br0 = Math.min(br0, row);
      br1 = Math.max(br1, row);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (!seen[next] && high(cells[next]!)) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (size >= 3) {
      clusters += 1;
      clusterSizes.push(size);
      clusterBoxes.push({ size, c0: bc0, c1: bc1, r0: br0, r1: br1 });
    }
  }
  const rowQuiet = (row: number): boolean => {
    let sum = 0;
    let peak = 0;
    for (let col = 0; col < cols; col += 1) {
      const value = cells[row * cols + col]!;
      sum += value;
      peak = Math.max(peak, value);
    }
    return sum / cols < quietThreshold && peak < quietThreshold * 2;
  };
  let quietTop = 0;
  while (quietTop < rows && rowQuiet(quietTop)) quietTop += 1;
  let quietBottom = 0;
  while (quietBottom < rows && rowQuiet(rows - 1 - quietBottom)) quietBottom += 1;
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const topSum = sorted.slice(-topCount).reduce((sum, value) => sum + value, 0);
  const hasHigh = maxCol >= 0;
  // Fundo separador: células quietas LIGADAS À BORDA (fundo liso em volta de peças) + transparência.
  const border = new Uint8Array(cells.length);
  const queue: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if ((row === 0 || col === 0 || row === rows - 1 || col === cols - 1) && quiet(cells[row * cols + col]!)) {
        border[row * cols + col] = 1;
        queue.push(row * cols + col);
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.pop()!;
    const col = current % cols;
    const row = Math.floor(current / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (!border[next] && quiet(cells[next]!)) {
        border[next] = 1;
        queue.push(next);
      }
    }
  }
  const transparentShare = transparent / (AW * AH);
  const backgroundSeparatorRatio = Math.min(1, border.reduce((sum, value) => sum + value, 0) / cells.length + transparentShare);
  // Pouca borda NÃO basta para ser fundo de colagem: bokeh, céu, parede iluminada e profundidade de
  // campo também são quietos localmente, mas mudam de cor/luz AO LONGO da região (gradiente de baixa
  // frequência). Fundo separador real é quase uniforme em toda a extensão. Mede-se a variação global
  // (p10–p90 das médias por célula) da região candidata opaca, e a variação local dentro das células.
  const rgbGrid = await sharp(png).flatten({ background: backdrop }).resize(AW, AH, { fit: "fill" }).raw().toBuffer();
  const cellStats = (index: number): { r: number; g: number; b: number; luma: number; lumaStd: number; alphaTransparent: number } => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    let r = 0;
    let g = 0;
    let b = 0;
    let lumaSum2 = 0;
    let lumaSq = 0;
    let transparentPx = 0;
    for (let y = row * BASE_CELL; y < (row + 1) * BASE_CELL; y += 1) {
      for (let x = col * BASE_CELL; x < (col + 1) * BASE_CELL; x += 1) {
        const p = (y * AW + x) * 3;
        r += rgbGrid[p]!;
        g += rgbGrid[p + 1]!;
        b += rgbGrid[p + 2]!;
        const luma = at(x, y);
        lumaSum2 += luma;
        lumaSq += luma * luma;
        if (rgba[(y * AW + x) * 4 + 3]! < 128) transparentPx += 1;
      }
    }
    const n = BASE_CELL * BASE_CELL;
    const mean = lumaSum2 / n;
    return { r: r / n, g: g / n, b: b / n, luma: mean, lumaStd: Math.sqrt(Math.max(0, lumaSq / n - mean * mean)), alphaTransparent: transparentPx / n };
  };
  const opaqueCandidates: ReturnType<typeof cellStats>[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (!border[index]) continue;
    const stats = cellStats(index);
    if (stats.alphaTransparent < 0.5) opaqueCandidates.push(stats);
  }
  const spread = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sortedValues = [...values].sort((a, b) => a - b);
    return sortedValues[Math.floor(sortedValues.length * 0.9) - (sortedValues.length >= 10 ? 0 : 0)]! - sortedValues[Math.floor(sortedValues.length * 0.1)]!;
  };
  const separatorColorVariation = Math.max(
    spread(opaqueCandidates.map((cell) => cell.luma)),
    spread(opaqueCandidates.map((cell) => cell.r)),
    spread(opaqueCandidates.map((cell) => cell.g)),
    spread(opaqueCandidates.map((cell) => cell.b)),
  );
  const separatorLocalVariation = opaqueCandidates.length > 0 ? opaqueCandidates.reduce((sum, cell) => sum + cell.lumaStd, 0) / opaqueCandidates.length : 0;
  // Confiança de fundo LISO: 1 até 8 níveis de variação global; 0 a partir de 32 (gradiente/luz
  // fotográfica clara). Transparência é separação estrutural inequívoca e não entra nesta conta.
  const separatorConfidence = opaqueCandidates.length === 0 ? 0 : clamp((32 - separatorColorVariation) / 24, 0, 1);
  const opaqueCandidateShare = opaqueCandidates.length / cells.length;
  const flatSeparatorRatio = Math.min(1, transparentShare + (separatorConfidence >= 0.6 ? opaqueCandidateShare : 0));
  // Peças de colagem são PAINÉIS: preenchem o próprio retângulo (foto, card). Objetos de uma cena
  // (flores, pessoas, móveis) têm contorno irregular e preenchem pouco o retângulo que os envolve.
  const contentPanelCount = clusterBoxes.filter((box) => {
    const width = box.c1 - box.c0 + 1;
    const height = box.r1 - box.r0 + 1;
    return width >= 2 && height >= 2 && box.size / (width * height) >= 0.6;
  }).length;
  const detailCells = clusterSizes.reduce((sum, value) => sum + value, 0);
  const largestClusterShare = detailCells > 0 ? Math.max(...clusterSizes) / detailCells : 1;
  // Divisórias retas de ponta a ponta (grade de painéis): linha/coluna interna com borda forte em
  // >= 90% da extensão. Fotografia contínua quase nunca tem isso.
  let straightDividers = 0;
  for (let y = Math.round(AH * 0.1); y < Math.round(AH * 0.9); y += 1) {
    let strong = 0;
    for (let x = 0; x < AW; x += 1) if (Math.abs(at(x, y + 1) - at(x, y - 1)) > 40) strong += 1;
    if (strong >= AW * 0.9) { straightDividers += 1; y += 3; }
  }
  for (let x = Math.round(AW * 0.1); x < Math.round(AW * 0.9); x += 1) {
    let strong = 0;
    for (let y = 0; y < AH; y += 1) if (Math.abs(at(x + 1, y) - at(x - 1, y)) > 40) strong += 1;
    if (strong >= AH * 0.9) { straightDividers += 1; x += 3; }
  }
  // Diversidade de tons: quantos tons (4 bits/canal) cobrem 90% dos pixels — arte chapada usa poucos.
  const rgb = await sharp(png).flatten({ background: backdrop }).resize(64, 80, { fit: "fill" }).raw().toBuffer();
  const bucketCounts = new Map<number, number>();
  for (let index = 0; index + 2 < rgb.length; index += 3) {
    const key = ((rgb[index]! >> 4) << 8) | ((rgb[index + 1]! >> 4) << 4) | (rgb[index + 2]! >> 4);
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }
  const sortedBuckets = [...bucketCounts.values()].sort((a, b) => b - a);
  let covered = 0;
  let colorBuckets90 = 0;
  for (const count of sortedBuckets) {
    if (covered >= (rgb.length / 3) * 0.9) break;
    covered += count;
    colorBuckets90 += 1;
  }
  const analysis: EditorialBaseAnalysis = {
    visualDensity: Number(clamp(total / cells.length / 30, 0, 1).toFixed(3)),
    negativeSpaceRatio: Number((cells.filter(quiet).length / cells.length).toFixed(3)),
    focalConcentration: Number((topSum / total).toFixed(3)),
    focalPoint: weight > 0
      ? { xPct: Number(((weightX / weight / cols) * 100).toFixed(1)), yPct: Number(((weightY / weight / rows) * 100).toFixed(1)) }
      : { xPct: 50, yPct: 50 },
    detailBox: hasHigh
      ? { xPct: Number(((minCol / cols) * 100).toFixed(1)), yPct: Number(((minRow / rows) * 100).toFixed(1)), widthPct: Number((((maxCol - minCol + 1) / cols) * 100).toFixed(1)), heightPct: Number((((maxRow - minRow + 1) / rows) * 100).toFixed(1)) }
      : { xPct: 0, yPct: 0, widthPct: 0, heightPct: 0 },
    detailClusters: clusters,
    quietTopPct: Number((quietTop / rows).toFixed(3)),
    quietBottomPct: Number((quietBottom / rows).toFixed(3)),
    meanLuma: Number((lumaSum / (AW * AH) / 255).toFixed(3)),
    transparentRatio: Number((transparent / (AW * AH)).toFixed(3)),
    backgroundSeparatorRatio: Number(backgroundSeparatorRatio.toFixed(3)),
    flatSeparatorRatio: Number(flatSeparatorRatio.toFixed(3)),
    separatorConfidence: Number(separatorConfidence.toFixed(3)),
    separatorColorVariation: Number(separatorColorVariation.toFixed(1)),
    separatorGradientScore: Number((separatorColorVariation / 255).toFixed(3)),
    separatorLocalVariation: Number(separatorLocalVariation.toFixed(2)),
    contentComponentCount: clusters,
    contentPanelCount,
    largestClusterShare: Number(largestClusterShare.toFixed(3)),
    straightDividers,
    colorBuckets90,
    flatPixelRatio: Number((flatPixels / (AW * AH)).toFixed(3)),
  };
  const explained = explainEditorialBaseClass(analysis);
  analysis.visualClass = explained.visualClass;
  analysis.classificationReasons = explained.reasons;
  return { analysis, grid: { cols, rows, cells, quietThreshold, highThreshold } };
}

/**
 * Classe visual da base. Colagem/folha de assets = peças SEPARADAS por fundo (transparente ou liso
 * ligado à borda); painéis = divisórias retas de ponta a ponta; ilustração = poucos tons chapados.
 * A contagem de focos de detalhe sozinha nunca decide: uma fotografia única rica (flores, tecido,
 * moldura) tem vários focos e continua sendo CENA ÚNICA (achado do cenário B execution-mv0m68op-4z3oek).
 */
export function classifyEditorialBase(analysis: EditorialBaseAnalysis): EditorialBaseVisualClass {
  return explainEditorialBaseClass(analysis).visualClass;
}

/** Fundo separador mínimo (fração do canvas) para falar em peças separadas por fundo. */
const SEPARATOR_MIN_RATIO = 0.2;

export function explainEditorialBaseClass(analysis: EditorialBaseAnalysis): { visualClass: EditorialBaseVisualClass; reasons: string[] } {
  const pieces = analysis.contentComponentCount ?? analysis.detailClusters;
  const panels = analysis.contentPanelCount ?? pieces;
  const transparent = analysis.transparentRatio;
  const flatSeparator = analysis.flatSeparatorRatio ?? analysis.backgroundSeparatorRatio ?? transparent;
  const confidence = analysis.separatorConfidence ?? 1;
  const variation = analysis.separatorColorVariation ?? 0;
  // Arte chapada (poucos tons cobrem 90% dos pixels) vem antes: formas sobre fundo liso não são colagem de fotos.
  // Transparência separa peças sem ambiguidade (recortes, stickers, colagem sobre alfa).
  if (transparent >= SEPARATOR_MIN_RATIO && pieces >= 3) {
    if (pieces >= 8 && (analysis.largestClusterShare ?? 1) < 0.25) {
      return { visualClass: "ASSET_SHEET", reasons: [`${Math.round(transparent * 100)}% transparente separando ${pieces} peças pequenas soltas`] };
    }
    return { visualClass: "COLLAGE", reasons: [`${Math.round(transparent * 100)}% transparente separando ${pieces} peças`] };
  }
  // Poucos tons sozinhos não bastam (parede/céu em gradiente também têm poucos): arte chapada tem
  // áreas EXATAMENTE planas; fotografia tem transição contínua e grão.
  if ((analysis.colorBuckets90 ?? 999) <= 24 && (analysis.flatPixelRatio ?? 1) >= 0.5) {
    return { visualClass: "ILLUSTRATION", reasons: [`poucos tons cobrem 90% da imagem (${analysis.colorBuckets90}) e ${Math.round((analysis.flatPixelRatio ?? 1) * 100)}% dos pixels são planos: arte chapada`] };
  }
  if ((analysis.straightDividers ?? 0) >= 1 && pieces >= 2) {
    return { visualClass: "MULTI_PANEL", reasons: [`${analysis.straightDividers} divisória(s) reta(s) de ponta a ponta entre ${pieces} regiões de conteúdo`] };
  }
  // Fundo opaco só separa peças quando é LISO em toda a extensão (cor/luz quase constante) e as
  // peças são painéis (preenchem o próprio retângulo) — não objetos soltos de uma mesma cena.
  if (flatSeparator >= SEPARATOR_MIN_RATIO && panels >= 2) {
    const reasons = [`fundo liso (variação global ${variation} níveis, confiança ${confidence}) cobre ${Math.round(flatSeparator * 100)}% e separa ${panels} painéis`];
    if (panels >= 6 && (analysis.largestClusterShare ?? 1) < 0.25) return { visualClass: "ASSET_SHEET", reasons };
    return { visualClass: "COLLAGE", reasons };
  }
  if (transparent >= SEPARATOR_MIN_RATIO) return { visualClass: "OTHER", reasons: [`${Math.round(transparent * 100)}% transparente sem peças separadas`] };
  const reasons: string[] = ["cena espacialmente contínua"];
  if ((analysis.backgroundSeparatorRatio ?? 0) >= SEPARATOR_MIN_RATIO && confidence < 0.6) {
    reasons.push(`região de pouca borda (${Math.round((analysis.backgroundSeparatorRatio ?? 0) * 100)}%) tem gradiente fotográfico de cor/luz (variação global ${variation} níveis) — não é fundo separador`);
  }
  if (pieces >= 3 && panels < 2) reasons.push(`${pieces} focos de detalhe são objetos da cena (contorno irregular), não painéis (${panels})`);
  if ((analysis.straightDividers ?? 0) === 0) reasons.push("sem divisórias retas");
  return { visualClass: "SINGLE_SCENE_PHOTO", reasons };
}

/** Fração do detalhe da base (acima do limiar quieto) dentro de uma janela (frações 0..1). */
function detailRetained(grid: BaseDetailGrid, window: { x: number; y: number; width: number; height: number }): number {
  let inside = 0;
  let total = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const excess = Math.max(0, grid.cells[row * grid.cols + col]! - grid.quietThreshold);
      total += excess;
      const cx = (col + 0.5) / grid.cols;
      const cy = (row + 0.5) / grid.rows;
      if (cx >= window.x && cx <= window.x + window.width && cy >= window.y && cy <= window.y + window.height) inside += excess;
    }
  }
  return total > 0 ? inside / total : 1;
}

/** Recorte mínimo aceito para "cover": a janela precisa manter quase todo o detalhe da base. */
export const BASE_COVER_MIN_DETAIL_RETAINED = 0.92;
const BASE_FULL_BLEED_ASPECT_TOLERANCE = 0.03;

type BaseFitPlan = EditorialBaseFit & {
  /** Janela da base (frações) desenhada na área; ausente = base inteira. */
  window?: { x: number; y: number; width: number; height: number };
  /** Retângulo onde a base (ou a janela) é desenhada dentro da área-alvo. */
  drawRect: PxRect;
};

/** Encaixe consciente da base numa área: full-bleed quando a proporção já bate, cover com recorte
 * centrado no foco SÓ se quase todo o detalhe sobrevive, senão contain com fundo da própria base.
 * Nunca crop central cego, nunca nova chamada de IA. */
function planBaseFit(analysis: EditorialBaseAnalysis, grid: BaseDetailGrid | undefined, base: { width: number; height: number }, target: PxRect): BaseFitPlan {
  const baseAspect = base.width / base.height;
  const targetAspect = target.width / target.height;
  const windowFor = (): { x: number; y: number; width: number; height: number } => {
    const width = baseAspect > targetAspect ? targetAspect / baseAspect : 1;
    const height = baseAspect > targetAspect ? 1 : baseAspect / targetAspect;
    const x = clamp(analysis.focalPoint.xPct / 100 - width / 2, 0, 1 - width);
    const y = clamp(analysis.focalPoint.yPct / 100 - height / 2, 0, 1 - height);
    return { x, y, width, height };
  };
  if (Math.abs(baseAspect - targetAspect) / targetAspect <= BASE_FULL_BLEED_ASPECT_TOLERANCE) {
    const window = windowFor();
    const retained = grid ? detailRetained(grid, window) : 1;
    return { strategy: "FULL_BLEED", cropLossPct: Number((1 - window.width * window.height).toFixed(3)), detailRetainedPct: Number(retained.toFixed(3)), reasons: [`proporção da base (${baseAspect.toFixed(3)}) já bate com a área (${targetAspect.toFixed(3)}): base inteira, sem recorte relevante`], window, drawRect: target };
  }
  const window = windowFor();
  const retained = grid ? detailRetained(grid, window) : 0;
  if (retained >= BASE_COVER_MIN_DETAIL_RETAINED) {
    return { strategy: "COVER_FOCAL_SAFE_CROP", cropLossPct: Number((1 - window.width * window.height).toFixed(3)), detailRetainedPct: Number(retained.toFixed(3)), reasons: [`recorte centrado no foco (${analysis.focalPoint.xPct}%, ${analysis.focalPoint.yPct}%) preserva ${(retained * 100).toFixed(0)}% do detalhe (>= ${BASE_COVER_MIN_DETAIL_RETAINED * 100}%)`], window, drawRect: target };
  }
  return {
    strategy: "CONTAIN_WITH_BACKGROUND",
    cropLossPct: 0,
    detailRetainedPct: 1,
    reasons: [`recorte para a área perderia detalhe (${(retained * 100).toFixed(0)}% < ${BASE_COVER_MIN_DETAIL_RETAINED * 100}%): base inteira + extensão desfocada dela mesma`],
    drawRect: fitAspectInto(target, baseAspect),
  };
}

async function baseWindowHref(png: Buffer, base: { width: number; height: number }, window: { x: number; y: number; width: number; height: number } | undefined): Promise<string> {
  if (!window || (window.width >= 0.999 && window.height >= 0.999)) return pngDataUri(png);
  const left = Math.round(window.x * base.width);
  const top = Math.round(window.y * base.height);
  const width = Math.min(base.width - left, Math.round(window.width * base.width));
  const height = Math.min(base.height - top, Math.round(window.height * base.height));
  return pngDataUri(await sharp(png).extract({ left, top, width, height }).png().toBuffer());
}

// ---------------------------------- premium_institutional 4:5 -----------------------------------

export type InstitutionalSelectionSignals = {
  base: EditorialBaseAnalysis;
  headlineChars: number;
  subheadlineChars: number;
  hasCta: boolean;
  visualDensity?: string;
  primaryMassPct?: number;
};

/** Mesmo input → mesma variante. Ordem das regras = prioridade. */
export function selectInstitutionalVariant(signals: InstitutionalSelectionSignals): { variant: InstitutionalVariant; reasons: string[] } {
  const { base } = signals;
  const quietBand = Math.max(base.quietTopPct, base.quietBottomPct);
  if (base.detailClusters >= 3 && base.negativeSpaceRatio < 0.5) {
    return { variant: "COLLAGE_EDITORIAL", reasons: [`base com ${base.detailClusters} focos de detalhe separados e pouco espaço negativo (${(base.negativeSpaceRatio * 100).toFixed(0)}%): texto por cima cobriria fotos e recorte perderia peças — base inteira como colagem, texto em faixa própria`] };
  }
  if (quietBand >= 0.24 && signals.headlineChars <= 52) {
    return { variant: "FULL_BLEED_EDITORIAL", reasons: [`base tem faixa de espaço negativo real de ${(quietBand * 100).toFixed(0)}% (${base.quietBottomPct >= base.quietTopPct ? "embaixo" : "em cima"}): texto entra nela com véu, base em tela cheia`] };
  }
  if (signals.headlineChars > 52 || signals.subheadlineChars > 110) {
    return { variant: "SPLIT_STORY", reasons: [`copy longa (headline ${signals.headlineChars}, sub ${signals.subheadlineChars}) precisa de faixa de leitura própria`] };
  }
  if (base.focalConcentration >= 0.5 && (signals.primaryMassPct ?? 0) >= 55) {
    return { variant: "FULL_BLEED_EDITORIAL", reasons: [`foco concentrado (${(base.focalConcentration * 100).toFixed(0)}% do detalhe em 20% da base) e diretor pediu massa ${signals.primaryMassPct}%: base em tela cheia, véu no lado oposto ao foco`] };
  }
  return { variant: "SPLIT_STORY", reasons: ["base sem faixa quieta suficiente para texto por cima: base em painel próprio e copy na extensão desfocada dela"] };
}

type InstitutionalPalette = { ink: string; muted: string; line: string; veil: string; scrim: string };
const INSTITUTIONAL_BACKDROP = "#1A0D10";
const INSTITUTIONAL_DARK: InstitutionalPalette = { ink: "#FFF6EC", muted: "#F3E4D8", line: "#F3DDB8", veil: "#1A0D10", scrim: "#140A0C" };

async function renderInstitutionalAdaptive(
  input: RenderEditorialCreativeInput,
  canvas: Canvas,
  logo: PreparedAsset | undefined,
  base: { png: Buffer; width: number; height: number },
  fontFaceCss: string,
  boxes: EditorialGeometryBox[],
  issues: EditorialGeometryIssue[],
): Promise<FamilyRender> {
  const W = canvas.width;
  const H = canvas.height;
  const M = 64;
  // 9:16: a pilha de texto/logo fica dentro da safe area vertical; no 4:5 os mesmos valores de sempre.
  const legacySafe = storySafeInsets(canvas);
  const textBottom = isVerticalCanvas(canvas) ? H - legacySafe.bottom : H - M - 8;
  const textTop = isVerticalCanvas(canvas) ? Math.max(M + 8, legacySafe.top) : M + 8;
  const plan = input.plan;
  const headline = plan.headline;
  const subheadline = plan.subheadline?.trim() ? plan.subheadline : undefined;
  const cta = plan.cta.trim() ? plan.cta : undefined;
  const { analysis, grid } = await analyzeBaseWithGrid(base.png);
  const selected = selectInstitutionalVariant({
    base: analysis,
    headlineChars: headline.length,
    subheadlineChars: subheadline?.length ?? 0,
    hasCta: Boolean(cta),
    visualDensity: plan.visualDensity,
    primaryMassPct: plan.artDirection?.primaryMassPct,
  });
  const override = input.qaVariantOverride && (INSTITUTIONAL_VARIANTS as readonly string[]).includes(input.qaVariantOverride) ? (input.qaVariantOverride as InstitutionalVariant) : undefined;
  const variant = override ?? selected.variant;
  const reasons = override ? [`QA_VARIANT_OVERRIDE=${override} (fixture local; regra escolheria ${selected.variant})`, ...selected.reasons] : selected.reasons;
  const palette = INSTITUTIONAL_DARK;
  const logoTreatment = logo ? resolveLogoTreatment(logo, "dark") : undefined;
  const ctaW = cta ? editorialCtaWidth(cta) : 0;
  const ambientHref = await buildSoftAmbient(base.png, canvas);

  // Pilha de texto medida (ritmo vertical fixo: nenhum vão maior que o previsto).
  const GAP = { logoToHead: 34, headToSub: 22, subToCta: 34 };
  const stack = (x: number, width: number, anchor: "start" | "middle", headMax: number, headLines: number) => {
    const headSpec: TextSpec = { id: "headline", text: headline, width, maxHeight: headMax * 1.04 * headLines, maxFontSize: headMax, minFontSize: 36, maxLines: headLines, lineHeight: 1.04, letterSpacing: -0.4 };
    const headFit = measureSpec(headSpec);
    const subSpec: TextSpec | undefined = subheadline ? { id: "subheadline", text: subheadline, width: Math.min(width, 820), maxHeight: 132, maxFontSize: 27, minFontSize: 19, maxLines: 3, lineHeight: 1.38, letterSpacing: 0.2 } : undefined;
    const subFit = subSpec ? measureSpec(subSpec) : undefined;
    const logoBox = logo ? logoSize(logo, 280, 46) : undefined;
    const height = (logoBox ? logoBox.height + GAP.logoToHead : 0) + headFit.height + (subFit ? GAP.headToSub + subFit.height : 0) + (cta ? GAP.subToCta + EDITORIAL_CTA.height : 0);
    const place = (top: number) => {
      let cursor = top;
      const centreX = x + width / 2;
      const logoRect = logoBox ? { x: Math.round(anchor === "middle" ? centreX - logoBox.width / 2 : x), y: Math.round(cursor), ...logoBox } : undefined;
      if (logoRect) cursor += logoRect.height + GAP.logoToHead;
      const headRect = { x, y: Math.round(cursor), width, height: headFit.height };
      cursor += headFit.height;
      let subRect: PxRect | undefined;
      if (subSpec && subFit) {
        cursor += GAP.headToSub;
        subRect = { x: anchor === "middle" ? Math.round(centreX - subSpec.width / 2) : x, y: Math.round(cursor), width: subSpec.width, height: subFit.height };
        cursor += subFit.height;
      }
      let pill: PxRect | undefined;
      if (cta) {
        cursor += GAP.subToCta;
        pill = { x: Math.round(anchor === "middle" ? centreX - ctaW / 2 : x), y: Math.round(cursor), width: ctaW, height: EDITORIAL_CTA.height };
      }
      return { logoRect, head: { spec: headSpec, rect: headRect, anchor } as TextBlock, sub: subSpec && subRect ? ({ spec: subSpec, rect: subRect, anchor } as TextBlock) : undefined, pill };
    };
    return { height, place };
  };

  let baseLayer = "";
  let defsExtra = "";
  let baseRect: PxRect;
  let fit: BaseFitPlan;
  let placed: ReturnType<ReturnType<typeof stack>["place"]>;
  let veil = "";

  if (variant === "FULL_BLEED_EDITORIAL") {
    const area = { x: 0, y: 0, width: W, height: H };
    fit = planBaseFit(analysis, grid, base, area);
    baseRect = fit.drawRect;
    const href = await baseWindowHref(base.png, base, fit.window);
    baseLayer = fit.strategy === "CONTAIN_WITH_BACKGROUND"
      ? `${imageTag(undefined, ambientHref, area, {})}<rect width="${W}" height="${H}" fill="${palette.scrim}" opacity="0.25"/>${imageTag(undefined, href, baseRect, { preserveAspectRatio: "xMidYMid meet" })}`
      : imageTag(undefined, href, area, { preserveAspectRatio: "xMidYMid slice" });
    const textAtTop = analysis.quietTopPct > analysis.quietBottomPct || (analysis.quietTopPct === analysis.quietBottomPct && analysis.focalPoint.yPct > 58);
    const column = stack(M + 8, W - 2 * M - 16, "start", 84, 3);
    const top = textAtTop ? textTop : textBottom - column.height;
    placed = column.place(top);
    const veilHeight = Math.round(column.height + 260);
    defsExtra += `<linearGradient id="instVeil" x1="0" y1="${textAtTop ? 1 : 0}" x2="0" y2="${textAtTop ? 0 : 1}"><stop offset="0" stop-color="${palette.scrim}" stop-opacity="0"/><stop offset="0.38" stop-color="${palette.scrim}" stop-opacity="0.58"/><stop offset="1" stop-color="${palette.scrim}" stop-opacity="0.86"/></linearGradient>`;
    veil = `<rect x="0" y="${textAtTop ? 0 : H - veilHeight}" width="${W}" height="${veilHeight}" fill="url(#instVeil)"/>`;
    reasons.push(`texto ${textAtTop ? "no topo" : "embaixo"} (faixa quieta topo ${(analysis.quietTopPct * 100).toFixed(0)}% / base ${(analysis.quietBottomPct * 100).toFixed(0)}%, foco y=${analysis.focalPoint.yPct}%)`);
  } else if (variant === "SPLIT_STORY") {
    const column = stack(M + 8, W - 2 * M - 16, "start", 70, 3);
    const panelBottom = textBottom - column.height - 44;
    const area = { x: M, y: M, width: W - 2 * M, height: panelBottom - M };
    fit = planBaseFit(analysis, grid, base, area);
    baseRect = fit.strategy === "CONTAIN_WITH_BACKGROUND" ? fit.drawRect : area;
    const href = await baseWindowHref(base.png, base, fit.window);
    defsExtra += `<clipPath id="storyPanel"><rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="28"/></clipPath>
      <filter id="panelShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000000" flood-opacity="0.35"/></filter>`;
    baseLayer = `<g filter="url(#panelShadow)"><rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="28" fill="${palette.scrim}"/></g>
      <g clip-path="url(#storyPanel)">
        ${fit.strategy === "CONTAIN_WITH_BACKGROUND" ? `${imageTag(undefined, ambientHref, area, {})}<rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" fill="${palette.scrim}" opacity="0.18"/>${imageTag(undefined, href, baseRect, { preserveAspectRatio: "xMidYMid meet" })}` : imageTag(undefined, href, area, { preserveAspectRatio: "xMidYMid slice" })}
      </g>`;
    placed = column.place(panelBottom + 44);
    veil = `<line x1="${M + 8}" y1="${panelBottom + 22}" x2="${M + 128}" y2="${panelBottom + 22}" stroke="${palette.line}" stroke-opacity="0.8" stroke-width="2"/>`;
  } else {
    // COLLAGE_EDITORIAL: a base inteira vira a colagem (nenhum recorte), sobre a extensão desfocada
    // dela mesma; texto em faixa própria abaixo.
    const column = stack(M + 8, W - 2 * M - 16, "middle", 66, 2);
    const printBottom = textBottom - column.height - 46;
    const area = { x: M + 24, y: M + 8, width: W - 2 * M - 48, height: printBottom - (M + 8) };
    fit = { ...planBaseFit(analysis, grid, base, area), strategy: "CONTAIN_WITH_BACKGROUND", cropLossPct: 0, detailRetainedPct: 1 };
    fit.reasons = ["colagem: base inteira preservada (contain), sem recorte — cada foto da base continua visível"];
    baseRect = fitAspectInto(area, base.width / base.height);
    fit.drawRect = baseRect;
    const border = 10;
    defsExtra += `<linearGradient id="printPaper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8EDE1"/><stop offset="1" stop-color="#E9D6C2"/></linearGradient><filter id="printShadow" x="-15%" y="-10%" width="130%" height="130%"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000000" flood-opacity="0.42"/></filter>`;
    baseLayer = `<g transform="rotate(-2.2 ${baseRect.x + baseRect.width / 2} ${baseRect.y + baseRect.height / 2})"><rect x="${baseRect.x - border - 14}" y="${baseRect.y - border + 10}" width="${baseRect.width + 2 * border}" height="${baseRect.height + 2 * border}" fill="#F7EBDD" opacity="0.55"/></g>
      <g filter="url(#printShadow)"><rect x="${baseRect.x - border}" y="${baseRect.y - border}" width="${baseRect.width + 2 * border}" height="${baseRect.height + 2 * border}" fill="url(#printPaper)"/></g>
      ${imageTag(undefined, pngDataUri(base.png), baseRect, { preserveAspectRatio: "xMidYMid meet" })}`;
    placed = column.place(printBottom + 46);
  }

  const zones = buildTextZones(plan, undefined, { headline: placed.head.rect, subheadline: placed.sub?.rect, cta: placed.pill ? ctaZoneRect(placed.pill) : undefined }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  const logoRect = placed.logoRect;
  if (logo && logoRect) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, `final rendered logo (${logoTreatment})`));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { blend: "multiply" as const } : {}) }));
  }
  const chip = logo && logoRect && logoTreatment === "CHIP"
    ? `<rect x="${logoRect.x - 12}" y="${logoRect.y - 8}" width="${logoRect.width + 24}" height="${logoRect.height + 16}" rx="${Math.min(14, (logoRect.height + 16) / 2)}" fill="#FFF8F1" opacity="0.94"/>`
    : "";
  const logoTag = logo && logoRect ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { style: "mix-blend-mode:multiply" } : {}) }) : "";
  const headSvg = renderTextBlock(placed.head, palette.ink, 850, Number((measureSpec(placed.head.spec).fontSize * 0.022).toFixed(2)), canvas, boxes, issues);
  const subSvg = placed.sub ? renderTextBlock(placed.sub, palette.muted, 500, 0, canvas, boxes, issues) : "";
  const ctaSvg = cta && placed.pill ? editorialCtaSvg(cta, placed.pill, { line: palette.line, veil: palette.veil, veilOpacity: 0.35, text: palette.ink }, canvas, boxes, issues) : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${fontFaceCss}
    <defs>
      ${defsExtra}
      <radialGradient id="instBackdrop" cx="0.3" cy="0.2" r="1.1"><stop offset="0" stop-color="#4A242B"/><stop offset="0.55" stop-color="#26131A"/><stop offset="1" stop-color="${INSTITUTIONAL_BACKDROP}"/></radialGradient>
      <radialGradient id="instVignette" cx="0.5" cy="0.45" r="0.78"><stop offset="0.62" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.38"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#instBackdrop)"/>
    ${analysis.transparentRatio > 0.02 ? imageTag(undefined, ambientHref, { x: 0, y: 0, width: W, height: H }, { opacity: 0.55 }) : ""}
    ${variant === "FULL_BLEED_EDITORIAL" ? "" : `${imageTag(undefined, ambientHref, { x: 0, y: 0, width: W, height: H }, { opacity: 0.7 })}<rect width="${W}" height="${H}" fill="${palette.scrim}" opacity="0.5"/>`}
    ${baseLayer}
    ${veil}
    <rect width="${W}" height="${H}" fill="url(#instVignette)"/>
    ${chip}
    ${logoTag}
    ${headSvg}
    ${subSvg}
    ${ctaSvg}
  </svg>`;

  const { window: _window, drawRect: _drawRect, ...baseFit } = fit;
  const metrics = compositionMetrics(boxes, canvas, baseRect, [baseRect]);
  return { svg, zones, assets, roles, verify, composition: { variant, selectionReasons: reasons, logoTreatment, pageTone: "dark", ...metrics, baseAnalysis: analysis, baseFit } };
}

// ---------------------------------- premium_institutional 4:5 (editorial v2) -------------------

export type InstitutionalEditorialSignals = {
  base: EditorialBaseAnalysis;
  visualClass: EditorialBaseVisualClass;
  headlineChars: number;
  subheadlineChars: number;
  hasSubheadline: boolean;
  visualDensity?: string;
};

/** Mesmo input → mesma variante. Primeiro a CLASSE da base (peças separadas → colagem); para cena
 * única, a forma da cena (faixa calma, foco deslocado) e a densidade pedida pelo plano decidem. */
export function selectInstitutionalEditorialVariant(signals: InstitutionalEditorialSignals): { variant: InstitutionalVariant; reasons: string[] } {
  const { base } = signals;
  if (signals.visualClass === "COLLAGE" || signals.visualClass === "ASSET_SHEET" || signals.visualClass === "MULTI_PANEL") {
    return { variant: "COLLAGE_EDITORIAL", reasons: [`base ${signals.visualClass}: peças separadas por fundo (${Math.round((base.backgroundSeparatorRatio ?? 0) * 100)}% separador) — base inteira, sem recorte, texto em faixa própria`] };
  }
  const quietBand = Math.max(base.quietTopPct, base.quietBottomPct);
  if (quietBand >= 0.24 && signals.headlineChars <= 52) {
    return { variant: "FULL_BLEED_STORY", reasons: [`${signals.visualClass}: faixa calma real de ${Math.round(quietBand * 100)}% ${base.quietBottomPct >= base.quietTopPct ? "embaixo" : "em cima"} — imagem em tela cheia, texto sobre a área calma`] };
  }
  if (signals.visualDensity === "clean" || (!signals.hasSubheadline && signals.headlineChars <= 32)) {
    return { variant: "MINIMAL_PREMIUM", reasons: [`${signals.visualClass}: plano pede composição limpa (densidade ${signals.visualDensity ?? "n/d"}) — menos elementos, tipografia contida`] };
  }
  const offset = base.focalPoint.xPct - 50;
  if (Math.abs(offset) >= 6) {
    return { variant: "ASYMMETRIC_LUXURY", reasons: [`${signals.visualClass}: foco deslocado ${offset > 0 ? "à direita" : "à esquerda"} (${base.focalPoint.xPct}%) — foto deslocada para o lado do foco, copy no eixo oposto`] };
  }
  return { variant: "PHOTO_DOMINANT_EDITORIAL", reasons: [`${signals.visualClass}: cena única sem faixa calma (topo ${Math.round(base.quietTopPct * 100)}%, base ${Math.round(base.quietBottomPct * 100)}%) e foco central (${base.focalPoint.xPct}%) — foto protagonista grande, copy em faixa editorial assimétrica`] };
}

/** Núcleo da cena: região contígua mais rica em volta do foco que soma 35% do detalhe — o recorte
 * editorial precisa contê-la inteira. Cresce um lado por vez, sempre na direção mais rica. */
const CROP_CORE_DETAIL_SHARE = 0.35;
/** Perda máxima de área num recorte editorial de cena única (o núcleo sempre preservado). */
const EDITORIAL_CROP_MAX_LOSS = 0.32;

function sceneCoreBox(analysis: EditorialBaseAnalysis, grid: BaseDetailGrid): { x: number; y: number; width: number; height: number } {
  const excess = (col: number, row: number): number => Math.max(0, grid.cells[row * grid.cols + col]! - grid.quietThreshold);
  let total = 0;
  for (let row = 0; row < grid.rows; row += 1) for (let col = 0; col < grid.cols; col += 1) total += excess(col, row);
  const fc = clamp(Math.floor((analysis.focalPoint.xPct / 100) * grid.cols), 0, grid.cols - 1);
  const fr = clamp(Math.floor((analysis.focalPoint.yPct / 100) * grid.rows), 0, grid.rows - 1);
  let c0 = fc;
  let c1 = fc;
  let r0 = fr;
  let r1 = fr;
  const sum = (): number => {
    let value = 0;
    for (let row = r0; row <= r1; row += 1) for (let col = c0; col <= c1; col += 1) value += excess(col, row);
    return value;
  };
  const strip = (side: "left" | "right" | "top" | "bottom"): number => {
    let value = 0;
    if (side === "left" && c0 > 0) for (let row = r0; row <= r1; row += 1) value += excess(c0 - 1, row);
    if (side === "right" && c1 < grid.cols - 1) for (let row = r0; row <= r1; row += 1) value += excess(c1 + 1, row);
    if (side === "top" && r0 > 0) for (let col = c0; col <= c1; col += 1) value += excess(col, r0 - 1);
    if (side === "bottom" && r1 < grid.rows - 1) for (let col = c0; col <= c1; col += 1) value += excess(col, r1 + 1);
    return value;
  };
  let current = sum();
  while (total > 0 && current < total * CROP_CORE_DETAIL_SHARE && (c0 > 0 || r0 > 0 || c1 < grid.cols - 1 || r1 < grid.rows - 1)) {
    const sides = (["left", "right", "top", "bottom"] as const).filter((side) => (side === "left" ? c0 > 0 : side === "right" ? c1 < grid.cols - 1 : side === "top" ? r0 > 0 : r1 < grid.rows - 1));
    // Por área: compara o ganho por célula (faixas verticais e horizontais têm tamanhos diferentes).
    const best = sides.map((side) => ({ side, gain: strip(side) / (side === "left" || side === "right" ? r1 - r0 + 1 : c1 - c0 + 1) })).sort((a, b) => b.gain - a.gain)[0]!;
    current += strip(best.side);
    if (best.side === "left") c0 -= 1;
    else if (best.side === "right") c1 += 1;
    else if (best.side === "top") r0 -= 1;
    else r1 += 1;
  }
  return { x: c0 / grid.cols, y: r0 / grid.rows, width: (c1 - c0 + 1) / grid.cols, height: (r1 - r0 + 1) / grid.rows };
}

/** Recorte editorial seguro para cena única: janela da proporção da área, centrada no foco, que
 * contém o núcleo inteiro e perde no máximo 32% da área; senão a base entra inteira (contain) sobre a
 * extensão desfocada dela mesma. Nunca deforma. */
function planEditorialCrop(analysis: EditorialBaseAnalysis, grid: BaseDetailGrid, base: { width: number; height: number }, target: PxRect): BaseFitPlan {
  const baseAspect = base.width / base.height;
  const targetAspect = target.width / target.height;
  const width = baseAspect > targetAspect ? targetAspect / baseAspect : 1;
  const height = baseAspect > targetAspect ? 1 : baseAspect / targetAspect;
  const core = sceneCoreBox(analysis, grid);
  const centreX = clamp(analysis.focalPoint.xPct / 100, core.x + core.width / 2 - 0.5 + width / 2, core.x + core.width / 2 + 0.5 - width / 2);
  const window = {
    x: clamp(centreX - width / 2, Math.max(0, core.x + core.width - width), Math.min(1 - width, core.x)),
    y: clamp(analysis.focalPoint.yPct / 100 - height / 2, Math.max(0, core.y + core.height - height), Math.min(1 - height, core.y)),
    width,
    height,
  };
  window.x = clamp(window.x, 0, 1 - width);
  window.y = clamp(window.y, 0, 1 - height);
  const loss = 1 - width * height;
  const coreInside = core.x >= window.x - 1e-6 && core.y >= window.y - 1e-6 && core.x + core.width <= window.x + window.width + 1e-6 && core.y + core.height <= window.y + window.height + 1e-6;
  if (loss <= 0.005) {
    return { strategy: "FULL_BLEED", cropLossPct: 0, detailRetainedPct: 1, reasons: ["proporção da base já é a da área: imagem inteira"], window, drawRect: target };
  }
  if (coreInside && loss <= EDITORIAL_CROP_MAX_LOSS) {
    return { strategy: "COVER_FOCAL_SAFE_CROP", cropLossPct: Number(loss.toFixed(3)), detailRetainedPct: Number(detailRetained(grid, window).toFixed(3)), reasons: [`recorte editorial centrado no foco preserva o núcleo da cena (${Math.round(core.width * 100)}%×${Math.round(core.height * 100)}% da base); perda de área ${Math.round(loss * 100)}% (máx. ${EDITORIAL_CROP_MAX_LOSS * 100}%)`], window, drawRect: target };
  }
  return { strategy: "CONTAIN_WITH_BACKGROUND", cropLossPct: 0, detailRetainedPct: 1, reasons: [`recorte cortaria o núcleo da cena ou perderia ${Math.round(loss * 100)}% da área: base inteira sobre a extensão dela mesma`], drawRect: fitAspectInto(target, baseAspect) };
}

/** Logo: direto quando o contraste/fidelidade permitem; placa suave integrada; chip só como último recurso. */
function resolveInstitutionalLogoTreatment(logo: PreparedAsset, surface: "light" | "dark" | "photo"): EditorialLogoTreatment {
  const hasOpaqueLightBox = logo.stats.borderOpaqueRatio > 0.9 && logo.stats.borderLuma > 228;
  if (surface === "light") return "LOGO_DIRECT_LIGHT";
  if (surface === "dark") return hasOpaqueLightBox || logo.stats.meanLuma < 120 ? "LOGO_SOFT_PLATE" : "LOGO_DIRECT_DARK";
  return "LOGO_HAIRLINE_PLATE";
}

type InstitutionalCopyBlock = { spec: TextSpec; rect: PxRect; anchor: "start" | "end" };

async function renderInstitutionalEditorial(
  input: RenderEditorialCreativeInput,
  canvas: Canvas,
  logo: PreparedAsset | undefined,
  base: { png: Buffer; width: number; height: number },
  fontFaceCss: string,
  boxes: EditorialGeometryBox[],
  issues: EditorialGeometryIssue[],
): Promise<FamilyRender> {
  const W = canvas.width;
  const H = canvas.height;
  const M = 64;
  const plan = input.plan;
  const headline = plan.headline;
  const subheadline = plan.subheadline?.trim() ? plan.subheadline : undefined;
  const cta = plan.cta.trim() ? plan.cta : undefined;
  const { analysis, grid } = await analyzeBaseWithGrid(base.png);
  const visualClass = analysis.visualClass ?? classifyEditorialBase(analysis);
  const selected = selectInstitutionalEditorialVariant({ base: analysis, visualClass, headlineChars: headline.length, subheadlineChars: subheadline?.length ?? 0, hasSubheadline: Boolean(subheadline), visualDensity: plan.visualDensity });
  const override = input.qaVariantOverride && (INSTITUTIONAL_VARIANTS as readonly string[]).includes(input.qaVariantOverride) ? (input.qaVariantOverride as InstitutionalVariant) : undefined;
  const variant = override ?? selected.variant;
  const reasons = override ? [`QA_VARIANT_OVERRIDE=${override} (fixture local; regra escolheria ${selected.variant})`, ...selected.reasons] : [...selected.reasons];

  if (variant === "COLLAGE_EDITORIAL" || variant === "FULL_BLEED_EDITORIAL" || variant === "SPLIT_STORY") {
    const legacy = await renderInstitutionalAdaptive({ ...input, qaVariantOverride: variant }, canvas, logo, base, fontFaceCss, boxes, issues);
    return legacy.composition ? { ...legacy, composition: { ...legacy.composition, variant, selectionReasons: reasons, baseVisualClass: visualClass, baseAnalysis: analysis } } : legacy;
  }

  // Paleta derivada da própria base (nunca um marrom genérico fixo).
  const palette = await extractScreenshotPalette(base.png);
  const lightSurface = mixRgb(palette.dominant, WHITE, 0.86);
  const darkSurface = mixRgb(palette.dominant, BLACK, 0.86);
  const surfaceTone: "light" | "dark" = variant === "ASYMMETRIC_LUXURY" ? "dark" : "light";
  const surface = surfaceTone === "light" ? lightSurface : darkSurface;
  const ink = surfaceTone === "light" ? toHex(mixRgb(darkSurface, BLACK, 0.35)) : toHex(mixRgb(lightSurface, WHITE, 0.4));
  const muted = surfaceTone === "light" ? toHex(mixRgb(mixRgb(darkSurface, BLACK, 0.35), lightSurface, 0.32)) : toHex(mixRgb(lightSurface, darkSurface, 0.18));
  const hairlineColor = toHex(mixRgb(palette.accent, surfaceTone === "light" ? BLACK : WHITE, 0.25));
  const photoSurface = variant === "FULL_BLEED_STORY";
  const logoTreatment = logo ? resolveInstitutionalLogoTreatment(logo, photoSurface ? "photo" : surfaceTone) : undefined;
  const ctaTreatment: EditorialCtaTreatment = variant === "PHOTO_DOMINANT_EDITORIAL" ? "SOLID_PREMIUM" : variant === "FULL_BLEED_STORY" ? "OUTLINE_EDITORIAL" : "TEXT_HAIRLINE";
  // 9:16: mesma largura de 1080, ~570 px a mais de altura e exibição em tela cheia no telefone —
  // composição vertical própria (nunca o 4:5 esticado), texto/logo dentro da safe area vertical.
  const vertical = isVerticalCanvas(canvas);
  const safe = storySafeInsets(canvas);
  const logoBox = logo
    ? vertical
      ? logoSize(logo, variant === "MINIMAL_PREMIUM" ? 236 : 260, variant === "MINIMAL_PREMIUM" ? 40 : 44)
      : logoSize(logo, variant === "MINIMAL_PREMIUM" ? 190 : 220, variant === "MINIMAL_PREMIUM" ? 32 : 36)
    : undefined;

  const headSpec = (width: number, max: number, lines: number, anchor: "start" | "end" = "start"): TextSpec => ({ id: "headline", text: headline, width, maxHeight: max * 1.08 * lines, maxFontSize: max, minFontSize: 30, maxLines: lines, lineHeight: 1.08, letterSpacing: -0.6, ...(anchor === "end" ? {} : {}) });
  const subSpec = (width: number, max: number, lines: number): TextSpec | undefined => (subheadline ? { id: "subheadline", text: subheadline, width, maxHeight: max * 1.42 * lines, maxFontSize: max, minFontSize: 15, maxLines: lines, lineHeight: 1.42, letterSpacing: 0.15 } : undefined);
  const CTA_TRACKING = 2.6;
  const ctaFontFor = (maxWidth: number, preferred: number): number => {
    let size = preferred;
    while (cta && size > 12 && estimateLineWidth(cta.toUpperCase(), size, CTA_TRACKING) > maxWidth) size -= 1;
    return size;
  };
  let ctaFont = vertical ? (variant === "MINIMAL_PREMIUM" ? 19 : 21) : variant === "MINIMAL_PREMIUM" ? 15 : 17;
  let ctaTextWidth = cta ? estimateLineWidth(cta.toUpperCase(), ctaFont, CTA_TRACKING) : 0;

  let photo: PxRect;
  let logoRect: PxRect | undefined;
  let head: InstitutionalCopyBlock;
  let sub: InstitutionalCopyBlock | undefined;
  let ctaRect: PxRect | undefined;
  let scrim: { top: number } | undefined;
  const decorations: string[] = [];

  if (vertical && variant === "PHOTO_DOMINANT_EDITORIAL") {
    // 9:16: foto quase de borda a borda no topo; bloco editorial empilhado ancorado na safe area da
    // base — headline larga, subtítulo, e uma linha com CTA sólido (esquerda) + logo (direita).
    const textW = W - 2 * M;
    const hs = headSpec(textW, 64, 3);
    const hf = measureSpec(hs);
    const ss = subSpec(780, 24, 3);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 64;
    const rowH = Math.max(cta ? ctaH : 0, logoBox?.height ?? 0);
    const bottom = H - safe.bottom;
    const blockH = hf.height + (sf ? 24 + sf.height : 0) + (rowH > 0 ? 40 + rowH : 0);
    const blockTop = bottom - blockH;
    photo = { x: 40, y: 40, width: W - 80, height: Math.round(blockTop - 64 - 40) };
    head = { spec: hs, rect: { x: M, y: Math.round(blockTop), width: textW, height: hf.height }, anchor: "start" };
    let cursor = blockTop + hf.height;
    if (ss && sf) {
      cursor += 24;
      sub = { spec: ss, rect: { x: M, y: Math.round(cursor), width: 780, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (rowH > 0) {
      const rowTop = cursor + 40;
      if (cta) {
        ctaFont = ctaFontFor(textW - (logoBox ? logoBox.width + 48 : 0) - 64, ctaFont);
        ctaTextWidth = estimateLineWidth(cta.toUpperCase(), ctaFont, CTA_TRACKING);
        ctaRect = { x: M, y: Math.round(rowTop + (rowH - ctaH) / 2), width: Math.round(ctaTextWidth + 64), height: ctaH };
      }
      logoRect = logoBox ? { x: W - M - logoBox.width, y: Math.round(rowTop + (rowH - logoBox.height) / 2), ...logoBox } : undefined;
    }
    decorations.push(`<line x1="${M}" y1="${blockTop - 30}" x2="${M + 112}" y2="${blockTop - 30}" stroke="${hairlineColor}" stroke-width="2"/>`);
  } else if (vertical && variant === "ASYMMETRIC_LUXURY") {
    // 9:16: foto alta deslocada para o lado do foco; na faixa oposta um fio vertical (espaço negativo
    // intencional); bloco de marca + copy escuro embaixo, ancorado na safe area.
    const photoW = 860;
    const focusRight = analysis.focalPoint.xPct >= 50;
    const textW = W - 2 * M;
    const hs = headSpec(textW - 40, 56, 4);
    const hf = measureSpec(hs);
    const ss = subSpec(760, 22, 3);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 48;
    const bottom = H - safe.bottom;
    const blockH = (logoBox ? logoBox.height + 34 : 0) + hf.height + (sf ? 24 + sf.height : 0) + (cta ? 34 + ctaH : 0);
    const blockTop = bottom - blockH;
    photo = { x: focusRight ? W - 40 - photoW : 40, y: 40, width: photoW, height: Math.round(blockTop - 60 - 40) };
    let cursor = blockTop;
    logoRect = logoBox ? { x: M, y: Math.round(cursor), ...logoBox } : undefined;
    if (logoBox) cursor += logoBox.height + 34;
    head = { spec: hs, rect: { x: M, y: Math.round(cursor), width: textW - 40, height: hf.height }, anchor: "start" };
    cursor += hf.height;
    if (ss && sf) {
      cursor += 24;
      sub = { spec: ss, rect: { x: M, y: Math.round(cursor), width: 760, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (cta) {
      ctaFont = ctaFontFor(textW, ctaFont);
      ctaTextWidth = estimateLineWidth(cta.toUpperCase(), ctaFont, CTA_TRACKING);
      ctaRect = { x: M, y: Math.round(cursor + 34), width: Math.min(textW, ctaTextWidth + 4), height: ctaH };
    }
    const lineX = focusRight ? Math.round(photo.x / 2) : Math.round((photo.x + photo.width + W) / 2);
    const lineTop = safe.top;
    const lineBottom = photo.y + photo.height - 40;
    if (lineBottom - lineTop > 60) decorations.push(`<line x1="${lineX}" y1="${lineTop}" x2="${lineX}" y2="${lineBottom}" stroke="${hairlineColor}" stroke-opacity="0.7" stroke-width="1.5"/>`);
  } else if (vertical && variant === "FULL_BLEED_STORY") {
    // 9:16: imagem em tela cheia; texto sobre a faixa calma real, dentro da safe area vertical.
    photo = { x: 0, y: 0, width: W, height: H };
    const textAtTop = analysis.quietTopPct > analysis.quietBottomPct;
    const hs = headSpec(900, 70, 3);
    const hf = measureSpec(hs);
    const ss = subSpec(760, 25, 3);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 62;
    const blockH = hf.height + (sf ? 22 + sf.height : 0) + (cta ? 36 + ctaH : 0);
    const top = textAtTop ? safe.top + (logoBox ? logoBox.height + 48 : 0) : H - safe.bottom - blockH;
    head = { spec: hs, rect: { x: M, y: Math.round(top), width: 900, height: hf.height }, anchor: "start" };
    let cursor = top + hf.height;
    if (ss && sf) {
      cursor += 22;
      sub = { spec: ss, rect: { x: M, y: Math.round(cursor), width: 760, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (cta) ctaRect = { x: M, y: Math.round(cursor + 36), width: Math.round(ctaTextWidth + 64), height: ctaH };
    logoRect = logoBox ? { x: M, y: safe.top, ...logoBox } : undefined;
    scrim = { top: textAtTop ? 0 : Math.max(H * (analysis.focalPoint.yPct / 100) + 40, top - 240) };
    if (!textAtTop && scrim.top > top - 40) issues.push({ code: "MASK_VIOLATION", message: "Véu do texto alcançaria o foco da cena." });
  } else if (vertical) {
    // 9:16 MINIMAL_PREMIUM: logo no topo da safe area, foto alta com margens generosas, copy
    // empilhada embaixo (headline, subtítulo, CTA texto + fio) — tipografia contida, nada boiando.
    const colX = 96;
    const colW = W - 2 * colX;
    const hs = headSpec(colW, 56, 3);
    const hf = measureSpec(hs);
    const ss = subSpec(760, 23, 3);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 46;
    const bottom = H - safe.bottom;
    const copyH = hf.height + (sf ? 18 + sf.height : 0) + (cta ? 34 + ctaH : 0);
    const copyTop = bottom - copyH;
    logoRect = logoBox ? { x: colX, y: safe.top, ...logoBox } : undefined;
    const photoTop = logoBox ? safe.top + logoBox.height + 44 : safe.top;
    photo = { x: colX, y: Math.round(photoTop), width: colW, height: Math.round(copyTop - 56 - photoTop) };
    head = { spec: hs, rect: { x: colX, y: Math.round(copyTop), width: colW, height: hf.height }, anchor: "start" };
    let cursor = copyTop + hf.height;
    if (ss && sf) {
      cursor += 18;
      sub = { spec: ss, rect: { x: colX, y: Math.round(cursor), width: 760, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (cta) {
      ctaFont = ctaFontFor(colW, ctaFont);
      ctaTextWidth = estimateLineWidth(cta.toUpperCase(), ctaFont, CTA_TRACKING);
      ctaRect = { x: colX, y: Math.round(cursor + 34), width: Math.round(ctaTextWidth + 4), height: ctaH };
    }
  } else if (variant === "PHOTO_DOMINANT_EDITORIAL") {
    // Foto protagonista quase de borda a borda; faixa editorial assimétrica: headline à esquerda,
    // logo + subtítulo + CTA alinhados à direita.
    const hs = headSpec(560, 50, headline.length > 44 ? 3 : 2);
    const hf = measureSpec(hs);
    const rightX = W - M;
    const colW = 330;
    const ss = subSpec(colW, 18, 3);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 52;
    const rightH = (logoBox ? logoBox.height + 22 : 0) + (sf ? sf.height + 22 : 0) + (cta ? ctaH : 0);
    const bandH = Math.max(hf.height, rightH);
    const bottom = H - M - 4;
    const bandTop = bottom - bandH;
    photo = { x: 40, y: 40, width: W - 80, height: Math.round(bandTop - 52 - 40) };
    head = { spec: hs, rect: { x: M, y: Math.round(bottom - hf.height), width: 560, height: hf.height }, anchor: "start" };
    let cursor = bottom - rightH;
    logoRect = logoBox ? { x: rightX - logoBox.width, y: Math.round(cursor), ...logoBox } : undefined;
    if (logoBox) cursor += logoBox.height + 22;
    if (ss && sf) {
      sub = { spec: ss, rect: { x: rightX - colW, y: Math.round(cursor), width: colW, height: sf.height }, anchor: "end" };
      cursor += sf.height + 22;
    }
    if (cta) ctaRect = { x: rightX - (ctaTextWidth + 56), y: Math.round(cursor), width: ctaTextWidth + 56, height: ctaH };
    decorations.push(`<line x1="${M}" y1="${bandTop - 26}" x2="${M + 96}" y2="${bandTop - 26}" stroke="${hairlineColor}" stroke-width="2"/>`);
  } else if (variant === "ASYMMETRIC_LUXURY") {
    // Foto deslocada para o lado do foco, altura quase total; copy em coluna estreita no eixo oposto,
    // ancorada embaixo; fio vertical liga a marca à copy (espaço negativo intencional).
    const photoW = 720;
    const focusRight = analysis.focalPoint.xPct >= 50;
    photo = { x: focusRight ? W - 40 - photoW : 40, y: 40, width: photoW, height: H - 80 };
    const colX = focusRight ? M : photo.x + photo.width + 40;
    const colW = focusRight ? photo.x - 40 - M : W - M - colX;
    // Coluna estreita: corpo contido para nunca deixar artigo sozinho na 1ª linha.
    const hs = headSpec(colW, 36, 5);
    const hf = measureSpec(hs);
    const ss = subSpec(colW, 17, 5);
    const sf = ss ? measureSpec(ss) : undefined;
    logoRect = logoBox ? { x: colX, y: M + 6, ...logoBox } : undefined;
    const bottom = H - M - 6;
    const ctaH = 40;
    let cursor = bottom - (cta ? ctaH : 0) - (sf ? sf.height + 24 : 0) - hf.height - (cta ? 30 : 0);
    head = { spec: hs, rect: { x: colX, y: Math.round(cursor), width: colW, height: hf.height }, anchor: "start" };
    cursor += hf.height;
    if (ss && sf) {
      cursor += 24;
      sub = { spec: ss, rect: { x: colX, y: Math.round(cursor), width: colW, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (cta) {
      ctaFont = ctaFontFor(colW, ctaFont);
      ctaTextWidth = estimateLineWidth(cta.toUpperCase(), ctaFont, CTA_TRACKING);
      ctaRect = { x: colX, y: Math.round(cursor + 30), width: Math.min(colW, ctaTextWidth + 4), height: ctaH };
    }
    const lineTop = (logoRect ? logoRect.y + logoRect.height : M) + 40;
    const lineBottom = head.rect.y - 40;
    if (lineBottom - lineTop > 60) decorations.push(`<line x1="${colX + 1}" y1="${lineTop}" x2="${colX + 1}" y2="${lineBottom}" stroke="${hairlineColor}" stroke-opacity="0.7" stroke-width="1.5"/>`);
  } else if (variant === "FULL_BLEED_STORY") {
    // Imagem em tela cheia; texto sobre a faixa comprovadamente calma (ou um véu discreto que não
    // alcança o foco), alinhado à esquerda; CTA contornado.
    photo = { x: 0, y: 0, width: W, height: H };
    const textAtTop = analysis.quietTopPct > analysis.quietBottomPct;
    const hs = headSpec(700, 60, 3);
    const hf = measureSpec(hs);
    const ss = subSpec(560, 20, 2);
    const sf = ss ? measureSpec(ss) : undefined;
    const ctaH = 54;
    const blockH = hf.height + (sf ? 18 + sf.height : 0) + (cta ? 30 + ctaH : 0);
    const top = textAtTop ? M + (logoBox ? logoBox.height + 40 : 0) : H - M - blockH;
    head = { spec: hs, rect: { x: M, y: Math.round(top), width: 700, height: hf.height }, anchor: "start" };
    let cursor = top + hf.height;
    if (ss && sf) {
      cursor += 18;
      sub = { spec: ss, rect: { x: M, y: Math.round(cursor), width: 560, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    if (cta) ctaRect = { x: M, y: Math.round(cursor + 30), width: ctaTextWidth + 56, height: ctaH };
    logoRect = logoBox ? { x: textAtTop ? M : M, y: textAtTop ? M : M, ...logoBox } : undefined;
    scrim = { top: textAtTop ? 0 : Math.max(H * (analysis.focalPoint.yPct / 100) + 40, top - 200) };
    if (!textAtTop && scrim.top > top - 40) issues.push({ code: "MASK_VIOLATION", message: "Véu do texto alcançaria o foco da cena." });
  } else {
    // MINIMAL_PREMIUM: foto com margens generosas, tipografia contida, CTA só texto + fio.
    const hs = headSpec(560, 38, headline.length > 44 ? 3 : 2);
    const hf = measureSpec(hs);
    const ss = subSpec(520, 16, 2);
    const sf = ss ? measureSpec(ss) : undefined;
    const photoH = 940;
    const copyH = hf.height + (sf ? 14 + sf.height : 0);
    const top = Math.round(Math.max(64, (H - (photoH + 48 + copyH)) / 2));
    photo = { x: 100, y: top, width: W - 200, height: photoH };
    const rowTop = photo.y + photo.height + 48;
    head = { spec: hs, rect: { x: photo.x, y: Math.round(rowTop), width: 560, height: hf.height }, anchor: "start" };
    let cursor = rowTop + hf.height;
    if (ss && sf) {
      cursor += 14;
      sub = { spec: ss, rect: { x: photo.x, y: Math.round(cursor), width: 520, height: sf.height }, anchor: "start" };
      cursor += sf.height;
    }
    const right = photo.x + photo.width;
    logoRect = logoBox ? { x: right - logoBox.width, y: Math.round(rowTop), ...logoBox } : undefined;
    if (cta) ctaRect = { x: right - ctaTextWidth - 4, y: Math.round(cursor - 36), width: ctaTextWidth + 4, height: 36 };
  }

  // Encaixe da foto: recorte editorial seguro (cena única) — nunca deforma.
  const fit = planEditorialCrop(analysis, grid, base, photo);
  const href = await baseWindowHref(base.png, base, fit.window);
  const ambientHref = await buildSoftAmbient(base.png, canvas);
  const photoTag = fit.strategy === "CONTAIN_WITH_BACKGROUND"
    ? `${imageTag(undefined, ambientHref, photo, { opacity: 0.9 })}${imageTag(undefined, href, fit.drawRect, { preserveAspectRatio: "xMidYMid meet" })}`
    : imageTag(undefined, href, photo, { preserveAspectRatio: "xMidYMid slice", clipId: "photoClip" });

  const zones = buildTextZones(plan, undefined, { headline: head.rect, subheadline: sub?.rect, cta: ctaRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  const assets: CreativePlan["assetPlacements"] = [];
  const verify: AssetVerifySpec[] = [];
  if (logo && logoRect) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, `final rendered logo (${logoTreatment})`));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain", ...(logoTreatment === "LOGO_DIRECT_LIGHT" ? { blend: "multiply" as const } : {}) }));
  }
  const plate = logo && logoRect && (logoTreatment === "LOGO_SOFT_PLATE" || logoTreatment === "LOGO_HAIRLINE_PLATE")
    ? logoTreatment === "LOGO_SOFT_PLATE"
      ? `<g filter="url(#plateShadow)"><rect x="${logoRect.x - 16}" y="${logoRect.y - 11}" width="${logoRect.width + 32}" height="${logoRect.height + 22}" rx="6" fill="${toHex(lightSurface)}"/></g>`
      : `<rect x="${logoRect.x - 16}" y="${logoRect.y - 11}" width="${logoRect.width + 32}" height="${logoRect.height + 22}" rx="4" fill="#FFFFFF" fill-opacity="0.94" stroke="${toHex(darkSurface)}" stroke-opacity="0.25" stroke-width="1"/>`
    : "";
  const logoTag = logo && logoRect ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet", ...(logoTreatment === "LOGO_DIRECT_LIGHT" ? { style: "mix-blend-mode:multiply" } : {}) }) : "";

  const onPhoto = photoSurface;
  const textInk = onPhoto ? "#FFF8F0" : ink;
  const textMuted = onPhoto ? "#F2E6DA" : muted;
  const renderCopy = (block: InstitutionalCopyBlock, fill: string, weight: number, embolden: number): string =>
    renderTextBlock({ spec: block.spec, rect: block.rect, anchor: block.anchor }, fill, weight, embolden, canvas, boxes, issues);
  const headSvg = renderCopy(head, textInk, 700, Number((measureSpec(head.spec).fontSize * 0.012).toFixed(2)));
  const subSvg = sub ? renderCopy(sub, textMuted, 400, 0) : "";
  let ctaSvg = "";
  if (cta && ctaRect) {
    // fitText não conta o tracking: a largura útil desconta o espaçamento entre letras.
    const trackingAllowance = CTA_TRACKING * cta.length;
    const ctaSpec: TextSpec = { id: "cta", text: cta, width: Math.max(40, (ctaTreatment === "TEXT_HAIRLINE" ? ctaRect.width : ctaRect.width - 40) - trackingAllowance), maxHeight: ctaRect.height, maxFontSize: ctaFont, minFontSize: 11, maxLines: 1, letterSpacing: CTA_TRACKING, uppercase: true };
    if (ctaTreatment === "SOLID_PREMIUM") {
      const fill = toHex(mixRgb(darkSurface, palette.accent, 0.18));
      ctaSvg = `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="3" fill="${fill}"/>
        ${renderTextBlock({ spec: ctaSpec, rect: { x: ctaRect.x + 20, y: ctaRect.y, width: ctaRect.width - 40, height: ctaRect.height }, anchor: "middle", valign: "center" }, toHex(lightSurface), 600, 0.25, canvas, boxes, issues)}`;
    } else if (ctaTreatment === "OUTLINE_EDITORIAL") {
      ctaSvg = `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="2" fill="#000000" fill-opacity="0.12" stroke="${textInk}" stroke-opacity="0.85" stroke-width="1.4"/>
        ${renderTextBlock({ spec: ctaSpec, rect: { x: ctaRect.x + 20, y: ctaRect.y, width: ctaRect.width - 40, height: ctaRect.height }, anchor: "middle", valign: "center" }, textInk, 600, 0.25, canvas, boxes, issues)}`;
    } else {
      // Texto + fio: o CTA é tipografia editorial sublinhada, sem botão.
      const lineY = ctaRect.y + ctaRect.height - 4;
      ctaSvg = `${renderTextBlock({ spec: ctaSpec, rect: { x: ctaRect.x, y: ctaRect.y, width: ctaRect.width, height: ctaRect.height - 10 }, anchor: "start", valign: "center" }, textInk, 600, 0.25, canvas, boxes, issues)}
        <line x1="${ctaRect.x}" y1="${lineY}" x2="${ctaRect.x + ctaRect.width}" y2="${lineY}" stroke="${hairlineColor}" stroke-width="2"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${fontFaceCss}
    <defs>
      <clipPath id="photoClip"><rect x="${photo.x}" y="${photo.y}" width="${photo.width}" height="${photo.height}" rx="${photoSurface ? 0 : 3}"/></clipPath>
      <radialGradient id="instGlow" cx="0.75" cy="0.15" r="0.9"><stop offset="0" stop-color="${toHex(palette.accent)}" stop-opacity="${surfaceTone === "light" ? 0.14 : 0.22}"/><stop offset="1" stop-color="${toHex(palette.accent)}" stop-opacity="0"/></radialGradient>
      <linearGradient id="storyVeil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${toHex(darkSurface)}" stop-opacity="0"/><stop offset="0.45" stop-color="${toHex(darkSurface)}" stop-opacity="0.6"/><stop offset="1" stop-color="${toHex(darkSurface)}" stop-opacity="0.9"/></linearGradient>
      <filter id="photoShadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#000000" flood-opacity="${surfaceTone === "light" ? 0.16 : 0.4}"/></filter>
      <filter id="plateShadow" x="-20%" y="-40%" width="140%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.25"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="${toHex(surface)}"/>
    ${imageTag(undefined, ambientHref, { x: 0, y: 0, width: W, height: H }, { opacity: surfaceTone === "light" ? 0.16 : 0.22 })}
    <rect width="${W}" height="${H}" fill="url(#instGlow)"/>
    ${photoSurface ? "" : `<g filter="url(#photoShadow)"><rect x="${photo.x}" y="${photo.y}" width="${photo.width}" height="${photo.height}" rx="3" fill="${toHex(surface)}"/></g>`}
    ${photoTag}
    ${photoSurface ? "" : `<rect x="${photo.x + 0.5}" y="${photo.y + 0.5}" width="${photo.width - 1}" height="${photo.height - 1}" rx="3" fill="none" stroke="${surfaceTone === "light" ? "#000000" : "#FFFFFF"}" stroke-opacity="0.08" stroke-width="1"/>`}
    ${scrim ? `<rect x="0" y="${Math.round(scrim.top)}" width="${W}" height="${Math.round(H - scrim.top)}" fill="url(#storyVeil)"/>` : ""}
    ${decorations.join("")}
    ${plate}
    ${logoTag}
    ${headSvg}
    ${subSvg}
    ${ctaSvg}
  </svg>`;

  const { window: _window, drawRect: _drawRect, ...baseFit } = fit;
  const metrics = compositionMetrics(boxes, canvas, photo, [photo]);
  return {
    svg,
    zones,
    assets,
    roles,
    verify,
    composition: { variant, selectionReasons: reasons, logoTreatment, ctaTreatment, pageTone: photoSurface ? "dark" : surfaceTone, ...metrics, baseAnalysis: analysis, baseVisualClass: visualClass, baseFit },
  };
}

// ---------------------------------- digital_service 4:5 -----------------------------------------

/** Classe do screenshot pela proporção real (largura/altura). Nunca força mobile. */
export function classifyScreenshot(width: number, height: number): ScreenshotClass {
  const aspect = width / height;
  if (!(aspect > 0) || aspect < 0.3 || aspect > 2.6) return "OTHER";
  if (aspect <= 0.66) return "MOBILE";
  if (aspect < 0.9) return "TABLET";
  if (aspect < 1.2) return "OTHER";
  return "DESKTOP";
}

export type DigitalSelectionSignals = {
  classification: ScreenshotClass;
  headlineChars: number;
  subheadlineChars: number;
  hasPrice: boolean;
  /** Regiões reais do screenshot com borda limpa e detalhe suficiente para virar recorte. */
  detailRegions: number;
  /** Legibilidade da tela INTEIRA no tamanho em que ela aparece (`assessScreenshotLegibility`). */
  legibility?: ScreenshotLegibility;
  /** A copy cabe na faixa do FLOATING_PRODUCT sem encolher a headline além do limite. */
  floatingCopyFits?: boolean;
  visualDensity?: string;
  primaryMassPct?: number;
};

/**
 * Mesmo input → mesma variante. Pergunta principal: a tela COMPLETA já é legível e forte como hero?
 * Só quando NÃO é (informação some na redução, ou uma feature pequena concentra o conteúdo e perde
 * detalhe) os recortes ampliados entram — achar regiões recortáveis sozinho nunca decide.
 * Tela legível: FLOATING_PRODUCT quando a copy cabe na faixa dele; senão UI_HERO.
 */
export function selectDigitalServiceVariant(signals: DigitalSelectionSignals): { variant: DigitalServiceVariant; reasons: string[] } {
  if (signals.classification === "MOBILE") return { variant: "MOBILE_DEVICE", reasons: ["screenshot com proporção de celular: mockup de aparelho"] };
  if (signals.classification !== "DESKTOP") {
    return { variant: "FLOATING_PRODUCT", reasons: [`screenshot ${signals.classification} (nem celular nem desktop): superfície flutuante, inteira`] };
  }
  const legibility = signals.legibility;
  const legibilityNote = legibility ? `escala hero ${legibility.heroScale}, retenção de borda no feed ${legibility.edgeRetentionAtFeed}` : "sem medida de legibilidade";
  if (legibility && signals.detailRegions >= 1) {
    if (!legibility.fullScreenLegible) {
      return { variant: "UI_DETAIL_FOCUS", reasons: [`tela inteira não continua legível no tamanho do feed (${legibilityNote}; mínimo ${SCREENSHOT_LEGIBLE_EDGE_RETENTION}): recortes ampliados mostram o que some na redução`] };
    }
    if (legibility.smallFeatureCritical) {
      return { variant: "UI_DETAIL_FOCUS", reasons: [`feature pequena concentra ${Math.round((legibility.featureEnergyShare ?? 0) * 100)}% do conteúdo em ${Math.round((legibility.featureAreaShare ?? 0) * 100)}% da tela e perde detalhe na redução (retenção ${legibility.featureEdgeRetention}): recorte ampliado explica`] };
    }
  }
  const legibleReason = legibility ? `tela inteira legível como hero (${legibilityNote}) — recortes não são necessários` : "tela inteira como hero";
  if ((signals.primaryMassPct ?? 0) >= 60) return { variant: "UI_HERO", reasons: [legibleReason, `diretor pediu massa ${signals.primaryMassPct}% (>= 60): layout direto, interface domina`] };
  if (signals.floatingCopyFits !== false) {
    return { variant: "FLOATING_PRODUCT", reasons: [legibleReason, "copy cabe na faixa do produto flutuante sem encolher a headline: profundidade e respiro valorizam a interface completa"] };
  }
  return { variant: "UI_HERO", reasons: [legibleReason, "copy longa não cabe na faixa do produto flutuante sem encolher demais a headline: UI_HERO dá mais espaço à copy"] };
}

// ---------------------------------- legibilidade da tela inteira --------------------------------

export type ScreenshotLegibility = {
  /** Escala da tela inteira no hero (largura útil / largura da fonte). */
  heroScale: number;
  /** Escala efetiva no feed: hero × (largura de tela de celular / largura do canvas). */
  feedScale: number;
  /** Fração da energia de borda (gradiente local) que sobrevive à redução até o tamanho do feed. */
  edgeRetentionAtFeed: number;
  fullScreenLegible: boolean;
  featureEnergyShare?: number;
  featureAreaShare?: number;
  featureEdgeRetention?: number;
  smallFeatureCritical: boolean;
};

/** Largura útil da tela inteira no canvas de design 4:5 (1080 − 2 × margem da superfície). */
export const SCREENSHOT_HERO_WIDTH_PX = 1024;
/** O post 1080 aparece na largura de um celular (~390 pt) no feed. */
export const FEED_VIEW_FACTOR = 390 / 1080;
/** Legível = mais da metade do detalhe de borda sobrevive no tamanho em que a tela é vista. */
export const SCREENSHOT_LEGIBLE_EDGE_RETENTION = 0.5;
/** Feature pequena: as células mais ricas (10% da área) concentram a maior parte do conteúdo. */
const SMALL_FEATURE_AREA_SHARE = 0.1;
const SMALL_FEATURE_MIN_ENERGY_SHARE = 0.5;

async function edgeMap(buffer: Buffer, width: number, height: number): Promise<Float32Array> {
  const { data } = await sharp(buffer).flatten({ background: "#ffffff" }).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      out[index] = Math.abs(data[index + 1]! - data[index - 1]!) + Math.abs(data[index + width]! - data[index - width]!);
    }
  }
  return out;
}

/** Mede se a tela COMPLETA continua legível no tamanho em que aparece (sem IA): compara a energia de
 * borda da fonte com a da mesma tela reduzida ao tamanho do feed e ampliada de volta. Texto miúdo,
 * tabela e gráfico denso perdem borda; títulos, cards e fotos sobrevivem. */
export async function assessScreenshotLegibility(png: Buffer, sourceWidth: number, sourceHeight: number): Promise<ScreenshotLegibility> {
  const heroScale = Math.min(1, SCREENSHOT_HERO_WIDTH_PX / sourceWidth);
  const feedScale = heroScale * FEED_VIEW_FACTOR;
  // Análise limitada a 1600 px de largura (mesma proporção de redução relativa).
  const analysisWidth = Math.min(sourceWidth, 1600);
  const analysisHeight = Math.round((analysisWidth * sourceHeight) / sourceWidth);
  const reduced = await sharp(png).flatten({ background: "#ffffff" }).resize(Math.max(8, Math.round(sourceWidth * feedScale))).png().toBuffer();
  const original = await edgeMap(png, analysisWidth, analysisHeight);
  const survived = await edgeMap(reduced, analysisWidth, analysisHeight);
  const cols = 16;
  const rows = 10;
  const cell0 = new Float64Array(cols * rows);
  const cell1 = new Float64Array(cols * rows);
  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      const c = Math.min(rows - 1, Math.floor((y / analysisHeight) * rows)) * cols + Math.min(cols - 1, Math.floor((x / analysisWidth) * cols));
      cell0[c] += original[y * analysisWidth + x]!;
      cell1[c] += survived[y * analysisWidth + x]!;
    }
  }
  const total0 = cell0.reduce((sum, value) => sum + value, 0) || 1;
  const total1 = cell1.reduce((sum, value) => sum + value, 0);
  const edgeRetentionAtFeed = Number((total1 / total0).toFixed(3));
  const order = [...cell0.keys()].sort((a, b) => cell0[b]! - cell0[a]!);
  const top = order.slice(0, Math.max(1, Math.round(cols * rows * SMALL_FEATURE_AREA_SHARE)));
  const top0 = top.reduce((sum, index) => sum + cell0[index]!, 0);
  const top1 = top.reduce((sum, index) => sum + cell1[index]!, 0);
  const featureEnergyShare = Number((top0 / total0).toFixed(3));
  const featureEdgeRetention = Number((top0 > 0 ? top1 / top0 : 1).toFixed(3));
  const fullScreenLegible = heroScale >= DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE && edgeRetentionAtFeed >= SCREENSHOT_LEGIBLE_EDGE_RETENTION;
  return {
    heroScale: Number(heroScale.toFixed(3)),
    feedScale: Number(feedScale.toFixed(3)),
    edgeRetentionAtFeed,
    fullScreenLegible,
    featureEnergyShare,
    featureAreaShare: SMALL_FEATURE_AREA_SHARE,
    featureEdgeRetention,
    smallFeatureCritical: featureEnergyShare >= SMALL_FEATURE_MIN_ENERGY_SHARE && featureEdgeRetention < SCREENSHOT_LEGIBLE_EDGE_RETENTION,
  };
}

// ---------------------------------- paleta e regiões do screenshot ------------------------------

type Rgb = { r: number; g: number; b: number };
const toHex = (c: Rgb): string => `#${[c.r, c.g, c.b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function saturation(c: Rgb): number {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Paleta aproximada do screenshot real (dominante, secundária, acento) por quantização. Só tinge
 * fundo e superfícies — o screenshot nunca é alterado. */
export async function extractScreenshotPalette(png: Buffer): Promise<{ dominant: Rgb; secondary: Rgb; accent: Rgb }> {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).resize(160, 160, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const flatBuckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const luma = (index: number): number => 0.299 * data[index * 3]! + 0.587 * data[index * 3 + 1]! + 0.114 * data[index * 3 + 2]!;
  for (let index = 0; index < info.width * info.height; index += 1) {
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    const flat = x > 0 && y > 0 && x < info.width - 1 && y < info.height - 1 &&
      Math.abs(luma(index + 1) - luma(index - 1)) + Math.abs(luma(index + info.width) - luma(index - info.width)) < 10;
    const r = data[index * 3]!;
    const g = data[index * 3 + 1]!;
    const b = data[index * 3 + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
    if (flat) {
      const flatBucket = flatBuckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      flatBucket.count += 1;
      flatBucket.r += r;
      flatBucket.g += g;
      flatBucket.b += b;
      flatBuckets.set(key, flatBucket);
    }
  }
  const colors = [...buckets.values()].map((bucket) => ({ count: bucket.count, c: { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count } })).sort((a, b) => b.count - a.count);
  const distance = (a: Rgb, b: Rgb): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const dominant = colors[0]?.c ?? WHITE;
  const secondary = colors.find((item) => distance(item.c, dominant) > 70)?.c ?? mixRgb(dominant, BLACK, 0.6);
  const total = info.width * info.height;
  const flatColors = [...flatBuckets.values()].map((bucket) => ({ count: bucket.count, c: { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count } }));
  const accent = [...flatColors]
    .filter((item) => saturation(item.c) > 0.22 && item.count / total > 0.002 && Math.max(item.c.r, item.c.g, item.c.b) > 70)
    .sort((a, b) => b.count * saturation(b.c) - a.count * saturation(a.c))[0]?.c ?? { r: 177, g: 91, b: 108 };
  return { dominant, secondary, accent };
}

type CropSpec = { relWidth: number; aspect: number };
type SourceRect = { x: number; y: number; width: number; height: number };

/** Regiões REAIS mais detalhadas do screenshot (gradiente local), sem sobreposição entre si. Ignora a
 * barra global de navegação (topo) e a borda inferior possivelmente cortada. Determinístico. */
export async function findScreenshotDetailRegions(png: Buffer, sourceWidth: number, sourceHeight: number, specs: readonly CropSpec[], exclude: readonly SourceRect[] = []): Promise<{ rect: SourceRect; score: number; relativeScore: number }[]> {
  const AW = 320;
  const AH = Math.max(80, Math.round((AW * sourceHeight) / sourceWidth));
  const { data } = await sharp(png).flatten({ background: "#ffffff" }).resize(AW, AH, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): number => data[clamp(y, 0, AH - 1) * AW + clamp(x, 0, AW - 1)]!;
  // Imagem integral do gradiente: média de qualquer janela em O(1).
  const integral = new Float64Array((AW + 1) * (AH + 1));
  let total = 0;
  for (let y = 0; y < AH; y += 1) {
    let row = 0;
    for (let x = 0; x < AW; x += 1) {
      const gradient = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
      row += gradient;
      total += gradient;
      integral[(y + 1) * (AW + 1) + x + 1] = integral[y * (AW + 1) + x + 1]! + row;
    }
  }
  const globalMean = total / (AW * AH) || 1;
  const windowMean = (x: number, y: number, w: number, h: number): number =>
    (integral[(y + h) * (AW + 1) + x + w]! - integral[y * (AW + 1) + x + w]! - integral[(y + h) * (AW + 1) + x]! + integral[y * (AW + 1) + x]!) / (w * h);
  const top = Math.round(AH * 0.08);
  const bottom = AH - Math.round(AH * 0.04);
  const chosen: { x: number; y: number; w: number; h: number; score: number }[] = [];
  // Regiões já usadas (ex.: pelo conjunto "a") ficam bloqueadas — o conjunto "b" mostra outros detalhes.
  const blocked = exclude.map((rect) => ({ x: Math.floor((rect.x * AW) / sourceWidth), y: Math.floor((rect.y * AH) / sourceHeight), w: Math.ceil((rect.width * AW) / sourceWidth), h: Math.ceil((rect.height * AH) / sourceHeight) }));
  for (const spec of specs) {
    const w = Math.max(8, Math.round(AW * spec.relWidth));
    const h = Math.max(6, Math.round(w / spec.aspect));
    let best: { x: number; y: number; w: number; h: number; score: number } | undefined;
    for (let y = top; y + h <= bottom; y += 3) {
      for (let x = 3; x + w <= AW - 3; x += 3) {
        if ([...chosen, ...blocked].some((other) => x < other.x + other.w && x + w > other.x && y < other.y + other.h && y + h > other.y)) continue;
        // Detalhe interno menos a "energia" da borda: a janela ideal envolve um componente
        // inteiro (card, linha de preço+botão) em vez de cortar no meio de uma foto.
        const ring = Math.max(1, Math.round(Math.min(w, h) * 0.08));
        const outer = windowMean(x, y, w, h) * w * h;
        const inner = windowMean(x + ring, y + ring, w - 2 * ring, h - 2 * ring) * (w - 2 * ring) * (h - 2 * ring);
        const border = (outer - inner) / (w * h - (w - 2 * ring) * (h - 2 * ring));
        const score = inner / ((w - 2 * ring) * (h - 2 * ring)) - 2.5 * border;
        if (!best || score > best.score) best = { x, y, w, h, score };
      }
    }
    if (best) chosen.push(tightenWindow(best));
  }
  const sx = sourceWidth / AW;
  const sy = sourceHeight / AH;
  function tightenWindow(item: { x: number; y: number; w: number; h: number; score: number }): { x: number; y: number; w: number; h: number; score: number } {
    const quiet = globalMean * 0.2;
    let { x, y, w, h } = item;
    const pad = 3;
    while (h > 12 && windowMean(x, y, w, 1) < quiet) { y += 1; h -= 1; }
    while (h > 12 && windowMean(x, y + h - 1, w, 1) < quiet) h -= 1;
    while (w > 12 && windowMean(x, y, 1, h) < quiet) { x += 1; w -= 1; }
    while (w > 12 && windowMean(x + w - 1, y, 1, h) < quiet) w -= 1;
    const nx = Math.max(item.x, x - pad);
    const ny = Math.max(item.y, y - pad);
    return { x: nx, y: ny, w: Math.min(item.x + item.w, x + w + pad) - nx, h: Math.min(item.y + item.h, y + h + pad) - ny, score: item.score };
  }
  return chosen.map((item) => ({
    rect: { x: Math.round(item.x * sx), y: Math.round(item.y * sy), width: Math.round(item.w * sx), height: Math.round(item.h * sy) },
    score: Number(item.score.toFixed(2)),
    relativeScore: Number((windowMean(item.x, item.y, item.w, item.h) / globalMean).toFixed(2)),
  }));
}

/** Detalhe mínimo (relativo à média da tela) para um componente de borda limpa virar recorte. */
const DETAIL_REGION_MIN_RELATIVE_SCORE = 0.9;
const DETAIL_CROP_SETS: Record<"a" | "b", readonly CropSpec[]> = {
  a: [{ relWidth: 0.28, aspect: 0.82 }, { relWidth: 0.27, aspect: 3.2 }],
  b: [{ relWidth: 0.27, aspect: 3.6 }, { relWidth: 0.29, aspect: 0.84 }],
};

// ---------------------------------- digital_service 4:5 (render) --------------------------------

/** Faixa de copy do FLOATING_PRODUCT (mesmos números no layout e na seleção). */
const FLOATING_COPY = { headWidth: 640, headMax: 54, subWidth: 560, depthReserve: 0.16 };
/** A headline do floating pode encolher no máximo 20% do seu corpo antes de a seleção preferir UI_HERO. */
const FLOATING_MIN_HEADLINE_RATIO = 0.8;

/** Largura mínima exibida (espaço de design 1080) para o screenshot desktop continuar legível. */
export const DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE = 0.4;
const SHOT_RADIUS = 18;

async function renderDigitalServiceAdaptive(
  input: RenderEditorialCreativeInput,
  canvas: Canvas,
  price: string | undefined,
  logo: PreparedAsset | undefined,
  screenshot: PreparedAsset,
  _base: { png: Buffer; width: number; height: number },
  _baseHref: string,
  fontFaceCss: string,
  boxes: EditorialGeometryBox[],
  issues: EditorialGeometryIssue[],
): Promise<FamilyRender> {
  const W = canvas.width;
  const H = canvas.height;
  const M = 56;
  const EDGE = 28; // a superfície do screenshot pode chegar até aqui (safe area de 2% = 21,6 / 27 px)
  const plan = input.plan;
  const headline = plan.headline;
  const subheadline = plan.subheadline?.trim() ? plan.subheadline : undefined;
  const cta = plan.cta.trim() ? plan.cta : undefined;
  const classification = classifyScreenshot(screenshot.width, screenshot.height);
  const aspect = screenshot.width / screenshot.height;
  const paletteRgb = await extractScreenshotPalette(screenshot.png);
  const autoCrops = await findScreenshotDetailRegions(screenshot.png, screenshot.width, screenshot.height, DETAIL_CROP_SETS.a);
  // Componente destacável = borda limpa (pontuação positiva) e detalhe ao menos perto da média da tela.
  const detailRegions = autoCrops.filter((item) => item.score > 0 && item.relativeScore >= DETAIL_REGION_MIN_RELATIVE_SCORE).length;
  const legibility = classification === "DESKTOP" ? await assessScreenshotLegibility(screenshot.png, screenshot.width, screenshot.height) : undefined;
  // 9:16: pilha vertical própria dentro da safe area (copy → profundidade → tela inteira); a tela
  // desktop continua limitada pela largura, o ganho do vertical é respiro e tipografia maior.
  const vertical = isVerticalCanvas(canvas);
  const safe = storySafeInsets(canvas);
  const V = { headWidth: W - 2 * M - 32, headMax: 76, subWidth: 860, ctaH: 66, ctaFont: 21, gap: 64 };
  const floatingCopyFits = vertical ? (() => {
    const shotHeight = (W - 2 * EDGE) / aspect;
    const headFit = fitText(headline, V.headWidth, V.headMax * 1.06 * 3, { maxFontSize: V.headMax, minFontSize: 36, maxLines: 3, lineHeight: 1.06 });
    const subFit = subheadline ? fitText(subheadline, V.subWidth, 3 * 26 * 1.4, { maxFontSize: 26, minFontSize: 19, maxLines: 3, lineHeight: 1.4 }) : undefined;
    const logoH = logo ? logoSize(logo, 270, 46).height + 34 : 0;
    const block = logoH + headFit.height + (subFit ? 20 + subFit.height : 0) + (price ? 18 + 64 : 0) + (cta ? 40 + V.ctaH : 0);
    const available = H - safe.top - safe.bottom - V.gap - shotHeight * (1 + FLOATING_COPY.depthReserve);
    return headFit.fits && (subFit?.fits ?? true) && headFit.fontSize >= V.headMax * FLOATING_MIN_HEADLINE_RATIO && block <= available;
  })() : (() => {
    const shotHeight = (W - 2 * EDGE) / aspect;
    const shotY = H - EDGE - 24 - shotHeight;
    const available = shotY - shotHeight * FLOATING_COPY.depthReserve - 20 - M;
    const headFit = fitText(headline, FLOATING_COPY.headWidth, FLOATING_COPY.headMax * 1.06 * 3, { maxFontSize: FLOATING_COPY.headMax, minFontSize: 32, maxLines: 3, lineHeight: 1.06 });
    const subFit = subheadline ? fitText(subheadline, FLOATING_COPY.subWidth, subheadline.length > 80 ? 96 : 70, { maxFontSize: subheadline.length > 80 ? 21 : 23, minFontSize: 17, maxLines: subheadline.length > 80 ? 3 : 2, lineHeight: 1.4 }) : undefined;
    const logoH = logo ? logoSize(logo, 230, 40).height + 30 : 0;
    const block = logoH + headFit.height + (subFit ? 18 + subFit.height : 0) + (price ? 16 + 60 : 0);
    return headFit.fits && (subFit?.fits ?? true) && headFit.fontSize >= FLOATING_COPY.headMax * FLOATING_MIN_HEADLINE_RATIO && block <= available;
  })();
  const selected = selectDigitalServiceVariant({
    classification,
    headlineChars: headline.length,
    subheadlineChars: subheadline?.length ?? 0,
    hasPrice: Boolean(price),
    detailRegions,
    legibility,
    floatingCopyFits,
    visualDensity: plan.visualDensity,
    primaryMassPct: plan.artDirection?.primaryMassPct,
  });
  const overridable = classification === "DESKTOP" ? ["UI_HERO", "UI_DETAIL_FOCUS", "FLOATING_PRODUCT"] : ["FLOATING_PRODUCT"];
  const override = input.qaVariantOverride && overridable.includes(input.qaVariantOverride) ? (input.qaVariantOverride as DigitalServiceVariant) : undefined;
  const variant = override ?? selected.variant;
  const reasons = override ? [`QA_VARIANT_OVERRIDE=${override} (fixture local; regra escolheria ${selected.variant})`, ...selected.reasons] : [...selected.reasons];
  const allowedOptions: Record<string, readonly DigitalServiceOption[]> = { UI_HERO: ["left", "right"], UI_DETAIL_FOCUS: ["a", "b"], FLOATING_PRODUCT: ["light", "dark"] };
  const defaultOption: DigitalServiceOption = variant === "UI_HERO" ? "left" : variant === "UI_DETAIL_FOCUS" ? "a" : "light";
  const option: DigitalServiceOption = input.qaVariantOption && allowedOptions[variant]?.includes(input.qaVariantOption) ? input.qaVariantOption : defaultOption;
  if (input.qaVariantOption && option === input.qaVariantOption) reasons.push(`QA_VARIANT_OPTION=${option}`);
  const dark = variant === "FLOATING_PRODUCT" && option === "dark";

  // Superfícies derivadas da paleta do screenshot (nada neon): claro = tom do acento muito diluído;
  // escuro = acento afundado em quase preto.
  const accent = paletteRgb.accent;
  const surface = dark
    ? { top: toHex(mixRgb(accent, BLACK, 0.86)), bottom: toHex(mixRgb(accent, BLACK, 0.93)), glowA: toHex(mixRgb(accent, WHITE, 0.1)), glowB: toHex(mixRgb(paletteRgb.secondary, accent, 0.5)) }
    : { top: toHex(mixRgb(accent, WHITE, 0.9)), bottom: toHex(mixRgb(accent, WHITE, 0.74)), glowA: toHex(mixRgb(accent, WHITE, 0.45)), glowB: toHex(mixRgb(paletteRgb.dominant, accent, 0.25)) };
  const ink = dark ? "#FFF5EE" : "#1F1416";
  const muted = dark ? "#E9D9D2" : "#5A4547";
  const accentHex = toHex(dark ? mixRgb(accent, WHITE, 0.82) : mixRgb(accent, BLACK, 0.18));
  const ctaText = dark ? toHex(mixRgb(accent, BLACK, 0.75)) : "#FFF8F3";
  const logoTreatment = logo ? resolveLogoTreatment(logo, dark ? "dark" : "light") : undefined;
  const logoBox = logo ? (vertical ? logoSize(logo, 270, 46) : logoSize(logo, 230, 40)) : undefined;
  const CTA_H = vertical ? V.ctaH : 58;
  const CTA_FONT = vertical ? V.ctaFont : 18;
  const ctaW = cta ? clamp(estimateLineWidth(cta.toUpperCase(), CTA_FONT, 2.4) + (vertical ? 80 : 64), 200, vertical ? 520 : 400) : 0;
  const shotAt = (x: number, y: number, width: number): PxRect => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(width / aspect) });
  const headSpec = (width: number, max: number, lines = 3): TextSpec => ({ id: "headline", text: headline, width, maxHeight: max * 1.06 * lines, maxFontSize: max, minFontSize: 32, maxLines: lines, lineHeight: 1.06, letterSpacing: -0.5 });
  const subSpec = (width: number): TextSpec | undefined =>
    !subheadline
      ? undefined
      : vertical
        ? { id: "subheadline", text: subheadline, width, maxHeight: 3 * 26 * 1.4, maxFontSize: 26, minFontSize: 19, maxLines: 3, lineHeight: 1.4, letterSpacing: 0.1 }
        : { id: "subheadline", text: subheadline, width, maxHeight: subheadline.length > 80 ? 96 : 70, maxFontSize: subheadline.length > 80 ? 21 : 23, minFontSize: 17, maxLines: subheadline.length > 80 ? 3 : 2, lineHeight: 1.4, letterSpacing: 0.1 };
  const priceSpec = (width: number): TextSpec | undefined => (price ? { id: "price", text: price, width, maxHeight: 60, maxFontSize: 46, minFontSize: 26, maxLines: 1 } : undefined);

  let shot: PxRect;
  let logoRect: PxRect | undefined;
  let head: TextBlock;
  let sub: TextBlock | undefined;
  let priceBlock: TextBlock | undefined;
  let pill: PxRect | undefined;
  const crops: { rect: SourceRect; placed: PxRect }[] = [];
  const connectors: string[] = [];
  let ghost = true;
  /** Vertical: quanto as camadas de profundidade podem subir acima da tela (vão real até a copy). */
  let floatingLift: number | undefined;

  /** Pilha de copy (headline → sub → preço) a partir de `top`; devolve o fundo. */
  const placeCopy = (x: number, top: number, hs: TextSpec, ss: TextSpec | undefined, anchor: "start" | "end" = "start"): number => {
    const hf = measureSpec(hs);
    const rx = anchor === "end" ? x - hs.width : x;
    head = { spec: hs, rect: { x: rx, y: Math.round(top), width: hs.width, height: hf.height }, anchor: anchor };
    let cursor = top + hf.height;
    if (ss) {
      const sf = measureSpec(ss);
      cursor += 18;
      sub = { spec: ss, rect: { x: anchor === "end" ? x - ss.width : x, y: Math.round(cursor), width: ss.width, height: sf.height }, anchor: anchor };
      cursor += sf.height;
    }
    const ps = priceSpec(Math.min(hs.width, 420));
    if (ps) {
      const pf = measureSpec(ps);
      cursor += 16;
      priceBlock = { spec: ps, rect: { x: anchor === "end" ? x - ps.width : x, y: Math.round(cursor), width: ps.width, height: pf.height }, anchor: anchor };
      cursor += pf.height;
    }
    return cursor;
  };
  const copyHeight = (hs: TextSpec, ss: TextSpec | undefined): number => measureSpec(hs).height + (ss ? 18 + measureSpec(ss).height : 0) + (price ? 16 + 60 : 0);

  if (vertical) {
    // Pilha vertical centrada na safe area: [logo, headline, sub, preço, CTA] + [recortes] + tela.
    const hs = headSpec(V.headWidth, V.headMax);
    const ss = subSpec(V.subWidth);
    const copyBlock = (logoBox ? logoBox.height + 34 : 0) + copyHeight(hs, ss) + (cta ? 40 + CTA_H : 0);
    shot = shotAt(EDGE, 0, W - 2 * EDGE);
    const depth = variant === "FLOATING_PRODUCT" ? shot.height * FLOATING_COPY.depthReserve : 0;
    let detail: { rect: SourceRect; height: number; width: number }[] = [];
    if (variant === "UI_DETAIL_FOCUS") {
      ghost = false;
      const found = option === "b"
        ? await findScreenshotDetailRegions(screenshot.png, screenshot.width, screenshot.height, DETAIL_CROP_SETS.b, autoCrops.map((item) => item.rect))
        : autoCrops;
      // Recortes reais lado a lado, mesma altura, largura total disponível.
      const gapX = 24;
      const ratios = found.map((item) => item.rect.width / item.rect.height);
      const rowH = Math.min(360, (W - 2 * EDGE - gapX * Math.max(0, found.length - 1)) / Math.max(0.1, ratios.reduce((sum, ratio) => sum + ratio, 0)));
      detail = found.map((item, index) => ({ rect: item.rect, height: Math.round(rowH), width: Math.round(rowH * ratios[index]!) }));
      reasons.push(`recortes ${option === "b" ? "b" : "a"}: ${found.map((item) => `${item.rect.width}x${item.rect.height}@${item.rect.x},${item.rect.y} (detalhe ${item.relativeScore}x a média)`).join("; ")}`);
    }
    const detailBlock = detail.length > 0 ? detail[0]!.height + 40 : 0;
    const total = copyBlock + V.gap + depth + detailBlock + shot.height;
    const shotFirst = variant === "UI_HERO" && option === "right";
    // FLOATING: copy no topo da safe area e tela na base dela — as camadas de profundidade ocupam o
    // vão entre as duas (nada boiando). Demais variantes: pilha centrada na safe area.
    const free = Math.max(0, H - safe.bottom - safe.top - total);
    const floating = variant === "FLOATING_PRODUCT";
    const start = floating ? safe.top : safe.top + free / 2;
    const copyTop = shotFirst ? start + shot.height + V.gap : start;
    logoRect = logoBox ? { x: M, y: Math.round(copyTop), ...logoBox } : undefined;
    const bottom = placeCopy(M, logoRect ? logoRect.y + logoRect.height + 34 : copyTop, hs, ss);
    if (cta) pill = { x: M, y: Math.round(bottom + 40), width: ctaW, height: CTA_H };
    let cursor = shotFirst ? start : copyTop + copyBlock + V.gap + depth + (floating ? free : 0);
    if (floating) floatingLift = depth + free;
    if (detail.length > 0) {
      const rowW = detail.reduce((sum, item) => sum + item.width, 0) + 24 * (detail.length - 1);
      let x = Math.round((W - rowW) / 2);
      for (const item of detail) {
        crops.push({ rect: item.rect, placed: { x, y: Math.round(cursor), width: item.width, height: item.height } });
        x += item.width + 24;
      }
      cursor += detailBlock;
    }
    shot.y = Math.round(cursor);
  } else if (variant === "UI_HERO" && option === "left") {
    // Copy alinhada à esquerda no alto, CTA ancorado à direita da copy; tela inteira embaixo.
    shot = shotAt(EDGE, 0, W - 2 * EDGE);
    shot.y = H - EDGE - shot.height;
    const hs = headSpec(620, 56);
    const ss = subSpec(560);
    const block = (logoBox ? logoBox.height + 30 : 0) + copyHeight(hs, ss);
    const top = Math.round(M + Math.max(0, (shot.y - 40 - M - block) / 2));
    logoRect = logoBox ? { x: M, y: top, ...logoBox } : undefined;
    const bottom = placeCopy(M, logoRect ? logoRect.y + logoRect.height + 30 : top, hs, ss);
    if (cta) pill = { x: W - M - ctaW, y: Math.round(bottom - CTA_H), width: ctaW, height: CTA_H };
  } else if (variant === "UI_HERO") {
    // Tela inteira no alto; copy embaixo alinhada à direita; logo à esquerda, na mesma linha do CTA.
    shot = shotAt(EDGE, EDGE, W - 2 * EDGE);
    const hs = headSpec(660, 54);
    const ss = subSpec(560);
    const rowH = Math.max(CTA_H, logoBox?.height ?? 0);
    const block = copyHeight(hs, ss) + (cta || logoBox ? 34 + rowH : 0);
    const areaTop = shot.y + shot.height + 40;
    const top = Math.round(areaTop + Math.max(0, (H - M - areaTop - block) / 2));
    const bottom = placeCopy(W - M, top, hs, ss, "end");
    const rowTop = Math.round(bottom + 34);
    if (cta) pill = { x: W - M - ctaW, y: rowTop + Math.round((rowH - CTA_H) / 2), width: ctaW, height: CTA_H };
    logoRect = logoBox ? { x: M, y: rowTop + Math.round((rowH - logoBox.height) / 2), ...logoBox } : undefined;
  } else if (variant === "UI_DETAIL_FOCUS") {
    // Tela inteira em largura total embaixo (UI protagonista) + 2 recortes ampliados de regiões
    // REAIS do mesmo screenshot, em coluna no alto ao lado da copy — nunca sobre a tela.
    ghost = false;
    const found = option === "b"
      ? await findScreenshotDetailRegions(screenshot.png, screenshot.width, screenshot.height, DETAIL_CROP_SETS.b, autoCrops.map((item) => item.rect))
      : autoCrops;
    const cropsRight = option !== "b";
    shot = shotAt(EDGE, 0, W - 2 * EDGE);
    shot.y = H - EDGE - shot.height;
    const gap = 20;
    const bandTop = EDGE + 8;
    const bandBottom = shot.y - 36;
    const copyW = 560;
    const colMaxW = W - M - copyW - 40 - EDGE;
    const naturalH = found.reduce((sum, item) => sum + colMaxW / (item.rect.width / item.rect.height), 0) + gap * Math.max(0, found.length - 1);
    const colW = Math.round(Math.min(colMaxW, (colMaxW * (bandBottom - bandTop)) / Math.max(1, naturalH)));
    const cropHeights = found.map((item) => Math.round(colW / (item.rect.width / item.rect.height)));
    const colH = cropHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, found.length - 1);
    const colX = cropsRight ? W - EDGE - colW : EDGE;
    const copyX = cropsRight ? M : W - M;
    const hs = headSpec(copyW, 52, 3);
    const ss = subSpec(copyW - 20);
    const copyH = (logoBox ? logoBox.height + 26 : 0) + copyHeight(hs, ss) + (cta ? 28 + CTA_H : 0);
    const copyTop = Math.round(bandTop + Math.max(0, (bandBottom - bandTop - copyH) / 2));
    logoRect = logoBox ? { x: cropsRight ? M : W - M - logoBox.width, y: copyTop, ...logoBox } : undefined;
    const copyBottom = placeCopy(copyX, logoRect ? logoRect.y + logoRect.height + 26 : copyTop, hs, ss, cropsRight ? "start" : "end");
    if (cta) pill = { x: cropsRight ? M : W - M - ctaW, y: Math.round(copyBottom + 28), width: ctaW, height: CTA_H };
    let cursor = bandTop + Math.max(0, (bandBottom - bandTop - colH) / 2);
    found.forEach((item, index) => {
      const placed = { x: colX, y: Math.round(cursor), width: colW, height: cropHeights[index]! };
      crops.push({ rect: item.rect, placed });
      // Conector discreto: sai pela lateral da coluna, desce pelo vão entre copy e recortes e corre
      // na faixa livre acima da tela até a posição de origem (nunca cruza copy, CTA ou a tela).
      const sourceX = shot.x + ((item.rect.x + item.rect.width / 2) / screenshot.width) * shot.width;
      const laneX = cropsRight ? placed.x - 12 - index * 10 : placed.x + placed.width + 12 + index * 10;
      const laneY = shot.y - 12 - index * 8;
      const fromY = placed.y + placed.height / 2;
      const edgeX = cropsRight ? placed.x : placed.x + placed.width;
      connectors.push(`<path d="M${edgeX} ${fromY.toFixed(1)} L${laneX} ${fromY.toFixed(1)} L${laneX} ${laneY} L${sourceX.toFixed(1)} ${laneY}" stroke="${accentHex}" stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray="4 5" fill="none"/><circle cx="${sourceX.toFixed(1)}" cy="${laneY}" r="4" fill="${accentHex}"/>`);
      cursor += placed.height + gap;
    });
    reasons.push(`recortes ${option === "b" ? "b" : "a"}: ${found.map((item) => `${item.rect.width}x${item.rect.height}@${item.rect.x},${item.rect.y} (detalhe ${item.relativeScore}x a média)`).join("; ")}`);
  } else {
    // FLOATING_PRODUCT: tela inteira em largura total flutuando sobre camadas nítidas giradas
    // (profundidade só atrás dela) — sem chrome de navegador; copy compacta no alto.
    shot = shotAt(EDGE, 0, W - 2 * EDGE);
    shot.y = H - EDGE - 24 - shot.height;
    const hs = headSpec(FLOATING_COPY.headWidth, FLOATING_COPY.headMax);
    const ss = subSpec(FLOATING_COPY.subWidth);
    const areaBottom = shot.y - shot.height * FLOATING_COPY.depthReserve - 20;
    const block = (logoBox ? logoBox.height + 30 : 0) + copyHeight(hs, ss);
    const copyTop = Math.round(M + Math.max(0, (areaBottom - M - block) / 2));
    logoRect = logoBox ? { x: M, y: copyTop, ...logoBox } : undefined;
    const bottom = placeCopy(M, logoRect ? logoRect.y + logoRect.height + 30 : copyTop, hs, ss);
    if (cta) pill = { x: W - M - ctaW, y: Math.round(bottom - CTA_H), width: ctaW, height: CTA_H };
  }

  const displayScale = shot.width / screenshot.width;
  if (classification === "DESKTOP" && displayScale < DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE) {
    issues.push({ code: "SCREENSHOT_ILLEGIBLE", message: `Screenshot desktop exibido a ${(displayScale * 100).toFixed(0)}% da largura original (< ${DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE * 100}%) — interface ilegível.` });
  }
  const zones = buildTextZones(plan, price, { headline: head!.rect, subheadline: sub?.rect, price: priceBlock?.rect, cta: pill ? ctaZoneRect(pill) : undefined }, canvas);
  const roles: CreativePlanAssetRole[] = ["screenshot"];
  const assets: CreativePlan["assetPlacements"] = [assetPlacement(screenshot, shot, canvas, `final rendered screenshot (${variant}/${option}, inteiro, contain)`)];
  assetBox("screenshot", shot, canvas, boxes);
  const inset = { left: (SHOT_RADIUS + 4) / shot.width, right: (SHOT_RADIUS + 4) / shot.width, top: (SHOT_RADIUS + 4) / shot.height, bottom: (SHOT_RADIUS + 4) / shot.height };
  const verify: AssetVerifySpec[] = [verifySpec("screenshot", shot, { fit: "contain", inset, checkFidelity: true })];
  const cropTags: string[] = [];
  const cropDiagnostics: EditorialScreenshotCrop[] = [];
  for (const [index, crop] of crops.entries()) {
    const cropPng = await sharp(screenshot.png).extract({ left: crop.rect.x, top: crop.rect.y, width: crop.rect.width, height: crop.rect.height }).png().toBuffer();
    const id = `detailClip${index}`;
    cropTags.push(`<clipPath id="${id}"><rect x="${crop.placed.x}" y="${crop.placed.y}" width="${crop.placed.width}" height="${crop.placed.height}" rx="14"/></clipPath>
      <g filter="url(#surfaceShadow)"><rect x="${crop.placed.x}" y="${crop.placed.y}" width="${crop.placed.width}" height="${crop.placed.height}" rx="14" fill="#FFFFFF"/></g>
      <image data-asset-role="screenshot" href="${pngDataUri(cropPng)}" x="${crop.placed.x}" y="${crop.placed.y}" width="${crop.placed.width}" height="${crop.placed.height}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${id})"/>
      <rect x="${crop.placed.x + 0.75}" y="${crop.placed.y + 0.75}" width="${crop.placed.width - 1.5}" height="${crop.placed.height - 1.5}" rx="14" fill="none" stroke="${accentHex}" stroke-opacity="0.35" stroke-width="1.5"/>`);
    assets.push(assetPlacement(screenshot, crop.placed, canvas, `final rendered screenshot detail crop (SCREENSHOT_SOURCE ${crop.rect.width}x${crop.rect.height}@${crop.rect.x},${crop.rect.y})`));
    assetBox("screenshot", crop.placed, canvas, boxes);
    const cropInset = { left: 18 / crop.placed.width, right: 18 / crop.placed.width, top: 18 / crop.placed.height, bottom: 18 / crop.placed.height };
    verify.push({ ...verifySpec("screenshot", crop.placed, { fit: "contain", inset: cropInset, checkFidelity: true }), crop: crop.rect });
    cropDiagnostics.push({ source: "SCREENSHOT_SOURCE", url: screenshot.url, cropSourceRect: crop.rect, placedRect: pctRect(crop.placed, canvas), zoomVsMain: Number((crop.placed.width / crop.rect.width / displayScale).toFixed(2)) });
  }
  if (logo && logoRect) {
    roles.push("logo");
    assets.push(assetPlacement(logo, logoRect, canvas, `final rendered logo (${logoTreatment})`));
    assetBox("logo", logoRect, canvas, boxes);
    verify.push(verifySpec("logo", logoRect, { fit: "contain", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { blend: "multiply" as const } : {}) }));
  }

  // Camadas de profundidade derivadas do PRÓPRIO screenshot: desfocadas a ponto de não ter texto
  // legível, nunca dentro da bbox da tela verdadeira (ficam atrás dela).
  const blurred = pngDataUri(await sharp(screenshot.png).resize(Math.round(screenshot.width / 8)).blur(2.2).modulate({ saturation: 0.9 }).png().toBuffer());
  const cx = shot.x + shot.width / 2;
  const cy = shot.y + shot.height / 2;
  const card = (rotate: number, dx: number, dy: number, fill: string, opacity: number, withImage: boolean): string =>
    `<g transform="rotate(${rotate} ${cx} ${cy}) translate(${dx.toFixed(1)} ${dy.toFixed(1)})" opacity="${opacity}"><g filter="url(#layerShadow)"><rect x="${shot.x}" y="${shot.y}" width="${shot.width}" height="${shot.height}" rx="${SHOT_RADIUS}" fill="${fill}"/></g>${withImage ? `<clipPath id="ghostClip${rotate}"><rect x="${shot.x}" y="${shot.y}" width="${shot.width}" height="${shot.height}" rx="${SHOT_RADIUS}"/></clipPath><image href="${blurred}" x="${shot.x}" y="${shot.y}" width="${shot.width}" height="${shot.height}" preserveAspectRatio="none" opacity="0.45" clip-path="url(#ghostClip${rotate})"/>` : ""}</g>`;
  const ghostLayers = ghost
    ? variant === "FLOATING_PRODUCT"
      ? card(-7, -shot.width * 0.06, -(floatingLift !== undefined ? Math.min(floatingLift - 40, shot.height * 0.32) : shot.height * 0.14), toHex(dark ? mixRgb(accent, BLACK, 0.55) : mixRgb(accent, WHITE, 0.55)), 0.9, false) +
        card(-3.5, -shot.width * 0.03, -(floatingLift !== undefined ? Math.min(floatingLift - 40, shot.height * 0.32) / 2 : shot.height * 0.07), dark ? toHex(mixRgb(accent, BLACK, 0.72)) : "#FFFFFF", 0.9, false)
      : card(option === "right" ? -2.2 : 2.2, 0, option === "right" ? 16 : -20, toHex(mixRgb(accent, WHITE, 0.6)), 0.7, false)
    : "";
  const shotTag = `<clipPath id="shotClip"><rect x="${shot.x}" y="${shot.y}" width="${shot.width}" height="${shot.height}" rx="${SHOT_RADIUS}"/></clipPath>
    <g filter="url(#surfaceShadow)"><rect x="${shot.x}" y="${shot.y}" width="${shot.width}" height="${shot.height}" rx="${SHOT_RADIUS}" fill="#FFFFFF"/></g>
    ${imageTag(screenshot, "", shot, { preserveAspectRatio: "xMidYMid meet", clipId: "shotClip" })}
    <rect x="${shot.x + 0.5}" y="${shot.y + 0.5}" width="${shot.width - 1}" height="${shot.height - 1}" rx="${SHOT_RADIUS}" fill="none" stroke="${dark ? "#FFFFFF" : "#2A1A1C"}" stroke-opacity="${dark ? 0.18 : 0.1}" stroke-width="1"/>`;
  const logoTag = logo && logoRect ? imageTag(logo, "", logoRect, { preserveAspectRatio: "xMidYMid meet", ...(logoTreatment === "MULTIPLY_ON_LIGHT" ? { style: "mix-blend-mode:multiply" } : {}) }) : "";
  const chip = logo && logoRect && logoTreatment === "CHIP" ? `<rect x="${logoRect.x - 12}" y="${logoRect.y - 8}" width="${logoRect.width + 24}" height="${logoRect.height + 16}" rx="12" fill="#FFF8F1" opacity="0.95"/>` : "";
  const renderBlock = (block: TextBlock, fill: string, weight: number, embolden: number): string => {
    const anchor = block.anchor ?? "start";
    return textSvg({ id: block.spec.id, text: block.spec.text, x: anchor === "end" ? block.rect.x + block.rect.width : block.rect.x, y: 0, top: block.rect.y, width: block.spec.width, maxHeight: block.spec.maxHeight, maxFontSize: block.spec.maxFontSize, minFontSize: block.spec.minFontSize, maxLines: block.spec.maxLines, lineHeight: block.spec.lineHeight, letterSpacing: block.spec.letterSpacing, anchor, fill, weight, embolden }, canvas, boxes, issues);
  };
  const headSvg = renderBlock(head!, ink, 850, Number((measureSpec(head!.spec).fontSize * 0.024).toFixed(2)));
  const subSvg = sub ? renderBlock(sub, muted, 500, 0) : "";
  const priceSvg = priceBlock ? renderBlock(priceBlock, accentHex, 850, 0.8) : "";
  // CTA comercial: pílula baixa, cor da marca do próprio produto, caixa alta espaçada, brilho sutil.
  const ctaSvg = cta && pill
    ? `<g filter="url(#ctaLift)"><rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="url(#ctaFill)"/></g>
      <rect x="${pill.x + 1}" y="${pill.y + 1}" width="${pill.width - 2}" height="${pill.height / 2}" rx="${pill.height / 2 - 1}" fill="#FFFFFF" opacity="${dark ? 0.12 : 0.1}"/>
      ${renderTextBlock({ spec: { id: "cta", text: cta, width: pill.width - 40, maxHeight: pill.height, maxFontSize: CTA_FONT, minFontSize: 13, maxLines: 1, letterSpacing: 2.4, uppercase: true }, rect: ctaZoneRect(pill), anchor: "middle", valign: "center" }, ctaText, 800, 0.35, canvas, boxes, issues)}`
    : "";
  const ctaFillA = dark ? "#FFF3EA" : toHex(mixRgb(accent, BLACK, 0.12));
  const ctaFillB = dark ? toHex(mixRgb(accent, WHITE, 0.7)) : toHex(mixRgb(accent, BLACK, 0.38));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${fontFaceCss}
    <defs>
      <linearGradient id="digitalSurface" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${surface.top}"/><stop offset="1" stop-color="${surface.bottom}"/></linearGradient>
      <radialGradient id="meshA" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${surface.glowA}" stop-opacity="${dark ? 0.55 : 0.75}"/><stop offset="1" stop-color="${surface.glowA}" stop-opacity="0"/></radialGradient>
      <radialGradient id="meshB" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${surface.glowB}" stop-opacity="${dark ? 0.4 : 0.6}"/><stop offset="1" stop-color="${surface.glowB}" stop-opacity="0"/></radialGradient>
      <radialGradient id="shotGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${toHex(dark ? mixRgb(accent, BLACK, 0.2) : mixRgb(accent, WHITE, 0.35))}" stop-opacity="${dark ? 0.55 : 0.6}"/><stop offset="1" stop-color="${toHex(accent)}" stop-opacity="0"/></radialGradient>
      <linearGradient id="ctaFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ctaFillA}"/><stop offset="1" stop-color="${ctaFillB}"/></linearGradient>
      <filter id="surfaceShadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#1A0B0E" flood-opacity="${dark ? 0.4 : 0.12}"/><feDropShadow dx="0" dy="34" stdDeviation="38" flood-color="#2A1014" flood-opacity="${dark ? 0.55 : 0.24}"/></filter>
      <filter id="ctaLift" x="-20%" y="-40%" width="140%" height="200%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#2A1014" flood-opacity="${dark ? 0.45 : 0.22}"/></filter>
      <filter id="layerShadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1A0B0E" flood-opacity="${dark ? 0.5 : 0.16}"/></filter>
      <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#digitalSurface)"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${shot.width * 0.7}" ry="${shot.height * 0.75}" fill="url(#shotGlow)"/>
    <ellipse cx="${variant === "UI_HERO" && option === "right" ? W * 0.18 : W * 0.86}" cy="${H * 0.12}" rx="${W * 0.55}" ry="${H * 0.32}" fill="url(#meshA)"/>
    <ellipse cx="${W * 0.1}" cy="${H * 0.92}" rx="${W * 0.6}" ry="${H * 0.3}" fill="url(#meshB)"/>
    <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>
    ${ghostLayers}
    ${shotTag}
    ${connectors.join("")}
    ${cropTags.join("")}
    ${chip}
    ${logoTag}
    ${headSvg}
    ${subSvg}
    ${priceSvg}
    ${ctaSvg}
  </svg>`;

  const prominenceRect = { x: 0, y: 0, width: Math.sqrt(shot.width * shot.height + crops.reduce((sum, crop) => sum + crop.placed.width * crop.placed.height, 0)), height: 0 };
  prominenceRect.height = prominenceRect.width;
  const metrics = compositionMetrics(boxes, canvas, prominenceRect, [shot, ...crops.map((crop) => crop.placed)]);
  return {
    svg,
    zones,
    assets,
    roles,
    verify,
    composition: {
      variant,
      selectionReasons: reasons,
      ...(price ? { priceTreatment: "INLINE_PRICE" as const } : {}),
      logoTreatment,
      pageTone: dark ? "dark" : "light",
      ...metrics,
      screenshot: {
        classification,
        sourceWidth: screenshot.width,
        sourceHeight: screenshot.height,
        aspect: Number(aspect.toFixed(3)),
        frame: variant === "FLOATING_PRODUCT" ? "FLOATING_SCREEN" : "EDITORIAL_SURFACE",
        fit: "contain",
        displayScale: Number(displayScale.toFixed(3)),
        displayWidthPx: shot.width,
        option,
        ...(legibility ? { legibility, floatingCopyFits } : {}),
        palette: { dominant: toHex(paletteRgb.dominant), secondary: toHex(paletteRgb.secondary), accent: toHex(paletteRgb.accent) },
        ...(cropDiagnostics.length > 0 ? { crops: cropDiagnostics } : {}),
      },
    },
  };
}

/** Mockup de celular (legado) só para screenshot com proporção de celular — registra a classe. */
function withMobileDiagnostics(rendered: FamilyRender, screenshot: PreparedAsset | undefined, canvas: Canvas): FamilyRender {
  if (!screenshot || canvas.format !== "4:5") return rendered;
  const shot = rendered.assets.find((placement) => placement.role === "screenshot");
  const displayWidthPx = shot ? Math.round((shot.rect.widthPct / 100) * canvas.width) : 0;
  return {
    ...rendered,
    composition: {
      variant: "MOBILE_DEVICE",
      selectionReasons: [`screenshot ${screenshot.width}x${screenshot.height} com proporção de celular: mockup de aparelho`],
      pageTone: "light",
      productVisualProminence: shot ? Number(((shot.rect.widthPct * shot.rect.heightPct) / 10000).toFixed(3)) : 0,
      largestEmptyBandPct: 0,
      contentCentroidOffset: 0,
      occupiedAreaRatio: 0,
      screenshot: { classification: "MOBILE", sourceWidth: screenshot.width, sourceHeight: screenshot.height, aspect: Number((screenshot.width / screenshot.height).toFixed(3)), frame: "PHONE_DEVICE", fit: "top_crop", displayScale: Number((displayWidthPx / screenshot.width).toFixed(3)), displayWidthPx },
    },
  };
}

/**
 * Safe area VERTICAL (9:16). Stories/Reels/Shorts sobrepõem a interface do app no topo (perfil,
 * barra de progresso) e na base (resposta, legenda, ações): conteúdo CRÍTICO — texto, logo, CTA —
 * fica dentro de uma faixa interna conservadora, sem copiar a UI de uma plataforma específica. A
 * imagem/fundo pode ocupar as bordas (não é crítica); só texto e logo são verificados.
 */
export const VERTICAL_STORY_SAFE = { topPct: 11, bottomPct: 14, sidePct: 5 } as const;

export function isVerticalCanvas(canvas: { width: number; height: number }): boolean {
  return canvas.height / canvas.width >= 1.6;
}

export function storySafeInsets(canvas: { width: number; height: number }): { top: number; bottom: number; side: number } {
  if (!isVerticalCanvas(canvas)) return { top: 0, bottom: 0, side: 0 };
  return {
    top: Math.round((canvas.height * VERTICAL_STORY_SAFE.topPct) / 100),
    bottom: Math.round((canvas.height * VERTICAL_STORY_SAFE.bottomPct) / 100),
    side: Math.round((canvas.width * VERTICAL_STORY_SAFE.sidePct) / 100),
  };
}

function violatesStorySafeArea(rect: PxRect, canvas: Canvas): boolean {
  const inset = storySafeInsets(canvas);
  if (inset.top === 0) return false;
  return rect.y < inset.top - 0.5 || rect.y + rect.height > canvas.height - inset.bottom + 0.5 || rect.x < inset.side - 0.5 || rect.x + rect.width > canvas.width - inset.side + 0.5;
}

function violatesSafeArea(rect: PxRect, canvas: Canvas): boolean {
  const marginX = (canvas.width * SAFE_AREA_MARGIN_PCT) / 100;
  const marginY = (canvas.height * SAFE_AREA_MARGIN_PCT) / 100;
  return rect.x < marginX || rect.y < marginY || rect.x + rect.width > canvas.width - marginX || rect.y + rect.height > canvas.height - marginY;
}

function boxPxRect(box: EditorialGeometryBox, canvas: Canvas): PxRect {
  return {
    x: (box.rect.xPct / 100) * canvas.width,
    y: (box.rect.yPct / 100) * canvas.height,
    width: (box.rect.widthPct / 100) * canvas.width,
    height: (box.rect.heightPct / 100) * canvas.height,
  };
}

/** Mesma regra do gate (`checkAssetSafeAreaCompliance`/`checkSafeAreaCompliance`), sobre a
 * geometria FINAL — o layout precisa respeitá-la antes de existir qualquer chamada de visão. A
 * sombra do produto conta como parte visível do componente: precisa caber inteira no canvas. */
export function checkEditorialSafeArea(boxes: readonly EditorialGeometryBox[], canvas: Canvas, family: EditorialCreativeFamily): EditorialGeometryIssue[] {
  const issues: EditorialGeometryIssue[] = [];
  for (const box of boxes) {
    const rect = boxPxRect(box, canvas);
    if (violatesSafeArea(rect, canvas)) {
      issues.push({ code: "SAFE_AREA_VIOLATION", message: `Componente "${box.id}" invade a margem de segurança de ${SAFE_AREA_MARGIN_PCT}% do canvas.` });
    }
    const critical = box.kind === "text" || box.role === "logo";
    if (critical && violatesStorySafeArea(rect, canvas)) {
      issues.push({ code: "SAFE_AREA_VIOLATION", message: `Componente "${box.id}" fora da safe area vertical (topo ${VERTICAL_STORY_SAFE.topPct}%, base ${VERTICAL_STORY_SAFE.bottomPct}%, laterais ${VERTICAL_STORY_SAFE.sidePct}%) — a interface do app cobriria texto/logo.` });
    }
    if (family === "product_offer" && box.role === "product_photo") {
      const shadow = productShadowExtent(rect);
      if (shadow.x < 0 || shadow.y < 0 || shadow.x + shadow.width > canvas.width || shadow.y + shadow.height > canvas.height) {
        issues.push({ code: "SAFE_AREA_VIOLATION", message: "A sombra do frame do produto é cortada pela borda do canvas." });
      }
    }
  }
  return issues;
}

type RawImage = { data: Buffer; width: number; height: number; channels: number };

async function toRaw(image: Sharp): Promise<RawImage> {
  const { data, info } = await image.flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function regionPx(rect: CreativePlanRect, width: number, height: number): PxRect {
  const x = Math.max(0, Math.round((rect.xPct / 100) * width));
  const y = Math.max(0, Math.round((rect.yPct / 100) * height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round((rect.widthPct / 100) * width))),
    height: Math.max(1, Math.min(height - y, Math.round((rect.heightPct / 100) * height))),
  };
}

async function fittedSource(png: Buffer, region: PxRect, fit: AssetVerifySpec["fit"], position: AssetVerifySpec["position"]): Promise<Buffer> {
  return sharp(png)
    .resize(region.width, region.height, { fit, position, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

/**
 * Prova em pixel de que o asset apareceu. Compara a região da arte FINAL (já decodificada do JPEG
 * entregue) com (a) o asset original no mesmo encaixe e (b) o mesmo SVG renderizado sem o asset.
 * Um frame vazio fica idêntico ao controle → `assetMatchRatio ≈ 0`. Sem controle (auditoria de um
 * artefato já publicado), só a fidelidade decide.
 */
async function measureAssetPixels(input: { final: RawImage; control?: RawImage; sourcePng: Buffer; expectedRegion?: Buffer; rect: CreativePlanRect; fit: AssetVerifySpec["fit"]; position: AssetVerifySpec["position"]; inset: AssetVerifySpec["inset"]; blend?: AssetVerifySpec["blend"] }): Promise<{ informativePixelRatio: number; assetMatchRatio: number; fidelityMeanAbsDiff: number; opaquePixels: number }> {
  const region = regionPx(input.rect, input.final.width, input.final.height);
  // RGBA do tamanho da região: o asset renderizado pelo mesmo rasterizador (render normal) ou,
  // na auditoria de artefato já publicado, o asset reencaixado pelo sharp.
  const source = input.expectedRegion ?? await fittedSource(input.sourcePng, region, input.fit, input.position);
  const x0 = Math.floor(region.width * input.inset.left);
  const x1 = region.width - Math.floor(region.width * input.inset.right);
  const y0 = Math.floor(region.height * input.inset.top);
  const y1 = region.height - Math.floor(region.height * input.inset.bottom);
  let totalBlocks = 0;
  let informative = 0;
  let matches = 0;
  let opaque = 0;
  let absDiffSum = 0;
  const fc = input.final.channels;
  // Presença é decidida em blocos (média de VERIFY_BLOCK×VERIFY_BLOCK px): o rasterizador do SVG
  // e o resize do sharp reamostram diferente, e traços finos (texto de logo) ficam meio pixel
  // deslocados. Um asset descartado continua idêntico ao controle em qualquer escala de bloco.
  const sums = new Float64Array(9);
  for (let by = y0; by < y1; by += VERIFY_BLOCK) {
    for (let bx = x0; bx < x1; bx += VERIFY_BLOCK) {
      sums.fill(0);
      let count = 0;
      for (let y = by; y < Math.min(by + VERIFY_BLOCK, y1); y += 1) {
        for (let x = bx; x < Math.min(bx + VERIFY_BLOCK, x1); x += 1) {
          const s = (y * region.width + x) * 4;
          const alpha = source[s + 3] / 255;
          const f = ((region.y + y) * input.final.width + region.x + x) * fc;
          const c = input.control ? ((region.y + y) * input.control.width + region.x + x) * input.control.channels : -1;
          let channelAbsSum = 0;
          for (let k = 0; k < 3; k += 1) {
            const finalValue = input.final.data[f + k];
            const controlValue = c >= 0 ? input.control!.data[c + k] : finalValue;
            sums[k] += finalValue;
            sums[3 + k] += controlValue;
            const sourceValue = input.blend === "multiply" && c >= 0 ? (source[s + k] * controlValue) / 255 : source[s + k];
            sums[6 + k] += sourceValue * alpha + controlValue * (1 - alpha);
            channelAbsSum += Math.abs(finalValue - sourceValue);
          }
          if (alpha > 0.94) {
            opaque += 1;
            absDiffSum += channelAbsSum / 3;
          }
          count += 1;
        }
      }
      if (count === 0) continue;
      totalBlocks += 1;
      if (!input.control) continue;
      let dExpectedControl = 0;
      let dFinalExpected = 0;
      let dFinalControl = 0;
      for (let k = 0; k < 3; k += 1) {
        const finalValue = sums[k] / count;
        const controlValue = sums[3 + k] / count;
        const expected = sums[6 + k] / count;
        dExpectedControl = Math.max(dExpectedControl, Math.abs(expected - controlValue));
        dFinalExpected = Math.max(dFinalExpected, Math.abs(finalValue - expected));
        dFinalControl = Math.max(dFinalControl, Math.abs(finalValue - controlValue));
      }
      if (dExpectedControl > INFORMATIVE_DIFF) {
        informative += 1;
        // Tolerância de reamostragem: até INFORMATIVE_DIFF/2 do esperado também conta. Um asset
        // descartado nunca entra aqui — final ≈ controle fica a mais de INFORMATIVE_DIFF/2 do
        // esperado justamente porque o bloco é informativo (esperado vs controle > INFORMATIVE_DIFF).
        if (dFinalExpected < dFinalControl || dFinalExpected <= INFORMATIVE_DIFF / 2) matches += 1;
      }
    }
  }
  return {
    informativePixelRatio: totalBlocks > 0 ? informative / totalBlocks : 0,
    assetMatchRatio: informative > 0 ? matches / informative : 0,
    fidelityMeanAbsDiff: opaque > 0 ? absDiffSum / opaque : 255,
    opaquePixels: opaque,
  };
}

function preserveAspectRatioFor(spec: AssetVerifySpec): string {
  if (spec.fit === "contain") return "xMidYMid meet";
  return spec.position === "top" ? "xMidYMin slice" : "xMidYMid slice";
}

/** "Como o asset deveria aparecer": o asset sozinho, renderizado pelo MESMO rasterizador e na
 * mesma geometria da arte final — elimina diferença de reamostragem entre sharp e SVG. */
async function renderExpectedAsset(spec: AssetVerifySpec, asset: PreparedAsset, canvas: Canvas, output: OutputSize): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${asset.href}" x="${spec.rect.x}" y="${spec.rect.y}" width="${spec.rect.width}" height="${spec.rect.height}" preserveAspectRatio="${preserveAspectRatioFor(spec)}"/></svg>`;
  const region = regionPx(pctRect(spec.rect, canvas), output.width, output.height);
  return rasterize(svg, canvas, output).ensureAlpha().extract({ left: region.x, top: region.y, width: region.width, height: region.height }).raw().toBuffer();
}

async function verifyAsset(spec: AssetVerifySpec, asset: PreparedAsset, final: RawImage, control: RawImage, canvas: Canvas, output: OutputSize): Promise<EditorialAssetVerification> {
  const rect = pctRect(spec.rect, canvas);
  const expected = await renderExpectedAsset(spec, asset, canvas, output);
  const presence = await measureAssetPixels({ final, control, sourcePng: asset.png, expectedRegion: expected, rect, fit: spec.fit, position: spec.position, inset: spec.inset, blend: spec.blend });
  // Fidelidade sempre contra o ORIGINAL decodificado pelo sharp (independente do rasterizador do
  // SVG): se o rasterizador descartasse/corrompesse o asset nos dois renders, isto ainda reprova.
  // Multiply precisa do fundo (controle) para montar o esperado; o asset continua vindo do original decodificado.
  const original = await measureAssetPixels({ final, sourcePng: asset.png, rect, fit: spec.fit, position: spec.position, inset: spec.inset, ...(spec.blend ? { control, blend: spec.blend } : {}) });
  const measured = { ...presence, fidelityMeanAbsDiff: original.fidelityMeanAbsDiff, opaquePixels: original.opaquePixels };
  const fidelityPass = measured.opaquePixels > 0 && measured.fidelityMeanAbsDiff <= MAX_FIDELITY_MEAN_ABS_DIFF;
  const present = measured.informativePixelRatio >= MIN_INFORMATIVE_RATIO && measured.assetMatchRatio >= MIN_ASSET_MATCH_RATIO;
  const visible = present && (!spec.checkFidelity || fidelityPass);
  const reason = visible
    ? undefined
    : !present
      ? measured.informativePixelRatio < MIN_INFORMATIVE_RATIO
        ? `asset indistinguível do frame vazio (pixels informativos ${(measured.informativePixelRatio * 100).toFixed(2)}%)`
        : `só ${(measured.assetMatchRatio * 100).toFixed(1)}% dos pixels informativos mostram o asset — frame vazio ou asset descartado no render`
      : `asset composto difere do original (diferença média ${measured.fidelityMeanAbsDiff.toFixed(1)} > ${MAX_FIDELITY_MEAN_ABS_DIFF})`;
  return {
    role: spec.role,
    detectedMime: asset.detectedMime,
    visible,
    informativePixelRatio: Number(measured.informativePixelRatio.toFixed(4)),
    assetMatchRatio: Number(measured.assetMatchRatio.toFixed(4)),
    fidelityMeanAbsDiff: Number(measured.fidelityMeanAbsDiff.toFixed(2)),
    fidelityPass,
    reason,
  };
}

/**
 * Auditoria de um artefato final já existente (sem render de controle) — compara a região
 * declarada do asset com o asset original no mesmo encaixe. Usado para reauditar peças publicadas
 * (ex.: o frame vazio do Smoke A) sem chamar visão.
 */
export async function measureCompositedAssetFidelity(input: { finalImage: Buffer; rect: CreativePlanRect; asset: EditorialCreativeAssetBuffer; fit?: AssetVerifySpec["fit"]; inset?: number }): Promise<{ fidelityMeanAbsDiff: number; fidelityPass: boolean }> {
  const prepared = await prepareAsset(input.asset);
  const final = await toRaw(sharp(input.finalImage));
  const inset = input.inset ?? 0.08;
  const measured = await measureAssetPixels({ final, sourcePng: prepared.png, rect: input.rect, fit: input.fit ?? "cover", position: "centre", inset: { left: inset, right: inset, top: inset, bottom: inset } });
  return { fidelityMeanAbsDiff: Number(measured.fidelityMeanAbsDiff.toFixed(2)), fidelityPass: measured.opaquePixels > 0 && measured.fidelityMeanAbsDiff <= MAX_FIDELITY_MEAN_ABS_DIFF };
}

/** Região do asset ORIGINAL decodificado — base da prova em pixel de um recorte de detalhe. */
async function cropPreparedAsset(asset: PreparedAsset, crop: { x: number; y: number; width: number; height: number }): Promise<PreparedAsset> {
  const png = await sharp(asset.png).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png().toBuffer();
  return { ...asset, png, href: pngDataUri(png), width: crop.width, height: crop.height };
}

function rasterize(svg: string, design: Canvas, output: OutputSize): Sharp {
  return sharp(Buffer.from(svg), { density: (72 * output.width) / design.width }).resize(output.width, output.height, { fit: "fill" });
}

function withoutAssetImages(svg: string): string {
  return svg.replace(/<image data-asset-role="[^"]+"[^>]*\/>/g, "");
}

async function prepareBackground(buffer: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  if (!detectImageMime(buffer)) {
    throw new EditorialCompositionError("EDITORIAL_ASSET_DECODE_FAILED", "imagem base não é PNG, JPEG, WEBP nem SVG reconhecível pelo conteúdo.");
  }
  try {
    const png = await sharp(buffer).rotate().png().toBuffer();
    const meta = await sharp(png).metadata();
    if (!meta.width || !meta.height) throw new Error("sem dimensões");
    return { png, width: meta.width, height: meta.height };
  } catch (error) {
    throw new EditorialCompositionError("EDITORIAL_ASSET_DECODE_FAILED", `imagem base não pôde ser decodificada: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
  }
}

/** Ambiente institucional: desfoque bem mais forte (só luz e cor da base, sem formas). */
async function buildSoftAmbient(png: Buffer, canvas: Canvas): Promise<string> {
  const ambient = await sharp(png)
    .resize(Math.round(canvas.width / 4), Math.round(canvas.height / 4), { fit: "cover" })
    .blur(30)
    .modulate({ saturation: 0.85 })
    .png()
    .toBuffer();
  return pngDataUri(ambient);
}

/** Ambiente do product_offer: a base da IA vira luz/cor de fundo desfocada — nunca um segundo
 * "produto" nítido competindo com a foto real. */
async function buildAmbient(png: Buffer, canvas: Canvas): Promise<string> {
  const ambient = await sharp(png)
    .resize(Math.round(canvas.width / 2), Math.round(canvas.height / 2), { fit: "cover" })
    .blur(18)
    .modulate({ saturation: 0.8, brightness: 1.04 })
    .png()
    .toBuffer();
  return pngDataUri(ambient);
}

/** Extensão desfocada da PRÓPRIA foto do produto, atrás de tudo: as bordas esfumadas da foto real
 * se fundem nela (integração sem card). Puramente decorativa — nunca entra em assetPlacements, e a
 * foto real nítida continua intacta na sua bbox. Recortes transparentes são achatados no creme. */
async function buildProductAmbient(product: PreparedAsset, canvas: Canvas): Promise<string> {
  const ambient = await sharp(product.png)
    .flatten({ background: "#F5EEE6" })
    .resize(Math.round(canvas.width / 2), Math.round(canvas.height / 2), { fit: "cover" })
    .blur(26)
    .modulate({ saturation: 0.9 })
    .png()
    .toBuffer();
  return pngDataUri(ambient);
}

/** Tom da base (luminância média) — decide paleta clara/escura do texto sobre ela. */
async function resolveBackgroundTone(png: Buffer): Promise<"light" | "dark"> {
  const { channels } = await sharp(png).stats();
  const luma = (0.299 * channels[0]!.mean + 0.587 * (channels[1]?.mean ?? channels[0]!.mean) + 0.114 * (channels[2]?.mean ?? channels[0]!.mean)) / 255;
  return luma < 0.42 ? "dark" : "light";
}

function resolveOutputSize(base: { width: number; height: number }, design: Canvas): OutputSize {
  const designRatio = design.width / design.height;
  const baseRatio = base.width / base.height;
  return Math.abs(baseRatio - designRatio) / designRatio <= 0.02 ? { width: base.width, height: base.height } : { width: design.width, height: design.height };
}

export async function renderEditorialCreative(input: RenderEditorialCreativeInput): Promise<RenderEditorialCreativeResult> {
  const format: Canvas["format"] = input.context.format === "9:16" ? "9:16" : "4:5";
  const canvas: Canvas = { ...DESIGN_CANVAS[format], format };
  const base = await prepareBackground(input.baseImageBuffer);
  const output = resolveOutputSize(base, canvas);
  const prepared = await Promise.all(input.assets.map((asset) => prepareAsset(asset)));
  const issues: EditorialGeometryIssue[] = [];
  const boxes: EditorialGeometryBox[] = [];
  const baseHref = pngDataUri(base.png);
  const logo = firstAsset(prepared, "logo");
  const product = firstAsset(prepared, "product_photo");
  const screenshot = firstAsset(prepared, "screenshot");
  const price = resolveEditorialConfirmedPrice(input.context);
  const family = resolveFamily(prepared, price);
  const fontFaceCss = await buildEditorialFontFaceCss();

  // Os três compositores adaptativos são paramétricos no canvas (W×H) e servem 4:5 e 9:16; os
  // templates antigos de slots fixos ficam só como fallback de screenshot MOBILE no digital.
  const rendered = family === "product_offer"
    ? true
      ? await renderProductOfferAdaptive(input, canvas, price, logo, product, {
          ambientHref: await buildAmbient(base.png, canvas),
          productAmbientHref: product ? await buildProductAmbient(product, canvas) : undefined,
          baseTone: await resolveBackgroundTone(base.png),
        }, fontFaceCss, boxes, issues)
      : await renderProductOffer(input, canvas, price, logo, product, await buildAmbient(base.png, canvas), fontFaceCss, boxes, issues)
    : family === "digital_service"
      ? screenshot && classifyScreenshot(screenshot.width, screenshot.height) !== "MOBILE"
        ? await renderDigitalServiceAdaptive(input, canvas, price, logo, screenshot, base, baseHref, fontFaceCss, boxes, issues)
        : withMobileDiagnostics(await renderDigitalService(input, canvas, price, logo, screenshot, baseHref || (await blankFallback(canvas.width, canvas.height, "#1a1012")), fontFaceCss, boxes, issues), screenshot, canvas)
      : true
        ? await renderInstitutionalEditorial(input, canvas, logo, base, fontFaceCss, boxes, issues)
        : await renderPremiumInstitutional(input, canvas, logo, baseHref, fontFaceCss, boxes, issues);

  // Contrato de texto ANTES de rasterizar: todo texto obrigatório precisa ter virado zona.
  const missingTexts = findEditorialRequiredTextsMissingFromZones(resolveEditorialRequiredTexts(input.plan, input.context), rendered.zones);
  if (missingTexts.length > 0) {
    throw new EditorialCompositionError("EDITORIAL_REQUIRED_TEXT_MISSING", `texto(s) obrigatório(s) sem zona resolvida no renderer (${family}): ${describeEditorialTextGaps(missingTexts)}.`);
  }

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const rect = boxPxRect(box, canvas);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > canvas.width || rect.y + rect.height > canvas.height) {
      issues.push({ code: "COMPONENT_OVERFLOW", message: `Componente "${box.id}" saiu do canvas.` });
    }
    for (let otherIndex = index + 1; otherIndex < boxes.length; otherIndex += 1) {
      const other = boxes[otherIndex];
      if (box.kind === "asset" && other.kind === "asset") continue;
      if (rectsOverlap(rect, boxPxRect(other, canvas))) {
        issues.push({ code: "COLLISION", message: `Componentes "${box.id}" e "${other.id}" colidem.` });
      }
    }
  }
  issues.push(...checkEditorialSafeArea(boxes, canvas, family));

  const buffer = await rasterize(rendered.svg, canvas, output).jpeg({ quality: 90 }).toBuffer();
  const assetVerification: EditorialAssetVerification[] = [];
  if (rendered.verify.length > 0) {
    const final = await toRaw(sharp(buffer));
    const control = await toRaw(rasterize(withoutAssetImages(rendered.svg), canvas, output));
    for (const spec of rendered.verify) {
      const sourceAsset = firstAsset(prepared, spec.role);
      if (!sourceAsset) continue;
      const asset = spec.crop ? await cropPreparedAsset(sourceAsset, spec.crop) : sourceAsset;
      const verification = { ...(await verifyAsset(spec, asset, final, control, canvas, output)), ...(spec.crop ? { cropSourceRect: spec.crop } : {}) };
      assetVerification.push(verification);
      if (!verification.visible) {
        issues.push({
          code: verification.fidelityPass || !spec.checkFidelity ? "ASSET_NOT_VISIBLE" : "ASSET_FIDELITY_MISMATCH",
          message: `Asset "${spec.role}" (${asset.detectedMime}) não comprovado nos pixels da arte final: ${verification.reason}.`,
        });
      }
    }
  }

  const textBoxes = boxes.filter((box) => box.kind === "text");
  const assetBoxes = boxes.filter((box) => box.kind === "asset");
  return {
    buffer,
    family,
    renderedTextZones: rendered.zones,
    renderedAssetPlacements: rendered.assets,
    compositedAssetRoles: [...new Set(rendered.roles)],
    renderedGeometry: { source: "final_rendered_geometry", family, textBoxes, assetBoxes },
    assetVerification,
    ...(rendered.composition ? { composition: rendered.composition } : {}),
    geometry: { valid: issues.length === 0, boxes, issues },
  };
}
