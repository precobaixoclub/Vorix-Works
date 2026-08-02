import type { Conversation, ConversationContext } from "../../domain/conversation/conversation.model.js";
import type { ConversationEventRepositoryPort } from "../ports/conversation-event-repository.port.js";
import type { ConversationMemoryRepositoryPort } from "../ports/conversation-memory-repository.port.js";

/**
 * Reconstrução de `ConversationContext` — Sprint 06 (Fase 1/2). Nunca guardado como "verdade"
 * isolada: `turnCount`/`lastIntent` vêm de reler os eventos já persistidos, `referencedEntities`
 * vem da `ConversationMemory` (que também é atualizada por regra, ver `extractEntities`). Barato
 * de propósito — sem esse tipo de recomputo simples, qualquer estado escondido vira uma fonte de
 * bug quando os eventos e o "resumo" saem de sincronia.
 */
export async function resolveContext(
  deps: { eventRepository: ConversationEventRepositoryPort; memoryRepository: ConversationMemoryRepositoryPort },
  conversation: Conversation,
): Promise<ConversationContext> {
  const events = await deps.eventRepository.listByConversation(conversation.id);
  const turnCount = events.filter((event) => event.type === "user_message").length;
  const lastIntentEvent = [...events].reverse().find((event) => event.type === "intent_classified");
  const lastIntent = (lastIntentEvent?.payload as { intent?: { type?: string } } | undefined)?.intent?.type as
    | ConversationContext["lastIntent"]
    | undefined;

  const memory = await deps.memoryRepository.get(conversation.id);

  return {
    tenantId: conversation.tenantId,
    workspaceId: conversation.workspaceId,
    turnCount,
    lastIntent,
    referencedEntities: memory?.facts ?? {},
  };
}

/**
 * Extração de entidade por regra — nunca NLP/embedding (PROMPT 06: "nenhuma dependência de
 * LLM"). Hoje só reconhece um padrão: `campanha "Nome Entre Aspas"`. Suficiente para provar que a
 * `ConversationMemory` funciona de ponta a ponta; mais regras entram quando o produto pedir.
 */
export function extractEntities(text: string, existing: Record<string, string>): Record<string, string> {
  const next = { ...existing };
  const campaignMatch = text.match(/campanha[^"'\n]*["']([^"']{2,60})["']/i);
  if (campaignMatch) next.campaign = campaignMatch[1];
  return next;
}
