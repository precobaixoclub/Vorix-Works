import useSWR from "swr";
import { getBackupRestorePlan, getQueues, getSecretHealth, getSystemHealth, listBackpressure, listCircuitBreakers, listRateLimits } from "./api";

export function useSystemHealth(workspaceId: string) {
  return useSWR(["system-health", workspaceId], () => getSystemHealth(workspaceId));
}

export function useCircuitBreakers(workspaceId: string) {
  return useSWR(["system-circuit-breakers", workspaceId], () => listCircuitBreakers(workspaceId));
}

export function useRateLimits(workspaceId: string) {
  return useSWR(["system-rate-limits", workspaceId], () => listRateLimits(workspaceId));
}

export function useBackpressure(workspaceId: string) {
  return useSWR(["system-backpressure", workspaceId], () => listBackpressure(workspaceId));
}

export function useQueues(workspaceId: string) {
  return useSWR(["system-queues", workspaceId], () => getQueues(workspaceId));
}

export function useSecretHealth(workspaceId: string) {
  return useSWR(["system-secret-health", workspaceId], () => getSecretHealth(workspaceId));
}

export function useBackupRestorePlan(workspaceId: string) {
  return useSWR(["system-backup-restore", workspaceId], () => getBackupRestorePlan(workspaceId));
}
