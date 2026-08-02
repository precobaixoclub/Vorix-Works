import type { ArthurDecision, ConversationEvent, ConversationState, UserIntent } from "./types";

/**
 * Agrupa o log plano de eventos (`GET /v1/conversations/:id/history`) em "turnos" — um por
 * `user_message`, com tudo que aconteceu depois dele (intenção, decisão, mensagem do sistema,
 * mudança de estado) até o próximo `user_message`. Não existe endpoint dedicado para isto no
 * backend de propósito (Sprint 06: "não existe ConversationMessage separada, é tudo evento") —
 * agrupar é responsabilidade da apresentação, não do domínio.
 */
export type ConversationTurn = {
  id: string;
  userMessageContent: string;
  userMessageCreatedAt: string;
  intent?: UserIntent;
  decision?: ArthurDecision;
  systemMessageText?: string;
  state?: ConversationState;
};

export function groupEventsIntoTurns(events: ConversationEvent[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | undefined;

  for (const event of events) {
    if (event.type === "user_message") {
      current = {
        id: event.id,
        userMessageContent: String((event.payload as { content?: string }).content ?? ""),
        userMessageCreatedAt: event.createdAt,
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;

    if (event.type === "intent_classified") {
      current.intent = (event.payload as { intent?: UserIntent }).intent;
    } else if (event.type === "decision_made") {
      current.decision = (event.payload as { decision?: ArthurDecision }).decision;
    } else if (event.type === "system_message") {
      current.systemMessageText = String((event.payload as { content?: string }).content ?? "");
    } else if (event.type === "state_changed") {
      current.state = (event.payload as { to?: ConversationState }).to;
    }
  }

  return turns;
}
