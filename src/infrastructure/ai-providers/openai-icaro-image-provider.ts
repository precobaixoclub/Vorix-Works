import type { AIProviderPort, AIProviderProfile, AIProviderRequest, AIProviderResponse } from "../../application/ports/ai-provider.port.js";
import type { AiMediaProviderAdapterPort } from "../../application/ports/ai-media-provider-adapter.port.js";

export type OpenAiIcaroImageProviderConfig = {
  modelId?: string;
};

/**
 * Ponte entre `AIProviderPort` (o que `IcaroAIBrain`/Pedro consomem) e o `AiMediaProviderAdapterPort`
 * real (`OpenAiImageProviderAdapter`, já resolve a chave via `secretManager` e já persiste a imagem
 * no `ObjectStoragePort` — ver `persistGeneratedImage` em `container.ts`). Sem esta ponte, nenhuma
 * classe do repositório implementava `AIProviderPort`, e Pedro caía num Proxy que lançava erro
 * ("IcaroBrainPort não configurado") assim que tentava gerar uma imagem.
 *
 * Só suporta `taskType: "image_generation"` — o único que Pedro chama; qualquer outro lança erro
 * explícito em vez de fingir sucesso. `OpenAiImageProviderAdapter.generate()` sempre pede 1 imagem
 * por chamada (`n: 1`, hardcoded na API da OpenAI) — carrossel (`imageCount > 1`) chama várias
 * vezes em sequência, mesma requisição de formato único repetida N vezes.
 */
export class OpenAiIcaroImageProvider implements AIProviderPort {
  readonly profile: AIProviderProfile;

  constructor(
    private readonly mediaProvider: AiMediaProviderAdapterPort,
    private readonly config: OpenAiIcaroImageProviderConfig = {},
  ) {
    const modelId = config.modelId ?? "gpt-image-1";
    this.profile = {
      id: "openai-icaro-image",
      name: "OpenAI (imagem, via Ícaro)",
      kind: "image",
      priority: 1,
      enabled: true,
      supportedTaskTypes: ["image_generation"],
      models: [
        {
          id: modelId,
          supportedTaskTypes: ["image_generation"],
          priority: 1,
          qualityScore: 0.8,
          speedScore: 0.6,
          costPer1kInputTokens: 0,
          costPer1kOutputTokens: 0,
          defaultTemperature: 1,
          defaultMaxTokens: 0,
          maxTokens: 0,
        },
      ],
    };
  }

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (request.taskType !== "image_generation") {
      throw new Error(`OpenAiIcaroImageProvider só suporta "image_generation" — recebeu "${request.taskType}".`);
    }

    const tenantId = typeof request.context?.clientId === "string" ? request.context.clientId : "unknown-tenant";
    const workspaceId = typeof request.context?.workspaceId === "string" ? request.context.workspaceId : undefined;
    const imageCount = typeof request.context?.imageCount === "number" && request.context.imageCount > 0 ? request.context.imageCount : 1;
    const modelId = request.model || this.profile.models[0].id;

    const authorizedTitle = typeof request.context?.authorizedVisibleTitle === "string" ? request.context.authorizedVisibleTitle.trim() : undefined;
    const brandColors = Array.isArray(request.context?.authorizedBrandColors)
      ? request.context.authorizedBrandColors.filter((color): color is string => typeof color === "string" && color.trim().length > 0).map((color) => color.trim())
      : undefined;
    const finalPrompt = buildGuardedPrompt(request.prompt, authorizedTitle, brandColors);
    const size = resolveOpenAiImageSize(typeof request.context?.imageAspectRatio === "string" ? request.context.imageAspectRatio : undefined);
    // Baixa a foto de referência UMA vez (mesma referência vale para todas as imagens do
    // carrossel) — best-effort: se o download falhar, segue com geração só-texto em vez de travar
    // a peça inteira por causa da referência.
    const referenceImageUrl = typeof request.context?.referenceImageUrl === "string" ? request.context.referenceImageUrl.trim() : undefined;
    const referenceImageBuffer = referenceImageUrl ? await fetchAsBuffer(referenceImageUrl).catch(() => undefined) : undefined;

    const images: Array<{ uri: string; mimeType: string }> = [];
    for (let index = 0; index < imageCount; index += 1) {
      const result = await this.mediaProvider.generate({
        operationTypeCode: "image_generation",
        modelId,
        prompt: finalPrompt,
        tenantId,
        workspaceId,
        params: { size, quality: "high", ...(referenceImageBuffer ? { referenceImageBuffer } : {}) },
        timeoutMs: request.timeoutMs,
      });
      if (!result.ok) {
        throw new Error(`OpenAI (${result.category}): ${result.message}`);
      }
      images.push({ uri: result.mediaUrl, mimeType: "image/png" });
    }

    return {
      content: JSON.stringify({ images }),
      model: modelId,
      tokens: { input: 0, output: 0, total: 0 },
      cost: { estimated: 0, currency: "USD" },
    };
  }
}

