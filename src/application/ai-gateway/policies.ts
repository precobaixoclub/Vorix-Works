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
