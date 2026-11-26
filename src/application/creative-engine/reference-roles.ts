/**
 * Biblioteca de referências do motor criativo — cada arquivo tem UMA função na peça.
 *
 * Achado da auditoria (25/11/2026): o motor tratava toda imagem anexada como "referência da pauta",
 * sem papel. Resultado: logo virando referência de composição, captura do site no lugar da foto do
 * produto e nenhuma garantia de qual imagem era o produto principal. Aqui cada candidato recebe um
 * papel explícito e explicável (`roleReason`), e a resolução por modo decide o que é TRANSMITIDO ao
 * modelo, em que ordem, o que fica de fora (com motivo) e o que falta (com orientação ao usuário).
 *
 * Funções puras: quem chama já resolveu origem, metadados e sinais da imagem (ver
 * `infrastructure/media/creative/image-analysis.ts`, `siteCaptureScore`).
 */

export const REFERENCE_ROLES = [
  "product_photo",
  "product_variant",
  "logo",
  "style_reference",
  "software_capture",
  "past_creative",
  "site_capture",
  "inspiration",
  "background",
] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

export const REFERENCE_ROLE_LABELS: Record<ReferenceRole, string> = {
  product_photo: "Fotografia do produto",
  product_variant: "Variação do produto",
  logo: "Logotipo",
  style_reference: "Referência de estilo",
  software_capture: "Captura do software",
  past_creative: "Material publicitário anterior",
  site_capture: "Captura de site",
  inspiration: "Imagem de inspiração",
  background: "Imagem de fundo",
};

/** De onde o arquivo veio — determina a confiança do papel. */
export type ReferenceSource = "catalog" | "brand_library" | "idea_upload";

export type BusinessKind = "physical_products" | "software" | "services" | "unknown";

export type ReferenceCandidate = {
  /** Identificador estável e não sensível (id do asset, `produto:<código>:<cor>` ou hash da URL). */
  id: string;
  source: ReferenceSource;
  /** `AssetMaterialType` da Biblioteca da marca, quando houver. */
  materialType?: string;
  name?: string;
  tags?: readonly string[];
  /** Instruções/regra de uso cadastradas no material (palavras-chave da funcionalidade, etc.). */
  notes?: string;
  /** Produto do catálogo (código/SKU) e variante (ex.: cor) — só para `source: "catalog"`. */
  productCode?: string;
  variantLabel?: string;
  /** Papel escolhido explicitamente pelo usuário — vence a inferência, salvo captura de tela óbvia
   * marcada como foto de produto (ver `SITE_CAPTURE_THRESHOLD`). */
  explicitRole?: ReferenceRole;
  /** 0–1: quão "print de tela/site" a imagem parece (barras, grade de itens, texto de interface). */
  siteCaptureScore?: number;
  /** Cor medida na foto vs. nome da variante (catálogo) — `consistent: false` = foto de outra cor. */
  variantColorCheck?: { consistent: boolean; measured: string; expected: string; closest?: string };
  /** Captura de software: tela de desktop ou de celular. */
  form?: "desktop" | "mobile";
  /** Foto de produto: estúdio (fundo liso, recorte confiável) ou cena (o produto depende do ambiente). */
  photoKind?: "studio" | "scene";
};

export type ClassifiedReference = ReferenceCandidate & { role: ReferenceRole; roleReason: string };

/** Acima disto, a imagem é tratada como captura de tela mesmo que tenha sido marcada como produto. */
export const SITE_CAPTURE_THRESHOLD = 0.62;

const MATERIAL_ROLE: Record<string, ReferenceRole> = {
  logo_principal: "logo",
  logo_secundaria: "logo",
  icone: "logo",
  screenshot_app: "software_capture",
  produto: "product_photo",
  referencia_visual: "style_reference",
  campanha: "past_creative",
  fundo: "background",
  foto_institucional: "inspiration",
  selo: "inspiration",
  outro: "inspiration",
};

