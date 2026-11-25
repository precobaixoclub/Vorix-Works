import type { CompositionOperation, CreativeSpec } from "./creative-spec.js";
import type { VarietyAssessment } from "./visual-variety.js";

/**
 * Quality Gate de fidelidade — compara briefing, referências e resultado final, por modo.
 *
 * Achado da auditoria (25/11/2026): a verificação do piloto media só contraste do texto, rosto
 * coberto e logo. Uma arte com cabides vazios (sem a camiseta anunciada) ou um monitor com painel
 * genérico passava, porque as cores e o tamanho estavam certos. Regra deste módulo: aprovação de
 * paleta/tamanho NUNCA compensa falha de fidelidade — qualquer falha reprova a peça, com motivo.
 *
 * As medições vêm da infraestrutura (`measure-fidelity.ts`: dHash e ΔE da região do produto,
 * proveniência da composição, vazio da tela, legibilidade) e, quando disponível, de uma revisão
 * visual por IA. Este módulo só decide — é puro e testável.
 */

export type GateCode =
  // produto físico
  | "PRODUCT_MISSING" | "PRODUCT_MISMATCH" | "PRINT_ALTERED" | "COLOR_MISMATCH" | "VARIANT_WRONG"
  | "REFERENCE_IGNORED" | "SITE_CAPTURE_AS_PRODUCT" | "PRODUCT_CROPPED" | "PRODUCT_TOO_SMALL" | "CUTOUT_ARTIFACT" | "FIDELITY_INCONCLUSIVE"
  // software
  | "UI_MISSING" | "SCREEN_EMPTY" | "UI_FICTIONAL" | "UI_ILLEGIBLE" | "FEATURE_MISMATCH"
  // todos
  | "TEXT_ILLEGIBLE" | "TEXT_OVERFLOW" | "TEXT_OVER_PRODUCT" | "MARGIN" | "LOGO" | "REPETITION" | "REFERENCE_MISSING" | "AI_REVIEW_REJECTED"
  | "BRAND_PALETTE_MISMATCH" | "VISUAL_DIRECTION_MISMATCH" | "SCENE_REVIEW_INCONCLUSIVE";

export type GateFinding = { code: GateCode; message: string };

export type ProductEvidence = {
  /** O produto entrou na arte como pixels da foto original (composição controlada). */
  composited: boolean;
  /** Distância dHash (0–64) entre o recorte do produto na arte e a foto original. */
  shapeDistance?: number;
  /** ΔE (CIE76) entre a cor dominante do produto na arte e a da foto original. */
  colorDeltaE?: number;
  /** Distância dHash (0–64) da região da estampa. */
  printDistance?: number;
  /** Fração da arte ocupada pelo produto. */
  coverage?: number;
  /** O produto encosta na borda da arte (corte indevido). */
  touchesEdge?: boolean;
  /** Código/variante efetivamente usados vs. anunciados. */
  usedProductCode?: string;
  usedVariant?: string;
  /** A imagem usada como produto foi detectada como captura de tela/site. */
  sourceLooksLikeCapture?: boolean;
  /** Recorte usado na composição e sua qualidade (buracos, fragmentos, halo, bloco de fundo). */
  cutout?: { used: boolean; ok: boolean; reasons: string[] };
};

export type ScreenEvidence = {
  /** A captura real foi inserida por composição (prova de proveniência). */
  composited: boolean;
  captureId?: string;
  /** Desvio-padrão de luminância (0–1) dentro da tela. */
  luminanceStd?: number;
  /** Densidade de bordas (0–1) dentro da tela — interface tem muitas. */
  edgeDensity?: number;
  /** Escala da captura na arte (px da arte por px da captura). */
  legibilityScale?: number;
  /** Altura aproximada (px na arte) de uma linha de texto da interface. */
  renderedTextPx?: number;
  /** Funcionalidade da captura usada vs. a do briefing. */
  captureFeature?: string;
};

export type TextEvidence = { contrast?: number; issues?: string[]; overflow?: boolean; marginOk?: boolean; coversProduct?: boolean };

export type AiReviewEvidence = { verdict: "approve" | "reject" | "unavailable"; findings?: GateFinding[] };

export type GateEvidence = {
  operation: CompositionOperation;
  transmittedReferenceIds: string[];
  product?: ProductEvidence;
  screen?: ScreenEvidence;
  text?: TextEvidence;
  logo?: { ok: boolean; warnings?: string[] };
  variety?: VarietyAssessment;
  aiReview?: AiReviewEvidence;
  scene?: { paletteIssue?: string; reviewRequired: boolean; review?: AiReviewEvidence };
};

export type GateResult = {
  approved: boolean;
  failures: GateFinding[];
  passes: string[];
  warnings: string[];
};

