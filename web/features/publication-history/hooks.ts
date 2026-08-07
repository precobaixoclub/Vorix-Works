import { useMemo } from "react";
import { useMetaPosts } from "@/features/meta/hooks";
import { useTikTokPosts } from "@/features/tiktok/hooks";
import { useYouTubePosts } from "@/features/youtube/hooks";
import type { UnifiedPublication } from "./types";

/** Junta os feeds reais de TikTok/Instagram/Facebook/YouTube numa lista só — mesma lógica que vivia
 * presa dentro de `publish/page.tsx`, agora reaproveitada pela tela de histórico. */
export function useUnifiedPublications(workspaceId: string) {
  const tiktok = useTikTokPosts(workspaceId);
  const meta = useMetaPosts(workspaceId);
  const youtube = useYouTubePosts(workspaceId);

  const data = useMemo<UnifiedPublication[] | undefined>(() => {
    if (tiktok.data === undefined && meta.data === undefined && youtube.data === undefined) return undefined;
    const unified: UnifiedPublication[] = [
      ...(tiktok.data ?? []).map((post): UnifiedPublication => ({
        id: post.publicationId,
        network: "tiktok",
        placement: "feed",
        text: post.description,
        media: post.media,
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
        state: post.state,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
        cancelledAt: post.cancelledAt,
      })),
      ...(meta.data ?? []).map((post): UnifiedPublication => ({
        id: post.publicationId,
        network: post.target,
        placement: post.placement,
        text: post.caption,
        media: post.media,
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
        state: post.state,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
        cancelledAt: post.cancelledAt,
      })),
      ...(youtube.data ?? []).map((post): UnifiedPublication => ({
        id: post.publicationId,
        network: "youtube",
        placement: "feed",
        text: post.description,
        media: post.media,
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
        state: post.state,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
        cancelledAt: post.cancelledAt,
      })),
    ];
    return unified.sort((a, b) => (b.scheduledAt ?? b.publishedAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.publishedAt ?? a.createdAt));
  }, [tiktok.data, meta.data, youtube.data]);

  const error = tiktok.error ?? meta.error ?? youtube.error;
  const isLoading = data === undefined && !error;

  async function mutate() {
    await Promise.all([tiktok.mutate(), meta.mutate(), youtube.mutate()]);
  }

  return { data, error, isLoading, mutate };
}
