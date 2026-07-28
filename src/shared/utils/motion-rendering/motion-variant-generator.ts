// Motion Variant Generator — a partir das instruções de render baseline (variante "A", produzida
// pelo Motion Render Pipeline), gera as variantes B e C. Nunca muda narrativa, preset, imagem,
// ordem ou duração — a ÚNICA coisa que varia entre A/B/C é `variantSeed` por cena, que
// `resolveSceneAnimationParameters` (motion-animation-parameters.ts) usa para gerar um jitter
// pequeno e determinístico nos parâmetros numéricos de movimento (ex.: intensidade do zoom).
//
// Determinístico: mesmo Motion Plan sempre produz as mesmas 3 variantes, sem `Math.random`.

import type { MotionRenderInstructions, MotionVariantId } from "../../../application/ports/motion-render-provider.port.js";
import { MOTION_VARIANT_IDS } from "../../../application/ports/motion-render-provider.port.js";

/** Deslocamento de seed por variante — arbitrário porém fixo, garante que B e C nunca coincidam com A nem entre si. */
const VARIANT_SEED_OFFSET: Record<MotionVariantId, number> = {
  A: 0,
  B: 1000,
  C: 2000,
};

export type GenerateVariantsOptions = {
  /** Quantas variantes gerar, na ordem A, B, C. Padrão: 3. */
  variantCount?: 1 | 2 | 3;
};

/**
 * Gera as variantes de render a partir da baseline. `baseline.variantId` é ignorado no resultado
 * (cada variante recebe seu próprio id A/B/C); o array de saída sempre começa em "A".
 */
export function generateMotionRenderVariants(baseline: MotionRenderInstructions, options: GenerateVariantsOptions = {}): MotionRenderInstructions[] {
  const variantCount = options.variantCount ?? 3;
  const variantIds = MOTION_VARIANT_IDS.slice(0, variantCount);

  return variantIds.map((variantId) => ({
    ...baseline,
    variantId,
    scenes: baseline.scenes.map((scene) => ({
      ...scene,
      variantSeed: scene.order + VARIANT_SEED_OFFSET[variantId],
    })),
  }));
}
