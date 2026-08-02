import { randomUUID } from "node:crypto";
import type { Briefing, BriefingFieldValue, BriefingReadiness, BriefingSchema, BriefingSource } from "../../domain/briefing/briefing.model.js";
import type { ConversationState, UserIntent } from "../../domain/conversation/conversation.model.js";
import { decideShouldCallAi } from "../ai-gateway/extraction-decision.js";
import { BRIEFING_FIELD_EXTRACTION_POLICY } from "../ai-gateway/policies.js";
import type { BriefingFieldExtractionResult } from "../ai-gateway/schemas/briefing-field-extraction-result.v1.js";
import type { AssetMetadataSourcePort } from "../ports/asset-metadata-source.port.js";
import type { AiGatewayPort } from "../ports/ai-gateway.port.js";
import type { CompanyKnowledgeSourcePort } from "../ports/company-knowledge-source.port.js";
import { cancelBriefing, confirmBriefingAndPrepareCommand, supersedeCommandAfterCorrection, type BriefingUseCaseDeps } from "./briefing-use-cases.js";
import { resolveFieldCandidates } from "./context-resolver.js";
import { toBriefingQuestionDto, toBriefingSummaryDto, toPreparedCommandSummaryDto, type BriefingQuestionDto, type BriefingSummaryDto, type PreparedCommandSummaryDto } from "./dto.js";
import type { ExtractedFieldValue } from "./extraction.js";
import { selectCurrentFieldValues } from "./field-state.js";
import { interpretBriefingMessage } from "./interpret-message.js";
import { planNextQuestion } from "./question-planner.js";
import { evaluateBriefingReadiness } from "./readiness-evaluator.js";

/**
 * `ProcessBriefingAnswer` — Sprint 07 (Fase 12), o caso de uso central desta sprint: interpreta
 * UMA mensagem contra um Briefing ativo (Fase 5/"Ordem de interpretação"), aplica a mutação
 * correspondente, tenta preencher o resto via Context Resolver, recalcula prontidão e decide
 * entre "faça mais uma pergunta" e "peça confirmação". Nunca chama Caio/Arthur legado/Skills.
 */
export type ProcessBriefingTurnDeps = BriefingUseCaseDeps & {
  companyKnowledgeSource: CompanyKnowledgeSourcePort;
  assetMetadataSource: AssetMetadataSourcePort;
  aiGateway: AiGatewayPort;
  /** `AI_BRIEFING_EXTRACTION_ENABLED` — checado na camada de aplicação (aqui), nunca no domínio.
   * `false` reproduz o comportamento idêntico à Sprint 07 (Fase 19/37): `decideShouldCallAi`
   * retorna `shouldCall:false` sem sequer montar um `AiRequest`. */
  aiExtractionEnabled: boolean;
};

export type ProcessBriefingTurnParams = {
  briefing: Briefing;
  schema: BriefingSchema;
  text: string;
  classifiedIntent: UserIntent;
  workspaceConnectedChannels?: readonly string[];
};

export type ProcessBriefingTurnResult =
  | {
      kind: "handled";
      briefing: Briefing;
      conversationState: ConversationState;
      systemMessageText: string;
      confirmationRequired: boolean;
      briefingSummary?: BriefingSummaryDto;
      nextQuestion?: BriefingQuestionDto;
      readiness?: BriefingReadiness;
      preparedCommandSummary?: PreparedCommandSummaryDto;
      /** Sprint 08 (Fase 20) — metadados públicos mínimos, nunca provider/model/tokens/confidence
       * bruta. `extractionWarnings` são sempre códigos seguros (ex.: `ai_extraction_failed:timeout`),
       * nunca texto livre do provider. */
      aiAssisted?: boolean;
      aiFallbackUsed?: boolean;
      extractionWarnings?: readonly string[];
    }
  /** Nova intenção inequívoca e incompatível — quem chama deve emitir `briefing_suspended` e
   * processar a mensagem pelo pipeline normal da Sprint 06 (nunca cancela o Briefing). */
  | { kind: "suspend"; intent: UserIntent }
  /** Briefing `ready` e a mensagem não é cancelamento/correção — nada a fazer aqui, o pipeline
   * normal da Sprint 06 deve processar a mensagem (o Briefing continua "vivo" para correções futuras). */
  | { kind: "not_applicable" };