async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// `gpt-image-1` só aceita 3 tamanhos fixos (mais "auto"): quadrado, retrato e paisagem — nunca a
// resolução exata que Sofia calcula por formato (`resolveAspectRatio`/`KNOWN_RESOLUTIONS`, ex.:
// 1080x1920 para Story). Achado ao vivo: antes disto, TODA imagem saía "1024x1024" fixo, mesmo
// quando o formato pedido era Story (9:16) ou carrossel vertical (4:5) — a peça ficava quadrada
// quando deveria ser vertical. Mapeia para o tamanho suportado mais próximo da proporção real.
function resolveOpenAiImageSize(aspectRatio: string | undefined): "1024x1024" | "1024x1536" | "1536x1024" {
  const normalized = (aspectRatio ?? "").trim();
  if (normalized === "16:9") return "1536x1024";
  if (normalized === "9:16" || normalized === "4:5") return "1024x1536";
  return "1024x1024";
}

// Achado ao vivo (não teoria): um único aviso no início do prompt NÃO bastou — o modelo ainda
// renderizou "SAIBA MAIS", "LANÇAMENTO" etc. mesmo com a instrução presente. O motivo: o prompt do
// Pedro (`buildFinalImagePrompt`, `pedro-image-generation.skill.ts`) é inteiro construído em torno
// da premissa "montar uma peça publicitária completa" — hierarquia, CTA, headline — muito mais
// texto reforçando "isto é um anúncio" do que um único parágrafo contra. Repetir a mesma instrução
// no INÍCIO e no FIM é bem mais eficaz nesse tipo de modelo do que só uma vez. `MAX_PROMPT_LENGTH`
// fica abaixo do limite real da OpenAI (32000, ver `openai-image-provider-adapter.ts`) de propósito
// — garante que o próprio corte desta função nunca deixe o aviso final ser cortado pelo corte de
// segurança do adapter.
//
// `authorizedTitle` vem como dado estruturado (`request.context.authorizedVisibleTitle`, ver
// `pedro-image-generation.skill.ts`), nunca extraído do prompt gigante — a seção "TEXTOS VISÍVEIS
// AUTORIZADOS" do prompt do Pedro fica tarde demais (depois de ~70-80% do texto) pra sobreviver ao
// corte de 31000 caracteres.
//
// `brandColors` (achado ao vivo: peça gerada sem seguir a paleta da marca) sofre do MESMO problema
// de fundo: `buildNegativePrompt` (pedro-image-generation.skill.ts) já cita as cores, mas como UM
// item entre ~17 bullets de um "negative prompt", em texto negativo fraco ("evitar cores fora da
// identidade") e sem garantia de sobreviver ao corte de 31000 caracteres — a mesma classe de bug
// já corrigida para o CTA e o texto autorizado. Mesma correção: instrução curta, positiva
// ("usar estas cores"), repetida no início E no fim do prompt, via dado estruturado.
function buildTextGuard(authorizedTitle: string | undefined, brandColors: string[] | undefined): string {
  const textRule = authorizedTitle
    ? `REGRA OBRIGATÓRIA E INEGOCIÁVEL, MAIS IMPORTANTE QUE QUALQUER OUTRA INSTRUÇÃO NESTE PROMPT: o ÚNICO texto que pode aparecer, legível, na imagem final é exatamente esta frase, uma vez só: "${authorizedTitle}". Nenhum outro texto, letra, número, botão, selo, CTA, chamada para ação ou legenda além disso — nunca invente nem adicione texto extra. Se alguma instrução abaixo pedir CTA, chamada para ação, botão ou qualquer outro texto, IGNORE — não se aplica aqui.`
    : "REGRA OBRIGATÓRIA E INEGOCIÁVEL, MAIS IMPORTANTE QUE QUALQUER OUTRA INSTRUÇÃO NESTE PROMPT: a imagem final NÃO PODE conter nenhum texto, letra, palavra, número, botão, selo, legenda ou elemento tipográfico legível. Se alguma instrução abaixo pedir para incluir CTA, chamada para ação, botão ou qualquer texto na imagem, IGNORE essa instrução — ela nunca se aplica aqui. Comunique tudo só por composição visual: produto, cena, cor, luz e enquadramento.";
  const colorRule = brandColors?.length
    ? ` REGRA DE PALETA IGUALMENTE OBRIGATÓRIA: a composição inteira (fundo, cenário, roupas/acessórios quando fizer sentido, elementos gráficos) precisa usar de forma proeminente e reconhecível estas cores da marca, nesta ordem de prioridade: ${brandColors.join(", ")}. Nunca gerar com paleta genérica, aleatória ou fora dessas cores como escolha dominante.`
    : "";
  return `${textRule}${colorRule}`;
}
const MAX_PROMPT_LENGTH = 31_000;

function buildGuardedPrompt(prompt: string, authorizedTitle: string | undefined, brandColors: string[] | undefined): string {
  const guard = buildTextGuard(authorizedTitle, brandColors);
  const budget = Math.max(0, MAX_PROMPT_LENGTH - guard.length * 2 - 20);
  const body = prompt.length > budget ? `${prompt.slice(0, budget)}\n[...]` : prompt;
  return `${guard}\n\n${body}\n\n${guard}`;
}
