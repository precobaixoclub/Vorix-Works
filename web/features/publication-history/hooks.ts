import { useMemo } from "react";
import useSWR from "swr";
import { listSocialPosts } from "@/features/social/api";
import { useTikTokPosts } from "@/features/tiktok/hooks";
import { useYouTubePosts } from "@/features/youtube/hooks";
import { socialPostsToPublications } from "./social-mapper";
import type { UnifiedPublication } from "./types";

/** Instagram e Facebook vêm do sistema de publicação social novo (`/v1/social/posts`), que guarda a
 * mídia, a rede e o link reais de cada destino. TikTok/YouTube seguem pelos feeds próprios. */
function useSocialFeed(workspaceId: string, enabled: boolean) {
  return useSWR(enabled ? ["social-feed", workspaceId] : null, () => listSocialPosts(workspaceId));
}

/** Junta os feeds reais de TikTok/Instagram/Facebook/YouTube numa lista só — mesma lógica que vivia
 * presa dentro de `publish/page.tsx`, agora reaproveitada pela tela de histórico. */
export function useUnifiedPublications(workspaceId: string, enabled = true) {
  const tiktok = useTikTokPosts(workspaceId, enabled);
  const social = useSocialFeed(workspaceId, enabled);
  const youtube = useYouTubePosts(workspaceId, enabled);

  const data = useMemo<UnifiedPublication[] | undefined>(() => {
    if (tiktok.data === undefined && social.data === undefined && youtube.data === undefined) return undefined;
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
      // Instagram + Facebook: uma linha por rede, com a mídia/rede/link reais do destino.
      ...socialPostsToPublications(social.data?.posts ?? [], ["instagram", "facebook"]),
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
  }, [tiktok.data, social.data, youtube.data]);

  const error = tiktok.error ?? social.error ?? youtube.error;
  const isLoading = enabled && data === undefined && !error;

  async function mutate() {
    await Promise.all([tiktok.mutate(), social.mutate(), youtube.mutate()]);
  }

  return { data, error, isLoading, mutate };
}
