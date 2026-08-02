import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { SchedulingHealth } from "../../domain/scheduling/scheduling.model.js";

export type SchedulingHealthServiceDeps = {
  repository: SchedulingRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  clock: ClockPort;
  lateThresholdMs: number;
};

export class SchedulingHealthService {
  constructor(private readonly deps: SchedulingHealthServiceDeps) {}

  async health(input: { tenantId: string; workspaceId: string }): Promise<SchedulingHealth> {
    const metrics = await this.deps.repository.metrics(input);
    const now = this.deps.clock.nowIso();
    const lateCutoff = new Date(this.deps.clock.now().getTime() - this.deps.lateThresholdMs).toISOString();
    const [lateOccurrences, deadLetters, outbox] = await Promise.all([
      this.deps.repository.listOccurrences({ tenantId: input.tenantId, workspaceId: input.workspaceId, status: "pending", dueToUtc: lateCutoff, limit: 50 }),
      this.deps.repository.listDeadLetters({ tenantId: input.tenantId, workspaceId: input.workspaceId, unresolvedOnly: true }),
      this.deps.publicationRepository.listOutbox({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
    ]);
    const checks: SchedulingHealth["checks"] = [
      { id: "database", status: "pass", safeMessage: "Repository de Scheduling respondeu." },
      { id: "temporal-queue", status: lateOccurrences.length > 0 ? "warn" : "pass", safeMessage: lateOccurrences.length > 0 ? "Ha ocorrencias pendentes atrasadas." : "Fila temporal sem atraso critico.", evidence: { lateOccurrences: lateOccurrences.length } },
      { id: "leases", status: "pass", safeMessage: "Leases expirados sao recuperaveis pelo recovery service." },
      { id: "outbox-bridge", status: outbox.some((message) => message.status === "dead_lettered") ? "warn" : "pass", safeMessage: "Bridge com Publication Outbox consultavel.", evidence: { outbox: outbox.length } },
      { id: "dead-letters", status: deadLetters.length > 0 ? "warn" : "pass", safeMessage: deadLetters.length > 0 ? "Ha dead letters de Scheduling aguardando acao." : "Sem dead letters pendentes.", evidence: { deadLetters: deadLetters.length } },
      { id: "clock-drift", status: Number.isNaN(new Date(now).getTime()) ? "fail" : "pass", safeMessage: "ClockPort retornou timestamp ISO valido." },
    ];
    const status = checks.some((check) => check.status === "fail") ? "unhealthy" : checks.some((check) => check.status === "warn") ? "degraded" : "healthy";
    const events = await this.deps.repository.listEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 200 });
    return {
      status,
      checks,
      metrics,
      lastDispatchAt: events.find((event) => event.eventType === "schedule.occurrence_dispatched")?.createdAt,
      lastRecoveryAt: events.find((event) => event.eventType === "schedule.recovery_completed")?.createdAt,
    };
  }
}
