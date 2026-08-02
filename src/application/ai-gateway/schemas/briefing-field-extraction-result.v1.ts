import { z } from "zod";
import type { BriefingSchema } from "../../../domain/briefing/briefing.model.js";

/**
 * `BriefingFieldExtractionResultV1` — Sprint 08 (Fase 8). Contrato de saída estruturada da ÚNICA
 * operação executável desta sprint. Validado em DUAS camadas obrigatórias, nesta ordem
 * (decisão obrigatória — nunca invertida):
 *
 * 1. ESTRUTURAL (`validateBriefingFieldExtractionStructure`) — Zod `strict()`: forma, tipos,
 *    ranges, nenhuma chave desconhecida. Não sabe nada sobre QUAL Briefing está ativo.
 * 2. SEMÂNTICA (`applySemanticValidation`) — já sabe o schema do Briefing ativo: descarta
 *    candidatos para campos que não existem, valores fora de `acceptedValues` (quando o campo é
 *    enum) e `evidence` que não aparece de fato no texto original (defesa contra alucinação —
 *    nunca aceitar uma "evidência" que o modelo inventou). Falha total só quando NADA sobra.
 *
 * `rationaleCode` é um enum fechado, curto — nunca uma explicação privada extensa do modelo
 * (Fase 8: "não pedir nem armazenar chain of thought").
 */

export const AI_RATIONALE_CODES = ["explicit_statement", "inferred_from_context", "pattern_match", "low_confidence_guess"] as const;
export type AiRationaleCode = (typeof AI_RATIONALE_CODES)[number];

export const BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION = 1;

const briefingFieldExtractionCandidateSchema = z
  .object({
    fieldKey: z.string().min(1).max(100),
    originalText: z.string().min(1).max(500),
    proposedValue: z.string().min(1).max(500),
    normalizedValue: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(300),
    requiresConfirmation: z.boolean(),
    sensitivityDetected: z.boolean(),
    rationaleCode: z.enum(AI_RATIONALE_CODES),
  })
  .strict();

const briefingFieldExtractionResultSchema = z
  .object({
    schemaVersion: z.literal(BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION),
    candidates: z.array(briefingFieldExtractionCandidateSchema).max(20),
    ambiguities: z.array(z.string().min(1).max(200)).max(20),
    unsupportedClaims: z.array(z.string().min(1).max(200)).max(20),
    warnings: z.array(z.string().min(1).max(200)).max(20),
  })
  .strict();

export type BriefingFieldExtractionCandidate = z.infer<typeof briefingFieldExtractionCandidateSchema>;
export type BriefingFieldExtractionResult = z.infer<typeof briefingFieldExtractionResultSchema>;

export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

/** JSON Schema espelhando `briefingFieldExtractionResultSchema` — usado como `input_schema` da
 * tool forçada da Anthropic (o SDK fala JSON Schema, não Zod). Mantido manualmente em sincronia
 * de propósito (mesmo padrão de "espelhamento por convenção" já usado em
 * `WorkspaceIntegrationRef`) — nenhuma lib de zod-to-json-schema foi adicionada só para isto. Um
 * teste dedicado (`briefing-field-extraction-tool-schema.test.mjs`) gera exemplos válidos/inválidos
 * e confere que os dois lados concordam. */
export const BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "candidates", "ambiguities", "unsupportedClaims", "warnings"],
  properties: {
    schemaVersion: { const: BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION },
    candidates: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "originalText", "proposedValue", "normalizedValue", "confidence", "evidence", "requiresConfirmation", "sensitivityDetected", "rationaleCode"],
        properties: {
          fieldKey: { type: "string", minLength: 1, maxLength: 100 },
          originalText: { type: "string", minLength: 1, maxLength: 500 },
          proposedValue: { type: "string", minLength: 1, maxLength: 500 },
          normalizedValue: { type: "string", minLength: 1, maxLength: 500 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "string", minLength: 1, maxLength: 300, description: "Trecho curto e literal do texto do usuário — nunca inventado." },
          requiresConfirmation: { type: "boolean" },
          sensitivityDetected: { type: "boolean" },
          rationaleCode: { type: "string", enum: [...AI_RATIONALE_CODES] },
        },
      },
    },
    ambiguities: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
    unsupportedClaims: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
    warnings: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
  },
};

export function validateBriefingFieldExtractionStructure(raw: unknown): StructuredValidationResult<BriefingFieldExtractionResult> {
  const result = briefingFieldExtractionResultSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  }
  return { valid: true, data: result.data };
}

export type SemanticValidationResult =
  | { valid: true; data: BriefingFieldExtractionResult; warnings: readonly string[] }
  | { valid: false; errors: readonly string[] };

/** Roda SÓ depois de `validateBriefingFieldExtractionStructure` ter aprovado — nunca a única
 * validação. Descarta candidato por candidato em vez de invalidar o lote inteiro (um `fieldKey`
 * desconhecido não deveria jogar fora 4 candidatos bons); só falha de verdade quando não sobra
 * absolutamente nada aproveitável. */
export function applySemanticValidation(params: { structural: BriefingFieldExtractionResult; schema: BriefingSchema; sourceText: string }): SemanticValidationResult {
  const fieldsByKey = new Map(params.schema.fields.map((field) => [field.key, field] as const));
  const normalizedSource = params.sourceText.toLowerCase();
  const warnings: string[] = [...params.structural.warnings];
  const keptCandidates: BriefingFieldExtractionCandidate[] = [];

  for (const candidate of params.structural.candidates) {
    const field = fieldsByKey.get(candidate.fieldKey);
    if (!field) {
      warnings.push(`candidate_dropped:unknown_field_key:${candidate.fieldKey}`);
      continue;
    }
    if (field.dataType === "enum" && field.acceptedValues && !field.acceptedValues.includes(candidate.normalizedValue)) {
      warnings.push(`candidate_dropped:value_not_in_accepted_values:${candidate.fieldKey}`);
      continue;
    }
    if (!normalizedSource.includes(candidate.evidence.trim().toLowerCase())) {
      warnings.push(`candidate_dropped:evidence_not_traceable:${candidate.fieldKey}`);
      continue;
    }
    keptCandidates.push(candidate);
  }

  // Zero candidatos sobrando NUNCA é `valid:false` — "a IA não achou nada de útil neste turno" é
  // um resultado normal, do mesmo jeito que a extração determinística às vezes não acha nada. Um
  // aviso registra o caso (útil para observabilidade), mas nunca bloqueia o turno.
  if (keptCandidates.length === 0 && params.structural.candidates.length > 0) {
    warnings.push("all_candidates_dropped_by_semantic_validation");
  }

  return { valid: true, data: { ...params.structural, candidates: keptCandidates }, warnings };
}
