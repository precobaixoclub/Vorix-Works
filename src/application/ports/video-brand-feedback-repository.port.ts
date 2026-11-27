import type { VideoBrandFeedback } from "../../domain/video-editing/brand-video-taste.js";

/**
 * Avaliações humanas de vídeo por marca (workspace): aprovação editorial e reprovações com motivo.
 * Adapters: `InMemoryVideoBrandFeedbackRepository` (dev/teste) e `PostgresVideoBrandFeedbackRepository`
 * (`db/migrations/0212_video_brand_feedback.sql`).
 */
export type VideoBrandFeedbackRepositoryPort = {
  record(feedback: VideoBrandFeedback): Promise<VideoBrandFeedback>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; limit?: number }): Promise<VideoBrandFeedback[]>;
  listByVersion(input: { tenantId: string; workspaceId: string; versionId: string }): Promise<VideoBrandFeedback[]>;
};
