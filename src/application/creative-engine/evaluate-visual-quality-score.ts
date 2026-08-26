import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativePlan } from "../../shared/utils/gpt-creative-plan.types.js";

/**
 * Visual Quality Score — auditoria "qualidade visual e direção de arte" (segunda auditoria do
 * motor de criativos). DELIBERADAMENTE separado do quality gate técnico
 * (`evaluate-creative-quality-gate.ts`): aquele responde "isso é publicável?" (pass/fail objetivo,
 * NUNCA um score — ver comentário no topo daquele arquivo). Este responde "isso é BOM?" — uma
 * pergunta subjetiva por natureza, então nunca um único julgamento solto ("parece bonito? sim/não")
 * como o resto do motor evita desde a primeira auditoria. Sempre 12 dimensões concretas, cada uma
 * com nota E justificativa, numa ÚNICA chamada de visão (mesmo princípio de custo de
 * `checkCreativeVisualIntegrity`: mais barato que uma chamada por critério).
 *
 * Só roda DEPOIS que o quality gate técnico já passou (`run-gpt-creative-engine.ts`) — nunca vale a
 * pena gastar uma chamada de visão avaliando estética de uma peça que já vai ser reprovada por um
 * defeito técnico duro.
 */

export const VISUAL_QUALITY_DIMENSIONS = [
  { key: "visualHierarchy", label: "hierarquia visual" },
  { key: "compositionBalance", label: "equilíbrio da composição" },
  { key: "legibility", label: "legibilidade" },
  { key: "focusClarity", label: "clareza do foco principal" },
  { key: "canvasUsage", label: "aproveitamento do canvas" },
  { key: "colorCoherence", label: "coerência cromática" },
  { key: "backgroundQuality", label: "qualidade do fundo" },
  { key: "assetIntegration", label: "integração dos assets reais" },
  { key: "nonGenericLook", label: "aparência não genérica (não parece template automático)" },
  { key: "visualCleanliness", label: "ausência de poluição visual" },
  { key: "commercialStrength", label: "força comercial" },
  { key: "artDirectionFidelity", label: "fidelidade à direção de arte planejada" },
] as const;

export type VisualQualityDimensionKey = (typeof VISUAL_QUALITY_DIMENSIONS)[number]["key"];

export type VisualQualityDimensionScore = {
  key: VisualQualityDimensionKey;
  label: string;
  score: number;
  justification: string;
};

export type VisualQualityScoreResult = {
  overallScore: number;
  dimensions: VisualQualityDimensionScore[];
  belowThreshold: boolean;
  weakDimensions: VisualQualityDimensionScore[];
};

/**
 * Limiares fixos e documentados — nunca "achismo" caso a caso. `MIN_OVERALL` é a média mínima
 * pedida pelo usuário como piso de qualidade percebida; `MIN_DIMENSION` existe porque uma peça com
 * média alta mas UMA dimensão catastrófica (ex.: legibilidade 1/10) nunca deveria passar só porque
 * as outras 11 compensam a média — qualquer dimensão abaixo do piso individual já reprova sozinha.
 */
export const VISUAL_QUALITY_MIN_OVERALL_SCORE = 6.5;
export const VISUAL_QUALITY_MIN_DIMENSION_SCORE = 4;

