import type {
  AiMediaGenerationFailureCategory,
  AiMediaGenerationRequest,
  AiMediaGenerationResult,
  AiMediaProviderAdapterPort,
  AiMediaProviderDescriptor,
} from "../../application/ports/ai-media-provider-adapter.port.js";

/**
 * Adapter Google Gemini/Veo (vídeo) — **AVISO**: diferente do adapter OpenAI (imagem), este
 * NÃO foi verificado contra um app registrado de verdade no Google AI Studio/Vertex — mesma
 * ressalva de `docs/kwai-publishing.md`. A forma abaixo (`predictLongRunning` + polling de
 * `operations/{name}`) segue a documentação pública da Gemini API para Veo, mas geração de vídeo é
 * assíncrona por natureza (pode levar minutos) — confirme os nomes de campo exatos e o tempo de
 * polling contra a API real antes de habilitar em produção. Se algo aqui não bater com o que a
 * Google documenta, o portal oficial é a fonte de verdade, não este arquivo.
 */
export type GoogleVeoProviderConfig = {
  apiBaseUrl?: string;
  enabled: boolean;
  getApiKey: () => Promise<string | undefined>;
  /** Intervalo de polling da operação assíncrona (Veo não devolve o vídeo pronto na primeira chamada). */
  pollIntervalMs?: number;
};

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const CACHE_TTL_MS = 60_000;

export class GoogleVeoProviderAdapter implements AiMediaProviderAdapterPort {
  readonly descriptor: AiMediaProviderDescriptor;
  private cachedKey?: string;
  private cachedAt = 0;

  constructor(private readonly config: GoogleVeoProviderConfig, private readonly httpClient: typeof fetch = fetch) {
    this.descriptor = {
      providerCode: "google",
      displayName: "Google Gemini/Veo (vídeo)",
      enabled: config.enabled,
      capabilities: ["video_generation"],
    };
  }

  private async resolveApiKey(): Promise<string | undefined> {
    const now = Date.now();
    if (now - this.cachedAt > CACHE_TTL_MS) {
      this.cachedKey = await this.config.getApiKey();
      this.cachedAt = now;
    }
    return this.cachedKey;
  }

  async generate(request: AiMediaGenerationRequest): Promise<AiMediaGenerationResult> {
    const startedAt = Date.now();
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      return { ok: false, category: "not_configured", message: "GoogleVeoProviderAdapter sem API key configurada.", latencyMs: 0 };
    }

    const baseUrl = this.config.apiBaseUrl ?? DEFAULT_BASE_URL;
    const durationSeconds = typeof request.params.durationSeconds === "number" ? request.params.durationSeconds : 5;
    const aspectRatio = typeof request.params.aspectRatio === "string" ? request.params.aspectRatio : "16:9";

    try {
      const startResponse = await this.httpClient(
        `${baseUrl}/v1beta/models/${request.modelId}:predictLongRunning?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: request.prompt }],
            parameters: { durationSeconds, aspectRatio },
          }),
        },
      );
      if (!startResponse.ok) return { ok: false, ...(await classifyGoogleError(startResponse)), latencyMs: Date.now() - startedAt };

      const startBody = (await startResponse.json()) as { name?: string };
      if (!startBody.name) return { ok: false, category: "invalid_request", message: "Google não retornou o nome da operação assíncrona.", latencyMs: Date.now() - startedAt };

      const mediaUrl = await this.pollUntilDone(baseUrl, apiKey, startBody.name, request.timeoutMs);
      const latencyMs = Date.now() - startedAt;
      if (!mediaUrl) return { ok: false, category: "timeout", message: "Geração de vídeo não terminou dentro do tempo limite.", latencyMs };

      return { ok: true, mediaUrl, billableUnits: durationSeconds, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return { ok: false, category: "provider_unavailable", message: "Falha de conexão com a Google (Veo).", latencyMs };
    }
  }

  private async pollUntilDone(baseUrl: string, apiKey: string, operationName: string, timeoutMs: number): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    const intervalMs = this.config.pollIntervalMs ?? 5_000;
    while (Date.now() < deadline) {
      const response = await this.httpClient(`${baseUrl}/v1beta/${operationName}?key=${apiKey}`);
      if (response.ok) {
        const body = (await response.json()) as { done?: boolean; response?: { generatedVideos?: Array<{ video?: { uri?: string } }> } };
        if (body.done) return body.response?.generatedVideos?.[0]?.video?.uri;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return undefined;
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    const apiKey = await this.resolveApiKey();
    return { ok: Boolean(apiKey), safeMessage: apiKey ? undefined : "API key da Google não configurada." };
  }
}

async function classifyGoogleError(response: Response): Promise<{ category: AiMediaGenerationFailureCategory; message: string }> {
  if (response.status === 401 || response.status === 403) return { category: "authentication_failed", message: "Credencial Google inválida ou sem permissão." };
  if (response.status === 429) return { category: "rate_limited", message: "Rate limit da Google." };
  if (response.status >= 500) return { category: "provider_unavailable", message: "Erro interno da Google." };
  if (response.status === 400) return { category: "invalid_request", message: "Requisição inválida para a Google (Veo)." };
  return { category: "internal_error", message: "Erro inesperado ao chamar a Google (Veo)." };
}
