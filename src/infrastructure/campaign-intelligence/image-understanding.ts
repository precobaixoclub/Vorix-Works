import { extname } from "node:path";
import type { CampaignFile, ImageAnalysis, MediaItemCategory, MediaQuality } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";
import { normalizeAspectRatio, readRasterDimensions } from "../visual-assets/visual-asset-metadata.js";
import { recognizeText } from "./ocr.js";
import { extractDominantColors } from "./dominant-colors.js";

/**
 * Image Understanding (seção 3): nunca só guarda a imagem — sempre extrai OCR, cores, indícios de
 * interface (botões/menus/formulários) e classifica a categoria. Cada campo vem de uma evidência
 * concreta (texto OCR, nome do arquivo, cor extraída), nunca de um palpite sem base.
 */

const INTERFACE_HINTS = ["menu", "entrar", "login", "confirmar", "cadastrar", "buscar", "pesquisar", "voltar", "próximo", "proximo", "salvar", "enviar", "criar conta", "senha"];
const BUTTON_LINE_PATTERN = /^[A-ZÀ-Ú][\wÀ-ú\s]{2,28}$/;
const LOGO_FILENAME_HINTS = ["logo", "marca", "brand"];
const ICON_FILENAME_HINTS = ["icon", "icone", "ícone"];

function detectButtons(ocrText: string): string[] {
  return ocrText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => BUTTON_LINE_PATTERN.test(line) && !line.includes("."))
    .slice(0, 10);
}

function detectCategory(fileName: string, hasInterfaceElements: boolean, width: number, height: number): MediaItemCategory {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".svg")) return "svg";
  if (LOGO_FILENAME_HINTS.some((hint) => lowerName.includes(hint))) return "logo";
  if (ICON_FILENAME_HINTS.some((hint) => lowerName.includes(hint)) || (width > 0 && width === height && width <= 256)) return "icon";
  if (hasInterfaceElements) return "screen_capture";
  if (width > 0 && height > 0 && width / height >= 2.5) return "banner";
  return "image";
}

function estimateQuality(width: number, height: number): MediaQuality {
  const pixels = width * height;
  if (pixels === 0) return "low";
  if (pixels >= 1_000_000) return "high";
  if (pixels >= 300_000) return "medium";
  return "low";
}

export async function analyzeImage(file: CampaignFile): Promise<ImageAnalysis> {
  const ocrText = await recognizeText(file.absolutePath);
  const dominantColors = await extractDominantColors(file.absolutePath);

  let width = 0;
  let height = 0;
  if ([".png", ".jpg", ".jpeg"].includes(extname(file.absolutePath).toLowerCase())) {
    const dimensions = await readRasterDimensions(file.absolutePath).catch(() => ({ width: 0, height: 0 }));
    width = dimensions.width;
    height = dimensions.height;
  }

  const detectedTexts = ocrText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hasInterfaceElements = INTERFACE_HINTS.some((hint) => ocrText.toLowerCase().includes(hint));
  const buttons = detectButtons(ocrText);
  const category = detectCategory(file.originalFileName, hasInterfaceElements, width, height);
  const quality = estimateQuality(width, height);

  return {
    fileId: file.id,
    ocrText,
    detectedTexts,
    dominantColors,
    hasInterfaceElements,
    buttons,
    category,
    quality,
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? normalizeAspectRatio(width, height) : "unknown",
    tags: [category, ...(hasInterfaceElements ? ["interface"] : [])],
  };
}
