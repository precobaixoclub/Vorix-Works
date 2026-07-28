import { createHash } from "node:crypto";
import type { AssetResolutionMetadata } from "../../../application/ports/visual-asset-provider.port.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 13) — hash determinístico e barato do
 * estado relevante do catálogo (id+hash+approvalStatus de cada asset), usado só para DETECTAR
 * mudança, nunca para identificar o conteúdo em si. Qualquer aprovação/rejeição/nova validação
 * muda o hash; reordenar a mesma lista não muda (ordenado antes de hashear).
 */
export function computeCatalogFingerprint(assets: Array<{ id: string; hash?: string; approvalStatus?: string; validationDate?: string }>): string {
  const rows = assets
    .map((asset) => `${asset.id}:${asset.hash ?? ""}:${asset.approvalStatus ?? ""}:${asset.validationDate ?? ""}`)
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
}

export function buildResolutionMetadata(input: { catalogHash: string; rankingPolicyVersion: string; validatorVersion: string; now?: Date }): AssetResolutionMetadata {
  return {
    catalogHash: input.catalogHash,
    rankingPolicyVersion: input.rankingPolicyVersion,
    validatorVersion: input.validatorVersion,
    resolvedAt: (input.now ?? new Date()).toISOString(),
  };
}

export type StalenessCheck = { stale: true; reasons: string[] } | { stale: false };

/** `ASSET_RESOLUTION_STALE` (seção 13) — nunca refaz sozinho, só informa. */
export function checkResolutionStaleness(
  persisted: AssetResolutionMetadata | undefined,
  current: { catalogHash: string; rankingPolicyVersion: string; validatorVersion: string },
): StalenessCheck {
  if (!persisted) return { stale: false };
  const reasons: string[] = [];
  if (persisted.catalogHash !== current.catalogHash) reasons.push(`Catálogo mudou desde a resolução (hash ${persisted.catalogHash} → ${current.catalogHash}).`);
  if (persisted.rankingPolicyVersion !== current.rankingPolicyVersion) reasons.push(`Política de ranking mudou (${persisted.rankingPolicyVersion} → ${current.rankingPolicyVersion}).`);
  if (persisted.validatorVersion !== current.validatorVersion) reasons.push(`Visual Candidate Validator mudou de versão (${persisted.validatorVersion} → ${current.validatorVersion}).`);
  return reasons.length > 0 ? { stale: true, reasons } : { stale: false };
}
