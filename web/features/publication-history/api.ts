import { cancelTikTokPost } from "@/features/tiktok/api";
import { cancelMetaPost } from "@/features/meta/api";
import { cancelYouTubePost } from "@/features/youtube/api";
import type { PublicationNetwork } from "./types";

/** Despacha o cancelamento pro endpoint certo conforme a rede — cada rede tem sua própria rota
 * de cancelamento (o Publication engine não expõe um endpoint cross-network hoje). */
export function cancelUnifiedPublication(workspaceId: string, network: PublicationNetwork, publicationId: string): Promise<{ publicationId: string; state: string }> {
  if (network === "tiktok") return cancelTikTokPost(workspaceId, publicationId);
  if (network === "youtube") return cancelYouTubePost(workspaceId, publicationId);
  return cancelMetaPost(workspaceId, publicationId);
}
