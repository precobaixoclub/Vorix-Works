import type { AssignmentFact, AttendanceFact } from "../../domain/dashboard/dashboard-metrics.js";

/** Leituras da Dashboard principal (0174). Devolve FATOS estruturados (timestamps, estados,
 * ciclos); as fórmulas ficam em `src/domain/dashboard/dashboard-metrics.ts`. */
export type AttendanceFactRow = Omit<AttendanceFact, "sla">;
export type PhaseTimeRow = { phaseName: string; seconds: number; teamId: string; conversationId: string };

export type SlaPolicyScope = "workspace" | "team" | "connection";
export type SlaPolicy = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scopeType: SlaPolicyScope;
  scopeId?: string;
  firstResponseSeconds?: number;
  resolutionSeconds?: number;
  updatedBy?: string;
  updatedAt: string;
};

export type DashboardRepositoryPort = {
  /** Atendimentos relevantes para `[from, to)`: abertos ou fechados no período, com algum ciclo no
   * período, ou ainda abertos agora (backlog). Mais todos os ciclos desses atendimentos. */
  listAttendanceFacts(input: { tenantId: string; workspaceId: string; from: string; to: string; connectionId?: string }): Promise<{ attendances: AttendanceFactRow[]; assignments: AssignmentFact[] }>;
  /** Permanências em fase do kanban de atendimento encerradas no período. */
  listPhaseTimes(input: { tenantId: string; workspaceId: string; from: string; to: string }): Promise<PhaseTimeRow[]>;
  listSlaPolicies(workspaceId: string): Promise<SlaPolicy[]>;
  upsertSlaPolicy(input: Omit<SlaPolicy, "id" | "updatedAt">): Promise<SlaPolicy>;
  deleteSlaPolicy(input: { workspaceId: string; scopeType: SlaPolicyScope; scopeId?: string }): Promise<void>;
};
