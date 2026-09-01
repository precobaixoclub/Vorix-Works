import { randomUUID } from "node:crypto";
import type { InboxAiResponderInput, InboxAiResponderPort, InboxAiResponderResult } from "../../application/ports/inbox-ai-responder.port.js";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import { INBOX_AUTO_REPLY_POLICY } from "../../application/ai-gateway/policies.js";
import type { InboxAutoReplyResult } from "../../application/ai-gateway/schemas/inbox-auto-reply-result.v1.js";

/**
 * Único adapter concreto de `InboxAiResponderPort` (Módulo Conversas, Fase 5) — traduz o pedido
 * de "gere uma resposta pra esta conversa" num `AiRequest` real (`operation: "inbox_auto_reply"`)
 * e devolve só o texto + metadados operacionais seguros. `application/inbox/*` nunca vê
 * `AiGatewayPort`/`AiRequest` diretamente — só este adapter, injetado via
 * `InboxUseCaseDeps.aiResponder` na composição raiz do `vorix-worker`.
 */
export class AiGatewayInboxResponder implements InboxAiResponderPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async generateReply(input: InboxAiResponderInput): Promise<InboxAiResponderResult> {
    const result = await this.aiGateway.execute({
      operation: "inbox_auto_reply",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      // Nunca `conversationId`/`briefingId` aqui de propósito: essas colunas de `ai_executions`
      // têm FK para as tabelas do domínio `conversation`/`briefing` (Arthur) — um id de
      // `inbox_conversations` ali violaria a constraint. A auditoria específica de Inbox vive em
      // `inbox_conversation_events` (eventos `ai_response_*`), correlacionada por `traceId`.
      input: {
        contactName: input.contactName,
        recentMessages: input.recentMessages.map((message) => ({ direction: message.direction, body: message.body, sentByAi: message.sentByAi })),
      },
      outputSchema: { id: "inbox-auto-reply-result", version: 1 },
      policy: INBOX_AUTO_REPLY_POLICY,
      // Fase 7 — única forma de fazer a chave de idempotência financeira chegar ao
      // `CreditGatedAiGateway` sem alargar `AiRequest`/`AiGateway` (que não conhecem Inbox): via
      // `metadata`, já genérico e nunca sanitizado/alterado pelo Gateway (só `input` é).
      metadata: { idempotencyKey: input.idempotencyKey },
    });

    if (!result.ok) {
      return { ok: false, category: result.error.category, message: result.error.message };
    }

    const output = result.data.output as InboxAutoReplyResult;
    return {
      ok: true,
      reply: output.reply,
      provider: result.data.provider,
      model: result.data.model,
      latencyMs: result.data.latencyMs,
      usage: {
        inputTokens: result.data.usage.inputTokens,
        outputTokens: result.data.usage.outputTokens,
        totalTokens: result.data.usage.totalTokens,
        estimatedCost: result.data.usage.estimatedCost,
      },
      traceId: result.data.traceId,
    };
  }
}
