import { z } from "zod";
import { isReportSectionKey, REPORT_SECTION_KEYS } from "../../../domain/reports/report-catalog.js";

/**
 * `ReportTemplateResultV1` — operação `report_template_builder`: a partir do que o cliente quer
 * acompanhar, a IA escolhe seções do catálogo FECHADO. Seção fora do catálogo é descartada; sem
 * nenhuma seção válida o resultado é inválido (nada é salvo sem revisão do cliente).
 */
export const REPORT_TEMPLATE_RESULT_SCHEMA_VERSION = 1;

const resultSchema = z
  .object({
    schemaVersion: z.literal(REPORT_TEMPLATE_RESULT_SCHEMA_VERSION),
    name: z.string().min(1).max(80),
    description: z.string().max(300),
    sections: z.array(z.string().min(1).max(60)).min(1).max(10),
    rationale: z.string().max(500),
    warnings: z.array(z.string()).max(10),
  })
  .strict();

export type ReportTemplateResult = z.infer<typeof resultSchema>;

export const REPORT_TEMPLATE_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "name", "description", "sections", "rationale", "warnings"],
  properties: {
    schemaVersion: { const: REPORT_TEMPLATE_RESULT_SCHEMA_VERSION },
    name: { type: "string", minLength: 1, maxLength: 80, description: "Nome curto do relatório (ex.: Fechamento semanal de vendas)." },
    description: { type: "string", maxLength: 300, description: "Para que serve este relatório, em uma frase." },
    sections: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", enum: [...REPORT_SECTION_KEYS] }, description: "Chaves das seções do catálogo, na ordem em que devem aparecer." },
    rationale: { type: "string", maxLength: 500, description: "Por que essas seções respondem ao pedido." },
    warnings: { type: "array", maxItems: 10, items: { type: "string", description: "O que foi pedido e não existe no catálogo." } },
  },
};

export function validateReportTemplateStructure(raw: unknown): { valid: true; data: ReportTemplateResult } | { valid: false; errors: readonly string[] } {
  const result = resultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

export function applyReportTemplateSemanticValidation(structural: ReportTemplateResult): { valid: true; data: ReportTemplateResult; warnings: readonly string[] } | { valid: false; errors: readonly string[] } {
  const warnings = [...structural.warnings];
  const sections = [...new Set(structural.sections)].filter((key) => isReportSectionKey(key) || (warnings.push(`section_unknown: "${key}"`), false));
  if (sections.length === 0) return { valid: false, errors: ["sections: nenhuma seção válida do catálogo"] };
  return { valid: true, data: { ...structural, sections, warnings }, warnings };
}
