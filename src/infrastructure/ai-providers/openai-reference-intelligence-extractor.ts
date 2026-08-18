import { parseReferenceIntelligence, type ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";

export type OpenAiReferenceIntelligenceExtractorConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 25_000;
const MODEL_ID = "gpt-4o-mini";
const MAX_IMAGES_PER_CALL = 5;

const EXTRACTION_INSTRUCTION = `Você é um especialista em extrair fatos verificáveis de imagens de referência de produto para uma peça publicitária. Analise TODAS as imagens anexadas nesta mensagem (rotuladas "Imagem 1", "Imagem 2", etc., na ordem em que aparecem) como referências do MESMO briefing.

Responda APENAS com um objeto JSON válido, sem markdown, no formato exato abaixo:

{
  "imagesAnalyzed": <número de imagens analisadas>,
  "primaryImageIndex": <índice 0-based da imagem MAIS limpa/representativa do produto em si — prefira uma foto focada em um único produto sobre um print de grade/listagem com vários produtos diferentes>,
  "multiImageRelationship": "same_product" | "different_products" | "different_angles" | "listing_and_detail" | "visual_inspiration" | "brand_identity" | "unknown",
  "relationshipReasoning": "<1 frase explicando a relação entre as imagens>",
  "verifiedFacts": { "productType": "...", "productName": "...", "category": "...", "brand": "..." },
  "visualFacts": {
    "colors": ["..."],
    "visualCharacteristics": ["..."],
    "relevantText": ["<qualquer texto legível visível nas imagens, incluindo preços, banners, selos>"],
    "ctaPresent": true|false,
    "imageContext": "<ex.: página de produto de e-commerce, foto de estúdio, print de app>",
    "elementsToPreserve": ["<o que NÃO pode mudar ao gerar uma nova peça: cor, formato, logo, proporção>"]
  },
  "commercialFacts": {
    "currentPrice": "<preço atual visível, ex. 'R$ 39,99', ou omita se não houver>",
    "previousPrice": "<preço anterior/riscado visível, ou omita>",
    "discountPercent": "<desconto visível, ex. '50%', ou omita>",
    "promotion": "<nome da promoção visível, ex. 'Oferta Relâmpago', ou omita>",
    "commercialConditions": ["<condições comerciais visíveis: parcelamento, frete, cupom>"],
    "shippingInfo": "<informação de frete visível, ou omita>"
  },
  "uncertainFacts": ["<algo que a imagem sugere mas não confirma com segurança>"],
  "claimSourceMap": { "<fato extraído>": "<qual imagem, ex. 'imagem 1'>" }
}

REGRAS OBRIGATÓRIAS:
- Nunca invente um fato que não está visível/legível na imagem. Preço, desconto, promoção e condições comerciais só entram em "commercialFacts" quando estiverem literalmente visíveis como texto ou número na imagem — nunca deduzidos ou estimados.
- Se um preço/desconto não está visível, OMITA o campo (não escreva null nem invente um valor).
- "uncertainFacts" é para o que você suspeita mas não tem certeza — nunca deixe isso vazar para "verifiedFacts"/"commercialFacts".
- Todo fato em "commercialFacts" e "verifiedFacts" precisa de uma entrada correspondente em "claimSourceMap" indicando de qual imagem veio.`;

type OpenAiChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * Extração ESTRUTURADA de fatos de referência — diferente de `OpenAiVisionDescriber` (que produz
 * só uma descrição de estilo em prosa livre, nunca fatos comerciais). Uma única chamada cobre
 * TODAS as imagens de uma vez (até `MAX_IMAGES_PER_CALL`), em vez de N chamadas independentes
 * concatenadas depois — permite ao próprio modelo reconciliar se são o mesmo produto e qual imagem
 * é a mais representativa, em vez de uma reconciliação por concatenação de texto.
 *
 * Mesma convenção best-effort de `OpenAiVisionDescriber.describe`: nunca lança, qualquer falha
 * (sem chave, rede, JSON malformado) devolve `undefined` — quem chama trata ausência como "sem
 * inteligência de referência disponível", nunca bloqueia a geração por causa disto.
 */
export class OpenAiReferenceIntelligenceExtractor {
  constructor(
    private readonly config: OpenAiReferenceIntelligenceExtractorConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  async extract(imageUrls: string[]): Promise<ReferenceIntelligence | undefined> {
    const urls = imageUrls.slice(0, MAX_IMAGES_PER_CALL);
    if (urls.length === 0) return undefined;
    const apiKey = await this.config.getApiKey();
    if (!apiKey) return undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const content: OpenAiChatContentBlock[] = [
        { type: "text", text: EXTRACTION_INSTRUCTION },
        ...urls.flatMap((url, index): OpenAiChatContentBlock[] => [
          { type: "text", text: `Imagem ${index + 1}:` },
          { type: "image_url", image_url: { url } },
        ]),
      ];
      const response = await this.httpClient(`${this.config.apiBaseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL_ID,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        if (process.env.DEBUG_REFERENCE_INTELLIGENCE) console.error("[DEBUG reference-intelligence] HTTP", response.status, await response.text().catch(() => ""));
        return undefined;
      }

      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = body.choices?.[0]?.message?.content?.trim();
      if (process.env.DEBUG_REFERENCE_INTELLIGENCE) console.error("[DEBUG reference-intelligence] raw", raw);
      if (!raw) return undefined;

      return parseReferenceIntelligence(raw);
    } catch (error) {
      if (process.env.DEBUG_REFERENCE_INTELLIGENCE) console.error("[DEBUG reference-intelligence] exception", error);
      return undefined;
    }
  }
}
