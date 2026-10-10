import type { AssetLibraryRepositoryPort } from "../ports/asset-library-repository.port.js";
import type { BrandVisualProfileRepositoryPort } from "../ports/brand-visual-profile-repository.port.js";
import { buildConservativeDefaultProfile, type BrandVisualProfile } from "../../shared/utils/brand-visual-profile.types.js";
import {
  commitBrandIdentity,
  describeColor,
  isEmptyBrandIdentity,
  validateBrandIdentityInput,
  type AppliedBrandRule,
  type BrandColor,
  type BrandColorRole,
  type BrandIdentity,
  type CreativeBrandIdentity,
} from "../../shared/utils/brand-identity.js";

/** Tipos de asset da biblioteca que podem ser uma versão de logo (imagem real fornecida). */
const LOGO_ELIGIBLE_KINDS = new Set(["logo", "visual_identity", "photo", "reference"]);

export type BrandIdentityServiceDeps = {
  brandVisualProfileRepository: BrandVisualProfileRepositoryPort;
  assetLibraryRepository: AssetLibraryRepositoryPort;
  /** URL pública de um objeto do storage do próprio Vorix (nunca URL arbitrária). */
  resolveAssetUrl(objectKey: string): string;
  /** Paleta dominante de uma imagem (determinística, sem IA) — usada só para SUGESTÃO. */
  extractPalette?(assetObjectKey: string): Promise<{ hex: string; share: number }[]>;
  now?(): string;
};

export type BrandIdentityView = { profileId?: string; identity: BrandIdentity | null };

export type SaveBrandIdentityResult =
  | { ok: true; view: BrandIdentityView }
  | { ok: false; kind: "invalid"; errors: string[] }
  | { ok: false; kind: "asset_not_found"; errors: string[] };

export type BrandColorSuggestion = BrandColor & { status: "SUGGESTION"; share: number; reason: string };

/**
 * Brand Identity por workspace. A rota HTTP já garantiu que o workspace pertence ao tenant do
 * principal; aqui toda logo é conferida contra a Asset Library DO MESMO workspace (asset de outro
 * workspace/tenant = "não encontrado", nunca aceito).
 */
