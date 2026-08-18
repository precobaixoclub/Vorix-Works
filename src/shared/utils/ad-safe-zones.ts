import type { AdLayoutZonePosition } from "./ad-layout.types.js";

/**
 * Safe zones por plataforma/formato (Fase 15) — margens (em % da largura/altura) que precisam
 * ficar livres de CTA, preço, headline ou logo porque a UI do app pode cobrir essa área (barra de
 * progresso, nome de usuário, legenda, botões de reação, controles do player).
 */

export const AD_SAFE_ZONE_PLATFORMS = ["instagram_feed", "instagram_stories", "instagram_reels", "tiktok", "facebook_feed"] as const;

export type AdSafeZonePlatform = (typeof AD_SAFE_ZONE_PLATFORMS)[number];

export type AdSafeZoneMargins = { top: number; bottom: number; left: number; right: number };

export const AD_SAFE_ZONES: Record<AdSafeZonePlatform, AdSafeZoneMargins> = {
  // Feed estático (1:1/4:5) — UI mínima sobreposta à imagem em si (like/comentário ficam FORA da
  // imagem, abaixo dela) — margem só por estética/respiro.
  instagram_feed: { top: 5, bottom: 5, left: 5, right: 5 },
  facebook_feed: { top: 5, bottom: 8, left: 5, right: 5 },
  // Vertical (9:16) — precisa de respiro maior: barra de progresso/nome de usuário no topo,
  // legenda/CTA/ícones de interação na base.
  instagram_stories: { top: 12, bottom: 20, left: 6, right: 6 },
  instagram_reels: { top: 10, bottom: 25, left: 6, right: 15 },
  tiktok: { top: 10, bottom: 22, left: 6, right: 18 },
};

function resolveDefaultMargins(): AdSafeZoneMargins {
  return { top: 8, bottom: 8, left: 5, right: 5 };
}

export function resolveSafeZoneMargins(platform: AdSafeZonePlatform | undefined): AdSafeZoneMargins {
  if (!platform) return resolveDefaultMargins();
  return AD_SAFE_ZONES[platform] ?? resolveDefaultMargins();
}

/** Verifica se uma zona (posição em % da peça) está inteiramente fora das margens inseguras. */
export function isZoneWithinSafeArea(position: AdLayoutZonePosition, platform: AdSafeZonePlatform | undefined): boolean {
  const margins = resolveSafeZoneMargins(platform);
  const zoneTop = position.yPct;
  const zoneBottom = position.yPct + position.heightPct;
  const zoneLeft = position.xPct;
  const zoneRight = position.xPct + position.widthPct;

  return zoneTop >= margins.top && zoneBottom <= 100 - margins.bottom && zoneLeft >= margins.left && zoneRight <= 100 - margins.right;
}

/** Desloca uma zona para dentro da área segura quando ela invade uma margem — clamp simples, nunca
 * redimensiona a zona, só reposiciona. */
export function clampZoneToSafeArea(position: AdLayoutZonePosition, platform: AdSafeZonePlatform | undefined): AdLayoutZonePosition {
  const margins = resolveSafeZoneMargins(platform);
  const maxLeft = 100 - margins.right - position.widthPct;
  const maxTop = 100 - margins.bottom - position.heightPct;

  return {
    ...position,
    xPct: Math.min(Math.max(position.xPct, margins.left), Math.max(margins.left, maxLeft)),
    yPct: Math.min(Math.max(position.yPct, margins.top), Math.max(margins.top, maxTop)),
  };
}
