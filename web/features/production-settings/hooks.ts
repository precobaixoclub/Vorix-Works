import useSWR from "swr";
import { getProductionSettings } from "./api";

export function useProductionSettings(workspaceId: string) {
  return useSWR(["production-settings", workspaceId], () => getProductionSettings(workspaceId));
}
