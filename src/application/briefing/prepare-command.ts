import type { Briefing, BriefingFieldValue, BriefingSchema, BriefingSource } from "../../domain/briefing/briefing.model.js";
import type { UserIntentType } from "../../domain/conversation/conversation.model.js";
import type { CreatePreparedCommandInput } from "../ports/prepared-command-repository.port.js";
import { isFieldApplicable, needsConfirmation } from "./field-state.js";

/**
 * Monta o `CreatePreparedCommandInput` a partir do estado atual do Briefing — Sprint 07 (Fase 9).
 * Só deve ser chamado depois que `BriefingReadinessEvaluator.isReadyForConfirmation` for `true` E
 * a confirmação explícita do usuário já tiver acontecido (`ConfirmBriefing`); esta função em si
 * não valida nada — é pura transformação de dados, a validação já aconteceu na Readiness.
 */
export function buildPreparedCommandInput(params: {
  briefing: Briefing;
  schema: BriefingSchema;
  currentValues: ReadonlyMap<string, BriefingFieldValue>;
  intent: UserIntentType;
}): CreatePreparedCommandInput {
  const { briefing, schema, currentValues, intent } = params;
  const known = buildKnown(currentValues);

  const validatedInputs: Record<string, string> = {};
  const sourceReferences: Record<string, BriefingSource> = {};
  const unresolvedOptionalFields: string[] = [];

  for (const field of schema.fields) {
    const value = currentValues.get(field.key);
    const resolved = value && value.ambiguityStatus !== "ambiguous" && (!needsConfirmation(field, value) || value.confirmedByUser);

    if (resolved && value) {
      validatedInputs[field.key] = value.value;
      sourceReferences[field.key] = value.source;
      continue;
    }

    if (!isFieldApplicable(field, known)) {
      unresolvedOptionalFields.push(field.key);
    }
  }

  return {
    tenantId: briefing.tenantId,
    workspaceId: briefing.workspaceId,
    conversationId: briefing.conversationId,
    briefingId: briefing.id,
    briefingRevision: briefing.revision,
    type: briefing.type,
    intent,
    validatedInputs,
    sourceReferences,
    unresolvedOptionalFields,
  };
}

function buildKnown(currentValues: ReadonlyMap<string, BriefingFieldValue>): Record<string, string> {
  const known: Record<string, string> = {};
  for (const [fieldKey, value] of currentValues) {
    if (value.ambiguityStatus === "ambiguous") continue;
    known[fieldKey] = value.normalizedValue;
  }
  return known;
}