export async function processBriefingTurn(deps: ProcessBriefingTurnDeps, params: ProcessBriefingTurnParams): Promise<ProcessBriefingTurnResult> {
  const { briefing, schema, text, classifiedIntent } = params;

  const currentListBefore = await deps.fieldValueRepository.listCurrentByBriefing(briefing.id);
  const currentValuesBefore = selectCurrentFieldValues(currentListBefore);
  const pendingQuestion = await deps.questionRepository.getPendingByBriefing(briefing.id);

  const interpretation = interpretBriefingMessage({
    schema,
    briefingType: briefing.type,
    text,
    pendingQuestion,
    classifiedIntent,
    alreadyKnownFieldKeys: new Set(currentValuesBefore.keys()),
  });

  if (briefing.status === "ready" && interpretation.kind !== "cancellation" && interpretation.kind !== "correction") {
    return { kind: "not_applicable" };
  }

  if (interpretation.kind === "cancellation") {
    const cancelled = await cancelBriefing(deps, { tenantId: briefing.tenantId, workspaceId: briefing.workspaceId, id: briefing.id });
    return {
      kind: "handled",
      briefing: cancelled,
      conversationState: "resolved",
      systemMessageText: "Briefing cancelado. Nenhum conteúdo foi gerado ainda.",
      confirmationRequired: false,
    };
  }

  if (interpretation.kind === "new_intent") {
    return { kind: "suspend", intent: interpretation.intent };
  }

  if (interpretation.kind === "confirmation") {
    if (pendingQuestion) await deps.questionRepository.markAnswered(pendingQuestion.id);
    const { briefing: readyBriefing, command } = await confirmBriefingAndPrepareCommand(deps, { briefing, schema, intent: classifiedIntent.type });
    return {
      kind: "handled",
      briefing: readyBriefing,
      conversationState: "resolved",
      systemMessageText: "Briefing confirmado. Um comando foi preparado, mas nenhum conteúdo foi gerado ainda.",
      confirmationRequired: false,
      preparedCommandSummary: toPreparedCommandSummaryDto(command),
    };
  }

  if (interpretation.kind === "suggestion_confirmed") {
    await deps.questionRepository.markAnswered(interpretation.question.id);
    const currentValue = currentValuesBefore.get(interpretation.fieldKey);
    if (currentValue) {
      await appendFieldValue(
        deps,
        briefing,
        {
          fieldKey: currentValue.fieldKey,
          value: currentValue.value,
          normalizedValue: currentValue.normalizedValue,
          confidence: currentValue.confidence,
          ambiguityStatus: currentValue.ambiguityStatus,
          matchedRule: "user_confirmed_suggestion",
          aiExecutionId: currentValue.aiExecutionId,
          rationaleCode: currentValue.rationaleCode,
          evidence: currentValue.evidence,
        },
        { source: currentValue.source, confirmedByUser: true, questionId: interpretation.question.id },
      );
    }
    await deps.eventRepository.append({
      conversationId: briefing.conversationId,
      type: "briefing_question_answered",
      payload: { questionId: interpretation.question.id, briefingId: briefing.id },
    });
    return continueBriefing(deps, { briefing, schema, text, workspaceConnectedChannels: params.workspaceConnectedChannels });
  }

  if (interpretation.kind === "ambiguous_confirmation") {
    return {
      kind: "handled",
      briefing,
      conversationState: "awaiting_confirmation",
      systemMessageText: 'Não entendi se isso é uma confirmação. Responda "sim" para confirmar, ou descreva o que quer corrigir.',
      confirmationRequired: true,
      nextQuestion: pendingQuestion ? toBriefingQuestionDto(pendingQuestion) : undefined,
    };
  }

  let workingBriefing = briefing;

  if (interpretation.kind === "correction") {
    const wasAlreadyConfirmedOnce = briefing.status === "awaiting_confirmation" || briefing.status === "ready";
    if (wasAlreadyConfirmedOnce) {
      const pending = await deps.questionRepository.getPendingByBriefing(briefing.id);
      if (pending) await deps.questionRepository.markSuperseded(pending.id);
      workingBriefing = await supersedeCommandAfterCorrection(deps, briefing);
    }
    await appendFieldValue(deps, workingBriefing, interpretation.extracted, { confirmedByUser: interpretation.extracted.ambiguityStatus !== "ambiguous" });
  } else if (interpretation.kind === "pending_answer") {
    await appendFieldValue(deps, workingBriefing, interpretation.extracted, {
      questionId: interpretation.question.id,
      confirmedByUser: interpretation.extracted.ambiguityStatus !== "ambiguous",
    });
    await deps.questionRepository.markAnswered(interpretation.question.id);
    await deps.eventRepository.append({
      conversationId: workingBriefing.conversationId,
      type: "briefing_question_answered",
      payload: { questionId: interpretation.question.id, briefingId: workingBriefing.id },
    });
  } else if (interpretation.kind === "opportunistic") {
    for (const extracted of interpretation.extracted) {
      await appendFieldValue(deps, workingBriefing, extracted, { confirmedByUser: extracted.ambiguityStatus !== "ambiguous" });
    }
  }
  // "fallback": nenhuma mutação — segue para a continuação compartilhada mesmo assim (pode
  // reapresentar a pergunta pendente ou reavaliar prontidão sem novidade nenhuma).

  return continueBriefing(deps, { briefing: workingBriefing, schema, text, workspaceConnectedChannels: params.workspaceConnectedChannels });
}