function buildVisualQualityScorePrompt(plan: CreativePlan, brandColors: readonly string[] | undefined): string {
  const art = plan.artDirection;
  const colorsLine = brandColors && brandColors.length > 0 ? `Paleta oficial da marca: ${brandColors.join(", ")}.` : "Nenhuma paleta oficial configurada para esta marca.";
  return [
    "Você é um diretor de arte sênior avaliando a QUALIDADE VISUAL desta peça publicitária já finalizada (imagem anexada) — nunca correção técnica, isso já foi checado antes desta avaliação.",
    "Dê uma nota de 0 a 10 para CADA uma das 12 dimensões abaixo, cada uma com uma justificativa objetiva de 1 frase. Seja um crítico rigoroso, não educado: a maioria das peças reais de mercado fica entre 5 e 7; notas 9-10 são raras e reservadas para peças excepcionais; notas abaixo de 4 significam um defeito estético grave nessa dimensão específica.",
    "",
    "DIREÇÃO DE ARTE PLANEJADA PARA ESTA PEÇA (avalie fidelidade a ISTO, nunca seu gosto pessoal):",
    `- Conceito: ${art.concept}`,
    `- Foco visual principal: ${art.visualFocus} (deveria ocupar ~${art.primaryMassPct}% do canvas)`,
    `- Hierarquia pretendida (do mais para o menos importante): ${art.elementHierarchy.join(" > ")}`,
    `- Estratégia de contraste: ${art.contrastStrategy}`,
    `- Direção cromática: ${art.chromaticDirection}`,
    `- Atmosfera: ${art.atmosphere}`,
    `- Tratamento de fundo: ${art.backgroundTreatment}`,
    `- Relação entre produto/screenshot e texto: ${art.productTextRelationship}`,
    colorsLine,
    "",
    "DIMENSÕES (responda EXATAMENTE estas 12 chaves):",
    ...VISUAL_QUALITY_DIMENSIONS.map((dimension) => `- "${dimension.key}": ${dimension.label}`),
    "",
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    `{${VISUAL_QUALITY_DIMENSIONS.map((dimension) => `"${dimension.key}": {"score": 0-10, "justification": "..."}`).join(", ")}}`,
    "Cada justificativa deve ser ESPECÍFICA e ACIONÁVEL quando a nota for baixa — descreva o problema concreto (ex.: \"o produto ocupa menos de 15% do canvas, sem protagonismo\", \"o headline divide o mesmo peso visual do subheadline, sem hierarquia clara\") em vez de um adjetivo vago (\"composição fraca\"). Essa justificativa pode virar instrução de correção direta para quem vai refazer a peça.",
  ].join("\n");
}

type VisualQualityScoreResponse = Partial<Record<VisualQualityDimensionKey, { score?: unknown; justification?: unknown }>>;

export async function evaluateVisualQualityScore(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    plan: CreativePlan;
    brandColors?: readonly string[];
    specialistId: string;
    /** Auditoria de custo — achado crítico: esta chamada de visão nunca entrava em NENHUM total
     * de custo do motor antes desta correção. Opcional e best-effort, mesmo espírito do resto da
     * função — nunca lançar por causa disto. */
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<VisualQualityScoreResult | undefined> {
  try {
    const response = await icaro.request({
      taskType: "review",
      prompt: buildVisualQualityScorePrompt(input.plan, input.brandColors),
      specialistId: input.specialistId,
      imageUrls: [input.finalImageUrl],
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 25_000,
    });
    input.onCost?.(response);
    if (response.status !== "completed") return undefined;

    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Visual Quality Score")) as VisualQualityScoreResponse;

    const dimensions: VisualQualityDimensionScore[] = [];
    for (const dimension of VISUAL_QUALITY_DIMENSIONS) {
      const raw = parsed[dimension.key];
      const rawScore = raw?.score;
      // Resposta incompleta (dimensão ausente ou nota fora de 0-10) nunca inventa um valor — best
      // effort igual ao resto do gate: sem dado confiável, `undefined` (peça segue sem o score,
      // nunca bloqueada por uma falha de leitura da IA).
      if (typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 10) return undefined;
      dimensions.push({
        key: dimension.key,
        label: dimension.label,
        score: rawScore,
        justification: typeof raw?.justification === "string" && raw.justification.trim() ? raw.justification.trim() : "Sem justificativa.",
      });
    }

    const overallScore = dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length;
    const weakDimensions = dimensions.filter((dimension) => dimension.score < VISUAL_QUALITY_MIN_DIMENSION_SCORE);
    const belowThreshold = overallScore < VISUAL_QUALITY_MIN_OVERALL_SCORE || weakDimensions.length > 0;

    return { overallScore, dimensions, belowThreshold, weakDimensions };
  } catch {
    return undefined;
  }
}

/**
 * Vira as dimensões fracas do score em instruções de correção CONCRETAS para o mesmo diretor GPT
 * — nunca um "melhore a estética" genérico (mesmo princípio das mensagens do quality gate técnico,
 * `routeCreativeRepair`). Prioriza dimensões que cruzaram o piso individual (`weakDimensions`,
 * defeito grave isolado); se nenhuma cruzou mas a média ainda ficou abaixo do piso geral (várias
 * dimensões medianas somadas), usa as 3 piores notas — sempre um número pequeno e finito de
 * instruções por rodada, nunca as 12 de uma vez (rodada de reparo focada, não uma reescrita total).
 */
export function buildAestheticRepairInstructions(result: VisualQualityScoreResult): string[] {
  const critical = result.weakDimensions;
  const source = critical.length > 0 ? critical : [...result.dimensions].sort((a, b) => a.score - b.score).slice(0, 3);
  return source.map((dimension) => `[Qualidade visual — ${dimension.label}, nota ${dimension.score.toFixed(1)}/10] ${dimension.justification}`);
}
