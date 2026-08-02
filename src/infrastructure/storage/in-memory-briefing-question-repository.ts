import type {
  BriefingQuestionRepositoryPort,
  CreateBriefingQuestionInput,
} from "../../application/ports/briefing-question-repository.port.js";
import type { BriefingQuestion } from "../../domain/briefing/briefing.model.js";

export type BriefingQuestionIdGenerator = () => string;
const defaultIdGenerator: BriefingQuestionIdGenerator = () => `briefing-question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryBriefingQuestionRepository implements BriefingQuestionRepositoryPort {
  private readonly questions = new Map<string, BriefingQuestion>();
  private readonly idGenerator: BriefingQuestionIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: BriefingQuestionIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateBriefingQuestionInput): Promise<BriefingQuestion> {
    const question: BriefingQuestion = {
      id: this.idGenerator(),
      briefingId: input.briefingId,
      fieldKeys: input.fieldKeys,
      text: input.text,
      reason: input.reason,
      priority: input.priority,
      answerType: input.answerType,
      options: input.options,
      status: "pending",
      createdAt: this.now().toISOString(),
    };
    this.questions.set(question.id, clone(question));
    return clone(question);
  }

  async getById(id: string): Promise<BriefingQuestion | undefined> {
    const found = this.questions.get(id);
    return found ? clone(found) : undefined;
  }

  async getPendingByBriefing(briefingId: string): Promise<BriefingQuestion | undefined> {
    const found = [...this.questions.values()].find((question) => question.briefingId === briefingId && question.status === "pending");
    return found ? clone(found) : undefined;
  }

  async listByBriefing(briefingId: string): Promise<BriefingQuestion[]> {
    return [...this.questions.values()]
      .filter((question) => question.briefingId === briefingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async markAnswered(id: string): Promise<BriefingQuestion> {
    return this.transition(id, { status: "answered", answeredAt: this.now().toISOString() });
  }

  async markSuperseded(id: string): Promise<BriefingQuestion> {
    return this.transition(id, { status: "superseded", supersededAt: this.now().toISOString() });
  }

  private transition(id: string, patch: Partial<BriefingQuestion>): BriefingQuestion {
    const existing = this.questions.get(id);
    if (!existing) throw new Error(`BRIEFING_QUESTION_NOT_FOUND: pergunta "${id}" não existe.`);
    const updated = { ...existing, ...patch };
    this.questions.set(id, clone(updated));
    return clone(updated);
  }

  clear(): void {
    this.questions.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
