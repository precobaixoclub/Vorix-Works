import useSWR from "swr";
import { getActiveBriefing } from "./api";

export function useActiveBriefing(workspaceId: string, conversationId: string | undefined) {
  return useSWR(workspaceId && conversationId ? ["briefing-active", workspaceId, conversationId] : null, () =>
    getActiveBriefing(workspaceId, conversationId as string),
  );
}
