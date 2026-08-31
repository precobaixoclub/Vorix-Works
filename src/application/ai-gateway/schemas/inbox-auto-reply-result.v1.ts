import { z } from "zod";

/**
 * `InboxAutoReplyResultV1` — Fase 5 (Conversas). Operação `inbox_auto_reply`: única saída
 * possível é o texto da resposta a enviar ao contato via WhatsApp. Validação em duas camadas,
 * mesma convenção de `briefing-field-extraction-result.v1.ts`:
 *
 * 1. ESTRUTURAL (`validateInboxAutoReplyStructure`) — Zod `strict()`: forma, tamanho.
 * 2. SEMÂNTICA (`applyInboxAutoReplySemanticValidation`) — rejeita respostas vazias após trim
 *    (o modelo "decidiu não responder" nunca deveria ter chegado à ferramenta, mas isto é a rede
 *    de segurança) e respostas absurdamente longas para uma mensagem de WhatsApp.
 */

export const INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION = 1;

const INBOX_AUTO_REPLY_MAX_CHARS = 2_000;

const inboxAutoReplyResultSchema = z
  .object({
    schemaVersion: z.literal(INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION),
    reply: z.string().min(1).max(INBOX_AUTO_REPLY_MAX_CHARS),
  })
  .strict();

export type InboxAutoReplyResult = z.infer<typeof inboxAutoReplyResultSchema>;

export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

/** JSON Schema espelhando `inboxAutoReplyResultSchema` — usado como `input_schema` da tool
 * forçada da Anthropic (mesmo padrão de espelhamento manual de `briefing-field-extraction-result.v1.ts`). */
export const INBOX_AUTO_REPLY_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "reply"],
  properties: {
    schemaVersion: { const: INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION },
    reply: { type: "string", minLength: 1, maxLength: INBOX_AUTO_REPLY_MAX_CHARS, description: "Texto da resposta a enviar ao contato pelo WhatsApp — sem markdown, sem saudação redundante." },
  },
};

export function validateInboxAutoReplyStructure(raw: unknown): StructuredValidationResult<InboxAutoReplyResult> {
  const result = inboxAutoReplyResultSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  }
  return { valid: true, data: result.data };
}

export type SemanticValidationResult =
  | { valid: true; data: InboxAutoReplyResult; warnings: readonly string[] }
  | { valid: false; errors: readonly string[] };

export function applyInboxAutoReplySemanticValidation(params: { structural: InboxAutoReplyResult }): SemanticValidationResult {
  const trimmed = params.structural.reply.trim();
  if (!trimmed) {
    return { valid: false, errors: ["reply_empty_after_trim"] };
  }
  return { valid: true, data: { ...params.structural, reply: trimmed }, warnings: [] };
}
