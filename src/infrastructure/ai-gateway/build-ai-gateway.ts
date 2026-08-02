import { AiGateway } from "../../application/ai-gateway/ai-gateway.js";
import type { AiOperationModelBindings } from "../../application/ai-gateway/model-router.js";
import type { AiExecutionRepositoryPort } from "../../application/ports/ai-execution-repository.port.js";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import type { AiTelemetryPort } from "../../application/ports/ai-telemetry.port.js";
import { AnthropicAiModelProvider } from "../ai/anthropic-ai-model-provider.js";
import { createNotConfiguredAiGateway } from "../ai/not-configured-ai-gateway.js";
import { InMemoryAiCircuitBreaker } from "./in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "./in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "./in-memory-ai-telemetry.js";

export type BuildAiGatewayOptions = {
  aiConfig: {
    enabled: boolean;
    briefingExtractionEnabled: boolean;
    anthropicApiKey?: string;
    anthropicBriefingExtractionModel: string;
  };
  executionRepository: AiExecutionRepositoryPort;
  telemetry?: AiTelemetryPort;
};

export type BuiltAiGateway = {
  aiGateway: AiGatewayPort;
  /** Já é `aiConfig.enabled && aiConfig.briefingExtractionEnabled` — o único valor que
   * `process-briefing-turn.ts` precisa (Fase 19: checado na aplicação, nunca no domínio). */
  aiExtractionEnabled: boolean;
};

/**
 * Único ponto de construção do AI Gateway ("composition root" do stack de IA, mesmo papel de
 * `buildPlatformRepositories`/`buildIdentityRepositories`). `enabled=false` devolve o MESMO
 * `NotConfiguredAiGateway` da Sprint 06 — comportamento idêntico à Sprint 07 (Fase 37).
 */
export function buildAiGateway(options: BuildAiGatewayOptions): BuiltAiGateway {
  if (!options.aiConfig.enabled) {
    return { aiGateway: createNotConfiguredAiGateway(), aiExtractionEnabled: false };
  }

  const anthropicProvider = new AnthropicAiModelProvider({ apiKey: options.aiConfig.anthropicApiKey });

  const bindings: AiOperationModelBindings = {
    briefing_field_extraction: { provider: "anthropic", modelId: options.aiConfig.anthropicBriefingExtractionModel },
  };

  const aiGateway = new AiGateway({
    providers: [anthropicProvider],
    bindings,
    rateLimiter: new InMemoryAiRateLimiter(),
    circuitBreaker: new InMemoryAiCircuitBreaker(),
    executionRepository: options.executionRepository,
    telemetry: options.telemetry ?? new InMemoryAiTelemetry(),
  });

  return { aiGateway, aiExtractionEnabled: options.aiConfig.briefingExtractionEnabled };
}
