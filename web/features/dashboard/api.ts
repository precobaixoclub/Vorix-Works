import useSWR from "swr";
import { apiClient } from "@/lib/api-client";

/** Espelha `getDashboard` (src/application/dashboard/dashboard-use-cases.ts). Fórmulas e regras de
 * período: docs/dashboard-indicadores.md — a tela só exibe, nunca recalcula. */
export type Average = { value?: number; sample: number };
export type DashboardPeriod = "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month" | "last_month" | "custom";
type Unavailable = { available: false };

export type DashboardAttendance = {
  available: true;
  volume: { opened: number; finalized: number; reopened: number; reopenRateBp?: number };
  frt: Average;
  frtAttendance: Average;
  tmr: Average;
  holding: Average;
  transfers: { count: number; attendancesWithTransfer: number; rateBp?: number; averagePerAttendance?: number };
  sla: { configured: boolean; firstResponse: { met: number; breached: number; rateBp?: number }; resolution: { met: number; breached: number; rateBp?: number }; openNear: number; openBreached: number };
  backlog: { total: number; queue: number; awaitingFirstResponse: number; awaitingAgent: number; awaitingCustomer: number; slaBreached: number };
  csat: { average: Average; sent: number; answered: number; responseRateBp?: number; waived: number; disabledByChannel: number; notApplicable: number; failed: number };
  closures: { typeName: string; subtypeName?: string; count: number; shareBp?: number }[];
  phases: { phaseName: string; average: Average }[];
  agents: { userId: string; participated: number; finalized: number; frt: Average; holding: Average; csat: Average; transfersOut: number }[];
  teams: { teamId: string; finalized: number; tmr: Average; frt: Average; csat: Average; backlog: number }[];
};

export type DashboardCommercial = {
  available: true;
  open: { count: number; valueCents: number };
  pipelineByStage: { pipelineId: string; stageId: string; name: string; count: number; valueCents: number }[];
  won: { count: number; valueCents: number };
  lost: { count: number; valueCents: number; reasons: { reason: string; count: number; shareBp?: number }[] };
  conversionBp?: number;
  averageTicketCents?: number;
  proposals: { created: number; sent: number; accepted: number; declined: number; acceptanceRateBp?: number; convertedToSale: number; saleConversionBp?: number };
  sellers: { userId: string; won: number; lost: number; wonValueCents: number; conversionBp?: number }[];
};

export type DashboardGoals = { available: true; month: string; hasGoal: boolean; targetCents?: number; realizedCents: number; pipelineCents: number; attainmentBp?: number; remainingCents?: number };

export type DashboardData = {
  viewing: string;
  period: { period: DashboardPeriod; from: string; to: string; timeZone: string; monthStart: string };
  options: { viewings: { value: string; label: string }[]; userIds: string[]; teams: { id: string; name: string }[] };
  attendance: DashboardAttendance | Unavailable;
  commercial: DashboardCommercial | Unavailable;
  goals: DashboardGoals | Unavailable;
};

export type DashboardQuery = { viewing: string; period: DashboardPeriod; from?: string; to?: string; connectionId?: string };

export function getDashboard(workspaceId: string, query: DashboardQuery): Promise<DashboardData> {
  const params = new URLSearchParams({ workspaceId, viewing: query.viewing, period: query.period });
  if (query.period === "custom" && query.from && query.to) { params.set("from", query.from); params.set("to", query.to); }
  if (query.connectionId) params.set("connectionId", query.connectionId);
  return apiClient.get<DashboardData>(`/v1/dashboard?${params.toString()}`);
}

export function useDashboard(workspaceId: string, query: DashboardQuery, options: { enabled?: boolean } = {}) {
  const ready = options.enabled !== false && (query.period !== "custom" || Boolean(query.from && query.to));
  return useSWR(ready ? ["dashboard", workspaceId, query.viewing, query.period, query.from, query.to, query.connectionId] : null, () => getDashboard(workspaceId, query), {
    refreshInterval: 120_000,
    keepPreviousData: true,
  });
}

// SLA (prazo operacional): empresa, equipe ou canal — mais específico vence.
export type SlaPolicy = { id: string; scopeType: "workspace" | "team" | "connection"; scopeId?: string; firstResponseSeconds?: number; resolutionSeconds?: number; updatedAt: string };

export function useSlaPolicies(workspaceId: string) {
  return useSWR(["sla-policies", workspaceId], () => apiClient.get<SlaPolicy[]>(`/v1/inbox/sla-policies?workspaceId=${encodeURIComponent(workspaceId)}`));
}

export function saveSlaPolicy(workspaceId: string, input: { scopeType: SlaPolicy["scopeType"]; scopeId?: string; firstResponseMinutes: number | null; resolutionMinutes: number | null }) {
  return apiClient.put<SlaPolicy | { deleted: true }>("/v1/inbox/sla-policies", { workspaceId, ...input });
}
