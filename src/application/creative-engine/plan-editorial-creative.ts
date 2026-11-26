import { buildCreativeSpec, buildImageInstruction, type CreativeSpec } from "./creative-spec.js";
import { captureFeatureScore, classifyReference, resolveReferencesForMode, type BusinessKind, type ClassifiedReference, type ReferenceCandidate, type ResolvedReferences } from "./reference-roles.js";
import { classifyVisualIntent, ideaText, type SoftwareFeature, type VisualIntentDecision, type VisualMode } from "./visual-intent.js";
import type { VisualFingerprint } from "./visual-variety.js";

/**
 * Plano criativo de uma pauta do Bolsão — a etapa que faltava entre "ideia selecionada" e "chamada
 * ao gerador". Junta tudo o que decide a fidelidade, numa função pura (o I/O fica com quem chama):
 *
 * 1. classifica cada material (catálogo, Biblioteca da marca, anexos da pauta) por papel;
 * 2. decide o modo (produto físico, software, conceitual) da PAUTA;
 * 3. completa a referência que falta quando há uma escolha segura (captura da funcionalidade na
 *    Biblioteca; produto autorizado para uso editorial, em rodízio) — sempre registrada;
 * 4. resolve o que é transmitido ao modelo, o que fica de fora e o que bloqueia;
 * 5. monta as telas (imagem única ou carrossel) e a especificação de cada uma, variando a
 *    composição entre as telas e em relação às peças recentes.
 */

export type EditorialIdeaForPlan = {
  id: string;
  externalId?: string;
  title: string;
  format: "single_image" | "carousel" | string;
  category?: string;
  approach?: string;
  commercialObjective?: string;
  targetAudience?: string;
  concept?: string;
  keyMessage: string;
  visualDirection?: string;
  creativePrompt?: string;
  cta?: string;
  carouselScript?: ReadonlyArray<{ headline: string; body?: string }>;
};

export type PlanScreen = { headline: string; body?: string; cta?: string };

/**
 * Produto do catálogo disponível para a peça (fotos por variante). `themes`: do que a estampa fala
 * (palavras sem acento; terminadas em "*" valem como prefixo) e os temas de ocasião (`fitness`, `praia`, `inverno`, `western`, `natal`).
 */
export type CatalogProductForPlan = { code: string; themes?: readonly string[]; photos: ReadonlyArray<{ id: string; variantLabel: string; siteCaptureScore?: number; photoKind?: "studio" | "scene" }> };

/**
 * Ocasiões que, quando a pauta fala delas, exigem uma peça daquele tema. Produção (26/11/2026): a pauta
 * "Seu treino, seu estilo" saiu com a camiseta de coração — o rodízio não olhava o assunto da pauta.
 */
