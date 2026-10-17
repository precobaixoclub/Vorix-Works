import { z } from "zod";

/**
 * `ReportAnalysisResultV1` — operação `report_ai_analysis`: leitura de um relatório já calculado
 * (números vêm do backend/painel, a IA só interpreta). Validação em duas camadas, mesmo padrão de
 * `deal-commercial-insights-result.v1.ts`: estrutural (Zod strict) e semântica — todo destaque,
 * risco e recomendação precisa citar um trecho LITERAL do relatório; sem evidência, é descartado.
 */
export const REPORT_ANALYSIS_RESULT_SCHEMA_VERSION = 1;

const itemSchema = z.object({ title: z.string().min(1).max(180), evidence: z.string().min(1).max(240) }).strict();
const recommendationSchema = z.object({ title: z.string().min(1).max(180), rationale: z.string().min(1).max(320), evidence: z.string().min(1).max(240) }).strict();

const resultSchema = z
  .object({
    schemaVersion: z.literal(REPORT_ANALYSIS_RESULT_SCHEMA_VERSION),
    summary: z.string().max(900),
    highlights: z.array(itemSchema).max(5),
    risks: z.array(itemSchema).max(5),
    recommendations: z.array(recommendationSchema).max(5),
    warnings: z.array(z.string()).max(10),
  })
  .strict();

export type ReportAnalysisResult = z.infer<typeof resultSchema>;

const evidenceProperty = { type: "string", minLength: 1, maxLength: 240, description: "Trecho LITERAL copiado do relatório (ex.: \"Conversão: 32%\") — nunca paráfrase." };

export const REPORT_ANALYSIS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "highlights", "risks", "recommendations", "warnings"],
  properties: {
    schemaVersion: { const: REPORT_ANALYSIS_RESULT_SCHEMA_VERSION },
    summary: { type: "string", maxLength: 900, description: "Leitura executiva do período em 2 a 4 frases, citando os números do relatório." },
    highlights: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["title", "evidence"], properties: { title: { type: "string", minLength: 1, maxLength: 180, description: "Ponto positivo ou fato relevante." }, evidence: evidenceProperty } } },
    risks: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["title", "evidence"], properties: { title: { type: "string", minLength: 1, maxLength: 180, description: "Ponto de atenção sustentado pelos números." }, evidence: evidenceProperty } } },
    recommendations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "evidence"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 180, description: "Ação concreta sugerida para a gestão." },
          rationale: { type: "string", minLength: 1, maxLength: 320 },
          evidence: evidenceProperty,
        },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string" } },
  },
};

export function validateReportAnalysisStructure(raw: unknown): { valid: true; data: ReportAnalysisResult } | { valid: false; errors: readonly string[] } {
  const result = resultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

/** Normaliza para comparar evidência com o texto-fonte sem depender de espaços/maiúsculas. */
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function applyReportAnalysisSemanticValidation(params: { structural: ReportAnalysisResult; sourceText: string }): { valid: true; data: ReportAnalysisResult; warnings: readonly string[] } {
  const source = normalize(params.sourceText);
  const grounded = (evidence: string) => source.includes(normalize(evidence));
  const warnings: string[] = [...params.structural.warnings];
  const keep = <T extends { title: string; evidence: string }>(items: readonly T[], kind: string) => items.filter((item) => grounded(item.evidence) || (warnings.push(`${kind}_not_grounded: "${item.title}"`), false));
  return {
    valid: true,
    data: {
      ...params.structural,
      highlights: keep(params.structural.highlights, "highlight"),
      risks: keep(params.structural.risks, "risk"),
      recommendations: keep(params.structural.recommendations, "recommendation"),
      warnings,
    },
    warnings,
  };
}
