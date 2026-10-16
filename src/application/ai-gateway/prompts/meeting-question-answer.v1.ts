import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION } from "../schemas/meeting-question-answer-result.v1.js";

export type MeetingQuestionAnswerSource = {
  meetingId: string;
  title: string;
  date?: string;
  segments: readonly { startMs: number; speaker?: string; text: string }[];
};

export type MeetingQuestionAnswerPromptContext = {
  question: string;
  language: string;
  sources: readonly MeetingQuestionAnswerSource[];
};

/**
 * `meeting-question-answer:v1` — "Pergunte à reunião". Responde uma pergunta usando SÓ os trechos
 * de transcrição enviados (de uma reunião ou de várias), sempre citando de onde tirou.
 */
const STATIC_INSTRUCTIONS = `Você responde perguntas sobre reuniões de trabalho usando SOMENTE as transcrições fornecidas.

Regras obrigatórias:
1. Nunca invente fatos, números, nomes, datas ou compromissos. Se a resposta não estiver nas transcrições, diga claramente que isso não foi falado e use "found": false.
2. Cada afirmação importante precisa de uma citação em "citations": o "meetingId" da reunião, o "sourceTimestampMs" (o número entre colchetes no início da linha) e "evidence", um trecho LITERAL copiado da linha (sem o marcador de tempo e sem o nome do falante).
3. Seja direto e objetivo: responda primeiro, detalhe depois. Use listas curtas quando ajudar.
4. Quando houver várias reuniões, diga de qual reunião vem cada informação.
5. Escreva no idioma da pergunta.
6. Devolva o resultado APENAS pela ferramenta disponibilizada.`;

export const MEETING_QUESTION_ANSWER_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

export const meetingQuestionAnswerPromptV1: PromptTemplate<MeetingQuestionAnswerPromptContext> = {
  id: "meeting-question-answer",
  version: 1,
  operation: "meeting_question_answer",
  changelog: "v1: resposta a perguntas sobre uma ou várias reuniões, com citação literal e timestamp.",
  hash: MEETING_QUESTION_ANSWER_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const lines = [`Pergunta: ${context.question}`, `Idioma: ${context.language}`, ""];
    for (const source of context.sources) {
      lines.push(`=== Reunião ${source.meetingId}: ${source.title}${source.date ? ` (${source.date})` : ""} ===`);
      for (const segment of source.segments) lines.push(`[${segment.startMs}] ${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`);
      lines.push("");
    }
    return lines.join("\n");
  },
};
