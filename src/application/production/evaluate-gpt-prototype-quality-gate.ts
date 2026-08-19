import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativeContext, CreativePlanAssetRole } from "../../shared/utils/gpt-creative-plan.types.js";

/**
 * Protótipo Paralelo — GPT/OpenAI como motor criativo principal (ver plano em
 * `run-gpt-creative-prototype.ts`). Gate DELIBERADAMENTE mais simples que o Quality Gate do motor
 * atual (`lucas-quality-review.skill.ts`, 10 dimensões de score) — só falhas graves, sem tentar
 * "ensinar design" ao modelo. Um `pass`/`fail` e a lista de motivos, nunca um score.
 */

export const GPT_PROTOTYPE_QUALITY_ISSUE_CODES = [
  "PRODUCT_MISMATCH",
  "REQUIRED_ASSET_MISSING",
  "TEXT_ILLEGIBLE_OR_CUT",
  "WRONG_ASPECT_RATIO",
  "COMPOSITION_BROKEN",
] as const;
export type GptPrototypeQualityIssueCode = (typeof GPT_PROTOTYPE_QUALITY_ISSUE_CODES)[number];

export type GptPrototypeQualityIssue = {
  code: GptPrototypeQualityIssueCode;
  message: string;
};

export type GptPrototypeQualityGateResult = {
  verdict: "pass" | "fail";
  issues: GptPrototypeQualityIssue[];
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
 * buffer final, quais assets foram de fato compostos). `compositedAssetRoles` vem de quem
 * orquestrou a composição (`run-gpt-creative-prototype.ts`) — nunca inferido aqui.
 */
export function evaluateDeterministicGptPrototypeChecks(input: {
  finalImageWidth: number;
  finalImageHeight: number;
  expectedAspectRatio: string;
  compositedAssetRoles: CreativePlanAssetRole[];
  contextAssetRoles: CreativePlanAssetRole[];
}): GptPrototypeQualityIssue[] {
  const issues: GptPrototypeQualityIssue[] = [];

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

  return issues;
}

const VISUAL_INTEGRITY_PROMPT = [
  "Avalie esta peça publicitária JÁ FINALIZADA (a imagem anexada) para defeitos GRAVES apenas — não julgue estética, apenas problemas objetivos que tornariam a peça inaceitável.",
  "Responda APENAS com JSON válido, sem markdown, no formato exato:",
  '{"productMismatch": true|false, "textIllegibleOrCut": true|false, "compositionBroken": true|false, "reasoning": "1-2 frases objetivas"}',
  "REGRAS:",
  "- \"productMismatch\": true SOMENTE se havia uma foto de produto real de referência e o produto na peça final é claramente outro produto (nunca marque true sem uma referência real para comparar).",
  "- \"textIllegibleOrCut\": true se algum texto principal (headline, CTA) está cortado nas bordas, sobreposto de forma ilegível, ou com contraste tão baixo que não dá pra ler.",
  "- \"compositionBroken\": true se a composição está visivelmente quebrada — elementos deformados, pillarboxing (barras vazias nas laterais), ou artefatos visuais graves.",
  "- Na dúvida, prefira false — este gate é para pegar defeitos ÓBVIOS, não para microgerenciar qualidade estética.",
].join("\n");

/** Chamada de visão best-effort (mesmo padrão de `checkProductFidelity`/`checkSemanticOcclusion`
 * em `lucas-quality-review.skill.ts`) — falha ou resposta ilegível nunca reprova por conta
 * própria, só um veredito EXPLÍCITO de defeito grave gera issue. Uma chamada só, cobrindo os 3
 * critérios juntos (deliberadamente mais barato que o motor atual, que faz 1 chamada por critério). */
export async function checkGptPrototypeVisualIntegrity(
  icaro: IcaroBrainPort,
  input: { finalImageUrl: string; referenceProductImageUrl?: string; specialistId: string },
): Promise<GptPrototypeQualityIssue[]> {
  try {
    const imageUrls = input.referenceProductImageUrl ? [input.referenceProductImageUrl, input.finalImageUrl] : [input.finalImageUrl];
    const response = await icaro.request({
      taskType: "review",
      prompt: VISUAL_INTEGRITY_PROMPT,
      specialistId: input.specialistId,
      imageUrls,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 300,
      timeoutMs: 25_000,
    });

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "GPT Prototype Quality Gate")) as {
      productMismatch?: unknown;
      textIllegibleOrCut?: unknown;
      compositionBroken?: unknown;
      reasoning?: unknown;
    };
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    const issues: GptPrototypeQualityIssue[] = [];
    if (parsed.productMismatch === true) issues.push({ code: "PRODUCT_MISMATCH", message: reasoning ?? "O produto na peça final não corresponde à foto de referência." });
    if (parsed.textIllegibleOrCut === true) issues.push({ code: "TEXT_ILLEGIBLE_OR_CUT", message: reasoning ?? "Texto principal ilegível ou cortado." });
    if (parsed.compositionBroken === true) issues.push({ code: "COMPOSITION_BROKEN", message: reasoning ?? "Composição visivelmente quebrada." });
    return issues;
  } catch {
    return [];
  }
}

export function combineGptPrototypeQualityIssues(...groups: GptPrototypeQualityIssue[][]): GptPrototypeQualityGateResult {
  const issues = groups.flat();
  return { verdict: issues.length > 0 ? "fail" : "pass", issues };
}

/** Orquestra as duas camadas (determinística + visão) — ponto único de entrada usado por
 * `run-gpt-creative-prototype.ts`. */
export async function evaluateGptPrototypeQualityGate(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    finalImageWidth: number;
    finalImageHeight: number;
    expectedAspectRatio: string;
    compositedAssetRoles: CreativePlanAssetRole[];
    context: CreativeContext;
    specialistId: string;
  },
): Promise<GptPrototypeQualityGateResult> {
  const deterministicIssues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: input.finalImageWidth,
    finalImageHeight: input.finalImageHeight,
    expectedAspectRatio: input.expectedAspectRatio,
    compositedAssetRoles: input.compositedAssetRoles,
    contextAssetRoles: input.context.assets.map((asset) => asset.role),
  });

  const referenceProductImageUrl = input.context.assets.find((asset) => asset.role === "product_photo")?.url;
  const visualIssues = await checkGptPrototypeVisualIntegrity(icaro, {
    finalImageUrl: input.finalImageUrl,
    referenceProductImageUrl,
    specialistId: input.specialistId,
  });

  return combineGptPrototypeQualityIssues(deterministicIssues, visualIssues);
}