export function classifyReference(candidate: ReferenceCandidate, businessKind: BusinessKind): ClassifiedReference {
  const looksLikeCapture = (candidate.siteCaptureScore ?? 0) >= SITE_CAPTURE_THRESHOLD;
  const captureRole: ReferenceRole = businessKind === "software" ? "software_capture" : "site_capture";
  const result = (role: ReferenceRole, roleReason: string): ClassifiedReference => ({ ...candidate, role, roleReason });

  if (candidate.explicitRole) {
    if ((candidate.explicitRole === "product_photo" || candidate.explicitRole === "product_variant") && looksLikeCapture) {
      return result(captureRole, "Marcada como foto de produto, mas a imagem tem cara de captura de tela (barras, grade de itens, texto de interface) — não substitui a fotografia original.");
    }
    return result(candidate.explicitRole, "Papel escolhido explicitamente pelo usuário.");
  }
  if (candidate.source === "catalog") {
    if (looksLikeCapture) return result("site_capture", "Imagem do catálogo com cara de captura de tela — não é usada como fotografia do produto.");
    return candidate.variantLabel
      ? result("product_photo", `Fotografia original do produto ${candidate.productCode ?? ""} (${candidate.variantLabel}) no catálogo.`.replace(/\s+/g, " "))
      : result("product_photo", `Fotografia original do produto ${candidate.productCode ?? ""} no catálogo.`.replace(/\s+/g, " "));
  }
  if (candidate.materialType === "screenshot_site") {
    return businessKind === "software"
      ? result("software_capture", "Captura do site/sistema cadastrada na Biblioteca de uma marca de software.")
      : result("site_capture", "Captura do site da loja — mostra a vitrine, não substitui a fotografia do produto.");
  }
  const mapped = candidate.materialType ? MATERIAL_ROLE[candidate.materialType] : undefined;
  if (mapped) {
    if (mapped === "product_photo" && looksLikeCapture) return result(captureRole, "Cadastrada como produto, mas a imagem tem cara de captura de tela.");
    return result(mapped, `Tipo cadastrado na Biblioteca da marca: ${candidate.materialType}.`);
  }
  // Envio solto na pauta, sem tipo: só a aparência decide entre captura e inspiração. Nunca vira
  // "foto do produto" por suposição — a foto do produto precisa vir do catálogo ou ser marcada.
  if (looksLikeCapture) return result(captureRole, "Imagem enviada na pauta com cara de captura de tela.");
  return result("inspiration", "Imagem enviada na pauta sem tipo definido — usada como inspiração visual, nunca como o produto anunciado.");
}

export type ReferenceGuidance = {
  code: "PRODUCT_PHOTO_MISSING" | "PRODUCT_THEME_MISMATCH" | "SOFTWARE_CAPTURE_MISSING" | "SITE_CAPTURE_NOT_PRODUCT" | "VARIANT_PHOTO_MISSING" | "VARIANT_PHOTO_MISMATCH";
  blocking: boolean;
  message: string;
};

export type ExcludedReference = { reference: ClassifiedReference; reason: string };

export type ResolvedReferences = {
  /** O produto/tela principal da peça — a referência que manda. */
  primary?: ClassifiedReference;
  /** Variações reais do mesmo produto (outras cores), em ordem. */
  variants: ClassifiedReference[];
  logos: ClassifiedReference[];
  /** Referências complementares permitidas (estilo, inspiração, fundo) — nunca alteram o produto. */
  complementary: ClassifiedReference[];
  /** Exatamente o que vai para o modelo de imagem, na ordem: principal → variações → complementares. */
  transmitted: ClassifiedReference[];
  excluded: ExcludedReference[];
  missing: ReferenceGuidance[];
};

