export type OpenAiVisionDescriberConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Ponte só-leitura entre uma URL de imagem já pública (referência anexada numa ideia, logo da
 * marca em Materiais) e uma descrição em texto — porque o pipeline de geração real (Sofia/Bianca/
 * Pedro) só aceita texto no prompt, nunca uma imagem de entrada. Best-effort de propósito: nunca
 * lança erro, sempre devolve `undefined` em qualquer falha (sem chave, rede, resposta vazia) —
 * quem chama trata a ausência de descrição como "sem contexto extra", nunca bloqueia a geração
 * por causa disto.
 */
export class OpenAiVisionDescriber {
  constructor(
    private readonly config: OpenAiVisionDescriberConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  async describe(imageUrl: string, instruction: string): Promise<string | undefined> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) return undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await this.httpClient(`${this.config.apiBaseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 300,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: instruction },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return undefined;

      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content?.trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }
}
