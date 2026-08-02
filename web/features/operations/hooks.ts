import useSWR from "swr";
import { getBackupRestorePlan, getQueues, getSecretHealth, getSystemHealth, listBackpressure, listCircuitBreakers, listRateLimits } from "./api";

export function useSystemHealth(workspaceId: string) {
  return useSWR(["system-health", workspaceId], () => getSystemHealth(workspaceId));
}

export function useCircuitBreakers(workspaceId: string) {
  return useSWR(["system-circuit-breakers", workspaceId], () => listCircuitBreakers(workspaceId));
}

export function useRateLimits() {
  return useSWR("system-rate-limits", listRateLimits);
}

export function useBackpressure(workspaceId: string) {
  return useSWR(["system-backpressure", workspaceId], () => listBackpressure(workspaceId));
}

export function useQueues() {
  return useSWR("system-queues", getQueues);
}

export function useSecretHealth() {
  return useSWR("system-secret-health", getSecretHealth);
}

export function useBackupRestorePlan() {
  return useSWR("system-backup-restore", getBackupRestorePlan);
}

