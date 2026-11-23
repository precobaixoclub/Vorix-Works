import type { SocialDestinationView, SocialPostView } from "@/features/social/types";
import type { PublicationNetwork, PublicationPlacement, UnifiedPublication } from "./types";

/**
 * Converte o feed REAL do sistema de publicação social (`/v1/social/posts`) nas linhas da tela de
 * Conteúdos. Um post unificado (ex.: Instagram + Facebook de uma vez) vira UMA publicação por
 * destino/rede, com a mídia, a rede e o link reais — ao contrário do feed legado por rede, que não
 * enxergava a mídia dos posts criados pelo compositor novo (ela mora no destino, não no artefato).
 */
const FEED_NETWORKS: readonly PublicationNetwork[] = ["instagram", "facebook", "tiktok", "youtube"];

function placementOf(format: string): PublicationPlacement {
  return format.startsWith("story") ? "story" : "feed";
}

function mediaOf(destination: SocialDestinationView): UnifiedPublication["media"] {
  const video = destination.media.find((item) => item.kind === "video");
  const imageUrls = destination.media.filter((item) => item.kind === "image").map((item) => item.url);
  return {
    ...(video ? { videoUrl: video.url } : {}),
    imageUrls,
    ...(video?.coverUrl ? { thumbnailUrl: video.coverUrl } : {}),
  };
}

export function socialPostsToPublications(
  posts: readonly SocialPostView[],
  networks: readonly PublicationNetwork[] = FEED_NETWORKS,
): UnifiedPublication[] {
  const allow = new Set(networks);
  return posts.flatMap((post) =>
    post.destinations
      .filter((destination) => allow.has(destination.network))
      .map((destination): UnifiedPublication => {
        const scheduledAt = destination.scheduledAt ?? post.scheduledAt;
        const timezone = destination.timezone ?? post.timezone;
        return {
          // Id do post (plano) — o mesmo que cancelar/publicar-de-novo usam.
          id: post.id,
          source: "social",
          network: destination.network,
          placement: placementOf(destination.format),
          text: destination.caption,
          media: mediaOf(destination),
          ...(scheduledAt ? { scheduledAt } : {}),
          ...(timezone ? { timezone } : {}),
          // O status unificado (derivePublicationStatus) lê o estado em minúsculas.
          state: destination.state.toLowerCase(),
          createdAt: post.createdAt,
          ...(destination.publishedAt ? { publishedAt: destination.publishedAt } : {}),
          ...(destination.externalUrl ? { externalUrl: destination.externalUrl } : {}),
        };
      }),
  );
}

/** Social destinations contain the actual media; legacy plan summaries can contain only text. */
export function mergePublicationFeeds(legacy: readonly UnifiedPublication[], social: readonly UnifiedPublication[]): UnifiedPublication[] {
  const key = (post: UnifiedPublication) => `${post.network}:${post.id}`;
  const socialKeys = new Set(social.map(key));
  return [...social, ...legacy.filter(post => !socialKeys.has(key(post)))]
    .sort((a, b) => (b.scheduledAt ?? b.publishedAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.publishedAt ?? a.createdAt));
}
