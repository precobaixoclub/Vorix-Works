import type { BriefingFieldValue, BriefingReadiness, BriefingSchema } from "../../domain/briefing/briefing.model.js";
import { buildKnownValuesMap, isFieldApplicable, isFieldResolved, needsConfirmation } from "./field-state.js";

/**
 * `BriefingReadinessEvaluator` — Sprint 07 (Fase 7). `isReadyForConfirmation` é SEMPRE calculado
 * a partir dos critérios explícitos (campos obrigatórios válidos, ambiguidades bloqueantes
 * resolvidas, sugestões externas obrigatórias confirmadas) — `readinessScore` é só informativo,
 * nunca a base da decisão (exigência explícita da Sprint 07B).
 */
export function evaluateBriefingReadiness(
  schema: BriefingSchema,
  currentValues: ReadonlyMap<string, BriefingFieldValue>,
  isConfirmed: boolean,
): BriefingReadiness {
  const known = buildKnownValuesMap(currentValues);
  const applicableFields = schema.fields.filter((field) => isFieldApplicable(field, known));
  const requiredFields = applicableFields.map((field) => field.key);

  const missingRequiredFields: string[] = [];
  const invalidFields: string[] = [];
  const ambiguousFields: string[] = [];
  const unconfirmedSuggestedFields: string[] = [];

  for (const field of applicableFields) {
    const value = currentValues.get(field.key);
    if (!value) {
      missingRequiredFields.push(field.key);
      continue;
    }
    if (value.ambiguityStatus === "ambiguous") {
      ambiguousFields.push(field.key);
      continue;
    }
    if (!isValidAgainstDefinition(value.normalizedValue, field.validation)) {
      invalidFields.push(field.key);
      continue;
    }
    if (needsConfirmation(field, value) && !value.confirmedByUser) {
      unconfirmedSuggestedFields.push(field.key);
      continue;
    }
    if (!isFieldResolved(field, value)) {
      missingRequiredFields.push(field.key);
    }
  }

  const optionalHighImpactFields = schema.fields
    .filter((field) => field.highImpact && !isFieldApplicable(field, known))
    .filter((field) => !isFieldResolved(field, currentValues.get(field.key)))
    .map((field) => field.key);

  const isReadyForConfirmation =
    missingRequiredFields.length === 0 && invalidFields.length === 0 && ambiguousFields.length === 0 && unconfirmedSuggestedFields.length === 0;

  const totalConsidered = requiredFields.length || 1;
  const resolvedCount = requiredFields.length - missingRequiredFields.length - invalidFields.length - ambiguousFields.length - unconfirmedSuggestedFields.length;
  const readinessScore = Math.max(0, Math.min(1, resolvedCount / totalConsidered));

  return {
    isReadyForConfirmation,
    isConfirmed,
    requiredFields,
    missingRequiredFields,
    invalidFields,
    ambiguousFields,
    unconfirmedSuggestedFields,
    optionalHighImpactFields,
    readinessScore,
    reason: describeReason({ isReadyForConfirmation, isConfirmed, missingRequiredFields, invalidFields, ambiguousFields, unconfirmedSuggestedFields }),
  };
}

function isValidAgainstDefinition(normalizedValue: string, validation: { pattern?: string; minLength?: number; maxLength?: number } | undefined): boolean {
  if (!validation) return true;
  if (validation.minLength !== undefined && normalizedValue.length < validation.minLength) return false;
  if (validation.maxLength !== undefined && normalizedValue.length > validation.maxLength) return false;
  if (validation.pattern !== undefined && !new RegExp(validation.pattern).test(normalizedValue)) return false;
  return true;
}

function describeReason(state: {
  isReadyForConfirmation: boolean;
  isConfirmed: boolean;
  missingRequiredFields: readonly string[];
  invalidFields: readonly string[];
  ambiguousFields: readonly string[];
  unconfirmedSuggestedFields: readonly string[];
}): string {
  if (state.isConfirmed) return "Briefing já confirmado pelo usuário.";
  if (state.isReadyForConfirmation) return "Todos os campos obrigatórios estão válidos, sem ambiguidades ou sugestões pendentes de confirmação.";
  const reasons: string[] = [];
  if (state.missingRequiredFields.length > 0) reasons.push(`campos obrigatórios ausentes: ${state.missingRequiredFields.join(", ")}`);
  if (state.invalidFields.length > 0) reasons.push(`campos inválidos: ${state.invalidFields.join(", ")}`);
  if (state.ambiguousFields.length > 0) reasons.push(`campos ambíguos: ${state.ambiguousFields.join(", ")}`);
  if (state.unconfirmedSuggestedFields.length > 0) reasons.push(`sugestões aguardando confirmação: ${state.unconfirmedSuggestedFields.join(", ")}`);
  return `Não pronto para confirmação — ${reasons.join("; ")}.`;
}
