import type {
  Briefing,
  BriefingAnswerType,
  BriefingFieldValue,
  BriefingQuestion,
  BriefingReadiness,
  BriefingSchema,
  BriefingSource,
  BriefingStatus,
  BriefingType,
  PreparedCommand,
  PreparedCommandStatus,
} from "../../domain/briefing/briefing.model.js";
import { needsConfirmation } from "./field-state.js";

/**
 * DTOs de saída do domínio de Briefing — Sprint 07 (Fase 13/15). Deliberadamente mais estreitos
 * que os tipos de domínio: nunca expõem `confidence`/`matchedRule`/`ambiguityStatus` bruto,
 * `assetId`/`conversationEventId`/`questionId` de `BriefingFieldValue`, ou qualquer coisa que
 * revele as REGRAS internas de extração — só o necessário para a UI mostrar "o que já sei" e "o
 * que falta" (requisito de segurança da Sprint 07B). São também o contrato usado pelo script de
 * contract-drift (Fase 15) — mudar a forma aqui sem atualizar o frontend deve ser pego por ele.
 */
export type BriefingFieldSummaryDto = {
  fieldKey: string;
  label: string;
  value: string;
  source: BriefingSource;
  confirmedByUser: boolean;
  requiresConfirmation: boolean;
};

export type BriefingSummaryDto = {
  briefingId: string;
  type: BriefingType;
  status: BriefingStatus;
  revision: number;
  knownFields: readonly BriefingFieldSummaryDto[];
  missingRequiredFields: readonly string[];
  ambiguousFields: readonly string[];
  unconfirmedSuggestedFields: readonly string[];
};

export type BriefingQuestionDto = {
  id: string;
  text: string;
  reason: string;
  answerType: BriefingAnswerType;
  options?: readonly string[];
  fieldKeys: readonly string[];
};

export type PreparedCommandSummaryDto = {
  id: string;
  type: BriefingType;
  briefingRevision: number;
  status: PreparedCommandStatus;
  fieldCount: number;
  unresolvedOptionalFieldCount: number;
};

export function toBriefingSummaryDto(
  schema: BriefingSchema,
  briefing: Briefing,
  currentValues: ReadonlyMap<string, BriefingFieldValue>,
  readiness: BriefingReadiness,
): BriefingSummaryDto {
  const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field] as const));

  const knownFields: BriefingFieldSummaryDto[] = [...currentValues.values()]
    .filter((value) => value.ambiguityStatus !== "ambiguous")
    .map((value) => {
      const field = fieldsByKey.get(value.fieldKey);
      return {
        fieldKey: value.fieldKey,
        label: field?.label ?? value.fieldKey,
        value: value.value,
        source: value.source,
        confirmedByUser: value.confirmedByUser,
        requiresConfirmation: field ? needsConfirmation(field, value) : false,
      };
    });

  return {
    briefingId: briefing.id,
    type: briefing.type,
    status: briefing.status,
    revision: briefing.revision,
    knownFields,
    missingRequiredFields: readiness.missingRequiredFields,
    ambiguousFields: readiness.ambiguousFields,
    unconfirmedSuggestedFields: readiness.unconfirmedSuggestedFields,
  };
}

export function toBriefingQuestionDto(question: BriefingQuestion): BriefingQuestionDto {
  return {
    id: question.id,
    text: question.text,
    reason: question.reason,
    answerType: question.answerType,
    options: question.options,
    fieldKeys: question.fieldKeys,
  };
}

export function toPreparedCommandSummaryDto(command: PreparedCommand): PreparedCommandSummaryDto {
  return {
    id: command.id,
    type: command.type,
    briefingRevision: command.briefingRevision,
    status: command.status,
    fieldCount: Object.keys(command.validatedInputs).length,
    unresolvedOptionalFieldCount: command.unresolvedOptionalFields.length,
  };
}
