import type {
  QualityFeedbackInsights,
  QualityFeedbackQuery,
  QualityFeedbackRecord,
  QualityFeedbackReport,
  QualityFeedbackSubmissionInput,
} from "./quality-feedback.types.js";

/**
 * Porta pública do módulo Quality Feedback. Consumida por interfaces (CLI) para gravar e listar
 * avaliações e gerar o relatório, e pelo Eduardo (como dependência opcional, no mesmo padrão do
 * `IcaroBrainPort`) exclusivamente através de `getInsightsForClient`.
 */
export type QualityFeedbackPort = {
  record(input: QualityFeedbackSubmissionInput): Promise<QualityFeedbackRecord>;
  list(query?: QualityFeedbackQuery): Promise<QualityFeedbackRecord[]>;
  getReport(query?: QualityFeedbackQuery): Promise<QualityFeedbackReport>;
  getInsightsForClient(clientId: string, limit?: number): Promise<QualityFeedbackInsights>;
};
