import { apiClient } from "@/lib/api-client";
import type { BackupRestorePlan, BackpressureSignal, CircuitBreaker, OperationalHealth, QueueSnapshot, RateLimitBucket, SecretHealth } from "./types";

export function getSystemHealth(workspaceId: string): Promise<OperationalHealth> {
  return apiClient.get<OperationalHealth>(`/v1/system/health?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listCircuitBreakers(workspaceId: string): Promise<CircuitBreaker[]> {
  return apiClient.get<CircuitBreaker[]>(`/v1/system/circuit-breakers?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function resetCircuitBreaker(id: string): Promise<CircuitBreaker> {
  return apiClient.post<CircuitBreaker>(`/v1/system/circuit-breakers/${encodeURIComponent(id)}/reset`);
}

export function listRateLimits(): Promise<RateLimitBucket[]> {
  return apiClient.get<RateLimitBucket[]>("/v1/system/rate-limits");
}

export function listBackpressure(workspaceId: string): Promise<BackpressureSignal[]> {
  return apiClient.get<BackpressureSignal[]>(`/v1/system/backpressure?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getQueues(): Promise<QueueSnapshot> {
  return apiClient.get<QueueSnapshot>("/v1/system/queues");
}

export function getSecretHealth(): Promise<SecretHealth> {
  return apiClient.get<SecretHealth>("/v1/system/secrets/health");
}

export function getBackupRestorePlan(): Promise<BackupRestorePlan> {
  return apiClient.get<BackupRestorePlan>("/v1/system/backup-restore");
}

