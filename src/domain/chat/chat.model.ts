/**
 * @deprecated Chat — Sprint 02 (Fase 5), fundação de domínio, NUNCA ligada a um endpoint real
 * (confirmado na Sprint 04). Substituída pelo domínio `Conversation` (Sprint 06,
 * `src/domain/conversation/conversation.model.ts`), que por sua vez ganhou coleta estruturada de
 * contexto na Sprint 07 (`src/domain/briefing/briefing.model.ts`). Este módulo continua existindo
 * só para não descartar dado histórico já persistido em `chat_*` — NENHUM consumidor novo deve
 * importar daqui (ver `scripts/check-legacy-chat-imports.mjs`, que falha o build se isso acontecer
 * fora da allowlist). Remoção depende de: (1) confirmar que não há dado de produção real em
 * `chat_sessions`/`chat_messages`, (2) um plano de migração explícito — nenhum dos dois foi feito
 * ainda.
 *
 * Nenhuma IA aqui: só a arquitetura (sessão, mensagem, anexo, "pergunta inteligente" como formato
 * de dado). `SmartQuestion` é o formato que uma "pergunta inteligente" teria quando a IA não
 * tivesse contexto suficiente — ligado ao gap real diagnosticado na Sprint 01
 * (`needs_more_context` sem branch dedicado em `caio.executor.ts`); a Sprint 07 resolveu esse gap
 * de verdade, mas pelo lado do `Conversation`/`Briefing`, não deste módulo.
 */

export const CHAT_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CHAT_ATTACHMENT_KINDS = ["image", "video", "document", "audio"] as const;
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

/**
 * Mesmo padrão de `AssetStorageRef` (Fase 4) — preparado, nunca preenchido nesta sprint (sem
 * upload real). Mesma regra de segurança (Sprint 03, correção obrigatória #4): apenas referência
 * durável (provedor/bucket/caminho), nunca token, credencial ou URL assinada temporária.
 */
export type ChatAttachmentStorageRef = {
  provider: string;
  bucket?: string;
  objectKey: string;
  metadata?: Record<string, string>;
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
