import type { QualityFeedbackRepositoryPort } from "../../application/quality-feedback/quality-feedback-repository.port.js";
import type { QualityFeedbackRecord } from "../../application/quality-feedback/quality-feedback.types.js";

export class InMemoryQualityFeedbackRepository implements QualityFeedbackRepositoryPort {
  private readonly records = new Map<string, QualityFeedbackRecord>();

  async save(record: QualityFeedbackRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async list(): Promise<QualityFeedbackRecord[]> {
    return Array.from(this.records.values()).map(clone);
  }

  clear(): void {
    this.records.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
