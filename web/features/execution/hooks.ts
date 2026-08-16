import useSWR, { type SWRConfiguration } from "swr";
import { getExecutionRun, listExecutionRuns } from "./api";
import type { ExecutionRunDetail } from "./types";

export function useExecutionRuns(workspaceId: string, runtimePlanId?: string) {
  return useSWR(workspaceId ? ["execution-runs", workspaceId, runtimePlanId] : null, () => listExecutionRuns(workspaceId, runtimePlanId));
}

export function useExecutionRun(workspaceId: string, id: string | undefined, config?: SWRConfiguration<ExecutionRunDetail>) {
  return useSWR(workspaceId && id ? ["execution-run", workspaceId, id] : null, () => getExecutionRun(workspaceId, id as string), config);
}
