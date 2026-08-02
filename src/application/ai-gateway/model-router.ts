import type { AiFailure, AiOperation, AiRequest } from "../ports/ai-gateway.port.js";
import { EXECUTABLE_AI_OPERATIONS } from "../ports/ai-gateway.port.js";
import type { AiModelProviderPort } from "../ports/ai-model-provider.port.js";
import { getModelRegistryEntry, OPERATION_REQUIRED_CAPABILITY, type AiModelRegistryEntry } from "./model-registry.js";

/**
 * AiModelRouter — Sprint 08 (Fase 7). Política determinística e testável, de propósito: operação
 * → capability exigida (mapa fixo, `model-registry.ts`) → binding operação→modelo (configuração,
 * nunca inferido) → valida contra o Registry → valida contra a `AiPolicy` do request → valida que
 * o provider está configurado e o circuit breaker não está aberto. Nenhuma pontuação por
 * custo/latência nesta sprint — o primeiro (e hoje único) candidato elegível vence.
 *
 * Devolve uma LISTA de candidatos (nunca um só) por extensibilidade — hoje, com um único provider
 * real conectado, `candidates.length` nunca passa de 1; o `providerFallbackAllowed` da política só
 * ganha efeito prático no dia em que um segundo provider real for registrado (Fase 20: não
 * obrigatório nesta sprint).
 */

export type AiOperationModelBinding = { provider: string; modelId: string };
export type AiOperationModelBindings = Partial<Record<AiOperation, AiOperationModelBinding>>;

export type AiRoutingCandidate = {
  provider: AiModelProviderPort;
  modelId: string;
  registryEntry: AiModelRegistryEntry;
};

export type AiRoutingResult = { ok: true; candidates: readonly AiRoutingCandidate[]; reason: string } | { ok: false; error: AiFailure };

export function routeAiRequest(params: {
  request: AiRequest;
  providers: readonly AiModelProviderPort[];
  bindings: AiOperationModelBindings;
  isProviderAvailable: (providerId: string) => boolean;
}): AiRoutingResult {
  const { request, providers, bindings, isProviderAvailable } = params;

  if (!EXECUTABLE_AI_OPERATIONS.includes(request.operation)) {
    return {
      ok: false,
      error: { category: "not_configured", message: `Operação "${request.operation}" existe como contrato, mas não é executável nesta sprint.`, retryable: false },
    };
  }

  const requiredCapability = OPERATION_REQUIRED_CAPABILITY[request.operation];
  if (request.policy.preferredCapability !== requiredCapability) {
    return {
      ok: false,
      error: {
        category: "invalid_request",
        message: `A política pediu a capability "${request.policy.preferredCapability}", mas a operação "${request.operation}" exige "${requiredCapability}".`,
        retryable: false,
      },
    };
  }

  const binding = bindings[request.operation];
  if (!binding) {
    return { ok: false, error: { category: "not_configured", message: `Nenhum modelo configurado para a operação "${request.operation}".`, retryable: false } };
  }

  const registryEntry = getModelRegistryEntry(binding.provider, binding.modelId);
  if (!registryEntry || registryEntry.status !== "active") {
    // Defesa em profundidade — isto deveria ter sido pego na validação de startup (Fase 5/24).
    return {
      ok: false,
      error: { category: "internal_error", message: `Binding aponta para "${binding.provider}/${binding.modelId}", que não está ativo no Model Registry.`, retryable: false },
    };
  }

  if (!registryEntry.capabilities.includes(requiredCapability)) {
    return {
      ok: false,
      error: { category: "policy_violation", message: `O modelo "${binding.modelId}" não declara a capability "${requiredCapability}".`, retryable: false },
    };
  }

  if (request.policy.allowedProviders && !request.policy.allowedProviders.includes(binding.provider)) {
    return { ok: false, error: { category: "policy_violation", message: `Provider "${binding.provider}" fora de \`allowedProviders\`.`, retryable: false } };
  }
  if (request.policy.allowedModels && !request.policy.allowedModels.includes(binding.modelId)) {
    return { ok: false, error: { category: "policy_violation", message: `Modelo "${binding.modelId}" fora de \`allowedModels\`.`, retryable: false } };
  }

  const provider = providers.find((candidate) => candidate.id === binding.provider);
  if (!provider || !provider.isConfigured()) {
    return { ok: false, error: { category: "not_configured", message: `Provider "${binding.provider}" não está configurado (sem credencial).`, retryable: false } };
  }

  if (!isProviderAvailable(provider.id)) {
    return {
      ok: false,
      error: { category: "provider_unavailable", message: `Provider "${provider.id}" está temporariamente indisponível (circuit breaker aberto).`, retryable: true, provider: provider.id },
    };
  }

  return {
    ok: true,
    reason: `Único candidato configurado para "${request.operation}": ${binding.provider}/${binding.modelId}.`,
    candidates: [{ provider, modelId: binding.modelId, registryEntry }],
  };
}
