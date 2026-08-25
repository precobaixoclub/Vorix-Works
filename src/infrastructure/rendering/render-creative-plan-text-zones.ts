import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";
import type { CreativePlanRect, CreativePlanTextZone, CreativePlanTextZoneKind } from "../../shared/utils/gpt-creative-plan.types.js";
import { pickReadableTextColor } from "../../shared/utils/color-contrast.js";
import { el, type SatoriNode } from "./components/satori-node.js";

/**
 * Executor determinístico das zonas de texto do `creative_plan` (`renderedBy: "renderer"`) —
 * migração "GPT como motor criativo único" (PR 4/9). DELIBERADAMENTE independente de
 * `ad-creative-renderer.ts`/`ad-layout.types.ts`/`component-skin-resolver.ts`: aquele stack está
 * amarrado a `PerformanceCreativePlan`/`AdLayoutZone` (autoridade do motor legado — `layoutFamily`,
 * `componentSkins`) e este módulo nunca deve importar nada de lá (ver
 * `scripts/check-creative-engine-isolation.mjs`). Reaproveita só o que é puramente técnico:
 * Satori+sharp para rasterizar/compor, `el`/`fitFontSizeToBox` (helpers mecânicos sem decisão
 * criativa) e `pickReadableTextColor` (matemática de contraste WCAG).
 *
 * O renderer aqui só EXECUTA — cor/posição/conteúdo de cada zona já vêm decididos pelo
 * `creative_plan`; a única decisão própria deste módulo é a picareta técnica (contraste de texto
 * sobre o fundo escolhido), nunca layout, skin ou estética.
 */

const moduleDir = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(moduleDir, "assets", "geist-regular.ttf");

let cachedFontBuffer: Buffer | undefined;
async function loadFont(): Promise<Buffer> {
  if (!cachedFontBuffer) cachedFontBuffer = await readFile(FONT_PATH);
  return cachedFontBuffer;
}

export type RenderCreativePlanTextZonesInput = {
  baseImageBuffer: Buffer;
  /** Só zonas com `renderedBy: "renderer"` — filtrar `"image_model"` é responsabilidade de quem
   * chama (o motor já sabe quais zonas o próprio modelo de imagem desenhou). */
  zones: readonly CreativePlanTextZone[];
  /** Cor de destaque da marca para zonas `emphasis: "secondary"` (ex.: CTA) — zonas `"primary"`
   * (headline) sempre usam o mesmo scrim escuro + texto branco, técnica que funciona sobre
   * qualquer fundo fotográfico imprevisível. */
  accentColor?: string;
  /** Multiplicador do tamanho de fonte calculado (`fitFontSizeToBox`) — usado pelo Repair Loop do
   * motor GPT (`renderer_reflow`, `creative-repair.ts`) para reduzir o texto numa nova tentativa
   * quando o quality gate reprova por `TEXT_ILLEGIBLE_OR_CUT`/`ELEMENT_CUT_OFF`, sem precisar de
   * uma nova decisão criativa do GPT. Padrão 1 (sem alteração). */
  fontScale?: number;
};

export type RenderedCreativePlanTextZone = {
  kind: CreativePlanTextZoneKind;
  rect: CreativePlanRect;
  fontSizePx: number;
};

export type RenderCreativePlanTextZonesResult = {
  buffer: Buffer;
  renderedZones: RenderedCreativePlanTextZone[];
};

const DEFAULT_ACCENT_COLOR = "#FACC15";

// Mesmo valor de `AVERAGE_CHAR_WIDTH_RATIO`/`lineHeight: 1.15` usados por `fitFontSizeToBox`
// (components/satori-node.ts) e pelo `span` abaixo — mantido em duplicado de propósito (ver
// `fitWrappedFontSizeToBox`).
const AVERAGE_CHAR_WIDTH_RATIO = 0.58;
const LINE_HEIGHT_RATIO = 1.15;

/**
 * Achado ao vivo em produção: `fitFontSizeToBox` (satori-node.ts) assume texto de UMA linha só —
 * pensada pra resolver preço/CTA curtos vazando da caixa — e por isso encolhia até o piso de 10px
 * um subheadline de frase inteira, que na prática QUEBRA em várias linhas dentro da div de largura
 * fixa (o Satori já quebra texto normalmente, sem `whiteSpace: nowrap` configurado). O resultado:
 * branco sobre preto, contraste de cor tecnicamente perfeito, mas ilegível de tão minúsculo — a
 * visão reprovou como "baixo contraste" por falta de um jeito melhor de descrever "fonte
 * inutilizável". Versão local (não a global, pra não alterar preço/CTA/badge do motor legado que
 * usam `fitFontSizeToBox` original) que testa se o texto CABE quebrando em múltiplas linhas antes
 * de encolher — nunca pior que a original pra texto curto (mesmo resultado quando cabe numa linha
 * só), sempre melhor pra texto longo.
 */
