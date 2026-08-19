/**
 * Unified Final Creative Score (Rodada 2, Fatia 2, Prioridade 10) — score 0-100 pós-geração
 * (Pedro + renderer + Quality Gates já rodaram), consolidando 10 dimensões 0-10. NÃO substitui
 * falhas duras: quem chama isto decide `hasHardFailure` a partir dos próprios issues já
 * calculados (preço errado, alucinação, texto ilegível/cortado, etc.) — quando `true`, o veredito
 * é sempre "reject", mesmo com nota alta ("a nota nunca mascara uma falha crítica").
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002. Este módulo é deliberadamente
 * agnóstico de `LucasIssueCode` (não importa nada do Lucas) — quem decide SE há falha dura é
 * sempre quem chama, a partir dos próprios sinais já calculados.
 */

export type CreativeQualityDimensions = {
  productFidelity: number;
  factualAccuracy: number;
  commercialClarity: number;
  visualHierarchy: number;
  typography: number;
  brandConsistency: number;
  productProminence: number;
  layoutBalance: number;
  specificity: number;
  professionalPolish: number;
};

export const CREATIVE_QUALITY_DIMENSION_KEYS: Array<keyof CreativeQualityDimensions> = [
  "productFidelity",
  "factualAccuracy",
  "commercialClarity",
  "visualHierarchy",
  "typography",
  "brandConsistency",
  "productProminence",
  "layoutBalance",
  "specificity",
  "professionalPolish",
];

export type CreativeQualityVerdict = "excellent" | "approved" | "repair" | "reject";

/** Limiares — ajustáveis com justificativa técnica (documentada aqui, não escondida em código
 * espalhado): 90-100 excelente; 82-89 aprovado; 72-81 reparo/revisão; abaixo de 72, rejeitar. */
export const CREATIVE_QUALITY_THRESHOLDS = { excellent: 90, approved: 82, repair: 72 } as const;

export type CreativeQualityScoreInput = {
  dimensions: CreativeQualityDimensions;
  /** `true` quando QUALQUER falha crítica objetiva foi detectada pelos Quality Gates existentes
   * (preço/produto errado, claim inventado, texto ilegível/cortado, sobreposição crítica,
   * pillarboxing, CTA cortado, logo quebrada, arte fora da proporção) — decidido pelo CHAMADOR, a
   * partir dos issues que ele já calculou, nunca recalculado aqui. */
  hasHardFailure: boolean;
  hardFailureReasons: string[];
};

export type CreativeQualityScoreResult = {
  score: number;
  dimensions: CreativeQualityDimensions;
  verdict: CreativeQualityVerdict;
  blockedByHardFailure: boolean;
  reasoning: string;
};

function resolveVerdictFromScore(score: number): CreativeQualityVerdict {
  if (score >= CREATIVE_QUALITY_THRESHOLDS.excellent) return "excellent";
  if (score >= CREATIVE_QUALITY_THRESHOLDS.approved) return "approved";
  if (score >= CREATIVE_QUALITY_THRESHOLDS.repair) return "repair";
  return "reject";
}

export function computeCreativeQualityScore(input: CreativeQualityScoreInput): CreativeQualityScoreResult {
  const score = CREATIVE_QUALITY_DIMENSION_KEYS.reduce((total, key) => total + input.dimensions[key], 0);
  const scoreBasedVerdict = resolveVerdictFromScore(score);
  // Falha dura sempre vence, mesmo com score de "excellent" — nunca mascarada pela nota agregada.
  const verdict: CreativeQualityVerdict = input.hasHardFailure ? "reject" : scoreBasedVerdict;

  const reasoning = input.hasHardFailure
    ? `Score ${score}/100 (${scoreBasedVerdict}), mas REJEITADO por falha crítica objetiva: ${input.hardFailureReasons.join("; ")}. A nota nunca mascara uma falha crítica.`
    : `Score ${score}/100 → veredito "${verdict}" (limiares: >=${CREATIVE_QUALITY_THRESHOLDS.excellent} excelente, >=${CREATIVE_QUALITY_THRESHOLDS.approved} aprovado, >=${CREATIVE_QUALITY_THRESHOLDS.repair} reparo/revisão, abaixo disso rejeitar).`;

  return { score, dimensions: input.dimensions, verdict, blockedByHardFailure: input.hasHardFailure, reasoning };
}
