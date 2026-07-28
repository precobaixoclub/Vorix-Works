import type { CapturedScreen, ExtractedContent, Feature } from "../../../domain/company-intelligence/company-intelligence.model.js";
import { slugify } from "./slug.js";

/**
 * Descoberta de funcionalidades (seção 6) a partir do conteúdo já extraído das páginas —
 * puramente heurística/determinística (sem LLM), para ficar testável com fixtures locais.
 * Cada funcionalidade tenta casar com uma tela capturada (seção 4) pelo nome, o que é o que a
 * seção 11/12 (Product Authenticity) precisa para preferir telas reais a mockups fictícios.
 */

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "para", "com", "em", "no", "na",
  "um", "uma", "seu", "sua", "que", "por", "ao", "aos", "às", "à", "mais", "sem", "muito",
]);

const PAIN_POINT_PATTERNS = [
  /sem\s+([a-zà-ú\s]+)/i,
  /chega de\s+([a-zà-ú\s]+)/i,
  /nunca mais\s+([a-zà-ú\s]+)/i,
  /acabe com\s+([a-zà-ú\s]+)/i,
];

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-zà-ú0-9\s]/gi, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
    ),
  ).slice(0, 8);
}

function findBenefit(featureName: string, benefits: string[]): string {
  const keywords = extractKeywords(featureName);
  const match = benefits.find((benefit) => keywords.some((keyword) => benefit.toLowerCase().includes(keyword)));
  return match ?? "";
}

function findPainPoint(featureName: string, paragraphs: string[]): string {
  const keywords = extractKeywords(featureName);
  const relevantParagraph = paragraphs.find((paragraph) => keywords.some((keyword) => paragraph.toLowerCase().includes(keyword)));
  if (!relevantParagraph) return "";
  for (const pattern of PAIN_POINT_PATTERNS) {
    const match = relevantParagraph.match(pattern);
    if (match) return match[0].trim();
  }
  return "";
}

function findRelatedScreens(featureName: string, screens: CapturedScreen[]): string[] {
  const keywords = extractKeywords(featureName);
  return screens
    .filter((screen) => keywords.some((keyword) => screen.category.includes(keyword) || screen.sourceUrl.toLowerCase().includes(keyword)))
    .map((screen) => screen.id);
}

export function discoverFeatures(content: ExtractedContent[], screens: CapturedScreen[] = []): Feature[] {
  const allBenefits = content.flatMap((entry) => entry.benefits);
  const allParagraphs = content.flatMap((entry) => entry.paragraphs);

  const candidateNames = Array.from(
    new Set(
      content
        .flatMap((entry) => entry.features)
        .map((name) => name.trim())
        .filter((name) => name.length >= 3 && name.length <= 80 && !name.endsWith("?")),
    ),
  );

  const features: Feature[] = candidateNames.map((name) => {
    const id = slugify(name) || `feature-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name,
      description: name,
      benefit: findBenefit(name, allBenefits),
      painPointSolved: findPainPoint(name, allParagraphs),
      category: "product",
      keywords: extractKeywords(name),
      relatedScreenIds: findRelatedScreens(name, screens),
    };
  });

  return dedupeById(features);
}

function dedupeById(features: Feature[]): Feature[] {
  const seen = new Map<string, Feature>();
  for (const feature of features) {
    if (!seen.has(feature.id)) seen.set(feature.id, feature);
  }
  return Array.from(seen.values());
}
