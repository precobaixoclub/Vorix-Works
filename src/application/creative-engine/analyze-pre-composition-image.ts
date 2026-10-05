import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativePlanTextZone, CreativePlanTextZoneKind } from "../../shared/utils/gpt-creative-plan.types.js";
import { SAFE_AREA_CANDIDATE_REGIONS, type RegionComplexity, type RegionSemanticFlags, type SafeAreaCandidateRegion } from "./resolve-actual-safe-area.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — análise de visão da imagem BASE (recém-
 * gerada pelo modelo, ANTES de qualquer composição determinística: nenhuma logo, screenshot real
 * ou texto do renderer ainda colados). Achado do smoke de produção da Rodada 4: pedir ao modelo
 * "não desenhe texto aqui" não é suficiente — o modelo pode desenhar mesmo assim. Esta análise dá
 * ao motor um dado REAL sobre o que de fato está na imagem antes de decidir onde/como desenhar o
 * texto determinístico por cima — nunca confia só na instrução de prompt.
 *
 * UMA ÚNICA chamada de visão (mesmo princípio de custo de `checkCreativeVisualIntegrity`) —
 * deliberadamente mais barata que a geração de imagem que ela existe pra evitar desperdiçar.
 */

export const SPURIOUS_TEXT_CLASSIFICATIONS = ["unauthorized_text", "ghost_text", "duplicated_text"] as const;
export type SpuriousTextClassification = (typeof SPURIOUS_TEXT_CLASSIFICATIONS)[number];

export type SpuriousTextFinding = {
  text: string;
  classification: SpuriousTextClassification;
  /** Preenchido quando `classification === "ghost_text"` — a zona `renderedBy: "renderer"` cujo
   * texto o modelo já desenhou sozinho por conta própria (o caso que o renderer precisa
   * NEUTRALIZAR antes de desenhar a sua própria versão por cima, nunca só desenhar ao lado). */
  matchedZoneKind?: CreativePlanTextZoneKind;
};

export type PreCompositionAnalysis = {
  spuriousTexts: SpuriousTextFinding[];
  /** Por kind de zona `renderedBy: "renderer"` presente no plano — `true` = a região planejada
   * dessa zona está livre (sem texto/produto/rosto). Zonas não analisadas (ex.: plano antigo sem
   * zonas) simplesmente não aparecem aqui. */
  plannedZonesClear: Partial<Record<CreativePlanTextZoneKind, boolean>>;
  regions: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>>;
  /** `undefined` quando não há screenshot real no contexto desta peça (pergunta não fazia
   * sentido) — só `true`/`false` quando de fato existe um placement de screenshot a validar. */
  screenshotSlotLooksFake?: boolean;
};

function describeZoneRect(zone: CreativePlanTextZone): string {
  return `${zone.kind}: x=${zone.rect.xPct}%-${zone.rect.xPct + zone.rect.widthPct}%, y=${zone.rect.yPct}%-${zone.rect.yPct + zone.rect.heightPct}%`;
}

function buildPreCompositionAnalysisPrompt(input: {
  rendererOwnedZones: readonly CreativePlanTextZone[];
  allowedRenderedTexts: readonly string[];
  hasScreenshotSlot: boolean;
}): string {
  const lines = [
    "Avalie esta imagem BASE recém-gerada (ANTES de qualquer composição determinística — nenhuma logo, screenshot real ou texto de renderer foi colado ainda).",
    "",
    `LISTA FECHADA DE TEXTOS AUTORIZADOS NESTA PEÇA (qualquer outro texto legível é espúrio): ${input.allowedRenderedTexts.map((text) => `"${text}"`).join(", ") || "(nenhum texto autorizado nesta peça)"}.`,
  ];
  if (input.rendererOwnedZones.length > 0) {
    lines.push(
      "",
      "ZONAS que um RENDERER determinístico vai desenhar por cima depois (devem estar com a região correspondente VAZIA nesta imagem base — qualquer texto legível dentro delas é um problema):",
      ...input.rendererOwnedZones.map((zone) => `- ${describeZoneRect(zone)} (texto que será desenhado ali: "${zone.text}")`),
    );
  }
  lines.push(
    "",
    "Para cada texto legível que você encontrar nesta imagem, classifique:",
    "- \"unauthorized_text\": texto que não está na lista de textos autorizados E não corresponde a nenhuma zona do renderer listada acima.",
    "- \"ghost_text\": texto que o modelo desenhou e que é IGUAL (ou muito parecido) ao texto de uma das zonas do renderer listadas acima — o modelo antecipou um texto que deveria ter deixado em branco.",
    "- \"duplicated_text\": o MESMO texto aparece mais de uma vez na imagem.",
    "",
    "Avalie também 6 regiões fixas do canvas (cada uma ~40% de largura x 20% de altura): top-left, top-right, center-left, center-right, bottom-left, bottom-right. Para cada uma, diga se tem texto legível, se tem parte do produto/elemento principal, se tem um rosto, e a complexidade visual geral (low/medium/high).",
    input.hasScreenshotSlot
      ? "Esta peça vai receber um SCREENSHOT REAL colado por cima depois, numa região reservada. Diga se a imagem JÁ mostra uma interface/tela/dashboard FALSA e completa nessa região reservada (o que seria um problema — a região deveria estar vazia/neutra, pronta para receber o screenshot real) — campo \"screenshotSlotLooksFake\"."
      : "",
    "",
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    '{"spuriousTexts": [{"text": "...", "classification": "unauthorized_text"|"ghost_text"|"duplicated_text", "matchedZoneKind": "headline"|"subheadline"|"cta"|"price"|"discount"|"url"|"badge"|null}], ' +
      '"plannedZonesClear": {"<kind>": true|false}, ' +
      '"regions": {"top-left": {"hasText": true|false, "hasProduct": true|false, "hasFace": true|false, "complexity": "low"|"medium"|"high"}, "top-right": {...}, "center-left": {...}, "center-right": {...}, "bottom-left": {...}, "bottom-right": {...}}' +
      (input.hasScreenshotSlot ? ', "screenshotSlotLooksFake": true|false' : "") +
      "}",
  );
  return lines.filter(Boolean).join("\n");
}

