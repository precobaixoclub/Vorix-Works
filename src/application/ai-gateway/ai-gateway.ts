import type { AiCircuitBreakerPort } from "../ports/ai-circuit-breaker.port.js";
import type { AiExecutionRepositoryPort } from "../ports/ai-execution-repository.port.js";
import type { AiFailure, AiFailureCategory, AiGatewayPort, AiGatewayResult, AiRequest, AiResponse } from "../ports/ai-gateway.port.js";
import type { AiModelProviderPort } from "../ports/ai-model-provider.port.js";
import type { AiRateLimiterPort } from "../ports/ai-rate-limiter.port.js";
import type { AiTelemetryPort } from "../ports/ai-telemetry.port.js";
import { buildAiUsage } from "./cost-calculator.js";
import { sanitizeAiInput } from "./input-sanitizer.js";
import type { AiOperationModelBindings } from "./model-router.js";
import { routeAiRequest } from "./model-router.js";
import { checkRenderedPrompt } from "./post-render-check.js";
import { getPromptTemplateRegistration } from "./prompt-template-registry.js";
import { computeBackoffMs, isRetryableFailure } from "./retry-policy.js";

/** Aproximação grosseira, documentada: ~4 caracteres por token. Não há tokenizer real nesta
 * sprint — só o suficiente para impor um limite antes de gastar uma chamada de verdade. */
const CHARS_PER_TOKEN_ESTIMATE = 4;
/** Margem extra sobre o input sanitizado para cobrir o texto fixo de instrução do template — o
 * `AiInputSanitizer` já limitou o INPUT do usuário; isto cobre o prompt final RENDERIZADO. */
const RENDERED_PROMPT_OVERHEAD_CHARS = 6_000;

export type AiGatewayDeps = {
  providers: readonly AiModelProviderPort[];
  bindings: AiOperationModelBindings;
  rateLimiter: AiRateLimiterPort;
  circuitBreaker: AiCircuitBreakerPort;
  executionRepository: AiExecutionRepositoryPort;
  telemetry: AiTelemetryPort;
  idGenerator?: () => string;
  now?: () => Date;
};

