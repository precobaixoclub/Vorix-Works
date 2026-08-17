export type OpenAiCopywriterConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
};

export type AdCopyInput = {
  objective: string;
  offerOrSubject: string;
  targetAudience: string;
  channel: string;
  /** Descrição por visão computacional das imagens de referência — ver `OpenAiVisionDescriber` —
   * dá ao redator informação real sobre o produto (cor, modelo, detalhes) que o usuário não
   * necessariamente digitou em texto. */
  referenceContext?: string;
};

export type AdCopy = {
  title: string;
  description: string;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Escreve título + descrição prontos para postar — nunca o texto bruto que o usuário digitou como
 * ideia/sugestão (esse é um briefing para a IA interpretar, não copy final, ver achado ao vivo:
 * "o texto não era pra ser aplicado exatamente o que escrevi"). Best-effort: nunca lança erro,
 * `undefined` em qualquer falha — quem chama cai para um fallback simples baseado no texto
 * original em vez de travar a geração por causa disto.
 */
export class OpenAiCopywriter {
  constructor(
    private readonly config: OpenAiCopywriterConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  async composeAdCopy(input: AdCopyInput): Promise<AdCopy | undefined> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) return undefined;

    const instruction = [
      "Você é um redator publicitário sênior. Escreva um título curto e uma descrição para postar nas redes sociais, em português, com base nas informações abaixo.",
      "Regras: nunca copie as informações literalmente — escreva como um anúncio de verdade, natural e persuasivo. Nunca invente preço, desconto, prazo ou dado que não foi informado. Título: no máximo 60 caracteres, sem aspas. Descrição: 2 a 4 frases, tom adequado ao público e ao canal, pronta para colar como legenda do post.",
      "Responda só em JSON, neste formato exato: {\"title\": \"...\", \"description\": \"...\"}",
      "",
      `Objetivo: ${input.objective}`,
      `Produto/oferta: ${input.offerOrSubject}`,
      `Público-alvo: ${input.targetAudience}`,
      `Canal: ${input.channel}`,
      input.referenceContext ? `Informação adicional (extraída de imagens de referência do produto): ${input.referenceContext}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await this.httpClient(`${this.config.apiBaseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 300,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: instruction }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return undefined;

      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = body.choices?.[0]?.message?.content;
      if (!raw) return undefined;

      const parsed = JSON.parse(raw) as { title?: unknown; description?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
      if (!title || !description) return undefined;
      return { title: title.slice(0, 100), description: description.slice(0, 500) };
    } catch {
      return undefined;
    }
  }
}
