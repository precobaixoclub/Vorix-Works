import type {
  AppendConversationEventInput,
  ConversationEventRepositoryPort,
} from "../../application/ports/conversation-event-repository.port.js";
import type { ConversationEvent } from "../../domain/conversation/conversation.model.js";

export type ConversationEventIdGenerator = () => string;
const defaultIdGenerator: ConversationEventIdGenerator = () => `conv-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryConversationEventRepository implements ConversationEventRepositoryPort {
  private readonly eventsByConversation = new Map<string, ConversationEvent[]>();
  private readonly idGenerator: ConversationEventIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: ConversationEventIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async append(input: AppendConversationEventInput): Promise<ConversationEvent> {
    const event: ConversationEvent = {
      id: this.idGenerator(),
      conversationId: input.conversationId,
      type: input.type,
      payload: input.payload,
      createdAt: this.now().toISOString(),
    };
    const events = this.eventsByConversation.get(input.conversationId) ?? [];
    events.push(clone(event));
    this.eventsByConversation.set(input.conversationId, events);
    return clone(event);
  }

  async listByConversation(conversationId: string): Promise<ConversationEvent[]> {
    return (this.eventsByConversation.get(conversationId) ?? []).map(clone);
  }

  clear(): void {
    this.eventsByConversation.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
