import type { AiCapability, AiFailureCategory, AiFinishReason, AiOperation } from "./ai-gateway.port.js";

/**
 * `AiModelProviderPort` — a porta INTERNA entre o Gateway (`src/application/ai-gateway/ai-gateway.ts`)
 * e um adapter de provider real (`src/infrastructure/ai/*-ai-model-provider.ts`). A aplicação
 * (Briefing, Conversation, qualquer caso de uso futuro) NUNCA recebe um `AiModelProviderPort`
 * diretamente — só o `AiGatewayPort`. É esta camada extra que permite trocar/adicionar provider
 * sem tocar em nenhum chamador do Gateway.
 *
 * Nome deliberadamente diferente de `AIProviderPort` (`src/application/ports/ai-provider.port.ts`,
 * usado pelo Ícaro) — são dois Ports distintos, de duas pilhas de IA distintas. Ver
 * `src/application/ai-gateway/README.md`.
 */

/** Já é o prompt RENDERIZADO (ver `PromptTemplate`) — o provider adapter nunca monta prompt, só
 * envia o que recebeu. `toolInputSchema` é JSON Schema simples (não Zod — o SDK do provider fala
 * JSON Schema; a validação Zod acontece depois, no Gateway, sobre o retorno). */
export type AiModelProviderRequest = {
  operation: AiOperation;
  model: string;
  systemPrompt: string;
  userInput: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
};

export type AiModelProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  providerReported: boolean;
};

export type AiModelProviderSuccess = {
  ok: true;
  /** Argumentos brutos da tool call, já `JSON.parse`ado — ainda NÃO validado contra o schema Zod
   * (isso é responsabilidade do Gateway, nunca do adapter). */
  rawOutput: unknown;
  usage: AiModelProviderUsage;
  finishReason: AiFinishReason;
  latencyMs: number;
};

export type AiModelProviderFailure = {
  ok: false;
  category: AiFailureCategory;
  message: string;
  latencyMs: number;
};

export type AiModelProviderResult = AiModelProviderSuccess | AiModelProviderFailure;

export type AiModelProviderHealth = { ok: boolean; message?: string };

export type AiModelProviderPort = {
  id: string;
  capabilities: readonly AiCapability[];
  /** `false` sem credencial configurada — o Router nunca seleciona um provider não configurado. */
  isConfigured(): boolean;
  execute(request: AiModelProviderRequest): Promise<AiModelProviderResult>;
  healthCheck(): Promise<AiModelProviderHealth>;
};
