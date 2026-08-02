import type { ConversationRepositoryPort, CreateConversationInput } from "../../application/ports/conversation-repository.port.js";
import type { Conversation, ConversationState } from "../../domain/conversation/conversation.model.js";

export type ConversationIdGenerator = () => string;
const defaultIdGenerator: ConversationIdGenerator = () => `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryConversationRepository implements ConversationRepositoryPort {
  private readonly conversations = new Map<string, Conversation>();
  private readonly idGenerator: ConversationIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: ConversationIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const timestamp = this.now().toISOString();
    const conversation: Conversation = {
      id: this.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      status: "active",
      state: "idle",
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.conversations.set(conversation.id, clone(conversation));
    return clone(conversation);
  }

  async getById(id: string): Promise<Conversation | undefined> {
    return clone(this.conversations.get(id));
  }

  async listByWorkspace(tenantId: string, workspaceId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values())
      .filter((conversation) => conversation.tenantId === tenantId && conversation.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async updateState(id: string, state: ConversationState): Promise<Conversation> {
    const existing = this.conversations.get(id);
    if (!existing) throw new Error(`CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated: Conversation = { ...existing, state, updatedAt: this.now().toISOString() };
    this.conversations.set(id, clone(updated));
    return clone(updated);
  }

  clear(): void {
    this.conversations.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
