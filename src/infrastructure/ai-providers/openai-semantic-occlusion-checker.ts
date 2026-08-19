import { SEMANTIC_OCCLUSION_PROMPT, parseSemanticOcclusionVerdict, type SemanticOcclusionVerdict } from "../../shared/utils/semantic-occlusion.types.js";

export type OpenAiSemanticOcclusionCheckerConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 20_000;
const MODEL_ID = "gpt-4o-mini";

/**
 * Checagem barata de oclusão semântica (Rodada 2, Fatia 3) — usada pelo Repair Loop DENTRO do
 * próprio `VisualPipelineExecutionTaskHandler`, ANTES de a peça virar artefato final: pergunta
 * (nunca infere geometria) se algum elemento comercial já composto está cobrindo rosto/olhos/mãos/
 * produto na imagem JÁ RENDERIZADA. Mesmo prompt/formato de resposta de
 * `LucasQualityReviewSkill.checkSemanticOcclusion` (registro oficial, chamado depois, via
 * `this.icaro`) — só o transporte HTTP é duplicado (execution handler não tem acesso a
 * `IcaroBrainPort`), o CRITÉRIO nunca diverge (`semantic-occlusion.types.ts`).
 *
 * Best-effort: qualquer falha devolve `undefined` — "não foi possível verificar" nunca vira
 * "reprovado", e o Repair Loop simplesmente não tenta reparo nenhum quando isso acontece (a peça
 * segue pro Quality Gate oficial do Lucas do mesmo jeito).
 */
export class OpenAiSemanticOcclusionChecker {
  constructor(
    private readonly config: OpenAiSemanticOcclusionCheckerConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  async check(imageUrl: string): Promise<SemanticOcclusionVerdict | undefined> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) return undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await this.httpClient(`${this.config.apiBaseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL_ID,
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: SEMANTIC_OCCLUSION_PROMPT },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        if (process.env.DEBUG_SEMANTIC_OCCLUSION) console.error("[DEBUG semantic-occlusion] HTTP", response.status, await response.text().catch(() => ""));
        return undefined;
      }

      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = body.choices?.[0]?.message?.content?.trim();
      if (!raw) return undefined;
      return parseSemanticOcclusionVerdict(raw);
    } catch (error) {
      if (process.env.DEBUG_SEMANTIC_OCCLUSION) console.error("[DEBUG semantic-occlusion] exception", error);
      return undefined;
    }
  }
}
