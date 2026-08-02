import type { BriefingReadiness } from "../../domain/briefing/briefing.model.js";

/**
 * `AiExtractionDecision` — Sprint 08 (Fase 11, decisão obrigatória 16/17). Decide se vale a pena
 * chamar o AI Gateway NESTE turno, depois que a extração determinística + Context Resolver (não-
 * IA) já rodaram. Deliberadamente NÃO restrita a "só quando falta campo obrigatório" — um campo
 * ambíguo (a IA pode ajudar a desambiguar com mais contexto) ou um opcional de alto impacto ainda
 * vazio também justificam a chamada. `unconfirmedSuggestedFields` fica de fora do gatilho: aquilo
 * já tem um valor conhecido, só falta o USUÁRIO confirmar — chamar a IA de novo não ajuda em nada.
 *
 * As condições "nunca chamar quando X" da Fase 11 que dependem do INTERPRETATION KIND da mensagem
 * (cancelamento, confirmação, resposta que já resolveu o campo) nunca chegam até aqui — são
 * garantidas estruturalmente por `process-briefing-turn.ts`: esta função só é invocada de dentro
 * de `continueBriefing`, que por sua vez só é alcançado depois que cancelamento/confirmação/
 * confirmação ambígua/nova intenção já retornaram mais cedo (ver `processBriefingTurn`).
 */
export type AiExtractionDecisionInput = {
  featureEnabled: boolean;
  readiness: BriefingReadiness;
};

export type AiExtractionDecisionResult = { shouldCall: true; reason: string } | { shouldCall: false; reason: string };

export function decideShouldCallAi(input: AiExtractionDecisionInput): AiExtractionDecisionResult {
  if (!input.featureEnabled) {
    return { shouldCall: false, reason: "feature_disabled" };
  }

  const hasSomethingWorthExtracting =
    input.readiness.missingRequiredFields.length > 0 || input.readiness.ambiguousFields.length > 0 || input.readiness.optionalHighImpactFields.length > 0;

  if (!hasSomethingWorthExtracting) {
    return { shouldCall: false, reason: "deterministic_sufficient" };
  }

  return { shouldCall: true, reason: "gaps_remaining_after_deterministic_extraction" };
}
