import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getApiBaseUrl } from "@/lib/api-error";
import { listActiveNotifications, listNotificationHistory, mintNotificationStreamToken } from "./api";

/** Central de notificações in-app ("sino"), réplica adaptada do CMDesk — poll de 60s é só o
 * FALLBACK (mesmo racional de `useInboxConnections`); `useNotificationsRealtime` cobre o caso
 * comum. */
export function useNotifications(workspaceId: string) {
  return useSWR(workspaceId ? ["notifications-active", workspaceId] : null, () => listActiveNotifications(workspaceId), { refreshInterval: 60_000 });
}

export function useNotificationHistory(workspaceId: string, enabled: boolean) {
  return useSWR(workspaceId && enabled ? ["notifications-history", workspaceId] : null, () => listNotificationHistory(workspaceId));
}

/**
 * SSE — nunca a fonte de verdade, só revalida o SWR mais rápido que o polling de fallback (mesmo
 * racional exato de `useInboxRealtime`). Reconecta com token FRESCO a cada tentativa; ao
 * (re)abrir, revalida tudo (recupera qualquer notificação perdida entre uma queda e a reconexão).
 */
export function useNotificationsRealtime(workspaceId: string): void {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (!workspaceId) return;
    let source: EventSource | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    function revalidate() {
      void mutate(["notifications-active", workspaceId]);
      void mutate(["notifications-history", workspaceId]);
    }

    async function connect() {
      if (closed) return;
      let streamToken: string;
      try {
        streamToken = (await mintNotificationStreamToken()).streamToken;
      } catch {
        if (!closed) retryTimeout = setTimeout(connect, 5_000);
        return;
      }
      if (closed) return;

      const query = new URLSearchParams({ workspaceId, stream_token: streamToken });
      source = new EventSource(`${getApiBaseUrl()}/v1/notifications/stream?${query.toString()}`);
      source.onopen = () => revalidate();
      source.addEventListener("notification.new", () => revalidate());
      source.onerror = () => {
        source?.close();
        if (!closed) retryTimeout = setTimeout(connect, 5_000);
      };
    }

    void connect();
    return () => {
      closed = true;
      source?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [workspaceId, mutate]);
}
