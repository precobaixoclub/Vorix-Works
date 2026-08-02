import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { PublicationSchedule, ScheduleConflict, ScheduleOccurrence } from "../../domain/scheduling/scheduling.model.js";

export type ScheduleConflictDetectorDeps = {
  repository: SchedulingRepositoryPort;
  idGenerator: () => string;
  conflictWindowMinutes: number;
};

export class ScheduleConflictDetector {
  constructor(private readonly deps: ScheduleConflictDetectorDeps) {}

  async detectForOccurrences(input: { schedule: PublicationSchedule; occurrences: readonly ScheduleOccurrence[] }): Promise<ScheduleConflict[]> {
    const conflicts: Omit<ScheduleConflict, "createdAt">[] = [];
    for (const occurrence of input.occurrences) {
      const window = {
        startsAtUtc: new Date(new Date(occurrence.dueAtUtc).getTime() - this.deps.conflictWindowMinutes * 60_000).toISOString(),
        endsAtUtc: new Date(new Date(occurrence.dueAtUtc).getTime() + this.deps.conflictWindowMinutes * 60_000).toISOString(),
      };
      const nearby = await this.deps.repository.listOccurrences({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, dueFromUtc: window.startsAtUtc, dueToUtc: window.endsAtUtc, limit: 200 });
      for (const other of nearby) {
        if (other.id === occurrence.id) continue;
        if (other.status === "cancelled" || other.status === "dead_lettered") continue;
        if (other.targetId === occurrence.targetId && other.providerId === occurrence.providerId) {
          conflicts.push(this.conflict(occurrence, "blocking", "SAME_TARGET_PROVIDER_WINDOW", "Mesmo target/provider na mesma janela.", other, window));
        } else if (other.providerId === occurrence.providerId) {
          conflicts.push(this.conflict(occurrence, "warning", "SAME_PROVIDER_WINDOW", "Mesmo provider na mesma janela operacional.", other, window));
        }
        if (occurrence.campaignId && other.campaignId === occurrence.campaignId) {
          conflicts.push(this.conflict(occurrence, "info", "SAME_CAMPAIGN_WINDOW", "Mesma campanha na janela editorial.", other, window));
        }
        if (occurrence.contentChecksum && other.contentChecksum === occurrence.contentChecksum) {
          conflicts.push(this.conflict(occurrence, "warning", "DUPLICATE_CONTENT", "Conteudo com checksum duplicado na janela.", other, window));
        }
      }
      if (occurrence.providerId !== "dry_run" && occurrence.providerId !== "fake" && !occurrence.credentialReferenceId) {
        conflicts.push(this.conflict(occurrence, "blocking", "CREDENTIAL_REFERENCE_MISSING", "Provider externo exige credencial governada antes do dispatch.", undefined, window));
      }
    }
    if (conflicts.length === 0) return [];
    await this.deps.repository.resolveConflicts({ tenantId: input.schedule.tenantId, workspaceId: input.schedule.workspaceId, scheduleId: input.schedule.id, now: new Date().toISOString() });
    return this.deps.repository.createConflicts(conflicts);
  }

  private conflict(
    occurrence: ScheduleOccurrence,
    severity: ScheduleConflict["severity"],
    code: string,
    safeMessage: string,
    other: ScheduleOccurrence | undefined,
    window: ScheduleConflict["window"],
  ): Omit<ScheduleConflict, "createdAt"> {
    return {
      id: this.deps.idGenerator(),
      tenantId: occurrence.tenantId,
      workspaceId: occurrence.workspaceId,
      scheduleId: occurrence.scheduleId,
      occurrenceId: occurrence.id,
      severity,
      code,
      safeMessage,
      conflictingScheduleId: other?.scheduleId,
      conflictingOccurrenceId: other?.id,
      providerId: occurrence.providerId,
      targetId: occurrence.targetId,
      window,
    };
  }
}