export const PRODUCT_THEME_DEMANDS: ReadonlyArray<{ theme: string; label: string; pattern: RegExp }> = [
  { theme: "fitness", label: "academia/treino", pattern: /\b(treino\w*|treinar|academia\w*|malha(?:r|cao|ndo)|musculac\w*|fitness|crossfit|atleta\w*|gym|workout|esportiv\w*)\b/ },
  { theme: "praia", label: "praia", pattern: /\b(praia\w*|pe na areia|litoral|piscina)\b/ },
  { theme: "inverno", label: "frio/inverno", pattern: /\b(inverno|frio|moletom|casaco\w*)\b/ },
  { theme: "western", label: "estilo western/country", pattern: /\b(western|texas|cowboy\w*|cowgirl\w*|country|rodeio\w*|faroeste|velho oeste|o oeste)\b/ },
  { theme: "natal", label: "Natal", pattern: /\b(natal|natalin\w*|papai noel|noel|ceia)\b/ },
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const themePattern = (theme: string) => new RegExp(theme.endsWith("*") ? `\\b${escapeRegExp(theme.slice(0, -1))}\\w*` : `\\b${escapeRegExp(theme)}\\b`);

/** Ocasiões que a pauta pede (ver PRODUCT_THEME_DEMANDS). */
export function themeDemands(text: string): Array<{ theme: string; label: string }> {
  return PRODUCT_THEME_DEMANDS.filter((demand) => demand.pattern.test(text)).map(({ theme, label }) => ({ theme, label }));
}

/** Temas da peça que aparecem no texto da pauta. */
export function matchedProductThemes(themes: readonly string[] | undefined, text: string): string[] {
  return (themes ?? []).filter((theme) => !PRODUCT_THEME_DEMANDS.some((demand) => demand.theme === theme) && themePattern(theme).test(text));
}

/**
 * Ordena as peças para a pauta: só as que atendem à ocasião pedida (academia, praia…); entre elas, a que
 * mais fala do assunto da pauta primeiro; empate mantém a ordem recebida (rodízio). Peça de ocasião
 * (camiseta de academia, de praia, de Natal…) só entra em pauta daquela ocasião — nunca no rodízio geral.
 */
export function rankProductsForIdea<T extends { themes?: readonly string[] }>(products: readonly T[], idea: EditorialIdeaForPlan): T[] {
  const text = ideaText(idea);
  const demands = themeDemands(text);
  const asked = new Set(demands.map((demand) => demand.theme));
  const occasions = (product: T) => PRODUCT_THEME_DEMANDS.filter((demand) => product.themes?.includes(demand.theme)).map((demand) => demand.theme);
  const fitting = products.filter((product) => demands.every((demand) => product.themes?.includes(demand.theme))
    && occasions(product).every((theme) => asked.has(theme)));
  return fitting
    .map((product, index) => ({ product, index, score: matchedProductThemes(product.themes, text).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.product);
}

export type PlanEditorialCreativeInput = {
  workspaceId: string;
  brandName: string;
  brandIdentity?: CreativeSpec["brandIdentity"];
  presentation?: CreativeSpec["presentation"];
  businessKind: BusinessKind;
  softwareFeatures?: readonly SoftwareFeature[];
  idea: EditorialIdeaForPlan;
  /** Materiais anexados à pauta, já identificados (catálogo / Biblioteca / envio solto). */
  ideaReferences: readonly ReferenceCandidate[];
  /** Capturas de software da Biblioteca da marca (para completar a pauta de software). */
  libraryCaptures?: readonly ReferenceCandidate[];
  /** Produtos autorizados para uso editorial automático, na ordem de rodízio (menos usado primeiro). */
  editorialProducts?: readonly CatalogProductForPlan[];
  history: readonly VisualFingerprint[];
  allowAi: boolean;
  explicitMode?: VisualMode;
};

export type PlannedScreen = { screen: PlanScreen; spec: CreativeSpec; instruction: string; transmitted: ClassifiedReference[] };

export type EditorialCreativePlan = {
  decision: VisualIntentDecision;
  references: ClassifiedReference[];
  resolved: ResolvedReferences;
  /** O que o planejador acrescentou sozinho (com motivo) — aparece no rastreamento e na tela. */
  autoSelected: Array<{ id: string; reason: string }>;
  screens: PlannedScreen[];
  blocked: boolean;
};

/** Telas da pauta: roteiro do carrossel, ou a arte única (texto exato do prompt criativo, senão a mensagem). */
export function screensForIdea(idea: EditorialIdeaForPlan): PlanScreen[] {
  if (idea.format === "carousel" && idea.carouselScript?.length) return idea.carouselScript.map((slide) => ({ headline: slide.headline, ...(slide.body ? { body: slide.body } : {}) }));
  const rule = idea.creativePrompt?.match(/TEXTO EXATO DA (?:CAPA\/ARTE|ARTE)\s*:\s*['“"]([^\r\n'”"]+)['”"]/i);
  const lines = idea.keyMessage.trim().split(/\r?\n\s*\r?\n/);
  const headline = rule?.[1] || lines[0] || idea.title;
  const body = (headline === lines[0] ? lines.slice(1) : lines).join("\n").trim();
  return [{ headline, ...(body ? { body } : {}), ...(idea.cta ? { cta: idea.cta } : {}) }];
}

export function planEditorialCreative(input: PlanEditorialCreativeInput): EditorialCreativePlan {
  const autoSelected: EditorialCreativePlan["autoSelected"] = [];
  let references = input.ideaReferences.map((candidate) => classifyReference(candidate, input.businessKind));
  let decision = classifyVisualIntent({ businessKind: input.businessKind, idea: { ...input.idea, objective: input.idea.commercialObjective }, references, explicitMode: input.explicitMode, softwareFeatures: input.softwareFeatures });

  if (decision.mode === "software" && !references.some((reference) => reference.role === "software_capture")) {
    const keywords = decision.feature?.feature.keywords;
    const pool = (input.libraryCaptures ?? []).map((candidate) => classifyReference(candidate, input.businessKind)).filter((reference) => reference.role === "software_capture");
    const resolvedPool = resolveReferencesForMode("software", pool, { featureKeywords: keywords, ideaText: ideaText(input.idea) });
    if (resolvedPool.primary) {
      references = [...references, resolvedPool.primary, ...resolvedPool.variants];
      autoSelected.push({ id: resolvedPool.primary.id, reason: `Captura real da Biblioteca escolhida para "${decision.feature?.feature.label ?? "a funcionalidade da pauta"}".` });
    }
  }

  let themeGap: string[] | undefined;
  if (decision.mode === "physical_product" && !references.some((reference) => reference.role === "product_photo" || reference.role === "product_variant")) {
    const usable = (input.editorialProducts ?? []).filter((item) => item.photos.some((photo) => (photo.siteCaptureScore ?? 0) < 0.62));
    const product = rankProductsForIdea(usable, input.idea)[0];
    if (product) {
      const photos = product.photos.filter((photo) => (photo.siteCaptureScore ?? 0) < 0.62).slice(0, 3);
      const added = photos.map((photo, index) => classifyReference({ id: photo.id, source: "catalog", productCode: product.code, variantLabel: photo.variantLabel, ...(index === 0 ? {} : { explicitRole: "product_variant" }), siteCaptureScore: photo.siteCaptureScore, ...(photo.photoKind ? { photoKind: photo.photoKind } : {}) }, input.businessKind));
      references = [...references, ...added];
      const matched = matchedProductThemes(product.themes, ideaText(input.idea));
      autoSelected.push({ id: added[0].id, reason: matched.length
        ? `A pauta não indicou o produto: modelo ${product.code} escolhido porque a estampa combina com o assunto (${matched.map((theme) => theme.replace(/\*$/, "")).join(", ")}).`
        : `A pauta não indicou o produto: modelo ${product.code} escolhido no rodízio dos produtos liberados para uso editorial.` });
    } else {
      // A pauta pede uma ocasião (academia, praia…) que nenhuma peça liberada atende: não força uma peça qualquer.
      const demands = themeDemands(ideaText(input.idea));
      if (demands.length && usable.length) themeGap = demands.map((demand) => demand.label);
    }
  }

  decision = classifyVisualIntent({ businessKind: input.businessKind, idea: { ...input.idea, objective: input.idea.commercialObjective }, references, explicitMode: input.explicitMode ?? decision.mode, softwareFeatures: input.softwareFeatures });
  const primaryProduct = references.find((reference) => reference.role === "product_photo")?.productCode;
  const resolved = resolveReferencesForMode(decision.mode, references, {
    productCode: primaryProduct, featureKeywords: decision.feature?.feature.keywords, featureLabel: decision.feature?.feature.label, ideaText: ideaText(input.idea),
  });
  if (themeGap) {
    resolved.missing = [
      ...resolved.missing.filter((item) => item.code !== "PRODUCT_PHOTO_MISSING"),
      { code: "PRODUCT_THEME_MISMATCH", blocking: true, message: `A pauta fala de ${themeGap.join(" e ")}, e nenhuma peça liberada para uso editorial combina com esse tema. Escolha a peça na pauta ou libere no catálogo um produto desse tema.` },
    ];
  }

  const screens = screensForIdea(input.idea);
  const seriesKey = screens.length > 1 ? `ideia:${input.idea.id}` : undefined;
  const used: string[] = [];
  // Software em carrossel: cada tela usa a captura da funcionalidade que mais combina com o próprio
  // texto (ex.: "a transcrição mostra…" → tela de transcrição), em vez de repetir a mesma tela.
  const featureCaptures = decision.mode === "software"
    ? [...references, ...(input.libraryCaptures ?? []).map((candidate) => classifyReference(candidate, input.businessKind))]
      .filter((reference, index, all) => reference.role === "software_capture" && reference.form !== "mobile" && all.findIndex((other) => other.id === reference.id) === index
        && (!decision.feature || captureFeatureScore(reference, decision.feature.feature.keywords) > 0))
    : [];
  const resolvedFor = (screen: PlanScreen): ResolvedReferences => {
    if (screens.length < 2 || featureCaptures.length < 2 || !resolved.primary) return resolved;
    const words = ideaText({ title: `${screen.headline} ${screen.body ?? ""}` }).split(/[^a-z0-9]+/).filter((word) => word.length > 4);
    const best = [...featureCaptures].sort((a, b) => captureFeatureScore(b, words) - captureFeatureScore(a, words))[0];
    if (!best || captureFeatureScore(best, words) === 0 || best.id === resolved.primary.id) return resolved;
    return { ...resolved, primary: best, transmitted: [best, ...resolved.transmitted.filter((reference) => reference.id !== resolved.primary!.id)] };
  };
  const planned = screens.map((screen, index) => {
    const screenReferences = resolvedFor(screen);
    // Carrossel conceitual: imagem gerada na capa e na 2ª tela; as demais tipográficas (tempo de geração dentro
    // da janela do horário e unidade da série).
    const allowAi = input.allowAi && !(decision.mode === "conceptual" && index >= 2);
    // Carrossel: cada tela com composição diferente (sem repetir a anterior); esgotou, recomeça.
    const spec = buildCreativeSpec({
      workspaceId: input.workspaceId, brand: { name: input.brandName, identity: input.brandIdentity, presentation: input.presentation }, idea: { ...input.idea, objective: input.idea.commercialObjective }, screen,
      decision, references: screenReferences, history: input.history, allowAi, seriesKey, excludeArchetypes: used,
    });
    if (used.includes(spec.composition.archetype)) used.length = 0;
    used.push(spec.composition.archetype);
    return { screen, spec, instruction: buildImageInstruction(spec, screenReferences.transmitted), transmitted: screenReferences.transmitted };
  });
  return { decision, references, resolved, autoSelected, screens: planned, blocked: resolved.missing.some((item) => item.blocking) };
}

/**
 * Ordem de rodízio dos produtos liberados para pauta automática: nunca usado primeiro, depois o usado
 * há mais tempo. `previous` vem do mais recente para o mais antigo, com os códigos usados em cada peça.
 * Correção da auditoria (25/11/2026): a ordem anterior colocava o ÚLTIMO usado na frente — a CMKV
 * repetia sempre a mesma estampa.
 */
export function rotationOrder(codes: readonly string[], previous: ReadonlyArray<{ codes?: readonly string[] | null }>): string[] {
  const lastSlot = (code: string) => {
    const index = previous.findIndex((item) => item.codes?.includes(code));
    return index === -1 ? Infinity : index;
  };
  return [...codes].sort((a, b) => (lastSlot(a) === lastSlot(b) ? a.localeCompare(b) : lastSlot(a) > lastSlot(b) ? -1 : 1));
}