function fitWrappedFontSizeToBox(text: string, widthPx: number, heightPx: number, maxHeightRatio = 0.6): number {
  const maxFontSize = Math.max(10, Math.round(heightPx * maxHeightRatio));
  const safeLength = Math.max(1, text.length);
  for (let fontSize = maxFontSize; fontSize > 10; fontSize -= 1) {
    const charsPerLine = Math.max(1, Math.floor(widthPx / (fontSize * AVERAGE_CHAR_WIDTH_RATIO)));
    const lines = Math.ceil(safeLength / charsPerLine);
    if (lines * fontSize * LINE_HEIGHT_RATIO <= heightPx) return fontSize;
  }
  return 10;
}

function toPx(pct: number, totalPx: number): number {
  return Math.round((pct / 100) * totalPx);
}

function buildZoneNode(zone: CreativePlanTextZone, left: number, top: number, widthPx: number, heightPx: number, accentColor: string, fontScale: number): { node: SatoriNode; fontSizePx: number } {
  const padding = Math.round(Math.min(widthPx, heightPx) * 0.12);
  const fittedFontSizePx = fitWrappedFontSizeToBox(zone.text, widthPx - padding * 2, heightPx - padding * 2);
  const fontSizePx = Math.max(10, Math.round(fittedFontSizePx * fontScale));

  const isPrimary = zone.emphasis === "primary";
  const backgroundColor = isPrimary ? "rgba(0, 0, 0, 0.55)" : accentColor;
  const textColor = isPrimary ? "#FFFFFF" : pickReadableTextColor(accentColor);

  // Uma única div acumula posição absoluta E estilo visual — nunca uma div de posição
  // "vazia" envolvendo outra de estilo (achado ao vivo: o Satori não preenche uma div
  // posicionada sem propriedades visuais próprias do jeito esperado quando o filho também
  // define width/height idênticos).
  const node = el(
    "div",
    {
      position: "absolute",
      left,
      top,
      width: widthPx,
      height: heightPx,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding,
      backgroundColor,
      borderRadius: Math.round(padding * 0.8),
      boxSizing: "border-box",
    },
    el(
      "span",
      {
        color: textColor,
        fontSize: fontSizePx,
        fontFamily: "Geist",
        fontWeight: 700,
        textAlign: "center",
        lineHeight: 1.15,
      },
      zone.text,
    ),
  );

  return { node, fontSizePx };
}

/**
 * Compõe as zonas de texto que o `creative_plan` decidiu delegar ao renderer (`renderedBy:
 * "renderer"`) como pixels REAIS sobre a imagem base gerada pelo motor GPT — mesma técnica de
 * `ad-creative-renderer.ts` (uma árvore Satori única, rasterizada uma vez, composta sobre a base
 * numa única operação), mas sem nenhuma dependência do vocabulário de zonas/planos do motor
 * legado.
 */
export async function renderCreativePlanTextZones(input: RenderCreativePlanTextZonesInput): Promise<RenderCreativePlanTextZonesResult> {
  const baseImage = sharp(input.baseImageBuffer);
  const metadata = await baseImage.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("CREATIVE_PLAN_TEXT_ZONES_IMAGE_METADATA_MISSING: não foi possível ler largura/altura da imagem base.");
  }

  if (input.zones.length === 0) {
    return { buffer: input.baseImageBuffer, renderedZones: [] };
  }

  const accentColor = input.accentColor ?? DEFAULT_ACCENT_COLOR;
  const fontScale = input.fontScale ?? 1;
  const positionedNodes: SatoriNode[] = [];
  const renderedZones: RenderedCreativePlanTextZone[] = [];

  for (const zone of input.zones) {
    const widthPx = toPx(zone.rect.widthPct, width);
    const heightPx = toPx(zone.rect.heightPct, height);
    const left = toPx(zone.rect.xPct, width);
    const top = toPx(zone.rect.yPct, height);
    const { node, fontSizePx } = buildZoneNode(zone, left, top, widthPx, heightPx, accentColor, fontScale);

    positionedNodes.push(node);
    renderedZones.push({ kind: zone.kind, rect: zone.rect, fontSizePx });
  }

  const root = el("div", { position: "relative", width, height, display: "flex" }, positionedNodes);

  const fontBuffer = await loadFont();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: [{ name: "Geist", data: fontBuffer, weight: 400, style: "normal" }],
  });

  const overlayBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const buffer = await baseImage.composite([{ input: overlayBuffer, left: 0, top: 0 }]).png().toBuffer();

  return { buffer, renderedZones };
}
