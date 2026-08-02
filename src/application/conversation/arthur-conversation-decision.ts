import type { ArthurDecision, ConversationContext, InternalCommand } from "../../domain/conversation/conversation.model.js";

/**
 * Arthur como Orchestrator conversacional — Sprint 06 (Fase 4). ADITIVO de propósito: não altera
 * `arthur.orchestrator.ts`/`ArthurOrchestrator` (o Arthur que planeja execuções de conteúdo para
 * Caio, usado pela CLI desde a Sprint 01) — é uma responsabilidade NOVA, expressa em código novo,
 * porque o Arthur desta sprint faz algo diferente: em vez de montar um `ExecutionPlan` para
 * conteúdo, ele decide o que fazer com uma INTENÇÃO de conversa. "Arthur apenas decide. Não gera
 * conteúdo" (PROMPT 06) — `ArthurDecision.executed` é sempre `false`.
 *
 * A decisão nem sempre confirma a sugestão do Intent Router (`InternalCommand`) — é isso que
 * torna esta camada um Orchestrator de verdade, não um simples repasse: se a intenção foi
 * classificada com baixa confiança, Arthur SEMPRE pede mais contexto, não importa o que o Router
 * sugeriu. Continua 100% regras — nenhuma chamada a LLM/AI Gateway acontece aqui.
 */

const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function decideConversationAction(command: InternalCommand, context: ConversationContext): ArthurDecision {
  if (command.intent.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      action: "request_more_context",
      reason: `Confiança da intenção (${command.intent.confidence.toFixed(2)}) abaixo do limiar (${LOW_CONFIDENCE_THRESHOLD}) — Arthur prefere perguntar a agir sobre um palpite.`,
      executed: false,
    };
  }

  // Delegações (Caio/Clara/Assets/Briefing) exigem que já exista contexto mínimo de conversa —
  // sem nenhum turno anterior e sem entidade referenciada, Arthur pede mais informação antes de
  // decidir chamar outra coisa, mesmo com uma intenção confiante. `turnCount` já inclui a
  // mensagem ATUAL (o Engine anexa o evento `user_message` antes de resolver o contexto, ver
  // `conversation-engine.ts`) — por isso "primeira mensagem" é `turnCount <= 1`, não `=== 0`.
  const delegatesToAnotherComponent = command.action !== "respond" && command.action !== "request_more_context";
  if (delegatesToAnotherComponent && context.turnCount <= 1 && Object.keys(context.referencedEntities).length === 0) {
    return {
      action: "request_more_context",
      reason: "Primeira mensagem da conversa, sem nenhuma entidade referenciada ainda — Arthur pede mais contexto antes de delegar.",
      executed: false,
    };
  }

  return { action: command.action, reason: command.reason, executed: false };
}
