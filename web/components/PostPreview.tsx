export type PostPreviewNetwork = "tiktok" | "instagram" | "facebook" | "kwai";
export type PostPreviewPlacement = "feed" | "story";

export type PostPreviewProps = {
  network: PostPreviewNetwork;
  placement: PostPreviewPlacement;
  caption: string;
  mediaKind: "image" | "video";
  imageUrls: readonly string[];
  videoUrl?: string;
  thumbnailUrl?: string;
  autoAddMusic?: boolean;
  accountLabel?: string;
};

const NETWORK_LABEL: Record<PostPreviewNetwork, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", kwai: "Kwai" };

/**
 * Mockup compacto de como o post vai aparecer na rede escolhida — nunca pixel-perfect (não é o
 * objetivo), só o suficiente pra tirar a "caixa preta" de agendar sem saber o resultado. Feed
 * (Instagram/Facebook) vira um quadrado com cabeçalho de conta; Story e TikTok/Kwai viram um
 * frame vertical 9:16, já que os três sempre ocupam a tela inteira do app de origem.
 */
export function PostPreview({ network, placement, caption, mediaKind, imageUrls, videoUrl, thumbnailUrl, autoAddMusic, accountLabel }: PostPreviewProps) {
  const isShortVideoNetwork = network === "tiktok" || network === "kwai";
  const isVertical = placement === "story" || isShortVideoNetwork;
  const cover = mediaKind === "video" ? thumbnailUrl : imageUrls[0];
  const extraImages = mediaKind === "image" ? Math.max(0, imageUrls.length - 1) : 0;
  const label = accountLabel ?? "sua_marca";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative mx-auto w-full max-w-[200px] overflow-hidden rounded-2xl border-4 border-black bg-black ${isVertical ? "aspect-[9/16]" : "aspect-square"}`}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-3xl text-white/40">
            {mediaKind === "video" || videoUrl ? "🎬" : "🖼"}
          </div>
        )}

        {mediaKind === "video" && !isShortVideoNetwork ? (
          <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">▶ Vídeo</span>
        ) : null}
        {extraImages > 0 ? (
          <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">+{extraImages}</span>
        ) : null}

        {!isVertical ? (
          <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/50 to-transparent px-2 py-1.5 text-[10px] font-medium text-white">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">{network === "instagram" ? "📷" : "👍"}</span>
            {label}
          </div>
        ) : null}

        {placement === "story" && !isShortVideoNetwork ? (
          <div className="absolute inset-x-2 top-1.5 flex gap-1">
            <span className="h-0.5 flex-1 rounded-full bg-white/80" />
          </div>
        ) : null}

        {isShortVideoNetwork ? (
          <>
            <div className="absolute bottom-14 right-1.5 flex flex-col items-center gap-3 text-white drop-shadow">
              <span className="text-lg">❤️</span>
              <span className="text-lg">💬</span>
              <span className="text-lg">↗️</span>
              <span className={`text-lg ${autoAddMusic === false ? "opacity-30" : ""}`}>🎵</span>
            </div>
            {caption ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2.5 pt-8 text-[11px] leading-snug text-white">
                <p className="font-semibold">@{label}</p>
                <p className="line-clamp-2">{caption}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {!isVertical && caption ? (
        <p className="line-clamp-2 w-full max-w-[200px] text-center text-xs text-ink-muted">
          <span className="font-medium text-ink">{label}</span> {caption}
        </p>
      ) : null}
      <p className="text-[11px] font-medium text-ink-muted">
        {NETWORK_LABEL[network]} · {placement === "story" ? "Story" : "Feed"}
      </p>
    </div>
  );
}
