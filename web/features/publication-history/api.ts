import { cancelTikTokPost } from "@/features/tiktok/api";
import { cancelYouTubePost } from "@/features/youtube/api";
import { cancelSocialPost } from "@/features/social/api";
import type { PublicationNetwork } from "./types";

/** Despacha o cancelamento pro endpoint certo conforme a rede. Instagram e Facebook agora passam
 * pelo sistema de publicação social (`/v1/social/posts/:id/cancel`), a mesma fonte da lista. */
export async function cancelUnifiedPublication(workspaceId: string, network: PublicationNetwork, publicationId: string): Promise<{ publicationId: string; state: string }> {
  if (network === "tiktok") return cancelTikTokPost(workspaceId, publicationId);
  if (network === "youtube") return cancelYouTubePost(workspaceId, publicationId);
  const post = await cancelSocialPost(workspaceId, publicationId);
  return { publicationId: post.id, state: post.state };
}
