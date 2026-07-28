import type { BrandLanguage, ExtractedContent } from "../../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Aprendizado de linguagem de marca (seção 7): tom, expressões recorrentes, CTAs, promessas e
 * posicionamento — tudo derivado do texto já extraído, nunca inventado. "Nunca inventar um novo
 * posicionamento quando já existir um oficial" (requisito explícito da seção 7) é cumprido aqui
 * ao só aceitar `positioning` quando existe um headline real para citar; do contrário retorna
 * string vazia, e é responsabilidade do chamador nunca preencher esse vazio com texto gerado.
 */

const PROMISE_KEYWORDS = ["garant", "sem burocracia", "sempre", "nunca mais", "direto para", "em minutos"];
const INFORMAL_MARKERS = ["você", "vocês", "seu", "sua", "!"];
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "para", "com", "em", "no", "na", "um", "uma", "que", "por"]);

export function analyzeBrandLanguage(content: ExtractedContent[], slogan?: string): BrandLanguage {
  const allHeadlines = content.flatMap((entry) => [...entry.headlines, ...entry.subheadlines]);
  const allParagraphs = content.flatMap((entry) => entry.paragraphs);
  const allCtas = Array.from(new Set(content.flatMap((entry) => entry.ctas)));
  const allText = [...allHeadlines, ...allParagraphs].join(" ");

  const informalHits = INFORMAL_MARKERS.filter((marker) => allText.toLowerCase().includes(marker)).length;
  const tone = informalHits >= 2 ? "conversacional, próximo, em segunda pessoa" : "institucional, direto";
  const style = allHeadlines.some((headline) => headline.length <= 40)
    ? "frases curtas e diretas, foco em benefício imediato"
    : "frases descritivas, foco em explicação";

  const vocabulary = topWords(allText, 15);
  const recurringExpressions = recurringPhrases([...allHeadlines, ...allCtas], 2);

  const promises = Array.from(
    new Set(allParagraphs.filter((paragraph) => PROMISE_KEYWORDS.some((keyword) => paragraph.toLowerCase().includes(keyword)))),
  ).slice(0, 10);

  const positioning = slogan?.trim() || allHeadlines[0] || "";

  return { tone, style, vocabulary, recurringExpressions, ctas: allCtas, promises, positioning };
}

function topWords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const rawWord of text.toLowerCase().replace(/[^a-zà-ú0-9\s]/gi, " ").split(/\s+/)) {
    if (rawWord.length < 4 || STOPWORDS.has(rawWord)) continue;
    counts.set(rawWord, (counts.get(rawWord) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function recurringPhrases(phrases: string[], minOccurrences: number): string[] {
  const counts = new Map<string, number>();
  for (const phrase of phrases) {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= minOccurrences)
    .map(([phrase]) => phrase);
}
