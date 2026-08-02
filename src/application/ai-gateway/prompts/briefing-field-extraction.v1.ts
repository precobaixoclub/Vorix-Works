import { createHash } from "node:crypto";
import type { BriefingSchema } from "../../../domain/briefing/briefing.model.js";
import type { PromptTemplate } from "../prompt-template.js";
import { BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION } from "../schemas/briefing-field-extraction-result.v1.js";

export type BriefingFieldExtractionPromptContext = {
  schema: BriefingSchema;
  message: string;
  /** fieldKey -> valor já conhecido (normalizado) — só para o modelo evitar repetir o óbvio, nunca usado para decidir nada aqui. */
  knownFieldKeys: readonly string[];
};

/**
 * `briefing-field-extraction:v1` — Sprint 08 (Fase 9). Só usa os campos do schema ATIVO (nunca um
 * catálogo fixo hardcoded) — `acceptedValues`/`dependsOn` vêm sempre de `context.schema`, nunca
 * inventados aqui. Instruções obrigatórias (Fase 9): proibir invenção; exigir preservação do texto
 * original; marcar ambiguidade; marcar baixa confiança; nunca definir prontidão; nunca criar
 * PreparedCommand; nunca responder ao usuário — a IA só propõe candidatos, o sistema decide tudo o
 * resto (Readiness Evaluator, Question Planner, confirmationPolicy, Sprint 07).
 */
const STATIC_INSTRUCTIONS = `Você é um extrator de fatos estruturados para um briefing de campanha de marketing.

Sua ÚNICA tarefa é identificar, na mensagem do usuário, valores para os campos do schema fornecido, e devolver isso através da ferramenta disponibilizada — nunca como texto livre.

Regras obrigatórias, sem exceção:
1. NUNCA invente um valor que não esteja, de alguma forma, apoiado no texto do usuário. Se não houver base clara, não proponha o campo.
2. "evidence" deve ser um trecho LITERAL e curto do texto do usuário — nunca uma paráfrase, nunca uma frase que você mesmo escreveu.
3. Preserve o texto original em "originalText" exatamente como o usuário escreveu.
4. Se o texto sugerir dois valores incompatíveis para o mesmo campo, NÃO escolha um sozinho — registre isso em "ambiguities" e não crie um candidato para esse campo.
5. Se sua confiança para um candidato for baixa, ainda assim proponha o candidato, mas marque "rationaleCode" como "low_confidence_guess" e "confidence" baixo (nunca omita por baixa confiança — deixe o sistema decidir o que fazer com isso).
6. Se perceber uma afirmação que parece relevante mas não corresponde a nenhum campo do schema, registre-a em "unsupportedClaims" — não a force em nenhum campo.
7. Você NUNCA decide se o briefing está pronto, NUNCA cria nenhum tipo de comando, e NUNCA responde diretamente ao usuário — isso é sempre responsabilidade de outro componente do sistema.
8. Só use os "fieldKey" listados abaixo. Para campos do tipo enum, "normalizedValue" deve ser exatamente um dos valores aceitos listados.`;

export const BRIEFING_FIELD_EXTRACTION_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

function buildFieldCatalog(schema: BriefingSchema): string {
  return schema.fields
    .map((field) => {
      const parts = [`- ${field.key} (${field.dataType}): ${field.label} — ${field.description}`];
      if (field.acceptedValues) parts.push(`  valores aceitos: ${field.acceptedValues.join(", ")}`);
      if (field.dependsOn && field.dependsOn.length > 0) parts.push(`  depende de: ${field.dependsOn.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n");
}

export const briefingFieldExtractionPromptV1: PromptTemplate<BriefingFieldExtractionPromptContext> = {
  id: "briefing-field-extraction",
  version: 1,
  operation: "briefing_field_extraction",
  changelog: "v1: primeira versão — extração de candidatos estruturados a partir da mensagem atual, sem contexto de conversa além do texto informado.",
  hash: BRIEFING_FIELD_EXTRACTION_PROMPT_HASH,

  buildSystemInstructions(context) {
    return [
      STATIC_INSTRUCTIONS,
      "",
      `Campos do schema "${context.schema.type}" (versão ${context.schema.version}):`,
      buildFieldCatalog(context.schema),
      "",
      `A saída deve ter "schemaVersion": ${BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION}.`,
    ].join("\n");
  },

  buildUserInput(context) {
    const knownLine = context.knownFieldKeys.length > 0 ? `Campos já conhecidos (não precisam ser repetidos, mas podem ser corrigidos se o texto contradisser): ${context.knownFieldKeys.join(", ")}` : "Nenhum campo conhecido ainda.";
    return [`Mensagem do usuário:\n"""\n${context.message}\n"""`, "", knownLine].join("\n");
  },
};