async function appendFieldValue(
  deps: ProcessBriefingTurnDeps,
  briefing: Briefing,
  extracted: ExtractedFieldValue,
  opts: { source?: BriefingSource; confirmedByUser: boolean; questionId?: string },
): Promise<BriefingFieldValue> {
  const value = await deps.fieldValueRepository.append({
    briefingId: briefing.id,
    fieldKey: extracted.fieldKey,
    value: extracted.value,
    normalizedValue: extracted.normalizedValue,
    source: opts.source ?? "user_message",
    confidence: extracted.confidence,
    questionId: opts.questionId,
    confirmedByUser: opts.confirmedByUser,
    ambiguityStatus: extracted.ambiguityStatus,
    aiExecutionId: extracted.aiExecutionId,
    rationaleCode: extracted.rationaleCode,
    evidence: extracted.evidence,
  });

  const eventType = value.ambiguityStatus === "ambiguous" ? "briefing_field_ambiguous" : value.revision === 1 ? "briefing_field_collected" : "briefing_field_updated";
  await deps.eventRepository.append({
    conversationId: briefing.conversationId,
    type: eventType,
    payload: { briefingId: briefing.id, fieldKey: extracted.fieldKey, source: value.source, revision: value.revision },
  });

  return value;
}

async function continueBriefing(
  deps: ProcessBriefingTurnDeps,
  params: { briefing: Briefing; schema: BriefingSchema; text: string; workspaceConnectedChannels?: readonly string[] },
): Promise<ProcessBriefingTurnResult> {
  const { briefing, schema, text } = params;

  const afterMutation = selectCurrentFieldValues(await deps.fieldValueRepository.listCurrentByBriefing(briefing.id));
  const stillMissingKeys = schema.fields.filter((field) => !afterMutation.has(field.key)).map((field) => field.key);

  let currentValues = afterMutation;
  if (stillMissingKeys.length > 0) {
    const candidates = await resolveFieldCandidates(
      {
        schema,
        missingFieldKeys: stillMissingKeys,
        workspaceId: briefing.workspaceId,
        currentMessageText: text,
        workspaceConnectedChannels: params.workspaceConnectedChannels,
      },
      { companyKnowledgeSource: deps.companyKnowledgeSource, assetMetadataSource: deps.assetMetadataSource },
    );

    for (const candidate of candidates) {
      await appendFieldValue(
        deps,
        briefing,
        {
          fieldKey: candidate.fieldKey,
          value: candidate.value,
          normalizedValue: candidate.normalizedValue,
          confidence: candidate.confidence,
          ambiguityStatus: "none",
          matchedRule: candidate.matchedRule,
        },
        { source: candidate.source, confirmedByUser: candidate.source === "user_message" || candidate.source === "conversation_memory" },
      );
    }

    if (candidates.length > 0) {
      currentValues = selectCurrentFieldValues(await deps.fieldValueRepository.listCurrentByBriefing(briefing.id));
    }
  }

  const preAiReadiness = evaluateBriefingReadiness(schema, currentValues, false);
  const aiDecision = decideShouldCallAi({ featureEnabled: deps.aiExtractionEnabled, readiness: preAiReadiness });

  let aiAssisted = false;
  let aiFallbackUsed = false;
  const extractionWarnings: string[] = [];

  if (aiDecision.shouldCall) {
    const aiOutcome = await callAiGatewayForBriefingExtraction(deps, { briefing, schema, text, currentValues });
    if (aiOutcome.ok) {
      aiAssisted = true;
      for (const candidate of aiOutcome.result.candidates) {
        await appendFieldValue(
          deps,
          briefing,
          {
            fieldKey: candidate.fieldKey,
            value: candidate.proposedValue,
            normalizedValue: candidate.normalizedValue,
            confidence: candidate.confidence,
            ambiguityStatus: "none",
            matchedRule: `ai:${candidate.rationaleCode}`,
            aiExecutionId: aiOutcome.aiExecutionId,
            rationaleCode: candidate.rationaleCode,
            evidence: candidate.evidence,
          },
          // "ai_extraction" está em EXTERNAL_SOURCES — nunca `confirmedByUser: true` aqui, mesmo
          // com confidence alta (decisão obrigatória: confidence nunca substitui confirmationPolicy).
          { source: "ai_extraction", confirmedByUser: false },
        );
      }
      extractionWarnings.push(...aiOutcome.result.ambiguities.map((text) => `ai_ambiguity:${text}`), ...aiOutcome.result.warnings);
      if (aiOutcome.result.candidates.length > 0) {
        currentValues = selectCurrentFieldValues(await deps.fieldValueRepository.listCurrentByBriefing(briefing.id));
      }
    } else {
      aiFallbackUsed = true;
      extractionWarnings.push(`ai_extraction_failed:${aiOutcome.category}`);
    }
  }

  const readiness = evaluateBriefingReadiness(schema, currentValues, false);

  if (readiness.isReadyForConfirmation) {
    const existingPending = await deps.questionRepository.getPendingByBriefing(briefing.id);
    if (existingPending) await deps.questionRepository.markSuperseded(existingPending.id);

    const summaryText = buildConfirmationSummaryText(schema, currentValues);
    const confirmationQuestion = await deps.questionRepository.create({
      briefingId: briefing.id,
      fieldKeys: [],
      text: summaryText,
      reason: "Todos os campos obrigatórios estão válidos — aguardando confirmação do usuário.",
      priority: 0,
      answerType: "confirmation",
      options: ["sim", "corrigir", "cancelar"],
    });
    await deps.eventRepository.append({
      conversationId: briefing.conversationId,
      type: "briefing_question_created",
      payload: { questionId: confirmationQuestion.id, briefingId: briefing.id, kind: "confirmation" },
    });

    const updatedBriefing = await deps.briefingRepository.updateStatus(briefing.id, "awaiting_confirmation");
    await deps.eventRepository.append({
      conversationId: briefing.conversationId,
      type: "briefing_confirmation_requested",
      payload: { briefingId: briefing.id, revision: briefing.revision },
    });

    return {
      kind: "handled",
      briefing: updatedBriefing,
      conversationState: "awaiting_confirmation",
      systemMessageText: summaryText,
      confirmationRequired: true,
      nextQuestion: toBriefingQuestionDto(confirmationQuestion),
      briefingSummary: toBriefingSummaryDto(schema, updatedBriefing, currentValues, readiness),
      readiness,
      aiAssisted,
      aiFallbackUsed,
      extractionWarnings,
    };
  }

  let nextQuestion = await deps.questionRepository.getPendingByBriefing(briefing.id);
  if (!nextQuestion) {
    const answeredFieldKeys = new Set(
      (await deps.questionRepository.listByBriefing(briefing.id)).filter((question) => question.status === "answered").flatMap((question) => question.fieldKeys),
    );
    const planned = planNextQuestion(schema, readiness, currentValues, answeredFieldKeys);
    if (planned) {
      nextQuestion = await deps.questionRepository.create({
        briefingId: briefing.id,
        fieldKeys: planned.fieldKeys,
        text: planned.text,
        reason: planned.reason,
        priority: planned.priority,
        answerType: planned.answerType,
        options: planned.options,
      });
      await deps.eventRepository.append({
        conversationId: briefing.conversationId,
        type: "briefing_question_created",
        payload: { questionId: nextQuestion.id, briefingId: briefing.id, fieldKeys: planned.fieldKeys },
      });
    }
  }

  const updatedBriefing = briefing.status === "collecting" ? briefing : await deps.briefingRepository.updateStatus(briefing.id, "collecting");
  return {
    kind: "handled",
    briefing: updatedBriefing,
    conversationState: "collecting_briefing",
    systemMessageText: nextQuestion?.text ?? "Preciso de mais informações para continuar — pode detalhar um pouco mais?",
    confirmationRequired: false,
    nextQuestion: nextQuestion ? toBriefingQuestionDto(nextQuestion) : undefined,
    briefingSummary: toBriefingSummaryDto(schema, updatedBriefing, currentValues, readiness),
    readiness,
    aiAssisted,
    aiFallbackUsed,
    extractionWarnings,
  };
}

