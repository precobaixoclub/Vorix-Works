import type { Pool } from "pg";
import type { AppendChatMessageInput, ChatRepositoryPort, CreateChatSessionInput } from "../../../application/ports/chat-repository.port.js";
import type { ChatAttachment, ChatAttachmentStorageRef, ChatMessage, ChatSession, SmartQuestion } from "../../../domain/chat/chat.model.js";

export type ChatIdGenerator = (prefix: string) => string;

const defaultIdGenerator: ChatIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type SessionRow = {
  id: string;
  workspace_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  title: string | null;
  context_summary: string | null;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  smart_question: SmartQuestion | null;
  created_at: Date;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  kind: string;
  name: string;
  storage_ref: ChatAttachmentStorageRef | null;
};

/**
 * Adapter Postgres de `ChatRepositoryPort` — Sprint 03 (Fase 4). `appendMessage` roda em uma
 * única transação (mensagem + anexos + `updated_at` da sessão) — ou tudo é gravado, ou nada é.
 * `listMessages` reconstrói mensagens + anexos sem N+1 (1 query para as mensagens, 1 query para
 * todos os anexos delas via `= any($1::text[])`). Nenhuma IA/LLM aqui — só persistência da
 * estrutura já definida na Sprint 02.
 */
export class PostgresChatRepository implements ChatRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: ChatIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: ChatIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async createSession(input: CreateChatSessionInput): Promise<ChatSession> {
    const id = this.idGenerator("chat-session");
    const result = await this.pool.query<SessionRow>(
      `insert into chat_sessions (id, workspace_id, status, created_at, updated_at, title)
       values ($1, $2, 'active', now(), now(), $3)
       returning *`,
      [id, input.workspaceId, input.title ?? null],
    );
    return this.toSessionDomain(result.rows[0]);
  }

  async getSession(id: string): Promise<ChatSession | undefined> {
    const result = await this.pool.query<SessionRow>("select * from chat_sessions where id = $1", [id]);
    return result.rows[0] ? this.toSessionDomain(result.rows[0]) : undefined;
  }

  async listSessionsByWorkspace(workspaceId: string): Promise<ChatSession[]> {
    const result = await this.pool.query<SessionRow>("select * from chat_sessions where workspace_id = $1 order by created_at asc", [
      workspaceId,
    ]);
    return result.rows.map((row) => this.toSessionDomain(row));
  }

  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessage> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const sessionCheck = await client.query("select id from chat_sessions where id = $1", [input.sessionId]);
      if (sessionCheck.rows.length === 0) {
        throw new Error(`CHAT_SESSION_NOT_FOUND: sessão "${input.sessionId}" não existe.`);
      }

      const messageId = this.idGenerator("chat-message");
      const messageResult = await client.query<MessageRow>(
        `insert into chat_messages (id, session_id, role, content, smart_question, created_at)
         values ($1, $2, $3, $4, $5, now())
         returning *`,
        [messageId, input.sessionId, input.role, input.content, input.smartQuestion ? JSON.stringify(input.smartQuestion) : null],
      );

      const attachments: ChatAttachment[] = [];
      for (const attachment of input.attachments ?? []) {
        const attachmentResult = await client.query<AttachmentRow>(
          `insert into chat_message_attachments (id, message_id, kind, name, storage_ref)
           values ($1, $2, $3, $4, $5)
           returning *`,
          [attachment.id, messageId, attachment.kind, attachment.name, attachment.storageRef ? JSON.stringify(attachment.storageRef) : null],
        );
        attachments.push(this.toAttachmentDomain(attachmentResult.rows[0]));
      }

      await client.query("update chat_sessions set updated_at = now() where id = $1", [input.sessionId]);

      await client.query("commit");
      return this.toMessageDomain(messageResult.rows[0], attachments);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const messagesResult = await this.pool.query<MessageRow>(
      "select * from chat_messages where session_id = $1 order by created_at asc, id asc",
      [sessionId],
    );
    const messageIds = messagesResult.rows.map((row) => row.id);
    const attachmentsByMessage = await this.fetchAttachments(messageIds);
    return messagesResult.rows.map((row) => this.toMessageDomain(row, attachmentsByMessage.get(row.id) ?? []));
  }

  private async fetchAttachments(messageIds: string[]): Promise<Map<string, ChatAttachment[]>> {
    const byMessage = new Map<string, ChatAttachment[]>();
    if (messageIds.length === 0) return byMessage;

    const result = await this.pool.query<AttachmentRow>("select * from chat_message_attachments where message_id = any($1::text[])", [
      messageIds,
    ]);
    for (const row of result.rows) {
      const list = byMessage.get(row.message_id) ?? [];
      list.push(this.toAttachmentDomain(row));
      byMessage.set(row.message_id, list);
    }
    return byMessage;
  }

  private toSessionDomain(row: SessionRow): ChatSession {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      status: row.status as ChatSession["status"],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      title: row.title ?? undefined,
      contextSummary: row.context_summary ?? undefined,
    };
  }

  private toMessageDomain(row: MessageRow, attachments: ChatAttachment[]): ChatMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as ChatMessage["role"],
      content: row.content,
      attachments,
      smartQuestion: row.smart_question ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toAttachmentDomain(row: AttachmentRow): ChatAttachment {
    return {
      id: row.id,
      kind: row.kind as ChatAttachment["kind"],
      name: row.name,
      storageRef: row.storage_ref ?? undefined,
    };
  }
}
