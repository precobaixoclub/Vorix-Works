import type { AppendChatMessageInput, ChatRepositoryPort, CreateChatSessionInput } from "../../application/ports/chat-repository.port.js";
import type { ChatMessage, ChatSession } from "../../domain/chat/chat.model.js";

export type ChatIdGenerator = (prefix: string) => string;

const defaultIdGenerator: ChatIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** @deprecated Ver `chat.model.ts` — nenhum consumidor novo. */
export class InMemoryChatRepository implements ChatRepositoryPort {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly messagesBySession = new Map<string, ChatMessage[]>();
  private readonly idGenerator: ChatIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: ChatIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async createSession(input: CreateChatSessionInput): Promise<ChatSession> {
    const timestamp = this.now().toISOString();
    const session: ChatSession = {
      id: this.idGenerator("chat-session"),
      workspaceId: input.workspaceId,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      title: input.title,
    };
    this.sessions.set(session.id, clone(session));
    this.messagesBySession.set(session.id, []);
    return clone(session);
  }

  async getSession(id: string): Promise<ChatSession | undefined> {
    return clone(this.sessions.get(id));
  }

  async listSessionsByWorkspace(workspaceId: string): Promise<ChatSession[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === workspaceId)
      .map(clone);
  }

  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessage> {
    if (!this.sessions.has(input.sessionId)) {
      throw new Error(`CHAT_SESSION_NOT_FOUND: sessão "${input.sessionId}" não existe.`);
    }
    const message: ChatMessage = {
      id: this.idGenerator("chat-message"),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      attachments: input.attachments ?? [],
      smartQuestion: input.smartQuestion,
      createdAt: this.now().toISOString(),
    };
    const messages = this.messagesBySession.get(input.sessionId) ?? [];
    messages.push(clone(message));
    this.messagesBySession.set(input.sessionId, messages);

    const session = this.sessions.get(input.sessionId);
    if (session) {
      this.sessions.set(input.sessionId, { ...session, updatedAt: message.createdAt });
    }

    return clone(message);
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return (this.messagesBySession.get(sessionId) ?? []).map(clone);
  }

  clear(): void {
    this.sessions.clear();
    this.messagesBySession.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
