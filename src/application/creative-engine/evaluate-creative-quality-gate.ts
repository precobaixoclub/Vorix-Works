import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole } from "../../shared/utils/gpt-creative-plan.types.js";
import { COMMERCIAL_FACT_TYPE_LABELS_PT, extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";

/**
 * Quality gate do motor GPT — migração "GPT como motor criativo único" (PR 5/9), promovido de
 * `evaluate-gpt-prototype-quality-gate.ts` (protótipo isolado) com a lista completa de falhas
 * críticas pedida. DELIBERADAMENTE mais simples que o Quality Gate do motor legado
 * (`lucas-quality-review.skill.ts`, 10 dimensões de score) — só `pass`/`fail` + lista de motivos,
 * nunca um score que tenta substituir o julgamento criativo do GPT.
 */

export const CREATIVE_QUALITY_ISSUE_CODES = [
  "PRODUCT_MISMATCH",
  "WRONG_LOGO",
  "SCREENSHOT_MISCHARACTERIZED",
  "REQUIRED_ASSET_MISSING",
  "INVENTED_COMMERCIAL_FACT",
  "WRONG_PRICE",
  "TEXT_ILLEGIBLE_OR_CUT",
  "ELEMENT_CUT_OFF",
  "WRONG_ASPECT_RATIO",
  "CRITICAL_OVERLAP",
  "COMPOSITION_BROKEN",
  "NON_PUBLISHABLE_SOURCE",
] as const;
export type CreativeQualityIssueCode = (typeof CREATIVE_QUALITY_ISSUE_CODES)[number];

export type CreativeQualityIssue = {
  code: CreativeQualityIssueCode;
  message: string;
};

export type CreativeQualityGateResult = {
  verdict: "pass" | "fail";
  issues: CreativeQualityIssue[];
};

const ASPECT_RATIO_TOLERANCE = 0.06;

function parseAspectRatio(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return undefined;
  return width / height;
}

/**
 * Falhas determinísticas — nunca dependem de IA, calculadas sobre dados REAIS (dimensões do
 * buffer final, quais assets foram de fato compostos, proveniência do artefato). Nada aqui
 * "adivinha" — cada issue vem de um dado concreto que já existe no resultado da execução.
 */
export function evaluateDeterministicCreativeChecks(input: {
  finalImageWidth: number;
  finalImageHeight: number;
  expectedAspectRatio: string;
  compositedAssetRoles: CreativePlanAssetRole[];
  contextAssetRoles: CreativePlanAssetRole[];
  /** `true` quando o artefato final tem proveniência não publicável (ver
   * `src/shared/utils/artifact-provenance.ts`) — nunca deve acontecer no caminho normal do motor
   * GPT, mas é a última rede de proteção determinística caso algo escape. */
  nonPublishableSource?: boolean;
}): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];

  const expectedRatio = parseAspectRatio(input.expectedAspectRatio);
  if (expectedRatio && input.finalImageWidth > 0 && input.finalImageHeight > 0) {
    const actualRatio = input.finalImageWidth / input.finalImageHeight;
    const deviation = Math.abs(actualRatio - expectedRatio) / expectedRatio;
    if (deviation > ASPECT_RATIO_TOLERANCE) {
      issues.push({
        code: "WRONG_ASPECT_RATIO",
        message: `Peça final ${input.finalImageWidth}x${input.finalImageHeight} não corresponde ao formato pedido "${input.expectedAspectRatio}" (desvio de ${(deviation * 100).toFixed(1)}%).`,
      });
    }
  }

  // Só logo/screenshot exigem composição determinística — produto real pode ter sido tratado por
  // edição via referência na própria geração (sem composição posterior), então não entra aqui.
  const rolesRequiringComposite: CreativePlanAssetRole[] = ["logo", "screenshot"];
  for (const role of rolesRequiringComposite) {
    if (input.contextAssetRoles.includes(role) && !input.compositedAssetRoles.includes(role)) {
      issues.push({
        code: "REQUIRED_ASSET_MISSING",
        message: `Asset obrigatório do tipo "${role}" estava disponível no contexto, mas não foi composto na peça final.`,
      });
    }
  }

  if (input.nonPublishableSource) {
    issues.push({
      code: "NON_PUBLISHABLE_SOURCE",
      message: "A imagem final tem origem marcada como não publicável (placeholder/fallback automático) — nunca pode virar peça entregável.",
    });
  }

  return issues;
}

