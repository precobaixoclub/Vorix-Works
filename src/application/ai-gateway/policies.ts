import type { AiPolicy } from "../ports/ai-gateway.port.js";
import { DEFAULT_AI_RETRY_POLICY } from "./retry-policy.js";

/** Política padrão de `briefing_field_extraction` — a única operação executável nesta sprint.
 * `providerFallbackAllowed: false` porque só existe um provider real conectado hoje (mudar para
 * `true` só faz sentido no dia em que um segundo provider real for registrado, Fase 20). */
export const BRIEFING_FIELD_EXTRACTION_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 2_000,
  maxOutputTokens: 1_024,
  timeoutMs: 8_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Política de `inbox_auto_reply` — Módulo Conversas, Fase 5. `maxInputTokens` mais generoso que
 * o de briefing porque carrega uma janela de mensagens recentes (ver `AI_CONTEXT_MESSAGE_LIMIT`
 * em `inbox-use-cases.ts`), não só uma mensagem isolada; `timeoutMs` mais curto que o padrão
 * (12s, não os 8s de briefing) porque o cliente está esperando uma resposta de verdade no
 * WhatsApp, mas ainda dentro do teto que `retry-policy.ts` considera aceitável não travar uma
 * requisição síncrona — aqui a chamada roda dentro do worker, não numa requisição HTTP, então um
 * timeout um pouco maior é seguro. `providerFallbackAllowed: false` pelo mesmo motivo de
 * `BRIEFING_FIELD_EXTRACTION_POLICY`: só um provider real conectado hoje. */
export const INBOX_AUTO_REPLY_POLICY: AiPolicy = {
  preferredCapability: "free_text",
  maxInputTokens: 4_000,
  maxOutputTokens: 512,
  timeoutMs: 12_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.4,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};
