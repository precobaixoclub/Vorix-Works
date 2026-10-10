import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { CreativeContext, CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { EditorialCreativeFamily } from "./editorial-composition.types.js";
import { resolveEditorialConfirmedPrice } from "./editorial-text-contract.js";
import { normalizeRenderedText } from "./evaluate-creative-quality-gate.js";

/** Mesma regra de família do renderer editorial (screenshot → digital; produto ou preço → oferta;
 * senão institucional), decidida ANTES da geração da base. */
export function resolveEditorialFamilyFromContext(context: CreativeContext): EditorialCreativeFamily {
  if (context.assets.some((asset) => asset.role === "screenshot")) return "digital_service";
  if (context.assets.some((asset) => asset.role === "product_photo") || resolveEditorialConfirmedPrice(context)) return "product_offer";
  return "premium_institutional";
}

export type EditorialBaseAlphaCoverage = {
  hasAlphaChannel: boolean;
  transparentRatio: number;
  semiTransparentRatio: number;
  opaqueRatio: number;
};

/**
 * A base institucional é a protagonista da peça: precisa ser essencialmente OPACA. Até 1% de pixels
 * não opacos (transparentes + semitransparentes) cobre antialias/serrilhado de borda e artefatos
 * pontuais (um anel de 1 px em volta de 1024×1280 já é ~0,7%); qualquer recorte real — sticker,
 * colagem flutuante, vazio — passa disso com folga (o cenário B real teve 46,5%).
 */
export const INSTITUTIONAL_BASE_MAX_NON_OPAQUE_RATIO = 0.01;

export function evaluateInstitutionalBaseAlpha(coverage: EditorialBaseAlphaCoverage): { ok: boolean; nonOpaqueRatio: number; reason?: string } {
  const nonOpaqueRatio = Number((coverage.transparentRatio + coverage.semiTransparentRatio).toFixed(4));
  if (nonOpaqueRatio <= INSTITUTIONAL_BASE_MAX_NON_OPAQUE_RATIO) return { ok: true, nonOpaqueRatio };
  return {
    ok: false,
    nonOpaqueRatio,
    reason: `base institucional ${(nonOpaqueRatio * 100).toFixed(1)}% não opaca (transparente ${(coverage.transparentRatio * 100).toFixed(1)}%, semitransparente ${(coverage.semiTransparentRatio * 100).toFixed(1)}%; máximo ${INSTITUTIONAL_BASE_MAX_NON_OPAQUE_RATIO * 100}%)`,
  };
}

/** Diagnóstico de texto da IMAGEM BASE (antes de qualquer texto/asset do renderer). */
export type EditorialBaseTextDiagnostic = {
  status: "AVAILABLE" | "NOT_AVAILABLE";
  /** O que foi analisado: a base da IA pura, nunca a composição com logo/textos. */
  target: "OPENAI_BASE";
  sourceArtifactUrl: string;
  texts: { text: string; normalizedText: string; bbox?: CreativePlanRect }[];
  reason?: string;
};

/** Data URL com o MIME REAL (pela assinatura dos bytes, nunca pela extensão do arquivo gravado). */
function toImageDataUrl(buffer: Buffer): string | undefined {
  const mime = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? "image/png"
    : buffer[0] === 0xff && buffer[1] === 0xd8
      ? "image/jpeg"
      : buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP"
        ? "image/webp"
        : undefined;
  return mime ? `data:${mime};base64,${buffer.toString("base64")}` : undefined;
}

function buildBaseTextScanPrompt(): string {
  return [
    "Você recebe UMA imagem gerada por IA que servirá de fundo para uma peça publicitária. Ainda não tem nenhum texto comercial composto por cima.",
    "Transcreva TODO texto legível que existir nela: palavras, letras soltas reconhecíveis, números, siglas, nomes de marca, placas, rótulos, wordmarks, texto de interface — exatamente como aparece.",
    "Para cada item informe \"region\": retângulo aproximado em porcentagem da imagem (xPct/yPct = canto superior esquerdo, widthPct/heightPct = tamanho).",
    "Não invente: só o que dá para ler. Textura, padrão ou forma que só lembra letras NÃO conta.",
    'Responda somente JSON: {"texts": [{"text": "...", "region": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}}]}. Lista vazia se não houver texto legível.',
  ].join("\n");
}

/**
 * Uma chamada leve de visão SÓ sobre a base (ADDITIONAL_CALL): a infraestrutura do gate final manda
 * referências + a peça final numa única pergunta "o que está na peça"; misturar ali "o que já estava
 * na base" exigiria refatorar o prompt/parse do gate inteiro. Best-effort: falha vira NOT_AVAILABLE
 * (o gate então NÃO usa reconciliação por ledger — falha fechada).
 */
export async function scanEditorialBaseText(
  icaro: IcaroBrainPort,
  input: { baseImageUrl: string; baseImageBuffer?: Buffer; specialistId: string; onCost?: (response: IcaroAIResponse | undefined) => void },
): Promise<EditorialBaseTextDiagnostic> {
  const unavailable = (reason: string): EditorialBaseTextDiagnostic => ({ status: "NOT_AVAILABLE", target: "OPENAI_BASE", sourceArtifactUrl: input.baseImageUrl, texts: [], reason });
  try {
    // Achado do benchmark final (bases digitais/oferta em PNG com alfa, gravadas como .jpg e lidas
    // pela URL 1–2 s depois do upload): a visão devolvia conteúdo vazio de forma intermitente e o
    // scan virava NOT_AVAILABLE, travando a reconciliação do ledger. Os bytes da base já estão em
    // memória: vão como data URL com o MIME real, e uma leitura que não conclui tem UMA nova
    // tentativa. Se ainda falhar, continua NOT_AVAILABLE (falha fechada).
    const imageUrl = input.baseImageBuffer ? toImageDataUrl(input.baseImageBuffer) ?? input.baseImageUrl : input.baseImageUrl;
    let response: IcaroAIResponse | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      response = await icaro.request({
        taskType: "review",
        prompt: buildBaseTextScanPrompt(),
        specialistId: input.specialistId,
        imageUrls: [imageUrl],
        expectedOutput: "json",
        priority: "quality",
        temperature: 0,
        maxTokens: 400,
        timeoutMs: 25_000,
      });
      input.onCost?.(response);
      if (response.status === "completed") break;
    }
    if (!response || response.status !== "completed") return unavailable(`visão não concluiu (${response?.status ?? "sem resposta"}) após 2 tentativas`);
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Editorial base text scan")) as { texts?: unknown };
    if (!Array.isArray(parsed.texts)) return unavailable("resposta sem lista de textos");
    const texts = parsed.texts.flatMap((raw) => {
      const record = typeof raw === "string" ? { text: raw } : (raw as { text?: unknown; region?: unknown });
      if (typeof record.text !== "string" || !record.text.trim()) return [];
      const region = record.region as Record<string, unknown> | undefined;
      const validRegion = region && ["xPct", "yPct", "widthPct", "heightPct"].every((key) => typeof region[key] === "number" && Number.isFinite(region[key] as number));
      return [{ text: record.text, normalizedText: normalizeRenderedText(record.text), ...(validRegion ? { bbox: region as unknown as CreativePlanRect } : {}) }];
    });
    return { status: "AVAILABLE", target: "OPENAI_BASE", sourceArtifactUrl: input.baseImageUrl, texts };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "erro desconhecido");
  }
}
