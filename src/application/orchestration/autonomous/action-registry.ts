import type { ActionDefinition } from "./autonomous-types.js";
import { gapAnalysisAction } from "./actions/gap-analysis.action.js";
import { mediaCatalogAction } from "./actions/media-catalog.action.js";
import { footageAcquisitionAction } from "./actions/footage-acquisition.action.js";
import { visualValidationAction } from "./actions/visual-validation.action.js";
import { productScreenCatalogAction } from "./actions/product-screen-catalog.action.js";
import { productCompositingAction } from "./actions/product-compositing.action.js";
import { narrationRegenerationAction } from "./actions/narration-regeneration.action.js";
import { mockupGenerationAction } from "./actions/mockup-generation.action.js";

/**
 * ACTION REGISTRY (seção 2) — a lista completa de capacidades corretivas conhecidas. Cada
 * `ActionDefinition` já declara id/nome/quando-usável (`isApplicable`)/o-que-resolve
 * (`resolves`)/pré-requisitos/tempo-esperado/efeitos-colaterais/limitações — nada disso é
 * hardcoded dentro do `AutonomousExecutionEngine`, que só consome esta lista genericamente via
 * `selectActionsForBlocker`.
 */
export const ACTION_REGISTRY: ActionDefinition[] = [
  mediaCatalogAction,
  footageAcquisitionAction,
  visualValidationAction,
  productScreenCatalogAction,
  productCompositingAction,
  narrationRegenerationAction,
  mockupGenerationAction,
  gapAnalysisAction,
];

export {
  gapAnalysisAction,
  mediaCatalogAction,
  footageAcquisitionAction,
  visualValidationAction,
  productScreenCatalogAction,
  productCompositingAction,
  narrationRegenerationAction,
  mockupGenerationAction,
};
