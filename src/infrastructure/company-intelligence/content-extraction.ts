import * as cheerio from "cheerio";
import type { ExtractedContent, ExtractedFaqItem, ExtractedPlan } from "../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Extração de conteúdo estruturado de uma página (seção 3): headlines, CTAs, benefícios,
 * planos/preços, FAQ etc. Heurísticas propositalmente simples e auditáveis (seletores DOM +
 * palavras-chave) em vez de um modelo de linguagem — mantém o resultado determinístico e
 * testável com fixtures locais, sem depender de rede em teste.
 */

const CTA_KEYWORDS = ["criar", "comece", "começar", "escolher", "assinar", "ver demonstra", "comparar", "solicitar", "experimente", "quero", "cadastr"];
const BENEFIT_KEYWORDS = ["sem burocracia", "fácil", "rápido", "simples", "completo", "direto para", "colaborativo", "ao vivo", "em minutos"];
const DIFFERENTIATOR_KEYWORDS = ["único", "exclusivo", "diferente de", "não é só", "muito mais que"];

function textOf($el: cheerio.Cheerio<any>): string {
  return $el.text().replace(/\s+/g, " ").trim();
}

export function extractContent(html: string, pageUrl: string): ExtractedContent {
  const $ = cheerio.load(html);

  const headlines = uniqueNonEmpty($("h1").map((_, el) => textOf($(el))).get());
  const subheadlines = uniqueNonEmpty($("h2, h3").map((_, el) => textOf($(el))).get());
  const paragraphs = uniqueNonEmpty(
    $("p").map((_, el) => textOf($(el))).get().filter((text) => text.length >= 20),
  );

  const lists: string[][] = [];
  $("ul, ol").each((_, el) => {
    const items = $(el).find("li").map((_, li) => textOf($(li))).get().filter(Boolean);
    if (items.length >= 2) lists.push(items);
  });

  const ctas = uniqueNonEmpty(
    $("a, button")
      .map((_, el) => textOf($(el)))
      .get()
      .filter((text) => text.length > 0 && text.length <= 60)
      .filter((text) => CTA_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword))),
  );

  const faq = extractFaq($);
  const plans = extractPlans($);
  const testimonials = extractTestimonials($);

  const bodyText = [...headlines, ...subheadlines, ...paragraphs, ...lists.flat()];
  const benefits = uniqueNonEmpty(bodyText.filter((text) => BENEFIT_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword))));
  const differentiators = uniqueNonEmpty(bodyText.filter((text) => DIFFERENTIATOR_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword))));
  const features = uniqueNonEmpty([...subheadlines, ...lists.flat()].filter((text) => text.length >= 3 && text.length <= 80));

  return { pageUrl, headlines, subheadlines, paragraphs, lists, faq, benefits, features, ctas, testimonials, plans, differentiators };
}

function extractFaq($: cheerio.CheerioAPI): ExtractedFaqItem[] {
  const items: ExtractedFaqItem[] = [];
  $("details").each((_, el) => {
    const question = textOf($(el).find("summary"));
    const answer = textOf($(el)).replace(question, "").trim();
    if (question && answer) items.push({ question, answer });
  });
  $("h2, h3, h4, dt").each((_, el) => {
    const text = textOf($(el));
    if (!text.endsWith("?")) return;
    const answerEl = $(el).next("p, dd");
    const answer = textOf(answerEl);
    if (answer) items.push({ question: text, answer });
  });
  return dedupeBy(items, (item) => item.question);
}

function extractPlans($: cheerio.CheerioAPI): ExtractedPlan[] {
  const plans: ExtractedPlan[] = [];
  const priceRegex = /R\$\s?\d+[.,]?\d*/;

  $("[class*='plan' i], [class*='pricing' i], [class*='preco' i]").each((_, el) => {
    const $el = $(el);
    const nameCandidate = textOf($el.find("h1, h2, h3, h4").first());
    const fullText = textOf($el);
    const priceMatch = fullText.match(priceRegex);
    if (!nameCandidate && !priceMatch) return;
    const featureItems = $el.find("li").map((_, li) => textOf($(li))).get().filter(Boolean);
    plans.push({
      name: nameCandidate || "Plano",
      price: priceMatch?.[0],
      description: undefined,
      features: featureItems,
    });
  });

  return dedupeBy(plans, (plan) => `${plan.name}-${plan.price ?? ""}`);
}

function extractTestimonials($: cheerio.CheerioAPI): Array<{ author?: string; text: string }> {
  const testimonials: Array<{ author?: string; text: string }> = [];
  $("blockquote, [class*='testimonial' i], [class*='depoimento' i]").each((_, el) => {
    const text = textOf($(el));
    if (text.length >= 15) testimonials.push({ text });
  });
  return testimonials;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function dedupeBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
