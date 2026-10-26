import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getApiBaseUrl } from "@/lib/api-error";
import { mintInboxStreamToken } from "@/features/inbox/api";
import { getRadarAlertDetail, getRadarCredits, getRadarStats, listRadarAlerts } from "./api";
import type { RadarListFilter } from "./types";

/** Radar de Sentimento — o polling é só FALLBACK (mesmo racional de `useNotifications`);
 * `useRadarRealtime` cobre o caso comum. Nenhuma destas leituras consome crédito de IA. */

export function useRadarAlerts(workspaceId: string, filter: RadarListFilter = {}) {
  return useSWR(["radar-alerts", workspaceId, filter.level ?? "", filter.teamId ?? "", filter.dismissed ? "dismissed" : "active"], () => listRadarAlerts(workspaceId, filter), { refreshInterval: 60_000 });
}

export function useRadarStats(workspaceId: string, teamId?: string) {
  return useSWR(["radar-stats", workspaceId, teamId ?? ""], () => getRadarStats(workspaceId, teamId), { refreshInterval: 60_000 });
}

export function useRadarCredits(workspaceId: string) {
  return useSWR(["radar-credits", workspaceId], () => getRadarCredits(workspaceId), { refreshInterval: 60_000 });
}

export function useRadarAlertDetail(workspaceId: string, conversationId: string | undefined) {
  return useSWR(conversationId ? ["radar-alert", workspaceId, conversationId] : null, () => getRadarAlertDetail(workspaceId, conversationId!));
}

const RADAR_EVENTS = ["radar.alert.update", "radar.ai.updated", "radar.ai.blocked"] as const;

function isRadarKey(key: unknown, workspaceId: string): boolean {
  return Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("radar-") && key[1] === workspaceId;
}

/**
 * Tempo real do Radar — reaproveita o SSE do módulo Conversas (`GET /v1/inbox/stream`, mesmo
 * token de curta duração). Os eventos só carregam ids: servem de gatilho para revalidar o REST,
 * que é quem aplica o escopo do usuário. `radar.ai.blocked` também revalida o saldo — é assim que
 * a tela reage, sem reload, quando os créditos acabam durante o uso.
 */
export function useRadarRealtime(workspaceId: string): void {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (!workspaceId) return;
    let source: EventSource | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const revalidate = () => void mutate((key) => isRadarKey(key, workspaceId));

    async function connect() {
      if (closed) return;
      let streamToken: string;
      try {
        streamToken = (await mintInboxStreamToken()).streamToken;
      } catch {
        if (!closed) retryTimeout = setTimeout(connect, 5_000);
        return;
      }
      if (closed) return;

      const query = new URLSearchParams({ workspaceId, stream_token: streamToken });
      source = new EventSource(`${getApiBaseUrl()}/v1/inbox/stream?${query.toString()}`);
      source.onopen = () => revalidate();
      for (const eventName of RADAR_EVENTS) source.addEventListener(eventName, revalidate);
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
