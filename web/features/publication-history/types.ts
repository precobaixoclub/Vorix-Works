export type PublicationNetwork = "tiktok" | "instagram" | "facebook" | "kwai";
export type PublicationPlacement = "feed" | "story";

/** Linha normalizada de publicação real — combina TikTok/Instagram/Facebook/Kwai numa lista só,
 * a mesma forma que já era montada localmente em `publish/page.tsx`, agora reaproveitável pela
 * tela de histórico e por qualquer outro lugar que precise do retrato real das publicações. */
export type UnifiedPublication = {
  id: string;
  network: PublicationNetwork;
  placement: PublicationPlacement;
  text: string;
  media: { videoUrl?: string; imageUrls: readonly string[]; thumbnailUrl?: string };
  scheduledAt?: string;
  timezone?: string;
  state: string;
  createdAt: string;
  publishedAt?: string;
  cancelledAt?: string;
};

export type PublicationDisplayStatus = "scheduled" | "published" | "failed" | "cancelled" | string;

/** Um post agendado pro futuro ainda está em `draft`/`waiting_for_approval`/`approved` no estado
 * bruto da Publication (o motor só avança pra `publishing`/`published` quando o Scheduler dispara)
 * — mostrar isso como "Rascunho" pro usuário seria enganoso, já que ele agendou de propósito.
 * Reduz pros 4 status que o usuário realmente entende. */
export function derivePublicationStatus(post: Pick<UnifiedPublication, "state" | "scheduledAt">): PublicationDisplayStatus {
  if (post.state === "published") return "published";
  if (post.state === "failed" || post.state === "unknown_outcome") return "failed";
  if (post.state === "cancelled") return "cancelled";
  if (post.scheduledAt) return "scheduled";
  return post.state;
}

export type PublicationContentType = "image" | "video" | "carousel" | "text";

export function contentTypeOf(post: Pick<UnifiedPublication, "media">): PublicationContentType {
  if (post.media.videoUrl) return "video";
  if (post.media.imageUrls.length > 1) return "carousel";
  if (post.media.imageUrls.length === 1) return "image";
  return "text";
}
