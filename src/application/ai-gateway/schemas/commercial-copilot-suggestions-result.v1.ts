import { z } from "zod";

/**
 * `CommercialCopilotSuggestionsResultV1` — CRM/Comercial, Fase 5. Operação
 * `commercial_copilot_suggestions`: até 5 sugestões de próxima ação sobre um Contact/Deal.
 * Validação em duas camadas, mesma convenção de `briefing-field-extraction-result.v1.ts`:
 *
 * 1. ESTRUTURAL (`validateCommercialCopilotSuggestionsStructure`) — Zod `strict()`: forma, tamanho.
 * 2. SEMÂNTICA (`applyCommercialCopilotSuggestionsSemanticValidation`) — anti-alucinação: cada
 *    `evidence` precisa aparecer literalmente (case-insensitive) no texto-fonte dado ao modelo;
 *    sugestões cuja evidência não bate são descartadas silenciosamente (zero sugestões
 *    sobreviventes é um resultado válido, nunca um erro).
 */

export const COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION = 1;

const SUGGESTED_ACTIONS = ["follow_up_task", "reach_out", "review_deal_stage", "send_proposal", "none"] as const;

const suggestionSchema = z
  .object({
    title: z.string().min(1).max(150),
    rationale: z.string().min(1).max(400),
    evidence: z.string().min(1).max(300),
    confidence: z.number().min(0).max(1),
    suggestedAction: z.enum(SUGGESTED_ACTIONS),
  })
  .strict();

const commercialCopilotSuggestionsResultSchema = z
  .object({
    schemaVersion: z.literal(COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION),
    suggestions: z.array(suggestionSchema).max(5),
    warnings: z.array(z.string()).max(10),
  })
  .strict();

export type CommercialCopilotSuggestion = z.infer<typeof suggestionSchema>;
export type CommercialCopilotSuggestionsResult = z.infer<typeof commercialCopilotSuggestionsResultSchema>;

export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

/** JSON Schema espelhando `commercialCopilotSuggestionsResultSchema` — usado como `input_schema`
 * da tool forçada da Anthropic (mesmo padrão de espelhamento manual das demais operações). */
export const COMMERCIAL_COPILOT_SUGGESTIONS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "suggestions", "warnings"],
  properties: {
    schemaVersion: { const: COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION },
    suggestions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "evidence", "confidence", "suggestedAction"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 150, description: "Título curto da ação sugerida." },
          rationale: { type: "string", minLength: 1, maxLength: 400, description: "Por que esta ação faz sentido, em linguagem de negócio." },
          evidence: {
            type: "string",
            minLength: 1,
            maxLength: 300,
            description: "Trecho LITERAL copiado dos dados fornecidos que embasa a sugestão — nunca um resumo ou paráfrase, e nunca um fato que não apareça no texto dado.",
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          suggestedAction: { type: "string", enum: [...SUGGESTED_ACTIONS], description: "Categoria da ação — 'none' quando a sugestão é só um alerta, sem ação concreta associável." },
        },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string" } },
  },
};

export function validateCommercialCopilotSuggestionsStructure(raw: unknown): StructuredValidationResult<CommercialCopilotSuggestionsResult> {
  const result = commercialCopilotSuggestionsResultSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  }
  return { valid: true, data: result.data };
}

export type SemanticValidationResult =
  | { valid: true; data: CommercialCopilotSuggestionsResult; warnings: readonly string[] }
  | { valid: false; errors: readonly string[] };

/** Descarta (sem erro) qualquer sugestão cuja `evidence` não apareça literalmente no texto-fonte
 * — a mesma defesa anti-alucinação de `applySemanticValidation` (briefing). */
export function applyCommercialCopilotSuggestionsSemanticValidation(params: { structural: CommercialCopilotSuggestionsResult; sourceText: string }): SemanticValidationResult {
  const sourceLower = params.sourceText.toLowerCase();
  const warnings: string[] = [...params.structural.warnings];
  const kept = params.structural.suggestions.filter((suggestion) => {
    const found = sourceLower.includes(suggestion.evidence.trim().toLowerCase());
    if (!found) warnings.push(`suggestion_evidence_not_grounded: "${suggestion.title}"`);
    return found;
  });
  return { valid: true, data: { ...params.structural, suggestions: kept, warnings }, warnings };
}
