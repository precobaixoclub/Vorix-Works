import useSWR from "swr";
import { getRuntime, getRuntimeBindings, listRuntime } from "./api";

export function useRuntimeList(workspaceId: string, planningId?: string) {
  return useSWR(workspaceId ? ["runtime-list", workspaceId, planningId] : null, () => listRuntime(workspaceId, planningId));
}

export function useRuntime(workspaceId: string, id: string | undefined) {
  return useSWR(workspaceId && id ? ["runtime", workspaceId, id] : null, () => getRuntime(workspaceId, id as string));
}

export function useRuntimeBindings(workspaceId: string, id: string | undefined) {
  return useSWR(workspaceId && id ? ["runtime-bindings", workspaceId, id] : null, () => getRuntimeBindings(workspaceId, id as string));
}
