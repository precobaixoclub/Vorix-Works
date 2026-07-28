export type QualityFeedbackLogAction =
  | "FeedbackValidationFailed"
  | "FeedbackRecorded"
  | "FeedbackListed"
  | "ReportGenerated"
  | "InsightsRequested"
  | "InsightsDelivered";

export type QualityFeedbackLogEntry = {
  id: string;
  occurredAt: string;
  action: QualityFeedbackLogAction;
  message: string;
  executionId?: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
};

export type QualityFeedbackLoggerPort = {
  record(entry: QualityFeedbackLogEntry): Promise<void>;
};
