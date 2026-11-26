import type { VideoProject, VideoProjectRepositoryPort, VideoProjectScope, VideoVersion, VideoVersionPatch } from "../../application/ports/video-project-repository.port.js";
import { ACTIVE_VIDEO_STATUSES } from "../../application/ports/video-project-repository.port.js";
import type { Transcript } from "../../application/video-editing/transcript-tools.js";

/** Implementação em memória (dev sem banco e testes). Mesma semântica de fila/lease do Postgres. */
export class InMemoryVideoProjectRepository implements VideoProjectRepositoryPort {
  private readonly projects = new Map<string, VideoProject>();
  private readonly versions = new Map<string, VideoVersion & { lockedBy?: string; lockedUntil?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private inScope(scope: VideoProjectScope, item: { tenantId: string; workspaceId: string }) {
    return item.tenantId === scope.tenantId && item.workspaceId === scope.workspaceId;
  }
  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  async createProject(project: VideoProject, firstVersion: VideoVersion) {
    this.projects.set(project.id, this.clone(project));
    this.versions.set(firstVersion.id, this.clone(firstVersion));
  }
  async getProject(scope: VideoProjectScope, projectId: string) {
    const project = this.projects.get(projectId);
    return project && this.inScope(scope, project) ? this.clone(project) : undefined;
  }
  async listProjects(scope: VideoProjectScope, limit: number) {
    return [...this.projects.values()].filter((project) => this.inScope(scope, project)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((p) => this.clone(p));
  }
  async saveTranscripts(projectId: string, transcripts: Record<string, Transcript>) {
    const project = this.projects.get(projectId);
    if (project) project.transcripts = this.clone(transcripts);
  }
  async addVersion(version: Omit<VideoVersion, "number">) {
    const number = Math.max(0, ...[...this.versions.values()].filter((v) => v.projectId === version.projectId).map((v) => v.number)) + 1;
    const created: VideoVersion = { ...this.clone(version), number };
    this.versions.set(created.id, created);
    return this.clone(created);
  }
  async getVersion(scope: VideoProjectScope, versionId: string) {
    const version = this.versions.get(versionId);
    return version && this.inScope(scope, version) ? this.strip(version) : undefined;
  }
  async listVersions(scope: VideoProjectScope, projectId: string) {
    return [...this.versions.values()].filter((v) => v.projectId === projectId && this.inScope(scope, v)).sort((a, b) => b.number - a.number).map((v) => this.strip(v));
  }
  async latestStrategies(scope: VideoProjectScope, limit: number) {
    return [...this.versions.values()].filter((v) => this.inScope(scope, v) && v.plan?.strategy).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((v) => v.plan!.strategy);
  }
  async countActive(scope: VideoProjectScope) {
    return [...this.versions.values()].filter((v) => this.inScope(scope, v) && ACTIVE_VIDEO_STATUSES.includes(v.status)).length;
  }
  async countCreatedSince(scope: VideoProjectScope, since: Date) {
    return [...this.versions.values()].filter((v) => this.inScope(scope, v) && v.createdAt >= since.toISOString()).length;
  }
  async requestCancel(scope: VideoProjectScope, versionId: string) {
    const version = this.versions.get(versionId);
    if (!version || !this.inScope(scope, version)) return undefined;
    if (version.status === "queued") Object.assign(version, { status: "cancelled", message: "Cancelado antes de começar." });
    else if (ACTIVE_VIDEO_STATUSES.includes(version.status)) version.cancelRequested = true;
    return this.strip(version);
  }
  async approve(scope: VideoProjectScope, versionId: string, userId: string, at: Date) {
    const version = this.versions.get(versionId);
    if (!version || !this.inScope(scope, version) || version.status !== "ready_for_review") return undefined;
    Object.assign(version, { status: "approved", approvedBy: userId, approvedAt: at.toISOString(), updatedAt: at.toISOString() });
    return this.strip(version);
  }
  async claimNext(input: { workerId: string; leaseMs: number }) {
    const now = this.now();
    const busy = [...this.versions.values()].some((v) => ["planning", "rendering", "verifying"].includes(v.status) && (v.lockedUntil ?? 0) >= now);
    if (busy) return undefined;
    const candidates = [...this.versions.values()]
      .filter((v) => v.status === "queued" || (["planning", "rendering", "verifying"].includes(v.status) && (v.lockedUntil ?? 0) < now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const version of candidates) {
      version.attempts += 1;
      if (version.attempts > version.maxAttempts) {
        Object.assign(version, { status: "failed", error: version.error ?? "tentativas esgotadas (worker interrompido)", lockedBy: undefined, lockedUntil: undefined });
        continue;
      }
      Object.assign(version, { status: "planning", lockedBy: input.workerId, lockedUntil: now + input.leaseMs, updatedAt: new Date(now).toISOString() });
      const project = this.projects.get(version.projectId)!;
      return { version: this.strip(version), project: this.clone(project) };
    }
    return undefined;
  }
  async heartbeat(input: { versionId: string; workerId: string; leaseMs: number }) {
    const version = this.versions.get(input.versionId);
    if (!version || version.lockedBy !== input.workerId) return { alive: false, cancelRequested: false };
    version.lockedUntil = this.now() + input.leaseMs;
    return { alive: true, cancelRequested: version.cancelRequested };
  }
  async update(input: { versionId: string; workerId: string; patch: VideoVersionPatch }) {
    const version = this.versions.get(input.versionId);
    if (!version || version.lockedBy !== input.workerId) return false;
    Object.assign(version, this.clone(input.patch), { updatedAt: new Date(this.now()).toISOString() });
    return true;
  }
  async release(input: { versionId: string; workerId: string; patch: VideoVersionPatch & { status: VideoVersion["status"] } }) {
    const ok = await this.update(input);
    if (!ok) return false;
    const version = this.versions.get(input.versionId)!;
    version.lockedBy = undefined;
    version.lockedUntil = undefined;
    if (input.patch.status === "queued") version.cancelRequested = false;
    return true;
  }
  private strip(version: VideoVersion & { lockedBy?: string; lockedUntil?: number }): VideoVersion {
    const { lockedBy: _lockedBy, lockedUntil: _lockedUntil, ...rest } = version;
    return this.clone(rest);
  }
}
