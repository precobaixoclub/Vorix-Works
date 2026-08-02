import useSWR from "swr";
import { getWorkspace, listWorkspaces } from "./api";

export function useWorkspaces(status?: "active" | "inactive" | "archived") {
  return useSWR(["workspaces", status], () => listWorkspaces(status));
}

export function useWorkspace(id: string) {
  return useSWR(id ? ["workspace", id] : null, () => getWorkspace(id));
}
