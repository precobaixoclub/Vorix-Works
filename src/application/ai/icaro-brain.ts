import { createHash } from "node:crypto";
import type {
  AICostReport,
  AIProviderFailureKind,
  AIProviderPort,
  AIProviderRequest,
  AIProviderResponse,
  AITokenUsage,
} from "../ports/ai-provider.port.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { IcaroBrainPort } from "./icaro-brain.contract.js";
import type { IcaroLoggerPort } from "./icaro-log.contract.js";
import type { IcaroProviderSelectionPolicyPort } from "./icaro-selection-policy.js";
import { DeterministicIcaroProviderSelectionPolicy } from "./icaro-selection-policy.js";
import type {
  AIRequestCachePort,
  IcaroAIRequest,
  IcaroAIResponse,
  IcaroCachePolicy,
  IcaroCostLedgerPort,
  IcaroFallbackPolicy,
  IcaroIdGenerator,
  IcaroProviderSelection,
  IcaroRetryPolicy,
  IcaroTaskConfiguration,
} from "./icaro.types.js";

export type IcaroAIBrainDependencies = {
  providers: AIProviderPort[];
  selectionPolicy?: IcaroProviderSelectionPolicyPort;
  logger?: IcaroLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  costLedger?: IcaroCostLedgerPort;
  cache?: AIRequestCachePort;
  retryPolicy?: Partial<IcaroRetryPolicy>;
  fallbackPolicy?: Partial<IcaroFallbackPolicy>;
  cachePolicy?: Partial<IcaroCachePolicy>;
  idGenerator?: IcaroIdGenerator;
  now?: () => Date;
};

type ClassifiedAIError = {
  kind: AIProviderFailureKind | "no_provider" | "unknown";
  message: string;
  retryable: boolean;
};

