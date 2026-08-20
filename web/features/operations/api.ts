import { apiClient } from "@/lib/api-client";
import type { BackupRestorePlan, BackpressureSignal, CircuitBreaker, OperationalHealth, QueueSnapshot, RateLimitBucket, SecretHealth } from "./types";

export function getSystemHealth(workspaceId: string): Promise<OperationalHealth> {
  return apiClient.get<OperationalHealth>(`/v1/system/health?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listCircuitBreakers(workspaceId: string): Promise<CircuitBreaker[]> {
  return apiClient.get<CircuitBreaker[]>(`/v1/system/circuit-breakers?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function resetCircuitBreaker(id: string, workspaceId: string): Promise<CircuitBreaker> {
  return apiClient.post<CircuitBreaker>(`/v1/system/circuit-breakers/${encodeURIComponent(id)}/reset?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listRateLimits(workspaceId: string): Promise<RateLimitBucket[]> {
  return apiClient.get<RateLimitBucket[]>(`/v1/system/rate-limits?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listBackpressure(workspaceId: string): Promise<BackpressureSignal[]> {
  return apiClient.get<BackpressureSignal[]>(`/v1/system/backpressure?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getQueues(workspaceId: string): Promise<QueueSnapshot> {
  return apiClient.get<QueueSnapshot>(`/v1/system/queues?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getSecretHealth(workspaceId: string): Promise<SecretHealth> {
  return apiClient.get<SecretHealth>(`/v1/system/secrets/health?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getBackupRestorePlan(workspaceId: string): Promise<BackupRestorePlan> {
  return apiClient.get<BackupRestorePlan>(`/v1/system/backup-restore?workspaceId=${encodeURIComponent(workspaceId)}`);
}
