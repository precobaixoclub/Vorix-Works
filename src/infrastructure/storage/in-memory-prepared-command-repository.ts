import type {
  CreatePreparedCommandInput,
  PreparedCommandRepositoryPort,
} from "../../application/ports/prepared-command-repository.port.js";
import type { BriefingType, PreparedCommand } from "../../domain/briefing/briefing.model.js";

export type PreparedCommandIdGenerator = () => string;
const defaultIdGenerator: PreparedCommandIdGenerator = () => `prepared-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryPreparedCommandRepository implements PreparedCommandRepositoryPort {
  private readonly commands = new Map<string, PreparedCommand>();
  private readonly idGenerator: PreparedCommandIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: PreparedCommandIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreatePreparedCommandInput): Promise<PreparedCommand> {
    const existing = await this.getByBriefingRevision(input.briefingId, input.briefingRevision, input.type);
    if (existing) return existing;

    const command: PreparedCommand = {
      id: this.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      briefingId: input.briefingId,
      briefingRevision: input.briefingRevision,
      type: input.type,
      intent: input.intent,
      validatedInputs: input.validatedInputs,
      sourceReferences: input.sourceReferences,
      unresolvedOptionalFields: input.unresolvedOptionalFields,
      status: "prepared",
      createdAt: this.now().toISOString(),
    };
    this.commands.set(command.id, clone(command));
    return clone(command);
  }

  async getById(id: string): Promise<PreparedCommand | undefined> {
    const found = this.commands.get(id);
    return found ? clone(found) : undefined;
  }

  async getByBriefingRevision(briefingId: string, briefingRevision: number, type: BriefingType): Promise<PreparedCommand | undefined> {
    const found = [...this.commands.values()].find(
      (command) => command.briefingId === briefingId && command.briefingRevision === briefingRevision && command.type === type,
    );
    return found ? clone(found) : undefined;
  }

  async markSuperseded(id: string): Promise<PreparedCommand> {
    const existing = this.commands.get(id);
    if (!existing) throw new Error(`PREPARED_COMMAND_NOT_FOUND: comando "${id}" não existe.`);
    const updated: PreparedCommand = { ...existing, status: "superseded", supersededAt: this.now().toISOString() };
    this.commands.set(id, clone(updated));
    return clone(updated);
  }

  clear(): void {
    this.commands.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