class SequentialIcaroIdGenerator implements IcaroIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopIcaroLogger implements IcaroLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopCostLedger implements IcaroCostLedgerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class IcaroAIBrain implements IcaroBrainPort {
  private readonly providers: AIProviderPort[];
  private readonly selectionPolicy: IcaroProviderSelectionPolicyPort;
  private readonly logger: IcaroLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly costLedger: IcaroCostLedgerPort;
  private readonly cache?: AIRequestCachePort;
  private readonly retryPolicy: IcaroRetryPolicy;
  private readonly fallbackPolicy: IcaroFallbackPolicy;
  private readonly cachePolicy: IcaroCachePolicy;
  private readonly idGenerator: IcaroIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: IcaroAIBrainDependencies) {
    this.providers = dependencies.providers;
    this.selectionPolicy = dependencies.selectionPolicy ?? new DeterministicIcaroProviderSelectionPolicy();
    this.logger = dependencies.logger ?? new NoopIcaroLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.costLedger = dependencies.costLedger ?? new NoopCostLedger();
    this.cache = dependencies.cache;
    this.retryPolicy = {
      maxAttemptsPerProvider: dependencies.retryPolicy?.maxAttemptsPerProvider ?? 2,
      retryableFailures: dependencies.retryPolicy?.retryableFailures ?? ["temporary", "timeout", "rate_limit"],
    };
    this.fallbackPolicy = {
      enabled: dependencies.fallbackPolicy?.enabled ?? true,
      maxFallbackProviders: dependencies.fallbackPolicy?.maxFallbackProviders ?? 2,
    };
    this.cachePolicy = {
      enabled: dependencies.cachePolicy?.enabled ?? false,
      ttlSeconds: dependencies.cachePolicy?.ttlSeconds,
    };
    this.idGenerator = dependencies.idGenerator ?? new SequentialIcaroIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async request(request: IcaroAIRequest): Promise<IcaroAIResponse> {
    const validationErrors = validateIcaroRequest(request);
    if (validationErrors.length > 0) {
      return this.failedResponse(request, {
        kind: "invalid_request",
        message: validationErrors.join("; "),
        retryable: false,
      }, 0, false);
    }

    await this.log("AIRequestReceived", "Ícaro recebeu uma solicitação de IA.", request, undefined, undefined, {
      taskType: request.taskType,
      expectedOutput: request.expectedOutput,
      cachePrepared: Boolean(this.cache),
      cacheEnabled: this.cachePolicy.enabled,
    });
    await this.emit("AIRequestStarted", request, {
      taskType: request.taskType,
      specialistId: request.specialistId,
    });

    const selections = this.selectProviders(request);
    if (selections.length === 0) {
      const error: ClassifiedAIError = {
        kind: "no_provider",
        message: `Nenhum Provider habilitado suporta a tarefa ${request.taskType}.`,
        retryable: false,
      };
      await this.log("Error", error.message, request, undefined, undefined, { error });
      await this.emit("AIRequestFailed", request, { error });
      const response = await this.failedResponse(request, error, 0, false);
      // Sem isto, uma falha de configuração (ex.: nenhuma chave de API válida para o Provider do
      // motor criativo) nunca deixaria rastro em `icaro_ai_calls` — o mesmo silêncio que a
      // auditoria "GPT como motor criativo único" apontou como o problema original.
      await this.recordCost(request, response);
      return response;
    }

    let totalAttempts = 0;
    let lastError: ClassifiedAIError | undefined;

    for (let selectionIndex = 0; selectionIndex < selections.length; selectionIndex += 1) {
      const selection = selections[selectionIndex];
      const provider = this.providers.find((candidate) => candidate.profile.id === selection.provider.id);
      if (!provider) continue;

      const fallbackUsed = selectionIndex > 0;
      if (fallbackUsed) {
        await this.log("FallbackStarted", `Fallback iniciado para Provider ${selection.provider.id}.`, request, undefined, selection, {
          previousError: lastError,
        });
        await this.emit("AIFallback", request, {
          providerId: selection.provider.id,
          modelId: selection.model.id,
          previousError: lastError,
        });
      }

      await this.log("ProviderSelected", `Provider ${selection.provider.id} selecionado pelo Ícaro.`, request, undefined, selection, {
        reason: selection.reason,
        score: selection.score,
      });
      await this.emit("ProviderSelected", request, {
        providerId: selection.provider.id,
        reason: selection.reason,
        score: selection.score,
      });

      await this.log("ModelSelected", `Modelo ${selection.model.id} selecionado pelo Ícaro.`, request, undefined, selection, {
        qualityScore: selection.model.qualityScore,
        speedScore: selection.model.speedScore,
      });
      await this.emit("ModelSelected", request, {
        providerId: selection.provider.id,
        modelId: selection.model.id,
      });

      for (let providerAttempt = 1; providerAttempt <= this.retryPolicy.maxAttemptsPerProvider; providerAttempt += 1) {
        totalAttempts += 1;
        const configuration = this.resolveTaskConfiguration(request, selection);
        const providerRequest = this.toProviderRequest(request, selection, configuration);
        const startedAt = Date.now();

        await this.log("AICallStarted", `Chamada de IA iniciada no Provider ${selection.provider.id}.`, request, providerAttempt, selection, {
          totalAttempts,
          configuration,
          fallbackUsed,
        });

        try {
          const providerResponse = await withTimeout(
            provider.execute(providerRequest),
            configuration.timeoutMs,
            `Timeout após ${configuration.timeoutMs}ms no Provider ${selection.provider.id}.`,
          );
          const durationMs = Math.max(0, Date.now() - startedAt);
          const tokens = normalizeTokens(request, providerResponse);
          const cost = normalizeCost(selection, tokens, providerResponse);
          const response: IcaroAIResponse = {
            status: "completed",
            provider: {
              id: selection.provider.id,
              name: selection.provider.name,
            },
            model: {
              id: providerResponse.model || selection.model.id,
            },
            durationMs,
            tokens,
            cost,
            content: providerResponse.content,
            warnings: providerResponse.warnings ?? [],
            attempt: {
              total: totalAttempts,
              providerAttempt,
              providerId: selection.provider.id,
            },
            fallbackUsed,
          };

          await this.recordCost(request, response);
          await this.log("AICallFinished", `Chamada de IA concluída no Provider ${selection.provider.id}.`, request, providerAttempt, selection, {
            durationMs,
            tokens,
            cost,
          });
          await this.emit("AIRequestFinished", request, {
            providerId: selection.provider.id,
            modelId: response.model.id,
            durationMs,
            tokens,
            cost,
            fallbackUsed,
          });
          await this.log("ResponseDelivered", "Resposta padronizada entregue pelo Ícaro.", request, providerAttempt, selection, {
            status: response.status,
          });
          return response;
        } catch (error) {
          const durationMs = Math.max(0, Date.now() - startedAt);
          lastError = classifyError(error);
          const logAction = lastError.kind === "timeout" ? "Timeout" : "Error";

          await this.log(logAction, lastError.message, request, providerAttempt, selection, {
            durationMs,
            totalAttempts,
            retryable: lastError.retryable,
            fallbackUsed,
          });

          const canRetry = providerAttempt < this.retryPolicy.maxAttemptsPerProvider
            && lastError.retryable
            && this.retryPolicy.retryableFailures.includes(lastError.kind as AIProviderFailureKind);

          if (canRetry) {
            await this.log("RetryScheduled", `Retry ${providerAttempt + 1} agendado para Provider ${selection.provider.id}.`, request, providerAttempt, selection, {
              error: lastError,
            });
            await this.emit("AIRetry", request, {
              providerId: selection.provider.id,
              modelId: selection.model.id,
              nextAttempt: providerAttempt + 1,
              error: lastError,
            });
            continue;
          }

          break;
        }
      }
    }

    const finalError = lastError ?? {
      kind: "unknown" as const,
      message: "Todos os Providers falharam sem devolver erro específico.",
      retryable: false,
    };
    const response = await this.failedResponse(request, finalError, totalAttempts, selections.length > 1);
    await this.recordCost(request, response);
    await this.emit("AIRequestFailed", request, {
      error: finalError,
      totalAttempts,
      fallbackUsed: response.fallbackUsed,
    });
    await this.log("ResponseDelivered", "Resposta de falha padronizada entregue pelo Ícaro.", request, undefined, undefined, {
      error: finalError,
      totalAttempts,
    });
    return response;
  }

  private selectProviders(request: IcaroAIRequest): IcaroProviderSelection[] {
    const selections = this.selectionPolicy.select(request, this.providers);
    if (!this.fallbackPolicy.enabled) return selections.slice(0, 1);
    return selections.slice(0, Math.max(1, this.fallbackPolicy.maxFallbackProviders + 1));
  }

  private resolveTaskConfiguration(request: IcaroAIRequest, selection: IcaroProviderSelection): IcaroTaskConfiguration {
    return {
      temperature: request.temperature ?? selection.model.defaultTemperature,
      maxTokens: Math.min(request.maxTokens ?? selection.model.defaultMaxTokens, selection.model.maxTokens),
      timeoutMs: request.timeoutMs ?? 30_000,
    };
  }

  private toProviderRequest(
    request: IcaroAIRequest,
    selection: IcaroProviderSelection,
    configuration: IcaroTaskConfiguration,
  ): AIProviderRequest {
    return {
      taskType: request.taskType,
      prompt: request.prompt,
      model: selection.model.id,
      temperature: configuration.temperature,
      maxTokens: configuration.maxTokens,
      timeoutMs: configuration.timeoutMs,
      context: {
        ...request.context,
        specialistId: request.specialistId,
        executionId: request.executionId,
        taskId: request.taskId,
        correlationId: request.correlationId,
      },
      constraints: request.constraints,
      expectedOutput: request.expectedOutput,
      imageUrls: request.imageUrls,
    };
  }

  private async failedResponse(
    request: IcaroAIRequest,
    error: ClassifiedAIError,
    totalAttempts: number,
    fallbackUsed: boolean,
  ): Promise<IcaroAIResponse> {
    return {
      status: "failed",
      provider: {},
      model: {},
      durationMs: 0,
      tokens: {
        input: 0,
        output: 0,
        total: 0,
      },
      cost: {
        estimated: 0,
        currency: "USD",
      },
      warnings: [error.message],
      attempt: {
        total: totalAttempts,
        providerAttempt: 0,
      },
      fallbackUsed,
      error,
    };
  }

  private async recordCost(request: IcaroAIRequest, response: IcaroAIResponse): Promise<void> {
    await this.costLedger.record({
      id: this.idGenerator.create("ai-cost"),
      occurredAt: this.timestamp(),
      specialistId: request.specialistId,
      taskType: request.taskType,
      providerId: response.provider.id,
      modelId: response.model.id,
      executionId: request.executionId,
      taskId: request.taskId,
      durationMs: response.durationMs,
      tokens: response.tokens,
      cost: response.cost,
      status: response.status,
      correlationId: request.correlationId,
      promptHash: hashPrompt(request.prompt),
      promptChars: request.prompt.length,
      retryCount: Math.max(0, response.attempt.total - 1),
      fallbackUsed: response.fallbackUsed,
    });
  }

  private async log(
    action: Parameters<IcaroLoggerPort["record"]>[0]["action"],
    message: string,
    request: IcaroAIRequest,
    attempt?: number,
    selection?: IcaroProviderSelection,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("icaro-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      specialistId: request.specialistId,
      executionId: request.executionId,
      taskId: request.taskId,
      providerId: selection?.provider.id,
      modelId: selection?.model.id,
      attempt,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, request: IcaroAIRequest, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.executionId,
      skillId: request.specialistId,
      taskId: request.taskId,
      payload: {
        source: "icaro",
        correlationId: request.correlationId,
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateIcaroRequest(request: IcaroAIRequest): string[] {
  const errors: string[] = [];
  if (!request || typeof request !== "object") return ["Solicitação de IA obrigatória."];
  if (!request.taskType) errors.push("taskType é obrigatório.");
  if (!request.specialistId?.trim()) errors.push("specialistId é obrigatório.");
  if (!request.prompt?.trim()) errors.push("prompt é obrigatório.");
  return errors;
}

function normalizeTokens(request: IcaroAIRequest, response: AIProviderResponse): AITokenUsage {
  const input = response.tokens?.input ?? estimateTokens(request.prompt);
  const output = response.tokens?.output ?? estimateTokens(String(response.content ?? ""));
  const total = response.tokens?.total ?? input + output;
  return { input, output, total };
}

function normalizeCost(selection: IcaroProviderSelection, tokens: AITokenUsage, response: AIProviderResponse): AICostReport {
  const estimated = response.cost?.estimated ?? (
    ((tokens.input / 1000) * selection.model.costPer1kInputTokens) +
    ((tokens.output / 1000) * selection.model.costPer1kOutputTokens)
  );
  return {
    estimated,
    actual: response.cost?.actual,
    currency: response.cost?.currency ?? "USD",
  };
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

/** Nunca o prompt em si — só um hash pra correlacionar/deduplicar sem reter conteúdo (mesmo
 * padrão de `ai-gateway.ts`/`ai_executions.prompt_hash`). */
function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function classifyError(error: unknown): ClassifiedAIError {
  const candidate = error as Partial<ClassifiedAIError> & { name?: string; kind?: string; retryable?: boolean; message?: string };
  const message = candidate?.message ?? "Erro desconhecido no Provider de IA.";

  if (candidate?.kind === "temporary" || candidate?.kind === "rate_limit" || candidate?.kind === "invalid_request" || candidate?.kind === "provider_error") {
    return {
      kind: candidate.kind,
      message,
      retryable: Boolean(candidate.retryable ?? candidate.kind !== "invalid_request"),
    };
  }

  if (candidate?.kind === "timeout" || candidate?.name === "TimeoutError" || message.toLowerCase().includes("timeout")) {
    return {
      kind: "timeout",
      message,
      retryable: true,
    };
  }

  return {
    kind: "provider_error",
    message,
    retryable: Boolean(candidate?.retryable ?? false),
  };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(timeoutMessage);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function createIcaroAIBrain(dependencies: IcaroAIBrainDependencies): IcaroAIBrain {
  return new IcaroAIBrain(dependencies);
}
