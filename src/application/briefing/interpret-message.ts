import type { BriefingQuestion, BriefingSchema, BriefingType } from "../../domain/briefing/briefing.model.js";
import type { UserIntent, UserIntentType } from "../../domain/conversation/conversation.model.js";
import {
  detectCancellation,
  detectConfirmation,
  detectCorrection,
  extractDirectAnswer,
  extractOpportunistic,
  type ConfirmationSignal,
  type ExtractedFieldValue,
} from "./extraction.js";

/**
 * Orquestrador da "Ordem de interpretação da mensagem" — Sprint 07B, precedência ESTRITA:
 * (1) cancelamento explícito; (2) correção explícita; (3) resposta à pergunta pendente;
 * (4) confirmação do resumo; (5) possível nova intenção; (6) extração oportunista;
 * (7) fallback conversacional. A pergunta pendente tem precedência sobre o Intent Router geral —
 * é por isso que (3)/(4) vêm antes de (5).
 */
export type BriefingInterpretation =
  | { kind: "cancellation" }
  | { kind: "correction"; fieldKey: string; extracted: ExtractedFieldValue }
  | { kind: "pending_answer"; question: BriefingQuestion; extracted: ExtractedFieldValue }
  | { kind: "confirmation" }
  /** Confirmação de UMA sugestão externa específica (Question Planner tier 5 — "Encontrei X para
   * campo Y, posso usar esse valor?"), nunca a confirmação do Briefing inteiro. Distinguido da
   * confirmação final pelo `BriefingQuestion.fieldKeys` não-vazio (a confirmação final sempre tem
   * `fieldKeys: []`) — sem essa distinção, um "sim" respondendo a uma sugestão de campo isolado
   * seria tratado como se confirmasse todo o Briefing e criaria um `PreparedCommand` mesmo com
   * outros campos obrigatórios ainda pendentes (bug encontrado e corrigido na Sprint 08). */
  | { kind: "suggestion_confirmed"; question: BriefingQuestion; fieldKey: string }
  | { kind: "ambiguous_confirmation" }
  | { kind: "new_intent"; intent: UserIntent }
  | { kind: "opportunistic"; extracted: readonly ExtractedFieldValue[] }
  | { kind: "fallback" };

/** Compatível = continua o Briefing atual sem suspender; qualquer outra intenção INEQUÍVOCA
 * (com `matchedRule` definido — fallback nunca interrompe) suspende. Só `campaign_creation` tem
 * schema nesta sprint, então só ele precisa de uma linha aqui. */
const COMPATIBLE_INTENTS_BY_BRIEFING_TYPE: Partial<Record<BriefingType, readonly UserIntentType[]>> = {
  campaign_creation: ["create_campaign", "answer_question", "free_chat", "unknown", "start_briefing"],
};

function isIncompatibleIntent(briefingType: BriefingType, intent: UserIntent): boolean {
  if (!intent.matchedRule) return false;
  const compatible = COMPATIBLE_INTENTS_BY_BRIEFING_TYPE[briefingType] ?? [];
  return !compatible.includes(intent.type);
}

export type InterpretBriefingMessageParams = {
  schema: BriefingSchema;
  briefingType: BriefingType;
  text: string;
  pendingQuestion?: BriefingQuestion;
  /** Classificação já feita pelo Intent Router da Sprint 06 — o interpretador nunca reclassifica. */
  classifiedIntent: UserIntent;
  alreadyKnownFieldKeys: ReadonlySet<string>;
};

export function interpretBriefingMessage(params: InterpretBriefingMessageParams): BriefingInterpretation {
  const { schema, briefingType, text, pendingQuestion, classifiedIntent, alreadyKnownFieldKeys } = params;

  // (1) Cancelamento explícito — precedência absoluta, mesmo sobre uma pergunta pendente.
  if (detectCancellation(text)) {
    return { kind: "cancellation" };
  }

  // (2) Correção explícita.
  const correction = detectCorrection(schema, text);
  if (correction) {
    const field = schema.fields.find((candidate) => candidate.key === correction.fieldKey);
    if (field) {
      return { kind: "correction", fieldKey: field.key, extracted: extractDirectAnswer(field, correction.remainder) };
    }
  }

  // (3)/(4) Pergunta pendente: pergunta de campo normal (3) vs. pergunta de confirmação (4) — que
  // por sua vez pode ser a confirmação FINAL do Briefing inteiro (`fieldKeys: []`) ou a
  // confirmação de UMA sugestão externa isolada (`fieldKeys: [algumCampo]`, tier 5 do Planner).
  if (pendingQuestion && pendingQuestion.status === "pending") {
    if (pendingQuestion.answerType === "confirmation") {
      const signal: ConfirmationSignal = detectConfirmation(text);
      if (signal === "affirmative") {
        return pendingQuestion.fieldKeys.length > 0
          ? { kind: "suggestion_confirmed", question: pendingQuestion, fieldKey: pendingQuestion.fieldKeys[0] }
          : { kind: "confirmation" };
      }
      if (signal === "ambiguous") return { kind: "ambiguous_confirmation" };
      // Nenhum sinal de confirmação — cai para as próximas etapas (pode ser nova intenção/extração).
    } else {
      const fieldKey = pendingQuestion.fieldKeys[0];
      const field = schema.fields.find((candidate) => candidate.key === fieldKey);
      if (field) {
        return { kind: "pending_answer", question: pendingQuestion, extracted: extractDirectAnswer(field, text) };
      }
    }
  }

  // (5) Possível nova intenção — só interrompe quando inequívoca e incompatível com o Briefing atual.
  if (isIncompatibleIntent(briefingType, classifiedIntent)) {
    return { kind: "new_intent", intent: classifiedIntent };
  }

  // (6) Extração oportunista.
  const opportunistic = extractOpportunistic(schema, text, alreadyKnownFieldKeys);
  if (opportunistic.length > 0) {
    return { kind: "opportunistic", extracted: opportunistic };
  }

  // (7) Fallback conversacional — comportamento da Sprint 06 preservado pelo chamador.
  return { kind: "fallback" };
}
