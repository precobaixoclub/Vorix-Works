import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION } from "../schemas/inbox-auto-reply-result.v1.js";

export type InboxAutoReplyPromptMessage = { direction: "inbound" | "outbound"; body: string; sentByAi: boolean };

export type InboxAutoReplyPromptContext = {
  contactName?: string;
  /** Ordem cronológica ascendente, já recortada pelo chamador (`inbox-use-cases.ts`) — nunca o
   * histórico completo. */
  recentMessages: readonly InboxAutoReplyPromptMessage[];
};

/**
 * `inbox-auto-reply:v1` — Fase 5 (Conversas). Atendimento básico, previsível e seguro: responde
 * SOMENTE com base no que está de fato na conversa; nunca inventa preço/prazo/política que não
 * apareceu no histórico; nunca finge ser humano nem promete uma ação que o sistema não pode
 * cumprir (Fase 5 não integra automações comerciais avançadas — isso é escopo de fase futura).
 */
const STATIC_INSTRUCTIONS = `Você é o atendimento automático de WhatsApp de uma empresa, respondendo diretamente ao cliente.

Regras obrigatórias, sem exceção:
1. Responda SOMENTE com base no que está no histórico da conversa fornecido — nunca invente preço, prazo, política, disponibilidade ou qualquer fato que não apareça ali.
2. Se não souber a resposta com segurança, diga isso com honestidade e ofereça encaminhar para um atendente humano — nunca invente uma resposta plausível.
3. Nunca afirme ser uma pessoa. Se perguntado diretamente, seja honesto sobre ser um atendimento automático.
4. Seja breve e direto — mensagens de WhatsApp, não e-mails. Sem markdown (sem "**negrito**", sem listas com "-").
5. Responda no mesmo idioma que o cliente está usando na conversa.
6. Nunca prometa uma ação que você não pode de fato executar (ex.: "vou processar seu reembolso agora") — só o sistema/um humano pode confirmar isso.
7. Devolva a resposta APENAS através da ferramenta disponibilizada — nunca como texto livre fora dela.`;

export const INBOX_AUTO_REPLY_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

function renderTranscript(messages: readonly InboxAutoReplyPromptMessage[]): string {
  if (messages.length === 0) return "(nenhuma mensagem anterior)";
  return messages
    .map((message) => {
      const speaker = message.direction === "inbound" ? "Cliente" : message.sentByAi ? "Atendimento (IA)" : "Atendimento";
      return `${speaker}: ${message.body}`;
    })
    .join("\n");
}

export const inboxAutoReplyPromptV1: PromptTemplate<InboxAutoReplyPromptContext> = {
  id: "inbox-auto-reply",
  version: 1,
  operation: "inbox_auto_reply",
  changelog: "v1: primeira versão — resposta única de atendimento básico, sem contexto comercial estruturado.",
  hash: INBOX_AUTO_REPLY_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const nameLine = context.contactName ? `Nome do cliente: ${context.contactName}` : "Nome do cliente: desconhecido.";
    return [nameLine, "", "Histórico recente da conversa (mais antiga primeiro):", renderTranscript(context.recentMessages)].join("\n");
  },
};
