import useSWR from "swr";
import { listCampaigns } from "./data";

export function useCampaigns(workspaceId: string) {
  return useSWR(["campaigns", workspaceId], () => listCampaigns(workspaceId));
}
