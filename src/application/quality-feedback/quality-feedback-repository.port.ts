import type { QualityFeedbackRecord } from "./quality-feedback.types.js";

export type QualityFeedbackRepositoryPort = {
  save(record: QualityFeedbackRecord): Promise<void>;
  list(): Promise<QualityFeedbackRecord[]>;
};
