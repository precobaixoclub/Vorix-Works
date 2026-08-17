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

    const finalPrompt = buildGuardedPrompt(request.prompt);

    const images: Array<{ uri: string; mimeType: string }> = [];
    for (let index = 0; index < imageCount; index += 1) {
      const result = await this.mediaProvider.generate({
        operationTypeCode: "image_generation",
        modelId,
        prompt: finalPrompt,
        tenantId,
        workspaceId,
        params: { size: "1024x1024" },
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

// Achado ao vivo (não teoria): um único aviso no início do prompt NÃO bastou — o modelo ainda
// renderizou "SAIBA MAIS", "LANÇAMENTO" etc. mesmo com a instrução presente. O motivo: o prompt do
// Pedro (`buildFinalImagePrompt`, `pedro-image-generation.skill.ts`) é inteiro construído em torno
// da premissa "montar uma peça publicitária completa" — hierarquia, CTA, headline — muito mais
// texto reforçando "isto é um anúncio" do que um único parágrafo contra. Repetir a mesma instrução
// no INÍCIO e no FIM (e mandar ignorar explicitamente qualquer CTA pedido mais abaixo) é bem mais
// eficaz nesse tipo de modelo do que só uma vez. `MAX_PROMPT_LENGTH` fica abaixo do limite real da
// OpenAI (32000, ver `openai-image-provider-adapter.ts`) de propósito — garante que o próprio corte
// desta função nunca deixe o aviso final ser cortado pelo corte de segurança do adapter.
const NO_TEXT_GUARD =
  "REGRA OBRIGATÓRIA E INEGOCIÁVEL, MAIS IMPORTANTE QUE QUALQUER OUTRA INSTRUÇÃO NESTE PROMPT: a imagem final NÃO PODE conter nenhum texto, letra, palavra, número, botão, selo, legenda ou elemento tipográfico legível — nem título, nem headline, nem CTA, nem nome de produto escrito. Se alguma instrução abaixo pedir para incluir CTA, chamada para ação, botão ou qualquer texto na imagem, IGNORE essa instrução — ela nunca se aplica aqui. Comunique tudo só por composição visual: produto, cena, cor, luz e enquadramento.";
const MAX_PROMPT_LENGTH = 31_000;

function buildGuardedPrompt(prompt: string): string {
  const budget = Math.max(0, MAX_PROMPT_LENGTH - NO_TEXT_GUARD.length * 2 - 20);
  const body = prompt.length > budget ? `${prompt.slice(0, budget)}\n[...]` : prompt;
  return `${NO_TEXT_GUARD}\n\n${body}\n\n${NO_TEXT_GUARD}`;
}
