import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanRect, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";
import type {
  EditorialCreativeAssetBuffer,
  EditorialCreativeFamily,
  EditorialGeometryBox,
  EditorialGeometryIssue,
  RenderEditorialCreativeInput,
  RenderEditorialCreativeResult,
} from "../../application/creative-engine/editorial-composition.types.js";
export { EDITORIAL_CREATIVE_FAMILIES } from "../../application/creative-engine/editorial-composition.types.js";
export type {
  EditorialCreativeAssetBuffer,
  EditorialCreativeFamily,
  EditorialGeometryBox,
  EditorialGeometryIssue,
  RenderEditorialCreativeInput,
  RenderEditorialCreativeResult,
} from "../../application/creative-engine/editorial-composition.types.js";
import { extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";
import { isValidHexColor } from "../../shared/utils/color-contrast.js";

type Canvas = { width: number; height: number; format: "4:5" | "9:16" };
type PxRect = { x: number; y: number; width: number; height: number };
type TextFit = { lines: string[]; fontSize: number; lineHeight: number; height: number; fits: boolean };

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
let cachedFontFaceCss: string | undefined;

async function loadEditorialFont(): Promise<Buffer> {
  if (!cachedFontBuffer) cachedFontBuffer = await readFile(FONT_PATH);
  return cachedFontBuffer;
}

export async function assertEditorialRuntimeFontAvailable(): Promise<{ family: string; path: string; bytes: number }> {
  const font = await loadEditorialFont();
  return { family: FONT_FAMILY, path: FONT_PATH, bytes: font.length };
}

export async function buildEditorialFontFaceCss(): Promise<string> {
  if (!cachedFontFaceCss) {
    const font = await loadEditorialFont();
    cachedFontFaceCss = `<style>@font-face{font-family:${FONT_FAMILY};src:url(data:font/truetype;base64,${font.toString("base64")}) format('truetype');font-weight:100 900;font-style:normal;} text{font-family:${FONT_FAMILY};}</style>`;
  }
  return cachedFontFaceCss;
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

function dataUri(buffer: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function pickAccent(context: CreativeContext): string {
  const hex = context.brandColors?.find((color) => isValidHexColor(color));
  return hex ?? DEFAULT_BRAND.roseDark;
}

function firstAsset(input: RenderEditorialCreativeInput, role: CreativePlanAssetRole): EditorialCreativeAssetBuffer | undefined {
  return input.assets.find((asset) => asset.role === role);
}

function resolveFamily(input: RenderEditorialCreativeInput, priceText?: string): EditorialCreativeFamily {
  if (firstAsset(input, "screenshot")) return "digital_service";
  if (firstAsset(input, "product_photo") || priceText) return "product_offer";
  return "premium_institutional";
}

function confirmedPrice(context: CreativeContext): string | undefined {
  const facts = extractCommercialFactsFromText(context.confirmedFacts.join("\n"));
  return facts.find((fact) => fact.type === "current_price")?.value;
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

function textSvg(input: { text: string; x: number; y: number; width: number; maxHeight: number; maxFontSize: number; minFontSize: number; maxLines: number; fill: string; weight?: number; letterSpacing?: number; anchor?: "start" | "middle" | "end"; uppercase?: boolean; id: string }, canvas: Canvas, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): string {
  const value = input.uppercase ? input.text.toUpperCase() : input.text;
  const fit = fitText(value, input.width, input.maxHeight, {
    maxFontSize: input.maxFontSize,
    minFontSize: input.minFontSize,
    maxLines: input.maxLines,
  });
  const rectX = input.anchor === "middle" ? input.x - input.width / 2 : input.anchor === "end" ? input.x - input.width : input.x;
  const rect = { x: rectX, y: input.y - input.maxFontSize, width: input.width, height: Math.max(input.maxHeight, fit.height) };
  boxes.push({ id: input.id, rect: pctRect(rect, canvas), text: value, fontSizePx: fit.fontSize, lineCount: fit.lines.length });
  if (!fit.fits) {
    issues.push({ code: "TEXT_OVERFLOW", message: `Texto "${input.id}" não coube no bloco editorial sem quebrar a hierarquia.` });
  }
  return `<text x="${input.x}" y="${input.y}" fill="${input.fill}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="${input.weight ?? 800}" text-anchor="${input.anchor ?? "start"}" letter-spacing="${input.letterSpacing ?? 0}">${fit.lines.map((line, index) => `<tspan x="${input.x}" dy="${index === 0 ? 0 : fit.fontSize * fit.lineHeight}">${xmlEscape(line)}</tspan>`).join("")}</text>`;
}

function imageTag(asset: EditorialCreativeAssetBuffer | undefined, fallback: string, rect: PxRect, options?: { clipId?: string; opacity?: number; preserveAspectRatio?: string }): string {
  const href = asset ? dataUri(asset.buffer) : fallback;
  return `<image href="${href}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="${options?.preserveAspectRatio ?? "xMidYMid slice"}"${options?.clipId ? ` clip-path="url(#${options.clipId})"` : ""}${options?.opacity !== undefined ? ` opacity="${options.opacity}"` : ""}/>`;
}

async function blankFallback(width: number, height: number, color: string): Promise<string> {
  const buffer = await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
  return dataUri(buffer);
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

async function renderProductOffer(input: RenderEditorialCreativeInput, canvas: Canvas, price: string | undefined, logo: EditorialCreativeAssetBuffer | undefined, product: EditorialCreativeAssetBuffer | undefined, baseFallback: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<{ svg: string; zones: CreativePlanTextZone[]; roles: CreativePlanAssetRole[] }> {
  const accent = pickAccent(input.context);
  const photoRect = canvas.format === "9:16"
    ? { x: 86, y: 110, width: 908, height: 850 }
    : { x: 486, y: 86, width: 518, height: 812 };
  const headlineRect = canvas.format === "9:16"
    ? { x: 92, y: 1236, width: 700, height: 250 }
    : { x: 92, y: 340, width: 336, height: 260 };
  const subRect = canvas.format === "9:16"
    ? { x: 92, y: 1488, width: 640, height: 96 }
    : { x: 96, y: 654, width: 322, height: 130 };
  const commerceRect = canvas.format === "9:16"
    ? { x: 92, y: 1644, width: 794, height: 130 }
    : { x: 76, y: 1010, width: 928, height: 170 };
  const ctaRect = canvas.format === "9:16"
    ? { x: 548, y: 1668, width: 338, height: 84 }
    : { x: 748, y: 1034, width: 226, height: 122 };
  const priceRect = canvas.format === "9:16"
    ? { x: 126, y: 1694, width: 372, height: 64 }
    : { x: 126, y: 1082, width: 520, height: 74 };
  if (rectsOverlap(headlineRect, photoRect)) issues.push({ code: "MASK_VIOLATION", message: "Headline de produto atravessa a fotografia." });
  const zones = buildTextZones(input.plan, price, { headline: headlineRect, subheadline: subRect, cta: ctaRect, price: priceRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  if (product) roles.push("product_photo");
  if (logo) roles.push("logo");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${fontFaceCss}
    <defs>
      <clipPath id="productPhoto"><rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="${canvas.format === "9:16" ? 54 : 42}"/></clipPath>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#3B121B" flood-opacity="0.22"/></filter>
      <linearGradient id="footer" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${DEFAULT_BRAND.roseDark}"/><stop offset="0.66" stop-color="#923E4F"/><stop offset="0.66" stop-color="${DEFAULT_BRAND.champagne}"/><stop offset="1" stop-color="#F2D798"/></linearGradient>
    </defs>
    <rect width="${canvas.width}" height="${canvas.height}" fill="${DEFAULT_BRAND.cream}"/>
    ${canvas.format === "4:5" ? `<rect x="56" y="56" width="968" height="1238" rx="54" fill="#FFFDF8" opacity="0.76"/><path d="M70 930C210 870 356 892 478 970C636 1072 820 1058 1008 930V1294H70Z" fill="#F7E7D8"/>` : ""}
    ${imageTag(product, baseFallback, photoRect, { clipId: "productPhoto" })}
    <rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="${canvas.format === "9:16" ? 54 : 42}" fill="none" stroke="#FFFFFF" stroke-width="10"/>
    ${logo ? imageTag(logo, "", canvas.format === "9:16" ? { x: 92, y: 1038, width: 300, height: 58 } : { x: 92, y: 88, width: 282, height: 54 }, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: headlineRect.y + (canvas.format === "9:16" ? 78 : 76), width: headlineRect.width, maxHeight: headlineRect.height, maxFontSize: canvas.format === "9:16" ? 88 : 66, minFontSize: 36, maxLines: canvas.format === "9:16" ? 3 : 4, fill: DEFAULT_BRAND.ink, weight: 850 }, canvas, boxes, issues)}
    ${input.plan.subheadline ? textSvg({ id: "subheadline", text: input.plan.subheadline, x: subRect.x, y: subRect.y + 40, width: subRect.width, maxHeight: subRect.height, maxFontSize: canvas.format === "9:16" ? 30 : 28, minFontSize: 20, maxLines: canvas.format === "9:16" ? 3 : 4, fill: "#60484A", weight: 500 }, canvas, boxes, issues) : ""}
    ${price ? `<g filter="url(#shadow)"><rect x="${commerceRect.x}" y="${commerceRect.y}" width="${commerceRect.width}" height="${commerceRect.height}" rx="${canvas.format === "9:16" ? 28 : 34}" fill="url(#footer)"/><rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="#FFF9F1" opacity="0.96"/></g>
    ${textSvg({ id: "price", text: price, x: priceRect.x, y: priceRect.y + 42, width: priceRect.width, maxHeight: priceRect.height, maxFontSize: canvas.format === "9:16" ? 54 : 64, minFontSize: 30, maxLines: 1, fill: "#FFFFFF", weight: 850 }, canvas, boxes, issues)}
    ${input.plan.cta.trim() ? textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: ctaRect.y + ctaRect.height / 2 + 10, width: ctaRect.width - 28, maxHeight: ctaRect.height - 18, maxFontSize: canvas.format === "9:16" ? 27 : 22, minFontSize: 16, maxLines: 1, fill: accent, weight: 850, anchor: "middle" }, canvas, boxes, issues) : ""}` : ""}
  </svg>`;
  return { svg, zones, roles };
}

async function renderPremiumInstitutional(input: RenderEditorialCreativeInput, canvas: Canvas, logo: EditorialCreativeAssetBuffer | undefined, baseFallback: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<{ svg: string; zones: CreativePlanTextZone[]; roles: CreativePlanAssetRole[] }> {
  const photoRect = canvas.format === "9:16" ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : { x: 470, y: 96, width: 520, height: 1028 };
  const panelRect = canvas.format === "9:16" ? { x: 146, y: 1008, width: 790, height: 520 } : { x: 96, y: 126, width: 330, height: 1118 };
  const headlineRect = canvas.format === "9:16" ? { x: 196, y: 1118, width: 610, height: 210 } : { x: 112, y: 372, width: 292, height: 310 };
  const subRect = canvas.format === "9:16" ? { x: 200, y: 1372, width: 550, height: 120 } : { x: 112, y: 790, width: 292, height: 190 };
  const ctaRect = canvas.format === "9:16" ? { x: 196, y: 1600, width: 344, height: 84 } : { x: 112, y: 1110, width: 304, height: 80 };
  if (!within(headlineRect, { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height })) issues.push({ code: "COMPONENT_OVERFLOW", message: "Headline institucional saiu da coluna editorial." });
  const zones = buildTextZones(input.plan, undefined, { headline: headlineRect, subheadline: subRect, cta: ctaRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  if (logo) roles.push("logo");
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
    ${logo ? imageTag(logo, "", canvas.format === "9:16" ? { x: 176, y: 110, width: 304, height: 68 } : { x: 112, y: 148, width: 306, height: 66 }, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: headlineRect.y + 80, width: headlineRect.width, maxHeight: headlineRect.height, maxFontSize: canvas.format === "9:16" ? 72 : 48, minFontSize: 30, maxLines: canvas.format === "9:16" ? 3 : 5, fill: "#FFFFFF", weight: 850 }, canvas, boxes, issues)}
    ${input.plan.subheadline ? textSvg({ id: "subheadline", text: input.plan.subheadline, x: subRect.x, y: subRect.y + 38, width: subRect.width, maxHeight: subRect.height, maxFontSize: canvas.format === "9:16" ? 30 : 24, minFontSize: 18, maxLines: 5, fill: "#FFEDE1", weight: 500 }, canvas, boxes, issues) : ""}
    ${input.plan.cta.trim() ? `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="#F8E6D8"/>${textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: ctaRect.y + ctaRect.height / 2 + 8, width: ctaRect.width - 30, maxHeight: ctaRect.height - 16, maxFontSize: 21, minFontSize: 15, maxLines: 1, fill: DEFAULT_BRAND.roseDark, weight: 850, anchor: "middle" }, canvas, boxes, issues)}` : ""}
  </svg>`;
  return { svg, zones, roles };
}

async function renderDigitalService(input: RenderEditorialCreativeInput, canvas: Canvas, price: string | undefined, logo: EditorialCreativeAssetBuffer | undefined, screenshot: EditorialCreativeAssetBuffer | undefined, baseFallback: string, fontFaceCss: string, boxes: EditorialGeometryBox[], issues: EditorialGeometryIssue[]): Promise<{ svg: string; zones: CreativePlanTextZone[]; roles: CreativePlanAssetRole[] }> {
  const screen = canvas.format === "9:16" ? { x: 608, y: 344, width: 326, height: 562 } : { x: 642, y: 250, width: 296, height: 500 };
  const device = canvas.format === "9:16" ? { x: 570, y: 300, width: 406, height: 658 } : { x: 604, y: 202, width: 374, height: 604 };
  const headlineRect = canvas.format === "9:16" ? { x: 152, y: 474, width: 380, height: 260 } : { x: 150, y: 386, width: 382, height: 250 };
  const subRect = canvas.format === "9:16" ? { x: 156, y: 798, width: 354, height: 142 } : { x: 154, y: 660, width: 360, height: 142 };
  const priceRect = canvas.format === "9:16" ? { x: 152, y: 1080, width: 438, height: 82 } : { x: 150, y: 896, width: 430, height: 82 };
  const ctaRect = canvas.format === "9:16" ? { x: 152, y: 1222, width: 326, height: 80 } : { x: 150, y: 1028, width: 326, height: 80 };
  const zones = buildTextZones(input.plan, price, { headline: headlineRect, subheadline: subRect, price: priceRect, cta: ctaRect }, canvas);
  const roles: CreativePlanAssetRole[] = [];
  if (screenshot) roles.push("screenshot");
  if (logo) roles.push("logo");
  if (screenshot) {
    const meta = await sharp(screenshot.buffer).metadata();
    if (meta.width && meta.height) {
      const sourceRatio = meta.width / meta.height;
      const targetRatio = screen.width / screen.height;
      if (Math.abs(sourceRatio - targetRatio) / targetRatio > 2.2) {
        issues.push({ code: "ASSET_RATIO_MISMATCH", message: "Screenshot real muito incompatível com a área do device mockup." });
      }
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
    ${logo ? imageTag(logo, "", canvas.format === "9:16" ? { x: 152, y: 144, width: 292, height: 56 } : { x: 150, y: 116, width: 270, height: 52 }, { preserveAspectRatio: "xMidYMid meet" }) : ""}
    ${textSvg({ id: "headline", text: input.plan.headline, x: headlineRect.x, y: headlineRect.y + 56, width: headlineRect.width, maxHeight: headlineRect.height, maxFontSize: canvas.format === "9:16" ? 58 : 54, minFontSize: 30, maxLines: 4, fill: DEFAULT_BRAND.ink, weight: 850 }, canvas, boxes, issues)}
    ${input.plan.subheadline ? textSvg({ id: "subheadline", text: input.plan.subheadline, x: subRect.x, y: subRect.y + 40, width: subRect.width, maxHeight: subRect.height, maxFontSize: 28, minFontSize: 18, maxLines: 4, fill: "#62484A", weight: 500 }, canvas, boxes, issues) : ""}
    ${price ? `<rect x="${priceRect.x}" y="${priceRect.y}" width="${priceRect.width}" height="${priceRect.height}" rx="20" fill="#F0DDC8"/>${textSvg({ id: "price", text: price, x: priceRect.x + 24, y: priceRect.y + 52, width: priceRect.width - 48, maxHeight: priceRect.height - 18, maxFontSize: 30, minFontSize: 18, maxLines: 1, fill: DEFAULT_BRAND.roseDark, weight: 850 }, canvas, boxes, issues)}` : ""}
    ${input.plan.cta.trim() ? `<rect x="${ctaRect.x}" y="${ctaRect.y}" width="${ctaRect.width}" height="${ctaRect.height}" rx="${ctaRect.height / 2}" fill="${DEFAULT_BRAND.roseDark}"/>${textSvg({ id: "cta", text: input.plan.cta.toUpperCase(), x: ctaRect.x + ctaRect.width / 2, y: ctaRect.y + ctaRect.height / 2 + 8, width: ctaRect.width - 34, maxHeight: ctaRect.height - 18, maxFontSize: 27, minFontSize: 16, maxLines: 1, fill: "#FFFFFF", weight: 850, anchor: "middle" }, canvas, boxes, issues)}` : ""}
    <g filter="url(#shadow)"><rect x="${device.x}" y="${device.y}" width="${device.width}" height="${device.height}" rx="64" fill="#171011"/><rect x="${device.x + 20}" y="${device.y + 20}" width="${device.width - 40}" height="${device.height - 40}" rx="48" fill="#FFFDF8"/>${imageTag(screenshot, baseFallback, screen, { clipId: "screen", preserveAspectRatio: "xMidYMin slice" })}</g>
  </svg>`;
  return { svg, zones, roles };
}

export async function renderEditorialCreative(input: RenderEditorialCreativeInput): Promise<RenderEditorialCreativeResult> {
  const meta = await sharp(input.baseImageBuffer).metadata();
  const width = meta.width ?? (input.context.format === "9:16" ? 1080 : 1080);
  const height = meta.height ?? (input.context.format === "9:16" ? 1920 : 1350);
  const format: Canvas["format"] = input.context.format === "9:16" ? "9:16" : "4:5";
  const canvas: Canvas = { width, height, format };
  const issues: EditorialGeometryIssue[] = [];
  const boxes: EditorialGeometryBox[] = [];
  const baseFallback = await blankFallback(width, height, "#1a1012");
  const logo = firstAsset(input, "logo");
  const product = firstAsset(input, "product_photo");
  const screenshot = firstAsset(input, "screenshot");
  const price = confirmedPrice(input.context);
  const family = resolveFamily(input, price);
  const fontFaceCss = await buildEditorialFontFaceCss();

  const rendered = family === "product_offer"
    ? await renderProductOffer(input, canvas, price, logo, product, product ? "" : dataUri(input.baseImageBuffer), fontFaceCss, boxes, issues)
    : family === "digital_service"
      ? await renderDigitalService(input, canvas, price, logo, screenshot, dataUri(input.baseImageBuffer), fontFaceCss, boxes, issues)
      : await renderPremiumInstitutional(input, canvas, logo, dataUri(input.baseImageBuffer), fontFaceCss, boxes, issues);

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const rect = {
      x: (box.rect.xPct / 100) * width,
      y: (box.rect.yPct / 100) * height,
      width: (box.rect.widthPct / 100) * width,
      height: (box.rect.heightPct / 100) * height,
    };
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) {
      issues.push({ code: "COMPONENT_OVERFLOW", message: `Componente "${box.id}" saiu do canvas.` });
    }
    for (let otherIndex = index + 1; otherIndex < boxes.length; otherIndex += 1) {
      const other = boxes[otherIndex];
      const otherRect = {
        x: (other.rect.xPct / 100) * width,
        y: (other.rect.yPct / 100) * height,
        width: (other.rect.widthPct / 100) * width,
        height: (other.rect.heightPct / 100) * height,
      };
      if (rectsOverlap(rect, otherRect)) {
        issues.push({ code: "COLLISION", message: `Componentes "${box.id}" e "${other.id}" colidem.` });
      }
    }
  }

  const buffer = await sharp(Buffer.from(rendered.svg)).jpeg({ quality: 90 }).toBuffer();
  return {
    buffer,
    family,
    renderedTextZones: rendered.zones,
    compositedAssetRoles: [...new Set(rendered.roles)],
    geometry: { valid: issues.length === 0, boxes, issues },
  };
}
