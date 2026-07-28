import type { MediaAssetCapability, MediaAssetRecord, MediaAssetType } from "../../../application/ports/media-catalog.port.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 6) — ponte de compatibilidade entre `desiredKind` e o
 * `type` físico do asset. Nunca afrouxa nada: só ADICIONA candidatos que antes eram
 * silenciosamente excluídos por igualdade estrita de `type` — todo asset que já combinava
 * continua combinando. A pergunta que o resolver deveria fazer para `desiredKind = "mockup"`
 * nunca foi "este arquivo tem o formato físico de um mockup?", e sim "este material representa o
 * produto de forma apresentável?" — respondida aqui por capacidade (`MediaAssetCapability`),
 * nunca pelo tipo físico sozinho.
 */

/** Para cada `MediaAssetType` que um Shot pode pedir, quais CAPACIDADES (além do `type` físico igual) também satisfazem o pedido. Só estende `"mockup"` — os demais tipos continuam exigindo igualdade estrita, sem risco para o fluxo já validado do Intent-Based Footage Acquisition. */
const CAPABILITY_BRIDGE_BY_DESIRED_TYPE: Partial<Record<MediaAssetType, MediaAssetCapability[]>> = {
  mockup: ["product_screen", "product_demo", "interface_capture"],
};

export function isCapableOfDesiredType(asset: MediaAssetRecord, desiredType: MediaAssetType | undefined): boolean {
  if (!desiredType) return true;
  if (asset.type === desiredType) return true;

  const bridgeCapabilities = CAPABILITY_BRIDGE_BY_DESIRED_TYPE[desiredType];
  if (!bridgeCapabilities) return false;

  return (asset.capabilities ?? []).some((capability) => bridgeCapabilities.includes(capability));
}
