import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativePlanRect, CreativePlanTextZone, CreativePlanTextZoneKind } from "../../shared/utils/gpt-creative-plan.types.js";
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
  /** ETAPA 3.2 (Rodada 4) — achado do smoke real: tratar só o retângulo PLANEJADO da zona não é
   * garantia de cobrir onde o modelo REALMENTE desenhou o texto espúrio (pode estar fora, ou em
   * mais de um lugar). `bbox` é a localização aproximada REAL reportada pela visão — percentual do
   * canvas, mesmo formato de `CreativePlanRect`. `undefined` quando a visão não conseguiu
   * localizar (cai no fallback do retângulo da zona planejada, nunca trava a execução). Nunca um
   * projeto de OCR — localização aproximada já é suficiente pra neutralizar (brief, ponto 3). */
  bbox?: CreativePlanRect;
  /** 0-1, confiança da visão nesta detecção específica — usado só como sinal auxiliar (nunca um
   * filtro rígido que descarta achados "menos confiantes"), `undefined` quando não informado. */
  confidence?: number;
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
    // ETAPA 3.2 — achado do smoke real: tratar só o retângulo PLANEJADO da zona não é garantia de
    // cobrir onde o texto espúrio REALMENTE está. Pede a localização REAL, não a planejada.
    "- Para CADA texto espúrio encontrado, informe também \"bbox\" (retângulo aproximado em PERCENTUAL do canvas, 0-100, onde esse texto REALMENTE aparece na imagem — nunca o retângulo planejado da zona, a localização REAL observada) e \"confidence\" (0 a 1, sua confiança nesta detecção). Localização aproximada já é suficiente — isto NÃO é uma tarefa de OCR perfeito.",
    "- Se o MESMO texto aparecer em MAIS de um lugar, reporte uma entrada SEPARADA em \"spuriousTexts\" para CADA ocorrência, cada uma com seu próprio \"bbox\".",
    "",
    "Avalie também 6 regiões fixas do canvas (cada uma ~40% de largura x 20% de altura): top-left, top-right, center-left, center-right, bottom-left, bottom-right. Para cada uma, diga se tem texto legível, se tem parte do produto/elemento principal, se tem um rosto, e a complexidade visual geral (low/medium/high).",
    input.hasScreenshotSlot
      ? "Esta peça vai receber um SCREENSHOT REAL colado por cima depois, numa região reservada. Diga se a imagem JÁ mostra uma interface/tela/dashboard FALSA e completa nessa região reservada (o que seria um problema — a região deveria estar vazia/neutra, pronta para receber o screenshot real) — campo \"screenshotSlotLooksFake\"."
      : "",
    "",
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    '{"spuriousTexts": [{"text": "...", "classification": "unauthorized_text"|"ghost_text"|"duplicated_text", "matchedZoneKind": "headline"|"subheadline"|"cta"|"price"|"discount"|"url"|"badge"|null, "bbox": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}, "confidence": 0.0}], ' +
      '"plannedZonesClear": {"<kind>": true|false}, ' +
      '"regions": {"top-left": {"hasText": true|false, "hasProduct": true|false, "hasFace": true|false, "complexity": "low"|"medium"|"high"}, "top-right": {...}, "center-left": {...}, "center-right": {...}, "bottom-left": {...}, "bottom-right": {...}}' +
      (input.hasScreenshotSlot ? ', "screenshotSlotLooksFake": true|false' : "") +
      "}",
  );
  return lines.filter(Boolean).join("\n");
}

function isValidBboxRect(value: unknown): value is CreativePlanRect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  const { xPct, yPct, widthPct, heightPct } = rect;
  if (typeof xPct !== "number" || typeof yPct !== "number" || typeof widthPct !== "number" || typeof heightPct !== "number") return false;
  if (![xPct, yPct, widthPct, heightPct].every(Number.isFinite)) return false;
  if (xPct < 0 || yPct < 0 || widthPct <= 0 || heightPct <= 0) return false;
  return true;
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

/** Extraído em ETAPA 3.3 — o MESMO parsing de achados espúrios (texto/classificação/bbox/
 * confiança/zona) é usado tanto pela análise pré-composição quanto pela reverificação global
 * (`checkGlobalTextLegibility`, abaixo), que antes da ETAPA 3.3 só devolvia um booleano. */
function parseSpuriousTexts(value: unknown): SpuriousTextFinding[] {
  const spuriousTexts: SpuriousTextFinding[] = [];
  if (!Array.isArray(value)) return spuriousTexts;
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text !== "string" || !record.text.trim() || !isSpuriousTextClassification(record.classification)) continue;
    spuriousTexts.push({
      text: record.text,
      classification: record.classification,
      matchedZoneKind: typeof record.matchedZoneKind === "string" ? (record.matchedZoneKind as CreativePlanTextZoneKind) : undefined,
      bbox: isValidBboxRect(record.bbox) ? record.bbox : undefined,
      confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence) ? Math.max(0, Math.min(1, record.confidence)) : undefined,
    });
  }
  return spuriousTexts;
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

    const spuriousTexts = parseSpuriousTexts(parsed.spuriousTexts);

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

