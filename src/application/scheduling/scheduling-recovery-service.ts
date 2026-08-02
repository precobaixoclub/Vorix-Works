import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { AuditActor } from "../../domain/credential/credential.model.js";

export type SchedulingRecoveryServiceDeps = {
  repository: SchedulingRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  clock: ClockPort;
  idGenerator: () => string;
  missedGraceMs: number;
};

export class SchedulingRecoveryService {
  constructor(private readonly deps: SchedulingRecoveryServiceDeps) {}

  async recover(input: { tenantId?: string; workspaceId?: string; actor: AuditActor; requestId?: string }): Promise<{ releasedLeases: number; missed: number }> {
    const now = this.deps.clock.nowIso();
    const releasedLeases = await this.deps.repository.releaseExpiredLeases(now);
    const olderThanUtc = new Date(this.deps.clock.now().getTime() - this.deps.missedGraceMs).toISOString();
    const missed = await this.deps.repository.markMissed({ tenantId: input.tenantId, workspaceId: input.workspaceId, now, olderThanUtc, policy: "manual_review" });
    if (input.tenantId && input.workspaceId) {
      await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "schedule.recovery_completed", actorUserId: input.actor.userId, payload: { releasedLeases, missed } });
      await this.deps.auditRepository.record({
        id: this.deps.idGenerator(),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        eventType: "schedule.recovery_completed",
        actor: input.actor,
        resource: { type: "scheduling", id: "recovery" },
        context: { requestId: input.requestId },
        result: { status: "success" },
        metadata: { releasedLeases, missed },
      });
    }
    return { releasedLeases, missed };
  }
}
