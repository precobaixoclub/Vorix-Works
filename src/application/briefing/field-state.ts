import type { BriefingCondition, BriefingFieldDefinition, BriefingFieldValue } from "../../domain/briefing/briefing.model.js";
import { evaluateBriefingCondition } from "../../domain/briefing/briefing.model.js";

/**
 * Seleção determinística do "valor atual" de cada campo a partir do histórico append-only
 * (Fase 3) — nunca depende só de timestamp. Compartilhado por Readiness, Question Planner e o
 * orquestrador de interpretação para nunca divergirem sobre "o que já é conhecido".
 */
export function selectCurrentFieldValues(allValues: readonly BriefingFieldValue[]): Map<string, BriefingFieldValue> {
  const current = new Map<string, BriefingFieldValue>();
  for (const value of allValues) {
    const existing = current.get(value.fieldKey);
    if (!existing || isNewer(value, existing)) {
      current.set(value.fieldKey, value);
    }
  }
  return current;
}

function isNewer(candidate: BriefingFieldValue, existing: BriefingFieldValue): boolean {
  if (candidate.revision !== existing.revision) return candidate.revision > existing.revision;
  if (candidate.createdAt !== existing.createdAt) return candidate.createdAt > existing.createdAt;
  return candidate.id > existing.id;
}

/** Mapa fieldKey -> normalizedValue para a DSL de `requiredWhen` — só entram valores resolvidos
 * (não ambíguos); um campo ambíguo conta como "ainda não conhecido" para fins de dependência. */
export function buildKnownValuesMap(current: ReadonlyMap<string, BriefingFieldValue>): Record<string, string> {
  const known: Record<string, string> = {};
  for (const [fieldKey, value] of current) {
    if (value.ambiguityStatus === "ambiguous") continue;
    known[fieldKey] = value.normalizedValue;
  }
  return known;
}

export function isFieldApplicable(field: BriefingFieldDefinition, known: Readonly<Record<string, string>>): boolean {
  if (field.required) return true;
  return field.requiredWhen ? evaluateCondition(field.requiredWhen, known) : false;
}

function evaluateCondition(condition: BriefingCondition, known: Readonly<Record<string, string>>): boolean {
  return evaluateBriefingCondition(condition, known);
}

/** Um campo está "resolvido" (não conta como faltante) quando existe um valor não ambíguo e, se a
 * política exigir confirmação para a fonte, `confirmedByUser` é true. */
export function isFieldResolved(field: BriefingFieldDefinition, value: BriefingFieldValue | undefined): boolean {
  if (!value) return false;
  if (value.ambiguityStatus === "ambiguous") return false;
  if (needsConfirmation(field, value) && !value.confirmedByUser) return false;
  return true;
}

export function needsConfirmation(field: BriefingFieldDefinition, value: BriefingFieldValue): boolean {
  if (field.confirmationPolicy === "never_required") return false;
  if (field.confirmationPolicy === "always_required") return true;
  return value.source !== "user_message" && value.source !== "conversation_memory";
}
