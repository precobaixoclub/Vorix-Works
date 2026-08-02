import type {
  AppendBriefingFieldValueInput,
  BriefingFieldValueRepositoryPort,
} from "../../application/ports/briefing-field-value-repository.port.js";
import { selectCurrentFieldValues } from "../../application/briefing/field-state.js";
import type { BriefingFieldValue } from "../../domain/briefing/briefing.model.js";

export type BriefingFieldValueIdGenerator = () => string;
const defaultIdGenerator: BriefingFieldValueIdGenerator = () => `briefing-value-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryBriefingFieldValueRepository implements BriefingFieldValueRepositoryPort {
  private readonly valuesByBriefing = new Map<string, BriefingFieldValue[]>();
  private readonly idGenerator: BriefingFieldValueIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: BriefingFieldValueIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async append(input: AppendBriefingFieldValueInput): Promise<BriefingFieldValue> {
    const list = this.valuesByBriefing.get(input.briefingId) ?? [];
    const maxRevision = Math.max(0, ...list.filter((value) => value.fieldKey === input.fieldKey).map((value) => value.revision));
    const value: BriefingFieldValue = {
      id: this.idGenerator(),
      briefingId: input.briefingId,
      fieldKey: input.fieldKey,
      value: input.value,
      normalizedValue: input.normalizedValue,
      source: input.source,
      confidence: input.confidence,
      questionId: input.questionId,
      conversationEventId: input.conversationEventId,
      assetId: input.assetId,
      confirmedByUser: input.confirmedByUser,
      revision: maxRevision + 1,
      supersedesValueId: input.supersedesValueId,
      ambiguityStatus: input.ambiguityStatus,
      createdAt: this.now().toISOString(),
      aiExecutionId: input.aiExecutionId,
      rationaleCode: input.rationaleCode,
      evidence: input.evidence,
    };
    list.push(clone(value));
    this.valuesByBriefing.set(input.briefingId, list);
    return clone(value);
  }

  async listCurrentByBriefing(briefingId: string): Promise<BriefingFieldValue[]> {
    const all = this.valuesByBriefing.get(briefingId) ?? [];
    return [...selectCurrentFieldValues(all).values()].map(clone);
  }

  async listAllByBriefing(briefingId: string): Promise<BriefingFieldValue[]> {
    return (this.valuesByBriefing.get(briefingId) ?? []).map(clone);
  }

  clear(): void {
    this.valuesByBriefing.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
