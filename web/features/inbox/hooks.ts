import { useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getApiBaseUrl } from "@/lib/api-error";
import { getAccessToken } from "@/lib/auth-token";
import { listInboxConnections, listInboxConversationMessages, listInboxConversations } from "./api";
import type { InboxConversationFilter } from "./types";

/**
 * Módulo Conversas — Fase 3. `refreshInterval` aqui é só o FALLBACK (bem mais espaçado que antes,
 * já que `useInboxRealtime` cobre o caso comum) — nunca a fonte principal de atualização.
 */
export function useInboxConnections(workspaceId: string) {
  return useSWR(["inbox-connections", workspaceId], () => listInboxConnections(workspaceId), { refreshInterval: 30_000 });
}

export function useInboxConversations(workspaceId: string, filter: InboxConversationFilter = "all") {
  return useSWR(["inbox-conversations", workspaceId, filter], () => listInboxConversations(workspaceId, filter), { refreshInterval: 30_000 });
}

export function useInboxConversationMessages(workspaceId: string, conversationId: string | undefined) {
  return useSWR(conversationId ? ["inbox-conversation-messages", workspaceId, conversationId] : null, () => listInboxConversationMessages(workspaceId, conversationId!), {
    refreshInterval: 20_000,
  });
}

const REALTIME_EVENT_TYPES = ["message.created", "message.updated", "conversation.updated", "connection.status_changed"] as const;

/**
 * SSE (Fase 3) — nunca é a fonte de verdade, só revalida o SWR mais rápido que o polling de
 * fallback quando algo muda. Reconecta com token FRESCO a cada tentativa (não confia no retry
 * nativo do `EventSource`, que reusaria a mesma URL com um `access_token` potencialmente
 * expirado) — ver `auth.middleware.ts` sobre por que o token vai por querystring aqui
 * especificamente (o `EventSource` do browser não seta headers customizados).
 */
export function useInboxRealtime(workspaceId: string, conversationId: string | undefined): void {
  const { mutate } = useSWRConfig();
  // Evita fechar/reabrir a conexão a cada re-render por causa de `mutate` mudar de identidade.
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  useEffect(() => {
    if (!workspaceId) return;
    let source: EventSource | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    function connect() {
      if (closed) return;
      const token = getAccessToken();
      const query = new URLSearchParams({ workspaceId, ...(token ? { access_token: token } : {}) });
      source = new EventSource(`${getApiBaseUrl()}/v1/inbox/stream?${query.toString()}`);

      for (const type of REALTIME_EVENT_TYPES) {
        source.addEventListener(type, (event: MessageEvent<string>) => {
          let payload: { conversationId?: string } = {};
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }
          void mutate(["inbox-conversations", workspaceId, "all"]);
          void mutate(["inbox-conversations", workspaceId, "mine"]);
          void mutate(["inbox-conversations", workspaceId, "unassigned"]);
          void mutate(["inbox-conversations", workspaceId, "unread"]);
          if (payload.conversationId && payload.conversationId === conversationIdRef.current) {
            void mutate(["inbox-conversation-messages", workspaceId, payload.conversationId]);
          }
        });
      }

      source.onerror = () => {
        source?.close();
        if (!closed) retryTimeout = setTimeout(connect, 5_000);
      };
    }

    connect();
    return () => {
      closed = true;
      source?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [workspaceId, mutate]);
}
