import type { VideoBrandFeedbackRepositoryPort } from "../../application/ports/video-brand-feedback-repository.port.js";
import type { VideoBrandFeedback } from "../../domain/video-editing/brand-video-taste.js";

export class InMemoryVideoBrandFeedbackRepository implements VideoBrandFeedbackRepositoryPort {
  private readonly items: VideoBrandFeedback[] = [];
  async record(feedback: VideoBrandFeedback) { this.items.push({ ...feedback }); return feedback; }
  async listByWorkspace(input: { tenantId: string; workspaceId: string; limit?: number }) {
    return this.items.filter((f) => f.tenantId === input.tenantId && f.workspaceId === input.workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, input.limit ?? 200);
  }
  async listByVersion(input: { tenantId: string; workspaceId: string; versionId: string }) {
    return (await this.listByWorkspace(input)).filter((f) => f.versionId === input.versionId);
  }
}
