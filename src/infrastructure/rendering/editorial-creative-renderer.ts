import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Sharp } from "sharp";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanRect, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";
import {
  EditorialCompositionError,
  type EditorialAssetVerification,
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
};

type FamilyRender = { svg: string; zones: CreativePlanTextZone[]; assets: CreativePlan["assetPlacements"]; roles: CreativePlanAssetRole[]; verify: AssetVerifySpec[] };

type AssetVerifySpec = {
  role: CreativePlanAssetRole;
  rect: PxRect;
  fit: "cover" | "contain";
  position: "centre" | "top";
  /** Frações da região ignoradas por borda (cantos arredondados/clip) — só comparamos pixels que o
   * layout garante estar dentro do clip. */
  inset: { left: number; right: number; top: number; bottom: number };
  checkFidelity: boolean;
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

async function measureAssetContent(png: Buffer): Promise<{ alphaCoverage: number; lumaStdev: number }> {
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
  return { alphaCoverage: opaque / total, lumaStdev: opaque > 0 ? Math.sqrt(Math.max(0, sumSq / opaque - mean * mean)) : 0 };
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
  if (asset.role === "product_photo") {
    const content = await measureAssetContent(png);
    if (content.alphaCoverage < MIN_ASSET_ALPHA_COVERAGE || content.lumaStdev < MIN_ASSET_LUMA_STDEV) {
      throw new EditorialCompositionError(
        "PRODUCT_ASSET_EMPTY",
        `foto do produto (${asset.url}) não tem conteúdo visual utilizável (cobertura opaca ${(content.alphaCoverage * 100).toFixed(1)}%, variação ${content.lumaStdev.toFixed(2)}).`,
      );
    }
  }
  return { ...asset, detectedMime, png, href: pngDataUri(png), width, height };
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
  return `<text x="${input.x}" y="${baseline}" fill="${input.fill}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="${input.weight ?? 800}" text-anchor="${input.anchor ?? "start"}" letter-spacing="${input.letterSpacing ?? 0}">${fit.lines.map((line, index) => `<tspan x="${input.x}" dy="${index === 0 ? 0 : fit.fontSize * fit.lineHeight}">${xmlEscape(line)}</tspan>`).join("")}</text>`;
}

function assetBox(role: CreativePlanAssetRole, rect: PxRect, canvas: Canvas, boxes: EditorialGeometryBox[]): void {
  boxes.push({ id: role, kind: "asset", role, rect: pctRect(rect, canvas) });
}

function assetPlacement(asset: EditorialCreativeAssetBuffer, rect: PxRect, canvas: Canvas, treatment: string): CreativePlan["assetPlacements"][number] {
  return { role: asset.role, url: asset.url, rect: pctRect(rect, canvas), frame: "none", treatment };
}

/** `data-asset-role` marca a tag do asset real para o render de controle (mesmo SVG sem o asset)
 * usado na verificação de pixel. */
function imageTag(asset: PreparedAsset | undefined, fallback: string, rect: PxRect, options?: { clipId?: string; opacity?: number; preserveAspectRatio?: string }): string {
  const href = asset ? asset.href : fallback;
  if (!href) return "";
  return `<image${asset ? ` data-asset-role="${asset.role}"` : ""} href="${href}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="${options?.preserveAspectRatio ?? "xMidYMid slice"}"${options?.clipId ? ` clip-path="url(#${options.clipId})"` : ""}${options?.opacity !== undefined ? ` opacity="${options.opacity}"` : ""}/>`;
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
  const logoRect = canvas.format === "9:16" ? { x: 152, y: 144, width: 292, height: 56 } : { x: 150, y: 116, width: 270, height: 52 };
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
async function measureAssetPixels(input: { final: RawImage; control?: RawImage; sourcePng: Buffer; expectedRegion?: Buffer; rect: CreativePlanRect; fit: AssetVerifySpec["fit"]; position: AssetVerifySpec["position"]; inset: AssetVerifySpec["inset"] }): Promise<{ informativePixelRatio: number; assetMatchRatio: number; fidelityMeanAbsDiff: number; opaquePixels: number }> {
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
            sums[6 + k] += source[s + k] * alpha + controlValue * (1 - alpha);
            channelAbsSum += Math.abs(finalValue - source[s + k]);
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
  const presence = await measureAssetPixels({ final, control, sourcePng: asset.png, expectedRegion: expected, rect, fit: spec.fit, position: spec.position, inset: spec.inset });
  // Fidelidade sempre contra o ORIGINAL decodificado pelo sharp (independente do rasterizador do
  // SVG): se o rasterizador descartasse/corrompesse o asset nos dois renders, isto ainda reprova.
  const original = await measureAssetPixels({ final, sourcePng: asset.png, rect, fit: spec.fit, position: spec.position, inset: spec.inset });
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

  const rendered = family === "product_offer"
    ? await renderProductOffer(input, canvas, price, logo, product, await buildAmbient(base.png, canvas), fontFaceCss, boxes, issues)
    : family === "digital_service"
      ? await renderDigitalService(input, canvas, price, logo, screenshot, baseHref || (await blankFallback(canvas.width, canvas.height, "#1a1012")), fontFaceCss, boxes, issues)
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
      const asset = firstAsset(prepared, spec.role);
      if (!asset) continue;
      const verification = await verifyAsset(spec, asset, final, control, canvas, output);
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
    geometry: { valid: issues.length === 0, boxes, issues },
  };
}