function isSpuriousTextClassification(value: unknown): value is SpuriousTextClassification {
  return typeof value === "string" && (SPURIOUS_TEXT_CLASSIFICATIONS as readonly string[]).includes(value);
}

function isRegionComplexity(value: unknown): value is RegionComplexity {
  return value === "low" || value === "medium" || value === "high";
}

function parseRegionFlags(value: unknown): RegionSemanticFlags | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.hasText !== "boolean" || typeof record.hasProduct !== "boolean" || typeof record.hasFace !== "boolean" || !isRegionComplexity(record.complexity)) {
    return undefined;
  }
  return { hasText: record.hasText, hasProduct: record.hasProduct, hasFace: record.hasFace, complexity: record.complexity };
}

/** Best-effort — falha ou resposta ilegível nunca bloqueia a peça (mesmo princípio do resto do
 * motor): `undefined` é tratado pelo chamador como "sem dado confiável", caindo nos tratamentos
 * mais conservadores (ver `resolve-actual-safe-area.ts`), nunca travando a execução. */
export async function analyzePreCompositionImage(
  icaro: IcaroBrainPort,
  input: {
    imageUrl: string;
    rendererOwnedZones: readonly CreativePlanTextZone[];
    allowedRenderedTexts: readonly string[];
    hasScreenshotSlot: boolean;
    specialistId: string;
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<PreCompositionAnalysis | undefined> {
  try {
    const response = await icaro.request({
      taskType: "review",
      prompt: buildPreCompositionAnalysisPrompt(input),
      specialistId: input.specialistId,
      imageUrls: [input.imageUrl],
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 700,
      timeoutMs: 25_000,
    });
    input.onCost?.(response);
    if (response.status !== "completed") return undefined;

    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Pre-Composition Analysis")) as {
      spuriousTexts?: unknown;
      plannedZonesClear?: unknown;
      regions?: unknown;
      screenshotSlotLooksFake?: unknown;
    };

    const spuriousTexts: SpuriousTextFinding[] = [];
    if (Array.isArray(parsed.spuriousTexts)) {
      for (const item of parsed.spuriousTexts) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as Record<string, unknown>;
        if (typeof record.text !== "string" || !record.text.trim() || !isSpuriousTextClassification(record.classification)) continue;
        spuriousTexts.push({
          text: record.text,
          classification: record.classification,
          matchedZoneKind: typeof record.matchedZoneKind === "string" ? (record.matchedZoneKind as CreativePlanTextZoneKind) : undefined,
        });
      }
    }

    const plannedZonesClear: Partial<Record<CreativePlanTextZoneKind, boolean>> = {};
    if (parsed.plannedZonesClear && typeof parsed.plannedZonesClear === "object") {
      for (const [kind, value] of Object.entries(parsed.plannedZonesClear as Record<string, unknown>)) {
        if (typeof value === "boolean") plannedZonesClear[kind as CreativePlanTextZoneKind] = value;
      }
    }

    const regions: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>> = {};
    if (parsed.regions && typeof parsed.regions === "object") {
      for (const region of SAFE_AREA_CANDIDATE_REGIONS) {
        const flags = parseRegionFlags((parsed.regions as Record<string, unknown>)[region]);
        if (flags) regions[region] = flags;
      }
    }

    return {
      spuriousTexts,
      plannedZonesClear,
      regions,
      screenshotSlotLooksFake: typeof parsed.screenshotSlotLooksFake === "boolean" ? parsed.screenshotSlotLooksFake : undefined,
    };
  } catch {
    return undefined;
  }
}
