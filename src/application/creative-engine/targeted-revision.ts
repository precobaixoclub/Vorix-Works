import type { CompositionOperation } from "./creative-spec.js";
import type { GateCode, GateFinding } from "./creative-fidelity-gate.js";

/**
 * Revisão direcionada — quando o Quality Gate reprova, decide a CORREÇÃO pelo motivo, em vez de
 * repetir a mesma solicitação. Achado da auditoria (25/11/2026): o piloto refazia a geração inteira
 * com uma frase de correção genérica (no máximo 2 vezes), mesmo quando o defeito era de produto
 * alterado — que a IA tende a repetir. Aqui:
 * - produto alterado/ignorado → recompõe com a fotografia original (barato e fiel por construção);
 * - tela vazia/fictícia → insere a captura real;
 * - texto/margem → só recompõe o texto (não regenera a imagem);
 * - repetição → troca o arquétipo de composição;
 * - falta de referência ou limites estourados → revisão manual. Nunca marca como pronta.
 */

export type RevisionActionKind =
  | "switch_to_controlled_composite"
  | "insert_real_capture"
  | "enlarge_capture"
  | "recompose_text"
  | "switch_archetype"
  | "replace_logo_variant"
  | "regenerate_scene_with_correction"
  | "manual_review";

export type RevisionPlan = {
  action: RevisionActionKind;
  reason: string;
  /** Instrução curta e específica para a próxima tentativa (quando houver IA envolvida). */
  correction?: string;
  /** Custo estimado da próxima tentativa (US$); 0 para composição controlada. */
  estimatedCostUsd: number;
};

export type RevisionInput = {
  failures: readonly GateFinding[];
  operation: CompositionOperation;
  attempt: number;
  maxAttempts: number;
  spentUsd: number;
  budgetUsd: number;
  /** Custo de uma nova geração por IA neste pipeline. */
  aiAttemptCostUsd: number;
};

const has = (failures: readonly GateFinding[], ...codes: GateCode[]) => failures.some((failure) => codes.includes(failure.code));

export function planRevision(input: RevisionInput): RevisionPlan {
  const { failures } = input;
  const reasons = failures.map((failure) => failure.message).join(" ");
  if (has(failures, "REFERENCE_MISSING")) {
    return { action: "manual_review", reason: `Falta material obrigatório — precisa de ação do usuário. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (input.attempt >= input.maxAttempts) {
    return { action: "manual_review", reason: `Limite de ${input.maxAttempts} tentativas atingido sem aprovação. ${reasons}`, estimatedCostUsd: 0 };
  }
  const usesAi = input.operation === "ai_edit_with_reference" || input.operation === "ai_generation" || input.operation === "ai_scene_with_composite";
  if (has(failures, "PRODUCT_MISMATCH", "PRINT_ALTERED", "COLOR_MISMATCH", "VARIANT_WRONG", "REFERENCE_IGNORED", "SITE_CAPTURE_AS_PRODUCT", "AI_REVIEW_REJECTED") && input.operation === "ai_edit_with_reference") {
    return { action: "switch_to_controlled_composite", reason: `A IA não preservou o produto — recompondo com a fotografia original. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (has(failures, "UI_FICTIONAL", "SCREEN_EMPTY", "UI_MISSING")) {
    return { action: "insert_real_capture", reason: `Interface ausente/fictícia — inserindo a captura real por composição. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (has(failures, "UI_ILLEGIBLE")) {
    return { action: "enlarge_capture", reason: `Captura pequena demais — usando enquadramento maior/recorte da funcionalidade. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (has(failures, "REPETITION")) {
    return { action: "switch_archetype", reason: `Composição repetida — trocando o arquétipo. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (has(failures, "PRODUCT_CROPPED", "PRODUCT_TOO_SMALL", "TEXT_OVER_PRODUCT", "TEXT_OVERFLOW", "TEXT_ILLEGIBLE", "MARGIN")) {
    return { action: "recompose_text", reason: `Ajuste de enquadramento/texto sem gerar nova imagem. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (has(failures, "LOGO")) {
    return { action: "replace_logo_variant", reason: `Logotipo inadequado — trocando a versão/tratamento. ${reasons}`, estimatedCostUsd: 0 };
  }
  if (usesAi) {
    if (input.spentUsd + input.aiAttemptCostUsd > input.budgetUsd) {
      return { action: "manual_review", reason: `Nova geração ultrapassaria o orçamento (US$ ${input.budgetUsd.toFixed(2)}). ${reasons}`, estimatedCostUsd: 0 };
    }
    return { action: "regenerate_scene_with_correction", reason: reasons, correction: failures.map((failure) => failure.message).join(" "), estimatedCostUsd: input.aiAttemptCostUsd };
  }
  return { action: "manual_review", reason: `Defeito sem correção automática segura. ${reasons}`, estimatedCostUsd: 0 };
}