/**
 * Determinístico, sem chamada de IA e sem custo: varre todo texto que a peça final vai exibir
 * (headline, subheadline, CTA, título, descrição, zonas de texto do plano) atrás de valores
 * comerciais (preço, desconto, frete, urgência) via `extractCommercialFactsFromText` — o mesmo
 * extrator regex já usado para o texto livre do usuário — e reprova qualquer valor que não esteja
 * EXATAMENTE entre os fatos já confirmados do `creative_context`. É a proteção direta contra o
 * GPT "quase acertar" um preço (ex.: arredondar R$39,99 para R$40) ou inventar uma condição
 * comercial que nunca foi confirmada.
 */
export function checkCommercialFactIntegrity(plan: CreativePlan, context: CreativeContext): CreativeQualityIssue[] {
  const texts = [plan.headline, plan.subheadline, plan.cta, plan.title, plan.description, ...plan.textZones.map((zone) => zone.text)].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  if (texts.length === 0) return [];

  const mentionedFacts = extractCommercialFactsFromText(texts.join("\n"));
  const issues: CreativeQualityIssue[] = [];

  for (const fact of mentionedFacts) {
    const matchesConfirmed = context.confirmedFacts.some((line) => line.includes(fact.value));
    if (matchesConfirmed) continue;

    const label = COMMERCIAL_FACT_TYPE_LABELS_PT[fact.type];
    const sameTypeConfirmed = context.confirmedFacts.some((line) => line.startsWith(label));
    issues.push({
      code: sameTypeConfirmed ? "WRONG_PRICE" : "INVENTED_COMMERCIAL_FACT",
      message: sameTypeConfirmed
        ? `A peça menciona "${fact.value}" (${label}), mas o fato confirmado no contexto tem outro valor — nunca publicar um dado comercial diferente do confirmado.`
        : `A peça menciona "${fact.value}" (${label}), mas nenhum fato comercial confirmado desse tipo existe no contexto — nunca inventar preço, desconto ou condição comercial.`,
    });
  }

  return issues;
}

const VISUAL_INTEGRITY_PROMPT = [
  "Avalie esta peça publicitária JÁ FINALIZADA (a imagem anexada) para defeitos GRAVES apenas — não julgue estética, apenas problemas objetivos que tornariam a peça inaceitável.",
  "Responda APENAS com JSON válido, sem markdown, no formato exato:",
  '{"productMismatch": true|false, "wrongLogo": true|false, "screenshotMischaracterized": true|false, "textIllegibleOrCut": true|false, "elementCutOff": true|false, "criticalOverlap": true|false, "compositionBroken": true|false, "reasoning": "1-2 frases objetivas"}',
  "REGRAS:",
  "- \"productMismatch\": true SOMENTE se havia uma foto de produto real de referência e o produto na peça final é claramente outro produto (nunca marque true sem uma referência real para comparar).",
  "- \"wrongLogo\": true SOMENTE se havia uma logo real de referência e a logo na peça final é visivelmente diferente (cores, proporções, símbolo) — nunca marque true sem uma referência real.",
  "- \"screenshotMischaracterized\": true SOMENTE se havia um screenshot real de referência e a interface mostrada na peça final não corresponde a ele (ex.: uma tela genérica/inventada no lugar do site real).",
  "- \"textIllegibleOrCut\": true se algum texto principal (headline, CTA, preço) está cortado nas bordas, sobreposto de forma ilegível, ou com contraste tão baixo que não dá pra ler.",
  "- \"elementCutOff\": true se qualquer elemento visual importante (produto, logo, dispositivo/mockup) está cortado de forma que perde informação essencial.",
  "- \"criticalOverlap\": true se um elemento comercial (preço, CTA, badge) sobrepõe de forma destrutiva um rosto, o produto principal ou outro elemento essencial.",
  "- \"compositionBroken\": true se a composição está visivelmente quebrada — elementos deformados, pillarboxing (barras vazias nas laterais), ou artefatos visuais graves.",
  "- Na dúvida, prefira false — este gate é para pegar defeitos ÓBVIOS, não para microgerenciar qualidade estética.",
].join("\n");

/** Chamada de visão best-effort, UMA chamada cobrindo todos os critérios juntos (deliberadamente
 * mais barato que o motor legado, que faz 1 chamada por critério) — falha ou resposta ilegível
 * nunca reprova por conta própria, só um veredito EXPLÍCITO de defeito grave gera issue. */
