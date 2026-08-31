import { getBriefingSchema } from "../../domain/briefing/schema-registry.js";
import type { BriefingType } from "../../domain/briefing/briefing.model.js";
import type { AiOperation } from "../ports/ai-gateway.port.js";
import type { PromptTemplate } from "./prompt-template.js";
import { briefingFieldExtractionPromptV1, type BriefingFieldExtractionPromptContext } from "./prompts/briefing-field-extraction.v1.js";
import { inboxAutoReplyPromptV1, type InboxAutoReplyPromptContext, type InboxAutoReplyPromptMessage } from "./prompts/inbox-auto-reply.v1.js";
import {
  applySemanticValidation,
  validateBriefingFieldExtractionStructure,
  BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION,
  BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA,
  type StructuredValidationResult,
} from "./schemas/briefing-field-extraction-result.v1.js";
import {
  applyInboxAutoReplySemanticValidation,
  validateInboxAutoReplyStructure,
  INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION,
  INBOX_AUTO_REPLY_TOOL_INPUT_SCHEMA,
} from "./schemas/inbox-auto-reply-result.v1.js";

/**
 * Registro operação → template + validação — Sprint 08 (Fase 9/11). Único ponto do Gateway que
 * conhece o domínio de Briefing (via `getBriefingSchema`) — o `AiGateway` em si (`ai-gateway.ts`)
 * nunca importa nada de `src/domain/briefing`, só chama estas funções genéricas. Isso é
 * intencional e diferente do isolamento Ícaro/Gateway: o Gateway PRECISA conhecer Briefing para
 * executar sua única operação real desta sprint — o que ele nunca pode conhecer é o Ícaro
 * (`src/application/ai/*`), ver `scripts/check-ai-stack-isolation.mjs`.
 *
 * Cada operação registrada tem seu próprio formato de resultado (`BriefingFieldExtractionResult`,
 * `InboxAutoReplyResult`...) — por isso `validateSemantics` devolve este tipo genérico
 * (`data: unknown`) em vez do tipo específico de uma única operação; cada `validateSemantics`
 * concreto abaixo ainda é fortemente tipado internamente, só a assinatura comum é solta.
 */
export type PromptTemplateSemanticValidationResult = { valid: true; data: unknown; warnings: readonly string[] } | { valid: false; errors: readonly string[] };

export type PromptTemplateRegistration = {
  template: PromptTemplate<unknown>;
  buildContext: (sanitizedInput: Readonly<Record<string, unknown>>) => unknown;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  outputSchemaRef: { id: string; version: number };
  validateStructure: (raw: unknown) => StructuredValidationResult<unknown>;
  validateSemantics: (structural: unknown, sanitizedInput: Readonly<Record<string, unknown>>) => PromptTemplateSemanticValidationResult;
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

function buildInboxAutoReplyContext(input: Readonly<Record<string, unknown>>): InboxAutoReplyPromptContext {
  const rawMessages = Array.isArray(input.recentMessages) ? (input.recentMessages as unknown[]) : [];
  const recentMessages: InboxAutoReplyPromptMessage[] = rawMessages
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      direction: entry.direction === "outbound" ? "outbound" : "inbound",
      body: typeof entry.body === "string" ? entry.body : "",
      sentByAi: entry.sentByAi === true,
    }));
  return {
    contactName: typeof input.contactName === "string" ? input.contactName : undefined,
    recentMessages,
  };
}

export const PROMPT_TEMPLATE_REGISTRY: Partial<Record<AiOperation, PromptTemplateRegistration>> = {
  inbox_auto_reply: {
    template: inboxAutoReplyPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildInboxAutoReplyContext(input),
    toolName: "submit_inbox_auto_reply",
    toolDescription: "Envia o texto da resposta a ser enviada ao cliente pelo WhatsApp.",
    toolInputSchema: INBOX_AUTO_REPLY_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "inbox-auto-reply-result", version: INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateInboxAutoReplyStructure(raw),
    validateSemantics: (structural, _sanitizedInput) => applyInboxAutoReplySemanticValidation({ structural: structural as Parameters<typeof applyInboxAutoReplySemanticValidation>[0]["structural"] }),
  },
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
