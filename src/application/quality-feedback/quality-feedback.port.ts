import type {
  QualityFeedbackCategory,
  QualityFeedbackInsights,
  QualityFeedbackQuery,
  QualityFeedbackRecord,
  QualityFeedbackReport,
  QualityFeedbackSubmissionInput,
} from "./quality-feedback.types.js";

export type QualityFeedbackRejectionSignals = {
  recurringReasons: QualityFeedbackCategory[];
  comments: string[];
};

/**
 * Porta pública do módulo Quality Feedback. Consumida por interfaces (CLI) para gravar e listar
 * avaliações e gerar o relatório, pelo Eduardo (como dependência opcional, no mesmo padrão do
 * `IcaroBrainPort`) exclusivamente através de `getInsightsForClient`, e pelo pipeline real de
 * Produção (`ContentBriefExecutionTaskHandler`) através de `getRecentRejectionSignalsForWorkspace`,
 * para alimentar a memória editorial com os motivos de rejeição recentes daquele workspace.
 */
export type QualityFeedbackPort = {
  record(input: QualityFeedbackSubmissionInput): Promise<QualityFeedbackRecord>;
  list(query?: QualityFeedbackQuery): Promise<QualityFeedbackRecord[]>;
  getReport(query?: QualityFeedbackQuery): Promise<QualityFeedbackReport>;
  getInsightsForClient(clientId: string, limit?: number): Promise<QualityFeedbackInsights>;
  getRecentRejectionSignalsForWorkspace(clientId: string, limit?: number): Promise<QualityFeedbackRejectionSignals>;
};