export async function checkCreativeVisualIntegrity(
  icaro: IcaroBrainPort,
  input: { finalImageUrl: string; referenceProductImageUrl?: string; referenceLogoUrl?: string; referenceScreenshotUrl?: string; specialistId: string },
): Promise<CreativeQualityIssue[]> {
  try {
    const referenceUrls = [input.referenceProductImageUrl, input.referenceLogoUrl, input.referenceScreenshotUrl].filter(
      (url): url is string => Boolean(url),
    );
    const imageUrls = [...referenceUrls, input.finalImageUrl];
    const response = await icaro.request({
      taskType: "review",
      prompt: VISUAL_INTEGRITY_PROMPT,
      specialistId: input.specialistId,
      imageUrls,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 400,
      timeoutMs: 25_000,
    });

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Creative Quality Gate")) as {
      productMismatch?: unknown;
      wrongLogo?: unknown;
      screenshotMischaracterized?: unknown;
      textIllegibleOrCut?: unknown;
      elementCutOff?: unknown;
      criticalOverlap?: unknown;
      compositionBroken?: unknown;
      reasoning?: unknown;
    };
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    const issues: CreativeQualityIssue[] = [];
    if (parsed.productMismatch === true) issues.push({ code: "PRODUCT_MISMATCH", message: reasoning ?? "O produto na peça final não corresponde à foto de referência." });
    if (parsed.wrongLogo === true) issues.push({ code: "WRONG_LOGO", message: reasoning ?? "A logo na peça final não corresponde à logo real de referência." });
    if (parsed.screenshotMischaracterized === true) issues.push({ code: "SCREENSHOT_MISCHARACTERIZED", message: reasoning ?? "A interface mostrada não corresponde ao screenshot real de referência." });
    if (parsed.textIllegibleOrCut === true) issues.push({ code: "TEXT_ILLEGIBLE_OR_CUT", message: reasoning ?? "Texto principal ilegível ou cortado." });
    if (parsed.elementCutOff === true) issues.push({ code: "ELEMENT_CUT_OFF", message: reasoning ?? "Elemento visual importante cortado, perdendo informação essencial." });
    if (parsed.criticalOverlap === true) issues.push({ code: "CRITICAL_OVERLAP", message: reasoning ?? "Elemento comercial sobrepõe destrutivamente rosto/produto/outro elemento essencial." });
    if (parsed.compositionBroken === true) issues.push({ code: "COMPOSITION_BROKEN", message: reasoning ?? "Composição visivelmente quebrada." });
    return issues;
  } catch {
    return [];
  }
}

export function combineCreativeQualityIssues(...groups: CreativeQualityIssue[][]): CreativeQualityGateResult {
  const issues = groups.flat();
  return { verdict: issues.length > 0 ? "fail" : "pass", issues };
}

/** Orquestra as três camadas (determinística + fatos comerciais + visão) — ponto único de
 * entrada usado por `run-gpt-creative-engine.ts`. Nunca produz um score — só `pass`/`fail` e a
 * lista de motivos, para nunca redirecionar a direção de arte do GPT. */
export async function evaluateCreativeQualityGate(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    finalImageWidth: number;
    finalImageHeight: number;
    expectedAspectRatio: string;
    compositedAssetRoles: CreativePlanAssetRole[];
    context: CreativeContext;
    plan: CreativePlan;
    specialistId: string;
    nonPublishableSource?: boolean;
  },
): Promise<CreativeQualityGateResult> {
  const deterministicIssues = evaluateDeterministicCreativeChecks({
    finalImageWidth: input.finalImageWidth,
    finalImageHeight: input.finalImageHeight,
    expectedAspectRatio: input.expectedAspectRatio,
    compositedAssetRoles: input.compositedAssetRoles,
    contextAssetRoles: input.context.assets.map((asset) => asset.role),
    nonPublishableSource: input.nonPublishableSource,
  });

  const commercialFactIssues = checkCommercialFactIntegrity(input.plan, input.context);

  const referenceProductImageUrl = input.context.assets.find((asset) => asset.role === "product_photo")?.url;
  const referenceLogoUrl = input.context.assets.find((asset) => asset.role === "logo")?.url;
  const referenceScreenshotUrl = input.context.assets.find((asset) => asset.role === "screenshot")?.url;
  const visualIssues = await checkCreativeVisualIntegrity(icaro, {
    finalImageUrl: input.finalImageUrl,
    referenceProductImageUrl,
    referenceLogoUrl,
    referenceScreenshotUrl,
    specialistId: input.specialistId,
  });

  return combineCreativeQualityIssues(deterministicIssues, commercialFactIssues, visualIssues);
}
