import useSWR from "swr";
import { listInstagramDmAutomationRules, listInstagramDmConversations, listInstagramDmMessages } from "./api";

export function useInstagramDmConversations(workspaceId: string, instagramBusinessAccountId: string | undefined) {
  return useSWR(instagramBusinessAccountId ? ["instagram-dm-conversations", workspaceId, instagramBusinessAccountId] : null, () => listInstagramDmConversations(workspaceId, instagramBusinessAccountId), {
    refreshInterval: 15_000,
  });
}

export function useInstagramDmMessages(workspaceId: string, conversationId: string | undefined) {
  return useSWR(conversationId ? ["instagram-dm-messages", workspaceId, conversationId] : null, () => listInstagramDmMessages(workspaceId, conversationId!), {
    refreshInterval: 10_000,
  });
}

export function useInstagramDmAutomationRules(workspaceId: string, instagramBusinessAccountId: string | undefined) {
  return useSWR(instagramBusinessAccountId ? ["instagram-dm-automation-rules", workspaceId, instagramBusinessAccountId] : null, () => listInstagramDmAutomationRules(workspaceId, instagramBusinessAccountId!));
}