type AiBriefingExtractionOutcome =
  | { ok: true; result: BriefingFieldExtractionResult; aiExecutionId: string }
  | { ok: false; category: string };

/**
 * Sprint 08 (Fase 11) — único ponto de chamada ao AI Gateway a partir do Briefing. `AiRequest.input`
 * carrega só o necessário para `prompt-template-registry.ts` reconstruir o contexto (nunca a
 * entidade `Briefing`/`Workspace` inteira). Qualquer falha (`!result.ok`) é tratada aqui mesmo —
 * quem chama (`continueBriefing`) só vê "ok" ou "não ok com uma categoria seguro", nunca uma
 * exceção. `correlationId` é gerado aqui (idealmente viria do `request.id` da borda HTTP; nesta
 * sprint a chamada não tem esse valor disponível na cadeia — o `traceId` do Gateway já garante
 * rastreabilidade ponta a ponta desta chamada específica).
 */
async function callAiGatewayForBriefingExtraction(
  deps: ProcessBriefingTurnDeps,
  params: { briefing: Briefing; schema: BriefingSchema; text: string; currentValues: ReadonlyMap<string, BriefingFieldValue> },
): Promise<AiBriefingExtractionOutcome> {
  const result = await deps.aiGateway.execute({
    operation: "briefing_field_extraction",
    tenantId: params.briefing.tenantId,
    workspaceId: params.briefing.workspaceId,
    conversationId: params.briefing.conversationId,
    briefingId: params.briefing.id,
    correlationId: randomUUID(),
    input: {
      schemaType: params.briefing.type,
      schemaVersion: params.briefing.schemaVersion,
      message: params.text,
      knownFieldKeys: [...params.currentValues.keys()],
    },
    outputSchema: { id: "briefing-field-extraction-result", version: 1 },
    policy: BRIEFING_FIELD_EXTRACTION_POLICY,
  });

  if (!result.ok) {
    return { ok: false, category: result.error.category };
  }

  return { ok: true, result: result.data.output as BriefingFieldExtractionResult, aiExecutionId: result.data.traceId };
}

function buildConfirmationSummaryText(schema: BriefingSchema, currentValues: ReadonlyMap<string, BriefingFieldValue>): string {
  const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field] as const));
  const lines = [...currentValues.values()]
    .filter((value) => value.ambiguityStatus !== "ambiguous")
    .map((value) => `- ${fieldsByKey.get(value.fieldKey)?.label ?? value.fieldKey}: ${value.value}`);

  return [
    "Aqui está o resumo do briefing até agora:",
    ...lines,
    "",
    'Posso confirmar? Responda "sim" para confirmar, ou descreva o que quer corrigir/cancelar.',
    "Nenhum conteúdo foi gerado ainda.",
  ].join("\n");
}
