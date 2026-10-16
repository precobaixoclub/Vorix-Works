import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION } from "../schemas/meeting-follow-up-result.v1.js";

export type MeetingFollowUpPromptContext = {
  title: string;
  language: string;
  recipientName?: string;
  senderName?: string;
  executiveSummary: string;
  decisions: readonly string[];
  nextSteps: readonly string[];
  tasks: readonly { description: string; owner?: string; dueDate?: string }[];
};

/** `meeting-follow-up:v1` — e-mail e mensagem de WhatsApp de follow-up a partir da análise já feita. */
const STATIC_INSTRUCTIONS = `Você escreve o follow-up de uma reunião de trabalho para ser enviado aos participantes.

Regras obrigatórias:
1. Use SOMENTE o resumo, as decisões, as tarefas e os próximos passos fornecidos. Nunca invente compromisso, prazo, preço ou fato.
2. E-mail: assunto curto; corpo cordial e profissional com agradecimento, resumo em poucas linhas, decisões, próximos passos (com responsável e prazo só quando informados) e um fechamento. Sem assinatura inventada: se o nome de quem envia não for informado, termine sem nome.
3. WhatsApp: mensagem curta (até ~700 caracteres), tom próximo e profissional, com os próximos passos em lista curta. Pode usar *negrito* do WhatsApp com moderação. Sem emojis em excesso.
4. Escreva no idioma indicado.
5. Devolva o resultado APENAS pela ferramenta disponibilizada.`;

export const MEETING_FOLLOW_UP_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

export const meetingFollowUpPromptV1: PromptTemplate<MeetingFollowUpPromptContext> = {
  id: "meeting-follow-up",
  version: 1,
  operation: "meeting_follow_up",
  changelog: "v1: e-mail e WhatsApp de follow-up a partir da análise estruturada da reunião.",
  hash: MEETING_FOLLOW_UP_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const list = (items: readonly string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "(nenhum)");
    return [
      `Reunião: ${context.title}`,
      `Idioma: ${context.language}`,
      `Destinatário: ${context.recipientName ?? "(não informado)"}`,
      `Quem envia: ${context.senderName ?? "(não informado)"}`,
      "",
      `Resumo: ${context.executiveSummary}`,
      "",
      `Decisões:\n${list(context.decisions)}`,
      "",
      `Próximos passos:\n${list(context.nextSteps)}`,
      "",
      `Tarefas:\n${list(context.tasks.map((task) => `${task.description}${task.owner ? ` — responsável: ${task.owner}` : ""}${task.dueDate ? ` — prazo: ${task.dueDate}` : ""}`))}`,
    ].join("\n");
  },
};
