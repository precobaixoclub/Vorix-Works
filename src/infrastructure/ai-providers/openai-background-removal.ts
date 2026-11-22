import { DEFAULT_GPT_IMAGE_MODEL, getGptImageModel, unsupportedGptImageModelMessage } from "../../shared/utils/gpt-image-models.js";

const DEFAULT_BASE_URL = "https://api.openai.com";

/** Prompt fixo, nunca customizável pelo caller — a única tarefa aqui é isolar o que já existe,
 * nunca redesenhar/reinterpretar o logotipo (mesma preocupação de `logo-compositor.ts`: a IA
 * nunca "desenha" a marca, só processa um arquivo real). */
const REMOVE_BACKGROUND_PROMPT =
  "Isole apenas o logotipo/marca já presente nesta imagem, removendo completamente o fundo ao redor dele. " +
  "Preserve EXATAMENTE as cores, proporções, texto e símbolo do logotipo original — nunca redesenhe, recolora, " +
  "estilize ou reinterprete o logotipo. Fundo 100% transparente.";

export type OpenAiBackgroundRemovalConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
  /** Modelo do catálogo (`OPENAI_IMAGE_MODEL`); precisa aceitar fundo transparente. */
  modelId?: string;
};

/**
 * Mesmo recurso que o usuário já usa manualmente no ChatGPT ("remove o fundo desta imagem") —
 * `POST /v1/images/edits` dos modelos GPT Image aceita uma imagem real de entrada e `background:
 * "transparent"`, devolvendo um PNG com canal alfa de verdade. Nunca registra o resultado como
 * Asset por conta própria — devolve só o buffer processado; quem chama decide se usa (ver
 * `assets.route.ts`, sempre com confirmação explícita do usuário antes de salvar como logo
 * oficial, já que um erro aqui se repetiria em toda peça futura da marca).
 */
export async function removeImageBackgroundViaAI(
  config: OpenAiBackgroundRemovalConfig,
  input: { imageBuffer: Buffer; contentType: string },
  httpClient: typeof fetch = fetch,
): Promise<Buffer> {
  const apiKey = await config.getApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_BACKGROUND_REMOVAL_NOT_CONFIGURED: nenhuma API key da OpenAI configurada neste servidor.");
  }

  const model = getGptImageModel(config.modelId ?? DEFAULT_GPT_IMAGE_MODEL);
  if (!model) throw new Error(`OPENAI_BACKGROUND_REMOVAL_NOT_CONFIGURED: ${unsupportedGptImageModelMessage(config.modelId)}`);
  if (!model.transparentBackground) throw new Error(`OPENAI_BACKGROUND_REMOVAL_NOT_CONFIGURED: o modelo ${model.id} não gera fundo transparente.`);

  const baseUrl = config.apiBaseUrl ?? DEFAULT_BASE_URL;
  const formData = new FormData();
  formData.append("model", model.id);
  formData.append("prompt", REMOVE_BACKGROUND_PROMPT);
  // "auto": mantém a proporção da logo enviada (antes era sempre um quadrado 1024x1024).
  formData.append("size", "auto");
  formData.append("quality", "high");
  formData.append("background", "transparent");
  formData.append("n", "1");
  formData.append("image", new Blob([input.imageBuffer], { type: input.contentType }), "logo-source");

  const response = await httpClient(`${baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    throw new Error(`OPENAI_BACKGROUND_REMOVAL_FAILED: ${body?.error?.message ?? `HTTP ${response.status} da OpenAI.`}`);
  }

  const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const base64 = body.data?.[0]?.b64_json;
  if (!base64) throw new Error("OPENAI_BACKGROUND_REMOVAL_FAILED: a OpenAI não retornou nenhuma imagem processada.");
  return Buffer.from(base64, "base64");
}
