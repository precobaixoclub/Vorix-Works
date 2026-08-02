import { getBriefingSchema } from "../../domain/briefing/schema-registry.js";
import type { BriefingType } from "../../domain/briefing/briefing.model.js";
import type { AiOperation } from "../ports/ai-gateway.port.js";
import type { PromptTemplate } from "./prompt-template.js";
import { briefingFieldExtractionPromptV1, type BriefingFieldExtractionPromptContext } from "./prompts/briefing-field-extraction.v1.js";
import {
  applySemanticValidation,
  validateBriefingFieldExtractionStructure,
  BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION,
  BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA,
  type SemanticValidationResult,
  type StructuredValidationResult,
} from "./schemas/briefing-field-extraction-result.v1.js";

/**
 * Registro operação → template + validação — Sprint 08 (Fase 9/11). Único ponto do Gateway que
 * conhece o domínio de Briefing (via `getBriefingSchema`) — o `AiGateway` em si (`ai-gateway.ts`)
 * nunca importa nada de `src/domain/briefing`, só chama estas funções genéricas. Isso é
 * intencional e diferente do isolamento Ícaro/Gateway: o Gateway PRECISA conhecer Briefing para
 * executar sua única operação real desta sprint — o que ele nunca pode conhecer é o Ícaro
 * (`src/application/ai/*`), ver `scripts/check-ai-stack-isolation.mjs`.
 *
 * Hoje só uma entrada existe. Adicionar uma segunda operação executável significa registrar uma
 * nova entrada aqui — nunca um `if/else` dentro de `ai-gateway.ts`.
 */
export type PromptTemplateRegistration = {
  template: PromptTemplate<unknown>;
  buildContext: (sanitizedInput: Readonly<Record<string, unknown>>) => unknown;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  outputSchemaRef: { id: string; version: number };
  validateStructure: (raw: unknown) => StructuredValidationResult<unknown>;
  validateSemantics: (structural: unknown, sanitizedInput: Readonly<Record<string, unknown>>) => SemanticValidationResult;
};

function buildBriefingFieldExtractionContext(input: Readonly<Record<string, unknown>>): BriefingFieldExtractionPromptContext {
  const schemaType = input.schemaType as BriefingType;
  const schema = getBriefingSchema(schemaType);
  if (!schema) {
    throw new Error(`AI_GATEWAY_INTERNAL_ERROR: nenhum schema registrado para "${schemaType}" — o chamador nunca deveria acionar esta operação sem um schema ativo.`);
  }
  return {
    schema,
    message: String(input.message ?? ""),
    knownFieldKeys: Array.isArray(input.knownFieldKeys) ? (input.knownFieldKeys as string[]) : [],
  };
}

export const PROMPT_TEMPLATE_REGISTRY: Partial<Record<AiOperation, PromptTemplateRegistration>> = {
  briefing_field_extraction: {
    template: briefingFieldExtractionPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildBriefingFieldExtractionContext(input),
    toolName: "submit_briefing_field_extraction",
    toolDescription: "Envia os candidatos de campo extraídos da mensagem do usuário, de acordo com o schema informado.",
    toolInputSchema: BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "briefing-field-extraction-result", version: BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateBriefingFieldExtractionStructure(raw),
    validateSemantics: (structural, sanitizedInput) =>
      applySemanticValidation({
        structural: structural as Parameters<typeof applySemanticValidation>[0]["structural"],
        schema: getBriefingSchema(sanitizedInput.schemaType as BriefingType)!,
        sourceText: String(sanitizedInput.message ?? ""),
      }),
  },
};

export function getPromptTemplateRegistration(operation: AiOperation): PromptTemplateRegistration | undefined {
  return PROMPT_TEMPLATE_REGISTRY[operation];
}
