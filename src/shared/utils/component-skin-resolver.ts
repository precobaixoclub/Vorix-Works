/**
 * Component Skins (Rodada 2, Fatia 2, Prioridade 6) — resolve qual `ComponentSkin` cada tipo de
 * zona do renderer usa, a partir do `BrandVisualProfile` do workspace. `foundation.components` já
 * guarda a escolha explícita para preço/desconto/CTA/badge (skins configuráveis diretamente);
 * as demais zonas (headline, benefícios, avaliação, prova social) derivam de `personality` —
 * nunca hardcoded para um único skin global, para que o mesmo perfil produza uma peça
 * consistente (todos os componentes "conversam" visualmente) sem exigir configuração campo a
 * campo de cada componente.
 */

import type { AdLayoutZoneType } from "./ad-layout.types.js";
import type { BrandVisualProfile, ComponentSkin } from "./brand-visual-profile.types.js";

/** Skin neutro aplicado quando não há perfil de marca disponível — idêntico ao visual que os
 * componentes já tinham antes da Prioridade 6 (nenhuma regressão para geração sem perfil). */
const DEFAULT_SKIN: ComponentSkin = "clean";

function deriveSecondarySkin(profile: BrandVisualProfile): ComponentSkin {
  const { personality } = profile;
  if (personality.sophistication === "premium") return "premium";
  if (personality.commercialAggressiveness === "aggressive" && personality.graphicDensityPreference === "dense") return "marketplace";
  if (personality.commercialAggressiveness === "aggressive") return "bold";
  if (personality.graphicDensityPreference === "minimal") return "editorial";
  return DEFAULT_SKIN;
}

/**
 * Mapa completo zona → skin. Preço/desconto/CTA/badge usam a escolha explícita do perfil
 * (`components.*Skin`, configurável); as demais zonas de texto/prova social recebem o skin
 * "secundário" derivado da personalidade — mesma família visual, sem exigir 12 campos de
 * configuração manual por workspace.
 */
export function resolveZoneSkins(profile: BrandVisualProfile | undefined): Partial<Record<AdLayoutZoneType, ComponentSkin>> {
  if (!profile) {
    return {
      price: DEFAULT_SKIN,
      discount: DEFAULT_SKIN,
      cta: DEFAULT_SKIN,
      badge: DEFAULT_SKIN,
      headline: DEFAULT_SKIN,
      benefits: DEFAULT_SKIN,
      specs: DEFAULT_SKIN,
      rating: DEFAULT_SKIN,
      salesProof: DEFAULT_SKIN,
    };
  }

  const secondary = deriveSecondarySkin(profile);
  return {
    price: profile.components.priceSkin,
    discount: profile.components.discountSkin,
    cta: profile.components.ctaSkin,
    badge: profile.components.badgeSkin,
    headline: secondary,
    benefits: secondary,
    specs: secondary,
    rating: secondary,
    salesProof: secondary,
  };
}
