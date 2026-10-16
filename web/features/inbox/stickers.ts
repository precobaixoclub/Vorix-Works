import { useEffect, useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { getApiBaseUrl } from "@/lib/api-error";
import { getAccessToken } from "@/lib/auth-token";
import type { InboxMessage } from "./types";

/** Figurinhas salvas da equipe (Conversas) — como as figurinhas salvas do WhatsApp. */
export type SavedSticker = { id: string; mimeType: string; sizeBytes: number; createdAt: string };

const q = encodeURIComponent;
export const stickersKey = (workspaceId: string) => ["inbox-stickers", workspaceId] as const;

export const listSavedStickers = (workspaceId: string) => apiClient.get<SavedSticker[]>(`/v1/inbox/stickers?workspaceId=${q(workspaceId)}`);
export const saveSticker = (workspaceId: string, messageId: string) => apiClient.post<SavedSticker & { alreadySaved: boolean }>("/v1/inbox/stickers", { workspaceId, messageId });
export const deleteSavedSticker = (workspaceId: string, stickerId: string) => apiClient.delete<{ deleted: true }>(`/v1/inbox/stickers/${q(stickerId)}?workspaceId=${q(workspaceId)}`);
export const sendSavedSticker = (workspaceId: string, conversationId: string, stickerId: string) => apiClient.post<InboxMessage>(`/v1/inbox/conversations/${q(conversationId)}/stickers/${q(stickerId)}`, { workspaceId });

export function useSavedStickers(workspaceId: string, enabled = true) {
  return useSWR(enabled ? stickersKey(workspaceId) : null, () => listSavedStickers(workspaceId));
}

/** Imagem da figurinha salva (privada): busca com a sessão e vira um endereço local do navegador. */
const blobCache = new Map<string, string>();
export function useStickerImage(workspaceId: string, stickerId: string): string | undefined {
  const [url, setUrl] = useState(() => blobCache.get(stickerId));
  useEffect(() => {
    if (blobCache.has(stickerId)) { setUrl(blobCache.get(stickerId)); return; }
    let cancelled = false;
    const token = getAccessToken();
    fetch(`${getApiBaseUrl()}/v1/inbox/stickers/${q(stickerId)}/file?workspaceId=${q(workspaceId)}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => (response.ok ? response.blob() : undefined))
      .then((blob) => {
        if (!blob || cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobCache.set(stickerId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceId, stickerId]);
  return url;
}
