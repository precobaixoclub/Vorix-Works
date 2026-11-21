"use client";

import { useState } from "react";
import { Bookmark, Heart, ImagePlus, MessageCircle, MoreHorizontal } from "lucide-react";
import { ChannelIcon, channelLabel } from "@/components/ChannelIcon";
import styles from "./studio.module.css";

export type StudioNetwork = "instagram" | "facebook" | "tiktok" | "youtube";
const NETWORKS: StudioNetwork[] = ["instagram", "facebook", "tiktok", "youtube"];

export function StudioPreview({ network, onNetworkChange, caption, images, videoUrl, thumbnailUrl, mediaKind, accountLabel, placement, onPlacementChange, showPlacements }: {
  network: StudioNetwork;
  onNetworkChange: (network: StudioNetwork) => void;
  caption: string;
  images: readonly string[];
  videoUrl: string;
  thumbnailUrl: string;
  mediaKind: "image" | "video";
  accountLabel: string;
  placement: "feed" | "story";
  onPlacementChange: (placement: "feed" | "story") => void;
  showPlacements: boolean;
}) {
  const [imageIndex, setImageIndex] = useState(0);
  const activeImage = Math.min(imageIndex, Math.max(0, images.length - 1));
  const vertical = network === "tiktok" || network === "youtube" || placement === "story";
  const hasMedia = mediaKind === "video" ? Boolean(videoUrl) : images.length > 0;
  const isMeta = network === "instagram" || network === "facebook";
  return (
    <section className={styles.panel} aria-label="Prévia da publicação">
      <div className={styles.previewHead}><h2 className={styles.sectionTitle}>Prévia do post</h2><span className={styles.sectionNote}>Ao vivo</span></div>
      <div className={styles.previewTabs} role="tablist" aria-label="Rede da prévia">
        {NETWORKS.map((item) => <button key={item} type="button" className={styles.previewTab} role="tab" aria-selected={network === item} aria-label={`Prévia ${channelLabel(item)}`} onClick={() => onNetworkChange(item)}><ChannelIcon channel={item} />{network === item ? <span aria-hidden>{item === "youtube" ? "Shorts" : channelLabel(item)}</span> : null}</button>)}
      </div>
      <div className={styles.previewCanvas}>
        {isMeta && showPlacements ? <div className={`${styles.segmented} mb-4`} aria-label="Formato da prévia"><button type="button" aria-pressed={placement === "feed"} onClick={() => onPlacementChange("feed")}>Feed</button><button type="button" aria-pressed={placement === "story"} onClick={() => onPlacementChange("story")}>Story</button></div> : null}
        <div className={styles.mockPost}>
          <div className={styles.mockHeader}>
            <span className={styles.avatar}>{accountLabel.slice(0, 1).toUpperCase()}</span>
            <span className={styles.mockAccount}><strong>{accountLabel}</strong><small>{channelLabel(network)}{isMeta ? ` · ${placement === "story" ? "Story" : "Feed"}` : ""}</small></span>
            <MoreHorizontal size={18} className="shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <div className={styles.mockImage} data-vertical={vertical}>
            {hasMedia ? mediaKind === "video" ? <video key={videoUrl} src={videoUrl} poster={thumbnailUrl || undefined} controls preload="metadata" playsInline aria-label="Prévia do vídeo" /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={images[activeImage]} alt={`Prévia da imagem ${activeImage + 1}`} />
            ) : <div className={styles.previewEmpty}><ImagePlus /><strong>Seu conteúdo, em destaque.</strong><p>Adicione uma imagem ou vídeo e acompanhe a prévia aqui.</p></div>}
            {mediaKind === "image" && images.length > 1 && placement !== "story" ? <span className={styles.carouselCount}>{activeImage + 1} / {images.length}</span> : null}
          </div>
          {mediaKind === "image" && images.length > 1 && placement !== "story" ? <div className={styles.dots}>{images.map((_, index) => <button type="button" key={index} aria-label={`Ver imagem ${index + 1}`} aria-pressed={activeImage === index} onClick={() => setImageIndex(index)} />)}</div> : null}
          <div className={styles.mockActions} aria-hidden><Heart /><MessageCircle /><Bookmark className="ml-auto" /></div>
          <div className={styles.mockCaption}><p>{caption || <span className="text-muted-foreground">Sua legenda aparece aqui…</span>}</p></div>
        </div>
        <p className={styles.previewFoot}>Prévia ilustrativa. A aparência pode variar na rede.</p>
      </div>
    </section>
  );
}
