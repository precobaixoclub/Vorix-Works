import type { AiCapability, AiFailureCategory } from "../../application/ports/ai-gateway.port.js";
import type {
  AiModelProviderHealth,
  AiModelProviderPort,
  AiModelProviderRequest,
  AiModelProviderResult,
} from "../../application/ports/ai-model-provider.port.js";

/**
 * `FakeAiModelProvider` — o ÚNICO provider usado pela suíte padrão (Fase 22/35: "nunca tornar a
 * suíte principal dependente de rede"). Sem SDK, sem I/O, respostas roteirizadas — cada chamada
 * consome a próxima entrada do script (a última entrada repete se o script acabar), permitindo
 * simular sequências reais: falha transitória seguida de sucesso, saída inválida, timeout, etc.
 */
export type FakeAiModelProviderScriptEntry = AiModelProviderResult | ((request: AiModelProviderRequest) => AiModelProviderResult);

export type FakeAiModelProviderOptions = {
  id?: string;
  capabilities?: readonly AiCapability[];
  script: readonly FakeAiModelProviderScriptEntry[];
  configured?: boolean;
};

export class FakeAiModelProvider implements AiModelProviderPort {
  readonly id: string;
  readonly capabilities: readonly AiCapability[];
  private readonly script: readonly FakeAiModelProviderScriptEntry[];
  private readonly configured: boolean;
  private callIndex = 0;

  constructor(options: FakeAiModelProviderOptions) {
    this.id = options.id ?? "fake-ai-model-provider";
    this.capabilities = options.capabilities ?? ["structured_text", "tool_calling", "free_text"];
    this.script = options.script;
    this.configured = options.configured ?? true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async execute(request: AiModelProviderRequest): Promise<AiModelProviderResult> {
    const entry = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex += 1;
    return typeof entry === "function" ? entry(request) : entry;
  }

  async healthCheck(): Promise<AiModelProviderHealth> {
    return { ok: this.configured };
  }

  get callCount(): number {
    return this.callIndex;
  }
}

export function fakeSuccess(rawOutput: unknown, overrides: Partial<Extract<AiModelProviderResult, { ok: true }>> = {}): AiModelProviderResult {
  return {
    ok: true,
    rawOutput,
    usage: { inputTokens: 120, outputTokens: 80, providerReported: true },
    finishReason: "stop",
    latencyMs: 42,
    ...overrides,
  };
}

export function fakeFailure(category: AiFailureCategory, message: string): AiModelProviderResult {
  return { ok: false, category, message, latencyMs: 10 };
}
