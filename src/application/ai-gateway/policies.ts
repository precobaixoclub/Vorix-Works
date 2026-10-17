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

/** Política de `commercial_copilot_suggestions` — CRM/Comercial, Fase 5. `temperature` baixa
 * (0.2, não 0) porque a tarefa é "sugerir", não extrair um valor determinístico único, mas ainda
 * baixa o bastante pra minimizar invenção; `maxOutputTokens` modesto (no máximo 5 sugestões
 * curtas). `providerFallbackAllowed: false` pelo mesmo motivo das demais políticas — só um
 * provider real conectado hoje. */
export const COMMERCIAL_COPILOT_SUGGESTIONS_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 3_000,
  maxOutputTokens: 800,
  timeoutMs: 8_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.2,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Política de `deal_commercial_insights` — Sales Engine. Entrada moderada (fatos + até ~30
 * mensagens truncadas), temperatura baixa (análise fiel, não criação). */
export const DEAL_COMMERCIAL_INSIGHTS_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 8_000,
  maxOutputTokens: 1_200,
  timeoutMs: 20_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.2,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Política de `report_ai_analysis` — entrada é o relatório já calculado (linhas curtas). */
export const REPORT_AI_ANALYSIS_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 8_000,
  maxOutputTokens: 1_500,
  timeoutMs: 25_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.2,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Política de `report_template_builder` — pedido curto + catálogo de seções. */
export const REPORT_TEMPLATE_BUILDER_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 3_000,
  maxOutputTokens: 600,
  timeoutMs: 15_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.2,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Política de `meeting_ai_analysis` — Vorix Meetings. Entrada grande (transcrição inteira de uma
 * reunião de até ~1h30), temperatura baixa (registro fiel, não criação), saída estruturada. Uma
 * transcrição acima do limite FALHA com motivo explícito — nunca é truncada em silêncio (cortar o
 * fim da reunião faria a análise omitir decisões sem avisar). */
export const MEETING_AI_ANALYSIS_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 60_000,
  maxOutputTokens: 4_000,
  timeoutMs: 90_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.1,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** "Pergunte à reunião": a entrada é a transcrição (ou os trechos mais relevantes de várias
 * reuniões); resposta curta, fiel, com citação. Interativo: timeout menor que a análise. */
export const MEETING_QUESTION_ANSWER_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 60_000,
  maxOutputTokens: 1_500,
  timeoutMs: 60_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.1,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};

/** Follow-up: rascunho de e-mail e WhatsApp a partir da análise (entrada pequena). */
export const MEETING_FOLLOW_UP_POLICY: AiPolicy = {
  preferredCapability: "structured_text",
  maxInputTokens: 8_000,
  maxOutputTokens: 2_000,
  timeoutMs: 45_000,
  retryPolicy: DEFAULT_AI_RETRY_POLICY,
  temperature: 0.4,
  structuredOutputRequired: true,
  sensitiveDataPolicy: "strict",
  providerFallbackAllowed: false,
};
