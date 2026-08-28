import useSWR from "swr";
import { listInboxConnections, listInboxConversationMessages, listInboxConversations } from "./api";
import type { InboxConversationFilter } from "./types";

export function useInboxConnections(workspaceId: string) {
  return useSWR(["inbox-connections", workspaceId], () => listInboxConnections(workspaceId), { refreshInterval: 15_000 });
}

export function useInboxConversations(workspaceId: string, filter: InboxConversationFilter = "all") {
  return useSWR(["inbox-conversations", workspaceId, filter], () => listInboxConversations(workspaceId, filter), { refreshInterval: 15_000 });
}

export function useInboxConversationMessages(workspaceId: string, conversationId: string | undefined) {
  return useSWR(conversationId ? ["inbox-conversation-messages", workspaceId, conversationId] : null, () => listInboxConversationMessages(workspaceId, conversationId!), {
    refreshInterval: 10_000,
  });
}
