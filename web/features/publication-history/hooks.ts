import { useMemo } from "react";
import useSWR from "swr";
import { listSocialPosts } from "@/features/social/api";
import { useTikTokPosts } from "@/features/tiktok/hooks";
import { useYouTubePosts } from "@/features/youtube/hooks";
import { mergePublicationFeeds, socialPostsToPublications } from "./social-mapper";
import type { UnifiedPublication } from "./types";

/** All four networks may have posts in the social composer with media stored on destinations. */
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
    // Wait for the feeds to settle: applying a source query too early used the empty legacy
    // summary, then never reapplied the real video when the social feed arrived.
    if ([tiktok, social, youtube].some(feed => feed.data === undefined && !feed.error)) return undefined;
    const legacy: UnifiedPublication[] = [
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
    return mergePublicationFeeds(legacy, socialPostsToPublications(social.data?.posts ?? []));
  }, [tiktok.data, tiktok.error, social.data, social.error, youtube.data, youtube.error]);

  const error = tiktok.error ?? social.error ?? youtube.error;
  const isLoading = enabled && data === undefined && !error;

  async function mutate() {
    await Promise.all([tiktok.mutate(), social.mutate(), youtube.mutate()]);
  }

  return { data, error, isLoading, mutate };
}
