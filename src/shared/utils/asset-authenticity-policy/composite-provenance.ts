import type { AuthenticityClass } from "../../../application/ports/visual-asset-provider.port.js";
import type { MediaAssetRecord } from "../../../application/ports/media-catalog.port.js";
import { classifyAuthenticity, isOfficial } from "./authenticity-classification.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 11) — classifica o `MediaAssetRecord` de
 * origem (footage) com o MESMO classificador canônico (nunca uma lógica paralela).
 */
export function classifyMediaAssetRecord(record: MediaAssetRecord, now?: Date): AuthenticityClass {
  return classifyAuthenticity({
    authenticityClassOverride: record.authenticityClassOverride,
    ingestionSource: record.ingestionSource,
    origin: record.origin,
    kind: record.type,
    tags: record.tags,
    capabilities: record.capabilities,
    approvalStatus: record.approvalStatus,
    footageClassification: record.footageClassification,
    validationDate: record.validationDate,
    indexedAt: record.indexedAt,
    now,
  });
}

/**
 * Um `ProductScreenRecord` não carrega `ingestionSource`/`capabilities` (porta separada) — o
 * único sinal genérico e confiável disponível hoje é o prefixo do `screenId`, que as pontes do
 * Company/Campaign Intelligence (`clara-bridge.ts`/`product-screen-bridge.ts`, qualquer empresa)
 * SEMPRE usam para telas realmente capturadas (`company-intel-*`/`campaign-intel-*`) — nunca um
 * ID/nome específico do Rumo ao Altar. Uma tela sem esse prefixo (seeds manuais mais antigas) é
 * tratada como não-oficial por padrão — nunca o contrário.
 */
export function classifyProductScreenById(screenId: string): AuthenticityClass {
  return screenId.startsWith("company-intel-") || screenId.startsWith("campaign-intel-") ? "official_original" : "synthetic_unverified";
}

/**
 * Seção 11 — um composite só recebe `official_derived` quando TODAS as fontes que representam o
 * produto (footage + tela) são oficiais. Caso contrário, permanece `synthetic_unverified` (nunca
 * `official_*` por composição sobre material fictício).
 */
export function classifyComposite(input: { sourceFootage: AuthenticityClass; screen: AuthenticityClass }): AuthenticityClass {
  return isOfficial(input.sourceFootage) && isOfficial(input.screen) ? "official_derived" : "synthetic_unverified";
}