const defaultIdGenerator = () => `ai-trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `AiGateway` — Sprint 08 (Fase 4/13/14). Única implementação real de `AiGatewayPort`. Orquestra:
 * rate limit → roteamento (inclui circuit breaker) → sanitização OBRIGATÓRIA → renderização do
 * prompt → verificação pós-renderização → chamada ao provider (com retry só para falha
 * transitória) → validação estrutural (Zod strict) → validação semântica → custo → persistência
 * → telemetria. NUNCA lança para falha esperada — sempre `AiGatewayResult`.
 */
export class AiGateway implements AiGatewayPort {
  constructor(private readonly deps: AiGatewayDeps) {}

  async execute(request: AiRequest): Promise<AiGatewayResult> {
    const startedAt = Date.now();
    const traceId = (this.deps.idGenerator ?? defaultIdGenerator)();

    const rateDecision = await this.deps.rateLimiter.consume({ tenantId: request.tenantId, operation: request.operation });
    if (!rateDecision.allowed) {
      return this.fail(request, traceId, startedAt, {
        category: "rate_limited",
        message: `Limite de chamadas de IA excedido para esta operação — tente novamente em ${rateDecision.retryAfterMs}ms.`,
        retryable: true,
      });
    }

    const registration = getPromptTemplateRegistration(request.operation);
    if (!registration) {
      return this.fail(request, traceId, startedAt, {
        category: "not_configured",
        message: `Nenhum template de prompt registrado para "${request.operation}".`,
        retryable: false,
      });
    }

    const routing = routeAiRequest({
      request,
      providers: this.deps.providers,
      bindings: this.deps.bindings,
      isProviderAvailable: (id) => this.deps.circuitBreaker.isAvailable(id),
    });
    if (!routing.ok) {
      return this.fail(request, traceId, startedAt, routing.error);
    }

    const sanitized = sanitizeAiInput({
      input: request.input,
      expectedTenantId: request.tenantId,
      expectedWorkspaceId: request.workspaceId,
      maxInputChars: request.policy.maxInputTokens * CHARS_PER_TOKEN_ESTIMATE,
    });
    if (!sanitized.ok) {
      return this.fail(request, traceId, startedAt, { category: "invalid_request", message: sanitized.message, retryable: false });
    }

    let context: unknown;
    try {
      context = registration.buildContext(sanitized.sanitized);
    } catch (error) {
      return this.fail(request, traceId, startedAt, {
        category: "internal_error",
        message: error instanceof Error ? error.message : "Falha ao construir o contexto do prompt.",
        retryable: false,
      });
    }

    const systemPrompt = registration.template.buildSystemInstructions(context);
    const userInput = registration.template.buildUserInput(context);

    const renderCheck = checkRenderedPrompt({
      systemPrompt,
      userInput,
      maxTotalChars: request.policy.maxInputTokens * CHARS_PER_TOKEN_ESTIMATE + RENDERED_PROMPT_OVERHEAD_CHARS,
    });
    if (!renderCheck.ok) {
      return this.fail(request, traceId, startedAt, { category: "policy_violation", message: `Prompt renderizado rejeitado: ${renderCheck.reason}.`, retryable: false });
    }

    let totalRetryCount = 0;
    let lastFailure: AiFailure | undefined;

    for (let candidateIndex = 0; candidateIndex < routing.candidates.length; candidateIndex += 1) {
      const candidate = routing.candidates[candidateIndex];
      const fallbackUsed = candidateIndex > 0;

      for (let attempt = 1; attempt <= request.policy.retryPolicy.maxAttempts; attempt += 1) {
        const providerResult = await candidate.provider.execute({
          operation: request.operation,
          model: candidate.modelId,
          systemPrompt,
          userInput,
          toolName: registration.toolName,
          toolDescription: registration.toolDescription,
          toolInputSchema: registration.toolInputSchema,
          maxOutputTokens: request.policy.maxOutputTokens,
          temperature: request.policy.temperature,
          timeoutMs: request.policy.timeoutMs,
        });

        if (!providerResult.ok) {
          this.deps.circuitBreaker.recordFailure(candidate.provider.id);
          lastFailure = { category: providerResult.category, message: providerResult.message, retryable: isRetryableFailure(providerResult.category, request.policy.retryPolicy), provider: candidate.provider.id, model: candidate.modelId };

          const canRetrySameCandidate = isRetryableFailure(providerResult.category, request.policy.retryPolicy) && attempt < request.policy.retryPolicy.maxAttempts;
          if (canRetrySameCandidate) {
            totalRetryCount += 1;
            await sleep(computeBackoffMs(attempt));
            continue;
          }
          break; // tenta o próximo candidato (se houver e a política permitir), fora deste loop de attempt
        }

        this.deps.circuitBreaker.recordSuccess(candidate.provider.id);

        const structural = registration.validateStructure(providerResult.rawOutput);
        if (!structural.valid) {
          lastFailure = { category: "invalid_output", message: `Saída estrutural inválida: ${structural.errors.join("; ")}`, retryable: false, provider: candidate.provider.id, model: candidate.modelId };
          break;
        }

        const semantic = registration.validateSemantics(structural.data, sanitized.sanitized);
        if (!semantic.valid) {
          lastFailure = { category: "invalid_output", message: `Saída semanticamente inválida: ${semantic.errors.join("; ")}`, retryable: false, provider: candidate.provider.id, model: candidate.modelId };
          break;
        }

        const usage = buildAiUsage({
          entry: candidate.registryEntry,
          inputTokens: providerResult.usage.inputTokens,
          outputTokens: providerResult.usage.outputTokens,
          cachedInputTokens: providerResult.usage.cachedInputTokens,
          providerReported: providerResult.usage.providerReported,
        });

        const response: AiResponse = {
          operation: request.operation,
          provider: candidate.provider.id,
          model: candidate.modelId,
          output: semantic.data,
          validated: true,
          usage,
          latencyMs: providerResult.latencyMs,
          finishReason: providerResult.finishReason,
          warnings: semantic.warnings,
          traceId,
        };

        await this.persist({
          request,
          traceId,
          startedAt,
          status: "succeeded",
          provider: candidate.provider.id,
          model: candidate.modelId,
          promptTemplateId: registration.template.id,
          promptVersion: registration.template.version,
          promptHash: registration.template.hash,
          usage,
          latencyMs: providerResult.latencyMs,
          retryCount: totalRetryCount,
          fallbackUsed,
          finishReason: providerResult.finishReason,
        });
        this.deps.telemetry.record({
          operation: request.operation,
          outcome: "succeeded",
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          correlationId: request.correlationId,
          traceId,
          provider: candidate.provider.id,
          model: candidate.modelId,
          retryCount: totalRetryCount,
          providerFallbackUsed: fallbackUsed,
          latencyMs: providerResult.latencyMs,
          usage,
        });

        return { ok: true, data: response };
      }

      if (!request.policy.providerFallbackAllowed) break;
    }

    return this.fail(request, traceId, startedAt, lastFailure ?? { category: "internal_error", message: "Falha desconhecida no AI Gateway.", retryable: false }, totalRetryCount);
  }

  private async fail(request: AiRequest, traceId: string, startedAt: number, error: AiFailure, retryCount = 0): Promise<AiGatewayResult> {
    await this.persist({
      request,
      traceId,
      startedAt,
      status: "failed",
      provider: error.provider ?? "none",
      model: error.model ?? "none",
      promptTemplateId: "n/a",
      promptVersion: 0,
      promptHash: "n/a",
      retryCount,
      fallbackUsed: false,
      errorCategory: error.category,
    });
    this.deps.telemetry.record({
      operation: request.operation,
      outcome: "failed",
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      correlationId: request.correlationId,
      traceId,
      provider: error.provider,
      model: error.model,
      failureCategory: error.category,
      retryCount,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, error };
  }

  private async persist(params: {
    request: AiRequest;
    traceId: string;
    startedAt: number;
    status: "succeeded" | "failed";
    provider: string;
    model: string;
    promptTemplateId: string;
    promptVersion: number;
    promptHash: string;
    usage?: AiResponse["usage"];
    latencyMs?: number;
    retryCount: number;
    fallbackUsed: boolean;
    finishReason?: AiResponse["finishReason"];
    errorCategory?: AiFailureCategory;
  }): Promise<void> {
    const completedAt = new Date().toISOString();
    await this.deps.executionRepository.create({
      id: params.traceId,
      tenantId: params.request.tenantId,
      workspaceId: params.request.workspaceId,
      userId: params.request.userId,
      conversationId: params.request.conversationId,
      briefingId: params.request.briefingId,
      operation: params.request.operation,
      provider: params.provider,
      model: params.model,
      promptTemplateId: params.promptTemplateId,
      promptVersion: params.promptVersion,
      promptHash: params.promptHash,
      status: params.status,
      inputTokenCount: params.usage?.inputTokens ?? 0,
      outputTokenCount: params.usage?.outputTokens ?? 0,
      totalTokenCount: params.usage?.totalTokens ?? 0,
      estimatedCost: params.usage?.estimatedCost ?? 0,
      currency: "USD",
      latencyMs: params.latencyMs ?? Date.now() - params.startedAt,
      retryCount: params.retryCount,
      fallbackUsed: params.fallbackUsed,
      finishReason: params.finishReason,
      errorCategory: params.errorCategory,
      traceId: params.traceId,
      correlationId: params.request.correlationId,
      completedAt,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
