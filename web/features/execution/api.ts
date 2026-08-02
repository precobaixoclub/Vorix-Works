import { apiClient } from "@/lib/api-client";
import type { ExecutionEvent, ExecutionRun, ExecutionRunDetail, ExecutionTaskRun, ExecutionTrace } from "./types";

export async function listExecutionRuns(workspaceId: string, runtimePlanId?: string): Promise<ExecutionRun[]> {
  const query = new URLSearchParams({ workspaceId });
  if (runtimePlanId) query.set("runtimePlanId", runtimePlanId);
  return apiClient.get<ExecutionRun[]>(`/v1/execution-runs?${query.toString()}`);
}

export function getExecutionRun(workspaceId: string, id: string): Promise<ExecutionRunDetail> {
  return apiClient.get<ExecutionRunDetail>(`/v1/execution-runs/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listExecutionTasks(workspaceId: string, id: string): Promise<ExecutionTaskRun[]> {
  return apiClient.get<ExecutionTaskRun[]>(`/v1/execution-runs/${id}/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listExecutionEvents(workspaceId: string, id: string): Promise<ExecutionEvent[]> {
  return apiClient.get<ExecutionEvent[]>(`/v1/execution-runs/${id}/events?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listExecutionTraces(workspaceId: string, id: string): Promise<ExecutionTrace[]> {
  return apiClient.get<ExecutionTrace[]>(`/v1/execution-runs/${id}/traces?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createExecutionRun(input: { workspaceId: string; runtimePlanId: string; idempotencyKey: string; executionMode?: "dry_run" | "real" }): Promise<ExecutionRun> {
  return apiClient.post<ExecutionRun>("/v1/execution-runs", input);
}

export function startExecutionRun(workspaceId: string, id: string): Promise<ExecutionRun> {
  return apiClient.post<ExecutionRun>(`/v1/execution-runs/${id}/start`, { workspaceId });
}

export function cancelExecutionRun(workspaceId: string, id: string): Promise<ExecutionRun> {
  return apiClient.post<ExecutionRun>(`/v1/execution-runs/${id}/cancel`, { workspaceId });
}

export function decideExecutionGate(input: { workspaceId: string; runId: string; gateId: string; decision: "approved" | "rejected" }): Promise<ExecutionRun> {
  return apiClient.post<ExecutionRun>(`/v1/execution-runs/${input.runId}/gates/${input.gateId}/decision`, { workspaceId: input.workspaceId, decision: input.decision });
}
