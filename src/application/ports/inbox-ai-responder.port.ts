/**
 * Módulo Conversas — Fase 5 (IA de Atendimento). Porta pequena e específica, decisão obrigatória
 * da fase: `src/application/inbox/*` NUNCA importa `AiGatewayPort`/`AiRequest`/prompt templates
 * diretamente — só este contrato, mínimo e específico do domínio de atendimento. Isso mantém
 * `inbox` decoplado tanto do bounded context `conversation` (Arthur) quanto dos detalhes internos
 * do AI Gateway (operação, política, template de prompt); a implementação real
 * (`infrastructure/ai-gateway/inbox-ai-responder-adapter.ts`) é quem sabe como isso vira um
 * `AiRequest` de verdade.
 *
 * `undefined` como valor de `InboxUseCaseDeps.aiResponder` (nunca uma exceção) é o sinal de "IA
 * não configurada neste processo" — a Inbox continua funcionando 100% normalmente sem isto (IA
 * caiu != Inbox caiu). Qualquer falha do provider/Gateway também nunca lança — sempre
 * `InboxAiResponderResult` com `ok:false`, mesmo espírito de `AiGatewayResult`.
 */

export type InboxAiResponderMessage = {
  direction: "inbound" | "outbound";
  body: string;
  sentByAi: boolean;
  createdAt: string;
};

export type InboxAiResponderInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  contactName?: string;
  contactPhone: string;
  /** Janela de contexto já recortada pelo chamador (ver `AI_CONTEXT_MESSAGE_LIMIT` em
   * `inbox-use-cases.ts`) — em ordem cronológica ascendente (mais antiga primeiro). Nunca o
   * histórico completo da conversa. */
  recentMessages: readonly InboxAiResponderMessage[];
};

export type InboxAiResponderSuccess = {
  ok: true;
  reply: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
  /** Correlaciona com `ai_executions.trace_id` — nunca usado para reconstruir prompt/resposta. */
  traceId: string;
};

export type InboxAiResponderFailure = {
  ok: false;
  /** Categoria seguro (nunca o erro bruto do provider) — mesmo vocabulário de `AiFailureCategory`,
   * mas como `string` solto aqui de propósito: `inbox` nunca importa o tipo do AI Gateway. */
  category: string;
  message: string;
};

export type InboxAiResponderResult = InboxAiResponderSuccess | InboxAiResponderFailure;

export type InboxAiResponderPort = {
  generateReply(input: InboxAiResponderInput): Promise<InboxAiResponderResult>;
};