/** ETAPA 3.3 (Rodada 4) — achado do smoke real da ETAPA 3.2: a reverificação global sabia dizer
 * "ainda existe texto não autorizado", mas nunca ONDE — nada no motor conseguia agir sobre um
 * achado sem localização. `residualFindings` usa o MESMO formato de `SpuriousTextFinding` (texto,
 * classificação, bbox, confiança) — quando a visão reporta uma bbox real, o chamador pode tratar
 * essa ocorrência residual exatamente como um achado da análise pré-composição (ver
 * `run-gpt-creative-engine.ts`, bloco de reverificação global com passe residual único). */
export type GlobalTextCheckResult = {
  hasUnresolvedText: boolean;
  residualFindings: SpuriousTextFinding[];
};

/**
 * ETAPA 3.2 (Rodada 4) — achado do smoke real da ETAPA 3.1: a reverificação LOCAL (só o recorte
 * da região tratada) confirmava sucesso, mas o gate final (peça inteira) ainda encontrava o mesmo
 * texto duplicado em outro lugar não coberto pelo tratamento. Esta checagem GLOBAL roda depois de
 * TODAS as regiões detectadas já terem sido tratadas — pergunta sobre a imagem BASE inteira já
 * tratada, nunca só uma região isolada (brief, ponto 9/10: "LOCAL RECHECK + GLOBAL RECHECK, ambos
 * precisam passar"). Conservadora: só aceita "limpo" com um `false` explícito.
 */
export async function checkGlobalTextLegibility(
  icaro: IcaroBrainPort,
  input: { imageUrl: string; allowedRenderedTexts: readonly string[]; specialistId: string; onCost?: (response: IcaroAIResponse | undefined) => void },
): Promise<GlobalTextCheckResult> {
  try {
    const response = await icaro.request({
      taskType: "review",
      prompt: [
        "Esta é a imagem BASE (antes de logo/screenshot/texto do renderer), depois de um tratamento local para esconder texto espúrio em regiões específicas.",
        `LISTA FECHADA DE TEXTOS AUTORIZADOS (qualquer outro texto legível é um problema): ${input.allowedRenderedTexts.map((text) => `"${text}"`).join(", ") || "(nenhum texto autorizado nesta peça)"}.`,
        "Olhando a imagem INTEIRA (não só uma região), há ALGUM texto legível que NÃO está na lista de textos autorizados, ou o MESMO texto autorizado aparecendo mais de uma vez? Conta também uma ocorrência PARCIALMENTE visível — letras ou palavras reconhecíveis vazando por trás ou ao redor de um cartão/caixa de texto, mesmo que a maior parte esteja coberta. Olhe com atenção especial perto das bordas de cartões/caixas de texto e em fundos decorativos/estampados.",
        // ETAPA 3.3 — achado do smoke real da ETAPA 3.2: saber que "ainda há texto" sem saber ONDE
        // não permite agir. Pede o MESMO formato estruturado da análise pré-composição (nunca só
        // um booleano), pra qualquer achado residual poder ser tratado na localização real.
        "Para CADA texto espúrio que você encontrar, reporte também \"bbox\" (retângulo aproximado em PERCENTUAL do canvas, 0-100, onde ele REALMENTE aparece) e \"confidence\" (0 a 1). Localização aproximada já basta — isto NÃO é uma tarefa de OCR perfeito.",
        "Responda APENAS com JSON válido, sem markdown, no formato exato: {\"hasUnresolvedText\": true|false, \"spuriousTexts\": [{\"text\": \"...\", \"classification\": \"unauthorized_text\"|\"ghost_text\"|\"duplicated_text\", \"bbox\": {\"xPct\": 0, \"yPct\": 0, \"widthPct\": 0, \"heightPct\": 0}, \"confidence\": 0.0}]}",
      ].join("\n"),
      specialistId: input.specialistId,
      imageUrls: [input.imageUrl],
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.1,
      // ETAPA 3.3 — era 50 (só cabia o booleano); achados estruturados (texto/bbox/confiança) por
      // ocorrência exigem mais espaço, mesmo orçamento usado pela análise pré-composição.
      maxTokens: 400,
      timeoutMs: 20_000,
    });
    input.onCost?.(response);
    // Conservador (brief): resposta incompleta nunca declara "limpo" — mas sem achados
    // estruturados pra agir, o chamador não tem como localizar o residual (passe residual
    // simplesmente não roda, vai direto pro `UNRECOVERABLE_GLOBAL_TEXT`).
    if (response.status !== "completed") return { hasUnresolvedText: true, residualFindings: [] };
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Global Text Recheck")) as { hasUnresolvedText?: unknown; spuriousTexts?: unknown };
    const residualFindings = parseSpuriousTexts(parsed.spuriousTexts);
    // `hasUnresolvedText` explícito continua sendo a fonte de verdade do veredito (conservador:
    // `!== false`); achados SEM o booleano mas com a lista não-vazia ainda contam como "ainda tem
    // problema" — nunca confia só na lista pra decidir o veredito geral, só pra localizar.
    const hasUnresolvedText = parsed.hasUnresolvedText !== false || residualFindings.length > 0;
    return { hasUnresolvedText, residualFindings };
  } catch {
    return { hasUnresolvedText: true, residualFindings: [] };
  }
}