/** Limites — conservadores: na dúvida, reprova e corrige (composição controlada é barata). */
export const FIDELITY_LIMITS = {
  maxShapeDistance: 14,
  maxPrintDistance: 16,
  maxColorDeltaE: 18,
  minProductCoverage: 0.12,
  minScreenLuminanceStd: 0.04,
  minScreenEdgeDensity: 0.035,
  minRenderedTextPx: 7,
  minTextContrast: 4.5,
} as const;

export function evaluateFidelityGate(spec: Pick<CreativeSpec, "mode" | "subject" | "requiredReferences" | "blockers">, evidence: GateEvidence): GateResult {
  const failures: GateFinding[] = [];
  const passes: string[] = [];
  const warnings: string[] = [];
  const fail = (code: GateCode, message: string) => failures.push({ code, message });

  for (const blocker of spec.blockers) fail("REFERENCE_MISSING", blocker.message);

  const required = spec.requiredReferences.map((reference) => reference.id);
  const primaryId = required[0];
  if (primaryId && !evidence.transmittedReferenceIds.includes(primaryId) && !(evidence.product?.composited || evidence.screen?.composited)) {
    fail("REFERENCE_IGNORED", "A referência principal selecionada não foi enviada ao gerador nem composta na arte.");
  } else if (primaryId) {
    passes.push("Referência principal efetivamente usada (enviada ao gerador ou composta).");
  }

  if (spec.mode === "physical_product") {
    const product = evidence.product;
    if (!product) {
      fail("PRODUCT_MISSING", "Não há evidência do produto anunciado na arte.");
    } else {
      if (product.sourceLooksLikeCapture) fail("SITE_CAPTURE_AS_PRODUCT", "A imagem usada como produto é uma captura de site/catálogo, não a fotografia original.");
      const expected = spec.subject.kind === "product" ? spec.subject : undefined;
      if (expected?.productCode && product.usedProductCode && product.usedProductCode !== expected.productCode) fail("PRODUCT_MISMATCH", `Produto ${product.usedProductCode} usado no lugar de ${expected.productCode}.`);
      if (expected?.variant && product.usedVariant && product.usedVariant !== expected.variant) fail("VARIANT_WRONG", `Variante ${product.usedVariant} usada no lugar de ${expected.variant}.`);
      if (product.composited) {
        if (product.cutout?.used && !product.cutout.ok) {
          fail("CUTOUT_ARTIFACT", `Recorte do produto com artefato: ${product.cutout.reasons.join("; ") || "qualidade insuficiente"}.`);
        } else {
          passes.push(product.cutout?.used ? "Produto recortado da fotografia original sem artefatos (fidelidade por construção)." : "Produto com a fotografia original inteira, sem recorte (fidelidade por construção).");
        }
      } else {
        // Produto gerado pela IA: sem a revisão visual contra a foto original, a fidelidade não está
        // comprovada — inconclusivo reprova (o caminho seguro é recompor com a foto original).
        if (!evidence.aiReview || evidence.aiReview.verdict === "unavailable") {
          fail("FIDELITY_INCONCLUSIVE", "Produto gerado pela IA sem revisão visual contra a fotografia original — fidelidade não comprovada.");
        }
        // Com revisão visual (elemento por elemento) a forma e a estampa são julgadas por ela: as distâncias
        // de pixel variam de propósito com pose, corpo e enquadramento (achado de 25/11/2026: close-up com a
        // estampa idêntica reprovava por "forma"). Sem revisão, as distâncias decidem. A cor medida é sempre regra.
        const reviewed = evidence.aiReview?.verdict === "approve" || evidence.aiReview?.verdict === "reject";
        const shapeOrPrint = (code: GateCode, message: string) => (reviewed ? warnings.push(`${message} (pose/enquadramento — decidido pela revisão visual)`) : fail(code, message));
        if (product.shapeDistance === undefined || product.colorDeltaE === undefined) {
          fail("REFERENCE_IGNORED", "Sem medição de fidelidade para um produto gerado pela IA — não é possível comprovar que é o mesmo.");
        } else {
          if (product.shapeDistance > FIDELITY_LIMITS.maxShapeDistance) shapeOrPrint("PRODUCT_MISMATCH", `Forma do produto diferente da foto original (distância ${product.shapeDistance}/64)`);
          if (product.colorDeltaE > FIDELITY_LIMITS.maxColorDeltaE) fail("COLOR_MISMATCH", `Cor comercial diferente da foto original (ΔE ${product.colorDeltaE.toFixed(1)}).`);
          else passes.push(`Cor do tecido igual à da foto original (ΔE ${product.colorDeltaE.toFixed(1)}).`);
        }
        if (product.printDistance !== undefined && product.printDistance > FIDELITY_LIMITS.maxPrintDistance) shapeOrPrint("PRINT_ALTERED", `Estampa com distância de pixel ${product.printDistance}/64 da original`);
        if (evidence.aiReview?.verdict === "approve") passes.push("Revisão visual elemento por elemento: mesma peça, mesma cor e mesma estampa da foto original.");
      }
      if (product.coverage !== undefined && product.coverage < FIDELITY_LIMITS.minProductCoverage) fail("PRODUCT_TOO_SMALL", `O produto ocupa só ${(product.coverage * 100).toFixed(0)}% da arte — não é o protagonista.`);
      if (product.touchesEdge) fail("PRODUCT_CROPPED", "O produto foi cortado pela borda da arte.");
    }
  }

  if (spec.mode === "software") {
    const screen = evidence.screen;
    if (!screen) {
      fail("UI_MISSING", "A interface obrigatória não aparece na arte.");
    } else {
      if (!screen.composited) fail("UI_FICTIONAL", "A tela não veio de uma captura real — interface gerada pela IA não representa o produto.");
      else passes.push("Interface composta a partir da captura real.");
      if ((screen.luminanceStd ?? 1) < FIDELITY_LIMITS.minScreenLuminanceStd && (screen.edgeDensity ?? 1) < FIDELITY_LIMITS.minScreenEdgeDensity) fail("SCREEN_EMPTY", "A tela do dispositivo está praticamente vazia.");
      if (screen.renderedTextPx !== undefined && screen.renderedTextPx < FIDELITY_LIMITS.minRenderedTextPx) fail("UI_ILLEGIBLE", `A captura ficou pequena demais para ler (texto ≈ ${screen.renderedTextPx.toFixed(1)} px).`);
      const expectedFeature = spec.subject.kind === "feature" ? spec.subject.key : undefined;
      if (expectedFeature && screen.captureFeature && screen.captureFeature !== expectedFeature) fail("FEATURE_MISMATCH", `A tela mostra "${screen.captureFeature}", mas a peça divulga "${expectedFeature}".`);
    }
  }

  if (evidence.scene?.paletteIssue) fail("BRAND_PALETTE_MISMATCH", evidence.scene.paletteIssue);
  if (evidence.scene?.reviewRequired) {
    const review = evidence.scene.review;
    if (review?.verdict === "approve") {
      passes.push("Cena revisada conforme a identidade da marca e a direção visual da pauta.");
    } else if (review?.verdict === "reject") {
      for (const finding of review.findings ?? [{ code: "VISUAL_DIRECTION_MISMATCH" as const, message: "A cena foi reprovada na revisão visual." }]) fail(finding.code, finding.message);
    } else {
      fail("SCENE_REVIEW_INCONCLUSIVE", "A aderência da cena à paleta e à direção visual precisa de revisão.");
    }
  }

  const text = evidence.text;
  if (text) {
    if (text.overflow) fail("TEXT_OVERFLOW", "O texto não coube na área segura.");
    if (text.contrast !== undefined && text.contrast < FIDELITY_LIMITS.minTextContrast) fail("TEXT_ILLEGIBLE", `Contraste do texto ${text.contrast.toFixed(2)}:1 (mínimo 4,5:1).`);
    if (text.coversProduct) fail("TEXT_OVER_PRODUCT", "O texto cobre o produto.");
    if (text.marginOk === false) fail("MARGIN", "Texto ou logo fora das margens seguras.");
    for (const issue of text.issues ?? []) fail("TEXT_ILLEGIBLE", issue);
    if (!failures.some((item) => item.code.startsWith("TEXT") || item.code === "MARGIN")) passes.push("Texto legível, dentro das margens e fora do produto.");
  }
  if (evidence.logo) {
    if (!evidence.logo.ok) fail("LOGO", "Logotipo oficial ausente ou ilegível.");
    warnings.push(...(evidence.logo.warnings ?? []));
  }
  if (evidence.variety && !evidence.variety.ok) {
    for (const finding of evidence.variety.findings) fail("REPETITION", finding.message);
  } else if (evidence.variety) {
    passes.push(`Diferente das ${evidence.variety.compared} peças recentes${evidence.variety.nearestDistance !== null ? ` (distância mínima ${evidence.variety.nearestDistance}/64)` : ""}.`);
  }
  if (evidence.aiReview?.verdict === "reject") {
    for (const finding of evidence.aiReview.findings ?? [{ code: "AI_REVIEW_REJECTED" as const, message: "Revisão visual por IA reprovou a peça." }]) fail(finding.code, finding.message);
  } else if (evidence.aiReview?.verdict === "unavailable" && evidence.operation !== "deterministic_composite" && evidence.operation !== "ai_scene_with_composite") {
    warnings.push("Revisão visual por IA indisponível — a fidelidade foi decidida só pelas medições determinísticas.");
  }

  return { approved: failures.length === 0, failures, passes, warnings };
}
