import type { MediaAssetCapability, MediaAssetIngestionSource, MediaAssetType } from "../../../application/ports/media-catalog.port.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 5) — infere capacidades criativas de um asset a
 * partir de sinais reais (origem de ingestão + tags + tipo físico), nunca de um palpite. Mesmo
 * espírito determinístico de `visual-asset-tag-signals.ts` (busca por palavra-chave, documentado
 * como heurística, nunca semântica real) — reaproveita esse mesmo vocabulário de tags quando
 * possível, para não criar um segundo dicionário de sinônimos.
 */

const PRODUCT_SCREEN_HINTS = ["rsvp", "pix", "presente", "album", "álbum", "mesa", "acoes", "ações", "checkin", "check-in", "site", "interface", "screenshot", "tela", "produto-real"];
const LOGO_HINTS = ["logo", "marca", "identidade-visual"];
const END_CARD_HINTS = ["end-card", "cta", "url", "logo-oficial"];
const HUMAN_CONTEXT_HINTS = ["pessoa", "casal", "noivos", "contexto-humano", "foto-contexto"];
const BACKGROUND_HINTS = ["background", "ambiente", "cenario", "cenário"];

function hasAny(haystack: string, hints: string[]): boolean {
  return hints.some((hint) => haystack.includes(hint));
}

export function inferCapabilities(input: {
  ingestionSource?: MediaAssetIngestionSource;
  tags: string[];
  type: MediaAssetType;
}): MediaAssetCapability[] {
  const haystack = input.tags.join(" ").toLowerCase();
  const capabilities = new Set<MediaAssetCapability>();

  const isOfficialCapture = input.ingestionSource === "company_intelligence" || input.ingestionSource === "campaign_intelligence" || input.ingestionSource === "product_screen_catalog";

  if (isOfficialCapture || hasAny(haystack, PRODUCT_SCREEN_HINTS)) {
    capabilities.add("product_screen");
    capabilities.add("interface_capture");
    capabilities.add("compositing_source");
    if (input.type === "video") {
      capabilities.add("product_demo");
      capabilities.add("device_interaction");
    }
  }

  if (hasAny(haystack, LOGO_HINTS) || input.type === "logo") capabilities.add("logo");
  if (hasAny(haystack, END_CARD_HINTS)) capabilities.add("end_card");
  if (hasAny(haystack, HUMAN_CONTEXT_HINTS)) capabilities.add("human_context");
  if (hasAny(haystack, BACKGROUND_HINTS)) capabilities.add("background");

  return Array.from(capabilities);
}
