import type { ShotAuthenticityRole, VisualAssetSearchQuery } from "../../../application/ports/visual-asset-provider.port.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seções 3, 5, 6) — deriva o papel de autenticidade
 * do Shot a partir dos MESMOS campos estruturados que a query já carrega (nunca um campo novo que
 * as Skills precisariam preencher) — `productRequirement`/`mockupRequirement`/
 * `screenshotRequirement` (seção 5: product_screen/product_demo/interface_capture/
 * product_interaction) e tags de marca (seção 5: official_logo/official_identity) mapeiam para
 * `"product"`/`"brand_identity"` (Hard Authenticity Constraint se aplica); `humanRequirement`
 * sozinho, ou nenhum requisito estruturado, mapeia para `"human_emotional"`/`"neutral"` (ranking
 * criativo normal, seção 6 — autenticidade nunca domina aqui).
 */

const BRAND_IDENTITY_TAG_HINTS = ["logo", "logo-oficial", "marca", "identidade-visual", "end-card", "cta"];

export function deriveShotAuthenticityRole(query: VisualAssetSearchQuery): ShotAuthenticityRole {
  const normalizedTags = query.requiredTags.map((tag) => tag.toLowerCase());

  const hasBrandTag = normalizedTags.some((tag) => BRAND_IDENTITY_TAG_HINTS.includes(tag));
  if (hasBrandTag) return "brand_identity";

  const hasProductRequirement = Boolean(query.productRequirement || query.mockupRequirement || query.screenshotRequirement);
  if (hasProductRequirement) return "product";

  if (query.humanRequirement) return "human_emotional";

  // Sem nenhum requisito estruturado: Shots de "establishing"/"closing"/contexto puro (ver
  // VisualSequenceRole) são tratados como humanos/ambientais por padrão — nunca aplicam a Hard
  // Authenticity Constraint sem evidência explícita de que o Shot representa o produto.
  if (query.shotPurpose === "establishing" || query.shotPurpose === "closing" || query.shotPurpose === "reaction" || query.shotPurpose === "human_interaction") {
    return "human_emotional";
  }

  return "neutral";
}

export function appliesHardAuthenticityConstraint(role: ShotAuthenticityRole): boolean {
  return role === "product" || role === "brand_identity";
}
