import useSWR from "swr";
import { getConversation, getHistory, listConversations } from "./api";

export function useConversations(workspaceId: string) {
  return useSWR(workspaceId ? ["conversations", workspaceId] : null, () => listConversations(workspaceId));
}

export function useConversation(workspaceId: string, conversationId: string | undefined) {
  return useSWR(workspaceId && conversationId ? ["conversation", workspaceId, conversationId] : null, () =>
    getConversation(workspaceId, conversationId as string),
  );
}

export function useConversationHistory(workspaceId: string, conversationId: string | undefined) {
  return useSWR(workspaceId && conversationId ? ["conversation-history", workspaceId, conversationId] : null, () =>
    getHistory(workspaceId, conversationId as string),
  );
}
