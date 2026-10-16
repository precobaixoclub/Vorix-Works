import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION } from "../schemas/meeting-ai-analysis-result.v1.js";

export type MeetingAiAnalysisSegment = { startMs: number; speaker?: string; text: string };

export type MeetingAiAnalysisPromptContext = {
  title: string;
  language: string;
  segments: readonly MeetingAiAnalysisSegment[];
  /** Modelo de resumo escolhido (vendas, 1:1…): seções extras em `templateSections`. */
  template?: { label: string; sections: readonly { title: string; instruction: string }[] };
};

/**
 * `meeting-ai-analysis:v1` — Vorix Meetings. Analisa UMA reunião estritamente a partir da
 * transcrição: nada de decisão, responsável ou prazo que não tenha sido dito.
 */
const STATIC_INSTRUCTIONS = `Você analisa a transcrição de uma reunião de trabalho e devolve um registro estruturado dela.

Regras obrigatórias, sem exceção:
1. Use SOMENTE o que está na transcrição. Nunca invente decisão, tarefa, responsável, prazo, número ou fato.
2. Decisões, tarefas e próximos passos: cada item precisa de "evidence", um trecho LITERAL copiado da transcrição (sem o marcador de tempo), e de "sourceTimestampMs", o tempo em milissegundos indicado no início da linha de onde ele veio.
3. "assigneeName" e "dueDate" só quando a pessoa e o prazo foram ditos explicitamente; caso contrário, null.
4. Se algo não foi decidido, não registre como decisão — no máximo como pergunta em aberto.
5. Se a transcrição não tiver conteúdo para uma seção, devolva a lista vazia. Listas vazias são corretas.
6. "confidence" entre 0 e 1 reflete o quão claramente o item foi dito.
7. Escreva no idioma da transcrição.
8. "templateSections": preencha UMA entrada por seção pedida no modelo de resumo (mesmo título), com o que foi dito. Se nada foi dito sobre a seção, escreva exatamente "Não mencionado na reunião.". Sem modelo pedido, devolva a lista vazia.
9. Devolva o resultado APENAS pela ferramenta disponibilizada.`;

export const MEETING_AI_ANALYSIS_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

export const meetingAiAnalysisPromptV1: PromptTemplate<MeetingAiAnalysisPromptContext> = {
  id: "meeting-ai-analysis",
  version: 1,
  operation: "meeting_ai_analysis",
  changelog: "v1: análise estruturada da reunião com evidência literal e timestamp por item.",
  hash: MEETING_AI_ANALYSIS_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const lines = [`Reunião: ${context.title}`, `Idioma: ${context.language}`];
    if (context.template?.sections.length) {
      lines.push("", `Modelo de resumo: ${context.template.label}. Seções a preencher em "templateSections":`);
      for (const section of context.template.sections) lines.push(`- ${section.title}: ${section.instruction}`);
    }
    lines.push("", "Transcrição (cada linha: [ms] falante: texto):");
    for (const segment of context.segments) lines.push(`[${segment.startMs}] ${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`);
    return lines.join("\n");
  },
};

/** Só o texto dito (sem marcadores) — base da checagem de evidência literal. */
export function meetingTranscriptPlainText(segments: readonly MeetingAiAnalysisSegment[]): string {
  return segments.map((segment) => segment.text).join(" ");
}
