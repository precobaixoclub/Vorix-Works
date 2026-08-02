import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { AiCapability, AiFailureCategory, AiFinishReason } from "../../application/ports/ai-gateway.port.js";
import type {
  AiModelProviderHealth,
  AiModelProviderPort,
  AiModelProviderRequest,
  AiModelProviderResult,
} from "../../application/ports/ai-model-provider.port.js";

/**
 * ÚNICO adapter desta sprint que importa um SDK de provedor de IA (decisão obrigatória: só
 * `@anthropic-ai/sdk`, nenhum outro). Fala com a Anthropic via `tool_choice` forçado — a "tool" é
 * o próprio schema de saída estruturada (`input_schema`), então a resposta do modelo É os
 * argumentos da tool call, já `JSON.parse`ados pelo SDK (nunca texto livre para fazer parse aqui).
 * Nunca decide nada de negócio — só traduz `AiModelProviderRequest` → chamada real → resultado
 * bruto (`rawOutput`, ainda não validado — isso é responsabilidade do `AiGateway`).
 */
export class AnthropicAiModelProvider implements AiModelProviderPort {
  readonly id = "anthropic";
  readonly capabilities: readonly AiCapability[] = ["structured_text", "tool_calling", "free_text"];
  private readonly client?: Anthropic;

  constructor(options: { apiKey?: string }) {
    this.client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : undefined;
  }

  isConfigured(): boolean {
    return this.client !== undefined;
  }

  async execute(request: AiModelProviderRequest): Promise<AiModelProviderResult> {
    if (!this.client) {
      return { ok: false, category: "not_configured", message: "AnthropicAiModelProvider sem credencial configurada.", latencyMs: 0 };
    }

    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          system: request.systemPrompt,
          messages: [{ role: "user", content: request.userInput }],
          tools: [
            {
              name: request.toolName,
              description: request.toolDescription,
              input_schema: request.toolInputSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: request.toolName },
        },
        { timeout: request.timeoutMs },
      );

      const latencyMs = Date.now() - startedAt;
      const toolUseBlock = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

      if (!toolUseBlock) {
        return { ok: false, category: "invalid_output", message: "O provider não retornou uma tool call, apesar de tool_choice forçado.", latencyMs };
      }

      return {
        ok: true,
        rawOutput: toolUseBlock.input,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cachedInputTokens: response.usage.cache_read_input_tokens ?? undefined,
          providerReported: true,
        },
        finishReason: mapStopReason(response.stop_reason),
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const classified = classifyAnthropicError(error);
      return { ok: false, category: classified.category, message: classified.message, latencyMs };
    }
  }

  async healthCheck(): Promise<AiModelProviderHealth> {
    return { ok: this.isConfigured() };
  }
}

function mapStopReason(stopReason: string | null): AiFinishReason {
  switch (stopReason) {
    case "tool_use":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "error";
  }
}

function classifyAnthropicError(error: unknown): { category: AiFailureCategory; message: string } {
  if (error instanceof APIConnectionTimeoutError) return { category: "timeout", message: "Timeout ao chamar o provider Anthropic." };
  if (error instanceof RateLimitError) return { category: "rate_limited", message: "Rate limit do provider Anthropic." };
  if (error instanceof AuthenticationError) return { category: "authentication_failed", message: "Credencial Anthropic inválida." };
  if (error instanceof PermissionDeniedError) return { category: "authentication_failed", message: "Permissão negada pelo provider Anthropic." };
  if (error instanceof BadRequestError) return { category: "invalid_request", message: "Requisição inválida para o provider Anthropic." };
  if (error instanceof APIConnectionError) return { category: "provider_unavailable", message: "Falha de conexão com o provider Anthropic." };
  if (error instanceof InternalServerError) return { category: "provider_unavailable", message: "Erro interno do provider Anthropic." };
  return { category: "internal_error", message: "Erro inesperado ao chamar o provider Anthropic." };
}
