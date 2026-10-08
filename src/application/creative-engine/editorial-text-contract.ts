import type { CreativeContext, CreativePlan, CreativePlanTextZone } from "../../shared/utils/gpt-creative-plan.types.js";
import { extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";

/**
 * Contrato de texto determinístico do modo editorial. Achado do Smoke A
 * (cer-runtime-muyx4qzs-hoinur): o plano tinha subheadline, `requiredElements` exigia subheadline,
 * mas o preflight de densidade do caminho padrão removeu a zona antes do renderer — o Quality Gate
 * só descobriu depois de gastar a imagem (`MISSING_REQUIRED_TEXT`).
 *
 * Regra única: um texto é OBRIGATÓRIO no modo editorial quando o diretor escreveu o texto
 * (headline sempre; subheadline/CTA quando não vazios) ou quando `requiredElements` o exige. Preço
 * é obrigatório quando o plano o exige (`requiredElements`/`requiredRenderedFacts`) e o valor vem
 * SEMPRE do fato confirmado, nunca do texto do plano. Todo texto obrigatório precisa chegar ao
 * renderer como zona resolvida — senão a execução falha antes da composição.
 */

export type EditorialTextKind = "headline" | "subheadline" | "price" | "cta";

export type EditorialRequiredText = {
  kind: EditorialTextKind;
  /** `undefined` quando o plano exige o texto mas não forneceu conteúdo — é exatamente o caso que
   * precisa falhar antes do renderer. */
  text: string | undefined;
};

const PRICE_ELEMENT_ALIASES = new Set(["price", "preco", "preço", "current_price"]);

function normalizedRequiredElements(plan: Pick<CreativePlan, "requiredElements">): Set<string> {
  return new Set((plan.requiredElements ?? []).map((element) => element.trim().toLowerCase()));
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveEditorialConfirmedPrice(context: Pick<CreativeContext, "confirmedFacts">): string | undefined {
  const facts = extractCommercialFactsFromText(context.confirmedFacts.join("\n"));
  return facts.find((fact) => fact.type === "current_price")?.value;
}

function planRequiresPrice(plan: Pick<CreativePlan, "requiredElements" | "requiredRenderedFacts">, elements: Set<string>): boolean {
  if ([...elements].some((element) => PRICE_ELEMENT_ALIASES.has(element))) return true;
  return extractCommercialFactsFromText((plan.requiredRenderedFacts ?? []).join("\n")).some((fact) => fact.type === "current_price");
}

export function resolveEditorialRequiredTexts(
  plan: Pick<CreativePlan, "headline" | "subheadline" | "cta" | "requiredElements" | "requiredRenderedFacts">,
  context: Pick<CreativeContext, "confirmedFacts">,
): EditorialRequiredText[] {
  const elements = normalizedRequiredElements(plan);
  const required: EditorialRequiredText[] = [{ kind: "headline", text: nonEmpty(plan.headline) }];
  const subheadline = nonEmpty(plan.subheadline);
  if (subheadline || elements.has("subheadline")) required.push({ kind: "subheadline", text: subheadline });
  if (planRequiresPrice(plan, elements)) required.push({ kind: "price", text: resolveEditorialConfirmedPrice(context) });
  const cta = nonEmpty(plan.cta);
  if (cta || elements.has("cta")) required.push({ kind: "cta", text: cta });
  return required;
}

/** Textos obrigatórios sem conteúdo no próprio plano — falha antes de gastar a imagem. */
export function findEditorialRequiredTextsWithoutContent(required: readonly EditorialRequiredText[]): EditorialRequiredText[] {
  return required.filter((item) => item.text === undefined);
}

/** Textos obrigatórios que não chegaram como zona resolvida do renderer (comparação exata do
 * texto, case-insensitive porque o CTA é desenhado em caixa alta). */
export function findEditorialRequiredTextsMissingFromZones(
  required: readonly EditorialRequiredText[],
  zones: readonly Pick<CreativePlanTextZone, "kind" | "text">[],
): EditorialRequiredText[] {
  return required.filter((item) => {
    if (item.text === undefined) return true;
    const expected = item.text.trim().toLowerCase();
    return !zones.some((zone) => zone.kind === item.kind && zone.text.trim().toLowerCase() === expected);
  });
}

export function describeEditorialTextGaps(gaps: readonly EditorialRequiredText[]): string {
  return gaps.map((gap) => (gap.text === undefined ? `${gap.kind} (exigido pelo plano, sem texto)` : `${gap.kind} "${gap.text}"`)).join(", ");
}