export class BrandIdentityService {
  constructor(private readonly deps: BrandIdentityServiceDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  async get(workspaceId: string): Promise<BrandIdentityView> {
    const profile = await this.deps.brandVisualProfileRepository.getByWorkspace(workspaceId);
    return { ...(profile?.id ? { profileId: profile.id } : {}), identity: profile?.identity ?? null };
  }

  private async libraryAssets(workspaceId: string): Promise<Map<string, { kind: string; status: string; objectKey?: string; name: string }>> {
    const library = await this.deps.assetLibraryRepository.getLibraryByWorkspace(workspaceId);
    if (!library) return new Map();
    const assets = await this.deps.assetLibraryRepository.listAssets(library.id);
    return new Map(assets.map((asset) => [asset.id, { kind: asset.kind, status: asset.status, objectKey: asset.storageRef?.objectKey, name: asset.name }]));
  }

  async save(workspaceId: string, raw: unknown): Promise<SaveBrandIdentityResult> {
    const validated = validateBrandIdentityInput(raw);
    if (!validated.ok) return { ok: false, kind: "invalid", errors: validated.errors };
    if (validated.identity.logos.length > 0) {
      const assets = await this.libraryAssets(workspaceId);
      const missing = validated.identity.logos.filter((logo) => {
        const asset = assets.get(logo.assetId);
        return !asset || asset.status !== "active" || !asset.objectKey || !LOGO_ELIGIBLE_KINDS.has(asset.kind);
      });
      if (missing.length > 0) return { ok: false, kind: "asset_not_found", errors: missing.map((logo) => `logo ${logo.assetId}: asset não encontrado na biblioteca deste workspace`) };
    }
    const now = this.now();
    const existing = await this.deps.brandVisualProfileRepository.getByWorkspace(workspaceId);
    const base: BrandVisualProfile = existing ?? buildConservativeDefaultProfile(workspaceId, now);
    const identity = commitBrandIdentity(validated.identity, existing?.identity, now);
    const saved = await this.deps.brandVisualProfileRepository.upsert({ ...base, identity, updatedAt: now });
    return { ok: true, view: { ...(saved.id ? { profileId: saved.id } : {}), identity: saved.identity ?? identity } };
  }

  /**
   * Identidade pronta para uma execução: logos resolvidas para URL do storage do próprio workspace;
   * logo arquivada/removida depois de configurada é descartada (registrado em `skipped`).
   * `undefined` = workspace sem identidade estruturada → motor em SYSTEM_DEFAULT.
   */
  async resolveForCreative(workspaceId: string): Promise<{ brand: CreativeBrandIdentity; skipped: AppliedBrandRule[] } | undefined> {
    const profile = await this.deps.brandVisualProfileRepository.getByWorkspace(workspaceId);
    const identity = profile?.identity;
    // Identidade vazia (limpa pelo usuário) = SYSTEM_DEFAULT: motor exatamente como sem perfil.
    if (!profile || !identity || isEmptyBrandIdentity(identity)) return undefined;
    const assets = identity.logos.length > 0 ? await this.libraryAssets(workspaceId) : new Map();
    const skipped: AppliedBrandRule[] = [];
    const logos: CreativeBrandIdentity["logos"] = [];
    for (const logo of identity.logos) {
      const asset = assets.get(logo.assetId);
      if (!asset || asset.status !== "active" || !asset.objectKey) {
        skipped.push({ code: "LOGO_VARIANT_UNAVAILABLE", detail: `logo ${logo.variant} (${logo.assetId}) não está mais ativa na biblioteca`, outcome: "SKIPPED" });
        continue;
      }
      try {
        logos.push({ ...logo, url: this.deps.resolveAssetUrl(asset.objectKey) });
      } catch {
        skipped.push({ code: "LOGO_VARIANT_UNAVAILABLE", detail: `logo ${logo.variant} (${logo.assetId}) sem URL resolvível`, outcome: "SKIPPED" });
      }
    }
    return { brand: { profileId: profile.id ?? `brand-profile:${workspaceId}`, workspaceId, version: identity.version, updatedAt: identity.updatedAt, identity, logos }, skipped };
  }

  /**
   * Sugestão de cores a partir de uma logo da biblioteca do workspace — determinística (pixels),
   * nunca gravada: o usuário revisa e salva conscientemente. Não lê texto da logo (nenhum OCR).
   */
  async suggestFromLogo(workspaceId: string, assetId: string): Promise<{ ok: true; suggestions: BrandColorSuggestion[] } | { ok: false }> {
    const assets = await this.libraryAssets(workspaceId);
    const asset = assets.get(assetId);
    if (!asset || asset.status !== "active" || !asset.objectKey || !this.deps.extractPalette) return { ok: false };
    const palette = await this.deps.extractPalette(asset.objectKey);
    const suggestions: BrandColorSuggestion[] = [];
    for (const [index, swatch] of palette.slice(0, 4).entries()) {
      const name = describeColor(swatch.hex);
      const neutral = name.pt === "branco" || name.pt === "preto" || name.pt.startsWith("cinza") || name.pt === "grafite";
      const role: BrandColorRole = neutral ? "NEUTRAL" : index === 0 || suggestions.every((item) => item.role !== "PRIMARY") ? "PRIMARY" : "ACCENT";
      suggestions.push({ hex: swatch.hex, role, name: name.pt, provenance: "ASSET_EXTRACTED", status: "SUGGESTION", share: Number(swatch.share.toFixed(3)), reason: `cor presente em ${Math.round(swatch.share * 100)}% dos pixels visíveis da logo "${asset.name}"` });
    }
    return { ok: true, suggestions };
  }
}
