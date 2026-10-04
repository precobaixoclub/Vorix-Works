import type {
  AiMediaGenerationFailureCategory,
  AiMediaGenerationRequest,
  AiMediaGenerationResult,
  AiMediaProviderAdapterPort,
  AiMediaProviderDescriptor,
} from "../../application/ports/ai-media-provider-adapter.port.js";
import { cropToTargetAspectRatio } from "../image-processing/aspect-ratio-crop.js";

export type OpenAiImageProviderConfig = {
  apiBaseUrl?: string;
  enabled: boolean;
  /** Consultada a cada chamada (com cache TTL, mesmo padrão de `AnthropicAiModelProvider`) — permite
   * o painel admin trocar a chave sem restart. */
  getApiKey: () => Promise<string | undefined>;
  /** Recebe a imagem gerada em base64 e devolve uma URL pública — normalmente grava no
   * `ObjectStoragePort` já usado para upload de mídia de publicação. Sem isto, o adapter não tem
   * como expor a imagem gerada (a API da OpenAI devolve `b64_json`, não uma URL). */
  persistGeneratedImage: (input: { base64: string; tenantId: string }) => Promise<string>;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const CACHE_TTL_MS = 60_000;
/** A OpenAI rejeita `prompt` acima de 32000 caracteres (`string_above_max_length`). Alguns
 * chamadores (ex.: Pedro, `pedro-image-generation.skill.ts`) constroem prompts muito mais longos —
 * um brief técnico completo pensado para um modelo de raciocínio, não para o parâmetro `prompt` de
 * `POST /v1/images/generations` — então cortar aqui é a defesa genérica do adapter contra QUALQUER
 * chamador que exceda o limite, sem precisar mudar a lógica de construção do prompt de cada Skill. */
const MAX_PROMPT_LENGTH = 32_000;

/**
 * Adapter OpenAI (`gpt-image-1`) — só capability `image_generation`. Documentação estável e bem
 * conhecida (`POST /v1/images/generations`), diferente do Kwai/Veo — nenhuma ressalva de "não
 * verificado contra API real" aqui.
 */
export class OpenAiImageProviderAdapter implements AiMediaProviderAdapterPort {
  readonly descriptor: AiMediaProviderDescriptor;
  private cachedKey?: string;
  private cachedAt = 0;
  // Auditoria/incidente de quota OpenAI — sinal de saúde LEVE (pedido explícito do usuário: "não
  // quero chamada paga frequente só pra health check"). Nunca faz uma chamada nova só pra checar
  // — só reflete o resultado da ÚLTIMA geração REAL que já ia acontecer de qualquer jeito (tráfego
  // de produção), e volta a `false` sozinho assim que uma geração seguinte tiver sucesso. Consumido
  // por `health()`, exibido no painel /admin/ai-providers (campo `health.ok`/`health.safeMessage`
  // já existente — nenhuma tela nova precisou ser criada).
  private lastKnownQuotaExhausted = false;

  constructor(private readonly config: OpenAiImageProviderConfig, private readonly httpClient: typeof fetch = fetch) {
    this.descriptor = {
      providerCode: "openai",
      displayName: "OpenAI (imagem)",
      enabled: config.enabled,
      capabilities: ["image_generation"],
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
    const result = await this.generateInternal(request);
    this.lastKnownQuotaExhausted = !result.ok && result.category === "quota_exhausted";
    return result;
  }

  private async generateInternal(request: AiMediaGenerationRequest): Promise<AiMediaGenerationResult> {
    const startedAt = Date.now();
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      return { ok: false, category: "not_configured", message: "OpenAiImageProviderAdapter sem API key configurada.", latencyMs: 0 };
    }

    const size = typeof request.params.size === "string" ? request.params.size : "1024x1024";
    // "high" (suportado pelo `gpt-image-1`) — sem isto a OpenAI usava a qualidade padrão dela
    // silenciosamente; peça pedida explicitamente para ficar "extremamente profissional" precisa
    // do parâmetro pedido, não só de um prompt melhor.
    const quality = typeof request.params.quality === "string" ? request.params.quality : "high";
    const baseUrl = this.config.apiBaseUrl ?? DEFAULT_BASE_URL;
    const prompt = truncatePrompt(request.prompt, MAX_PROMPT_LENGTH);
    // Achado ao vivo (comparado com o fluxo do próprio usuário no ChatGPT, que anexa a foto real
    // do produto): descrever a imagem de referência só em TEXTO (via visão computacional) perde
    // toda a fidelidade de forma/proporção/detalhe — o produto gerado nunca bate exatamente com o
    // exemplo. Quando há uma imagem de referência de verdade disponível, usa `POST
    // /v1/images/edits` (multipart, aceita uma imagem de entrada real) em vez de `/generations`
    // (só texto) — o modelo passa a enxergar o produto de verdade, não uma paráfrase dele.
    const referenceImageBuffer = Buffer.isBuffer(request.params.referenceImageBuffer) ? (request.params.referenceImageBuffer as Buffer) : undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      const response = referenceImageBuffer
        ? await this.httpClient(`${baseUrl}/v1/images/edits`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}` },
            // Sem "content-type" de propósito — o `fetch`/`undici` calcula o boundary do
            // multipart automaticamente a partir do `FormData`; setar manualmente quebra o parse.
            body: buildEditsFormData({ modelId: request.modelId, prompt, size, quality, referenceImageBuffer }),
            signal: controller.signal,
          })
        : await this.httpClient(`${baseUrl}/v1/images/generations`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: request.modelId, prompt, size, quality, n: 1 }),
            signal: controller.signal,
          });
      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) return { ok: false, ...(await classifyOpenAiError(response)), latencyMs };

      const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const image = body.data?.[0];
      if (!image) return { ok: false, category: "invalid_request", message: "OpenAI não retornou nenhuma imagem.", latencyMs };

      let mediaUrl = image.url;
      if (!mediaUrl && image.b64_json) {
        // `gpt-image-1` só devolve `b64_json` (nunca `url`) — precisa do Object Storage configurado
        // para virar uma URL pública. Erro isolado do bloco de rede acima para não virar
        // "Falha de conexão com a OpenAI" e esconder um problema de configuração local.
        try {
          // Corta pra proporção real ANTES de persistir (ver `resolveOpenAiImageSize` em
          // `openai-icaro-image-provider.ts`) — `size` só chega no tamanho suportado mais próximo,
          // nunca a proporção exata pedida (ex.: 9:16). Sem isto, pillarboxing/letterboxing
          // (achado ao vivo) fica permanentemente salvo no arquivo final.
          const targetAspectRatio = typeof request.params.targetAspectRatio === "string" ? request.params.targetAspectRatio : undefined;
          const rawBuffer = Buffer.from(image.b64_json, "base64");
          const croppedBuffer = await cropToTargetAspectRatio(rawBuffer, targetAspectRatio);
          const base64 = croppedBuffer === rawBuffer ? image.b64_json : croppedBuffer.toString("base64");
          mediaUrl = await this.config.persistGeneratedImage({ base64, tenantId: request.tenantId });
        } catch (error) {
          return {
            ok: false,
            category: "internal_error",
            message: error instanceof Error ? `Falha ao hospedar a imagem gerada: ${error.message}` : "Falha ao hospedar a imagem gerada.",
            latencyMs: Date.now() - startedAt,
          };
        }
      }
      if (!mediaUrl) return { ok: false, category: "invalid_request", message: "OpenAI retornou uma imagem sem URL nem b64_json.", latencyMs };

      return { ok: true, mediaUrl, billableUnits: 1, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, category: "timeout", message: "Timeout ao chamar a OpenAI.", latencyMs };
      }
      return { ok: false, category: "provider_unavailable", message: "Falha de conexão com a OpenAI.", latencyMs };
    }
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) return { ok: false, safeMessage: "API key da OpenAI não configurada." };
    if (this.lastKnownQuotaExhausted) {
      return { ok: false, safeMessage: "Atenção — quota/crédito indisponível (última geração falhou por falta de crédito na conta do provider)." };
    }
    return { ok: true };
  }
}

function buildEditsFormData(input: { modelId: string; prompt: string; size: string; quality: string; referenceImageBuffer: Buffer }): FormData {
  const formData = new FormData();
  formData.append("model", input.modelId);
  formData.append("prompt", input.prompt);
  formData.append("size", input.size);
  formData.append("quality", input.quality);
  formData.append("n", "1");
  formData.append("image", new Blob([input.referenceImageBuffer], { type: "image/png" }), "reference.png");
  return formData;
}

// Achado real em produção (incidente de quota OpenAI): o Vorix classificava TODO HTTP 429 como
// "Rate limit da OpenAI", mas a OpenAI usa o mesmo status 429 tanto para rate limit transitório
// quanto para crédito/saldo da organização esgotado (`error.code: "credit_balance_exhausted"` /
// `error.type: "insufficient_quota"`, confirmado contra a API real) — only o CORPO do erro
// distingue os dois. Nunca tratar como o mesmo problema: um se resolve sozinho, o outro exige
// adicionar crédito na conta OpenAI.
const QUOTA_EXHAUSTED_ERROR_CODES = new Set(["credit_balance_exhausted", "insufficient_quota"]);

async function classifyOpenAiError(response: Response): Promise<{ category: AiMediaGenerationFailureCategory; message: string }> {
  if (response.status === 401 || response.status === 403) return { category: "authentication_failed", message: "Credencial OpenAI inválida ou sem permissão." };
  if (response.status === 429) {
    const body = await response.json().catch(() => undefined) as { error?: { code?: string; type?: string; message?: string } } | undefined;
    if (body?.error?.code && QUOTA_EXHAUSTED_ERROR_CODES.has(body.error.code)) {
      return { category: "quota_exhausted", message: "Crédito/quota da OpenAI esgotado." };
    }
    if (body?.error?.type === "insufficient_quota") {
      return { category: "quota_exhausted", message: "Crédito/quota da OpenAI esgotado." };
    }
    return { category: "rate_limited", message: "Rate limit da OpenAI." };
  }
  if (response.status >= 500) return { category: "provider_unavailable", message: "Erro interno da OpenAI." };
  if (response.status === 400) {
    const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; type?: string } } | undefined;
    if (body?.error?.code === "content_policy_violation") return { category: "content_blocked", message: "Prompt bloqueado pela política de conteúdo da OpenAI." };
    return { category: "invalid_request", message: body?.error?.message ? `Requisição inválida para a OpenAI: ${body.error.message}` : "Requisição inválida para a OpenAI." };
  }
  return { category: "internal_error", message: "Erro inesperado ao chamar a OpenAI." };
}

/** Corta em fronteira de palavra (nunca no meio de um caractere multibyte) e deixa claro no fim do
 * prompt que houve corte — mais seguro que truncar cegamente no limite exato de caracteres, que
 * poderia deixar uma instrução pela metade logo antes do corte. */
function truncatePrompt(prompt: string, maxLength: number): string {
  if (prompt.length <= maxLength) return prompt;
  const marker = "\n\n[...prompt truncado por limite da OpenAI...]";
  const budget = maxLength - marker.length;
  const cut = prompt.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  const safeCut = lastSpace > budget * 0.9 ? cut.slice(0, lastSpace) : cut;
  return `${safeCut}${marker}`;
}
