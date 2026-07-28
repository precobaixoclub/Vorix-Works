/**
 * Chat — Sprint 02 (Fase 5), fundação de domínio. Nenhuma IA aqui: só a arquitetura (sessão,
 * mensagem, anexo, "pergunta inteligente" como formato de dado). O Chat vive dentro de um
 * Workspace (Fase 3) — é o ponto de entrada de praticamente toda ação futura do usuário, mas
 * nesta sprint é só um modelo de conversa persistível, sem nenhum motor por trás decidindo o que
 * responder.
 *
 * `SmartQuestion` é o formato que uma "pergunta inteligente" teria quando a IA não tiver contexto
 * suficiente — ligado diretamente a um gap real já diagnosticado na Sprint 01: `needs_more_context`
 * é um status genuíno que várias Skills já emitem (`SkillResponse.status`), mas
 * `caio.executor.ts` não tem um branch dedicado para ele — cai direto em falha dura, não
 * retomável. Ter o tipo `SmartQuestion` pronto aqui NÃO resolve esse gap; só garante que o Chat já
 * nasce com o lugar certo para receber a pergunta no dia em que o gap for corrigido (fora do
 * escopo desta sprint — Workflows não podem ser alterados aqui).
 */

export const CHAT_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CHAT_ATTACHMENT_KINDS = ["image", "video", "document", "audio"] as const;
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

/** Mesmo padrão de `AssetStorageRef` (Fase 4) — preparado, nunca preenchido nesta sprint (sem upload real). */
export type ChatAttachmentStorageRef = {
  provider: string;
  uri: string;
};

export type ChatAttachment = {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  storageRef?: ChatAttachmentStorageRef;
};

export const CHAT_SESSION_STATUSES = ["active", "archived"] as const;
export type ChatSessionStatus = (typeof CHAT_SESSION_STATUSES)[number];

export type ChatSession = {
  id: string;
  /** Todo Chat vive dentro de um Workspace — nunca solto. */
  workspaceId: string;
  status: ChatSessionStatus;
  createdAt: string;
  updatedAt: string;
  title?: string;
  /**
   * Contexto persistente entre mensagens — nesta sprint é só um resumo textual opcional, nunca
   * gerado automaticamente. O "context engine" de verdade (provavelmente lendo Creative DNA/
   * conhecimento da Clara) é trabalho de sprint futura.
   */
  contextSummary?: string;
};

/** Ver comentário do arquivo — formato de "pergunta inteligente", sem nenhuma lógica de quando/como perguntar. */
export type SmartQuestion = {
  question: string;
  reason: string;
  /** De onde essa pergunta nasceu (ex.: qual step do workflow emitiu `needs_more_context`) — nunca resolvido nesta sprint. */
  sourceStepId?: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  attachments: ChatAttachment[];
  /** Presente só em mensagens do tipo "a IA está perguntando algo por falta de contexto". */
  smartQuestion?: SmartQuestion;
  createdAt: string;
};
