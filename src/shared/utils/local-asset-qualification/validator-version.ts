/**
 * Identifica qual versão do Visual Candidate Validator (reaproveitado, nunca duplicado) produziu
 * um resultado de validação — nunca um número inventado por asset, uma única constante real.
 * Atualizar manualmente só se `visual-candidate-validator.ts`/`pre-composition-simulator.ts`
 * mudarem de forma que invalide resultados antigos (nenhuma mudança nesta sprint).
 */
export const LOCAL_ASSET_VALIDATOR_VERSION = "footage-visual-validation-2.0+local-asset-qualification-1.0";