export type ResolveReferencesOptions = {
  /** Produto anunciado (código) quando a pauta/usuário escolheu um. */
  productCode?: string;
  /** Palavras da funcionalidade divulgada (modo software) para escolher a captura certa. */
  featureKeywords?: readonly string[];
  /** Nome legível da funcionalidade (usado só na orientação ao usuário). */
  featureLabel?: string;
  /** Texto da pauta (normalizado) — desempata capturas da mesma funcionalidade. */
  ideaText?: string;
  maxVariants?: number;
  maxComplementary?: number;
};

const normalizeText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pontuação de uma captura para uma funcionalidade: palavras da funcionalidade no nome/tags/notas. */
export function captureFeatureScore(reference: ReferenceCandidate, keywords: readonly string[] | undefined): number {
  if (!keywords?.length) return 0;
  const haystack = normalizeText([reference.name, ...(reference.tags ?? []), reference.notes].filter(Boolean).join(" "));
  return keywords.reduce((score, keyword) => score + (haystack.includes(normalizeText(keyword)) ? 1 : 0), 0);
}

export type VisualModeForReferences = "physical_product" | "software" | "conceptual";

export function resolveReferencesForMode(
  mode: VisualModeForReferences,
  references: readonly ClassifiedReference[],
  options: ResolveReferencesOptions = {},
): ResolvedReferences {
  const maxVariants = options.maxVariants ?? 2;
  const maxComplementary = options.maxComplementary ?? 2;
  const logos = references.filter((reference) => reference.role === "logo");
  const excluded: ExcludedReference[] = logos.map((reference) => ({
    reference,
    reason: "Logotipo não é referência de composição — é aplicado pelo renderizador, com o arquivo original.",
  }));
  const missing: ReferenceGuidance[] = [];
  const complementaryPool = references.filter((reference) => ["style_reference", "inspiration", "background"].includes(reference.role));

  if (mode === "physical_product") {
    // Foto cadastrada numa variante, mas mostrando outra cor: erro de catálogo — nunca anuncia a cor errada.
    for (const reference of references.filter((item) => item.variantColorCheck?.consistent === false)) {
      const seen = reference.variantColorCheck!.closest ?? reference.variantColorCheck!.measured;
      excluded.push({ reference, reason: `A foto da variante "${reference.variantLabel}" mostra outra cor (${seen}) — corrija a foto no catálogo.` });
      missing.push({ code: "VARIANT_PHOTO_MISMATCH", blocking: false, message: `A foto cadastrada para ${reference.productCode ?? "o produto"} "${reference.variantLabel}" parece ser de outra cor (${seen}). Ela não foi usada; corrija a foto dessa variante no catálogo.` });
    }
    const products = references.filter((reference) => (reference.role === "product_photo" || reference.role === "product_variant") && reference.variantColorCheck?.consistent !== false);
    // A variante que o usuário escolheu como principal está com a foto errada: não troca em silêncio por
    // outra cor (a peça anunciaria uma cor e mostraria outra) — bloqueia até corrigir o catálogo.
    const chosenPrimary = references.find((reference) => reference.role === "product_photo");
    if (chosenPrimary?.variantColorCheck?.consistent === false) {
      missing.push({ code: "VARIANT_PHOTO_MISMATCH", blocking: true, message: `A variante anunciada ("${chosenPrimary.variantLabel}") está com a foto de outra cor no catálogo. Corrija a foto ou escolha outra variante antes de gerar.` });
    }
    const ofProduct = options.productCode ? products.filter((reference) => reference.productCode === options.productCode) : products;
    for (const reference of products.filter((item) => !ofProduct.includes(item))) {
      excluded.push({ reference, reason: `Foto de outro produto (${reference.productCode ?? "sem código"}) — a peça anuncia ${options.productCode}.` });
    }
    const primary = ofProduct.find((reference) => reference.role === "product_photo") ?? ofProduct[0];
    const sameProduct = primary?.productCode ? ofProduct.filter((reference) => reference !== primary && reference.productCode === primary.productCode) : ofProduct.filter((reference) => reference !== primary);
    const variants = sameProduct.slice(0, maxVariants);
    for (const reference of references.filter((item) => item.role === "site_capture" || item.role === "software_capture")) {
      excluded.push({ reference, reason: "Captura de tela/site não substitui a fotografia original do produto." });
    }
    for (const reference of references.filter((item) => item.role === "past_creative")) {
      excluded.push({ reference, reason: "Peça publicitária anterior não entra como referência do produto (evita repetir a composição)." });
    }
    if (!primary) {
      const hadCapture = references.some((item) => item.role === "site_capture");
      missing.push({
        code: hadCapture ? "SITE_CAPTURE_NOT_PRODUCT" : "PRODUCT_PHOTO_MISSING",
        blocking: true,
        message: hadCapture
          ? "A pauta só tem captura do site/catálogo. Selecione o produto no catálogo ou anexe a fotografia original da peça — a captura não é usada no lugar do produto."
          : "Esta peça anuncia um produto, mas nenhuma fotografia original foi selecionada. Escolha o produto no catálogo ou anexe a foto original dele.",
      });
    }
    const complementary = complementaryPool.slice(0, maxComplementary);
    return { primary, variants, logos, complementary, transmitted: [...(primary ? [primary] : []), ...variants, ...complementary], excluded, missing };
  }

  if (mode === "software") {
    const captures = references.filter((reference) => reference.role === "software_capture");
    const ideaWords = (options.ideaText ?? "").split(/[^a-z0-9]+/).filter((word) => word.length > 4);
    // A funcionalidade decide o grupo; as palavras da pauta decidem qual tela dele (ex.: calendário x bolsão).
    const score = (reference: ClassifiedReference) => Math.min(1, captureFeatureScore(reference, options.featureKeywords)) * 10 + captureFeatureScore(reference, ideaWords) + 0.1 * captureFeatureScore(reference, options.featureKeywords) + (reference.form === "mobile" ? -0.25 : 0);
    const ranked = [...captures].sort((a, b) => score(b) - score(a));
    const primary = options.featureKeywords?.length ? ranked.find((reference) => captureFeatureScore(reference, options.featureKeywords) > 0) : ranked[0];
    // Mesma funcionalidade em outro formato (ex.: a conversa no celular) — para o arquétipo de celular.
    const variants = primary ? ranked.filter((reference) => reference !== primary && reference.form && reference.form !== primary.form && captureFeatureScore(reference, options.featureKeywords) > 0).slice(0, 1) : [];
    for (const reference of captures.filter((item) => item !== primary && !variants.includes(item))) {
      excluded.push({ reference, reason: "Captura de outra funcionalidade (ou menos específica) — a peça mostra só a tela divulgada." });
    }
    if (!primary) {
      missing.push({
        code: "SOFTWARE_CAPTURE_MISSING",
        blocking: true,
        message: `Para demonstrar ${options.featureLabel ? `"${options.featureLabel}"` : "esta funcionalidade"} é preciso uma captura real da tela. Cadastre na Biblioteca da marca (tipo "Captura do aplicativo") uma imagem da tela correspondente — a IA não inventa a interface.`,
      });
    }
    const complementary = complementaryPool.slice(0, maxComplementary);
    return { primary, variants, logos, complementary, transmitted: [...(primary ? [primary] : []), ...variants, ...complementary], excluded, missing };
  }

  // Conceitual: liberdade visual, mas nada de produto/tela "parecido" — referências de produto, se
  // houver, não são trocadas por inspiração silenciosamente (ver classifyVisualIntent).
  const complementary = references.filter((reference) => ["style_reference", "inspiration", "background", "product_photo", "product_variant"].includes(reference.role)).slice(0, Math.max(maxComplementary, 4));
  for (const reference of references.filter((item) => item.role === "site_capture" || item.role === "past_creative" || item.role === "software_capture")) {
    excluded.push({ reference, reason: "Captura/peça anterior não orienta uma campanha conceitual." });
  }
  return { primary: undefined, variants: [], logos, complementary, transmitted: complementary, excluded, missing };
}
