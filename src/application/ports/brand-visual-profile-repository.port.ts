import type { BrandVisualProfile } from "../../shared/utils/brand-visual-profile.types.js";

/**
 * Contrato de persistência do Brand Visual Profile (Rodada 2, Fatia 2, Prioridade 5) — 1 perfil
 * por workspace. Adapters: `InMemoryBrandVisualProfileRepository` (dev/teste) e
 * `PostgresBrandVisualProfileRepository` (produção, `db/migrations/0059_brand_visual_profiles.sql`).
 */
export type BrandVisualProfileRepositoryPort = {
  getByWorkspace(workspaceId: string): Promise<BrandVisualProfile | undefined>;
  /** Cria se não existir, substitui inteiramente se já existir (upsert) — sempre a `updatedAt` do
   * `profile` recebido; nunca faz merge parcial de campos aqui (quem decide o que preservar é o
   * chamador, ex.: o bootstrap que só cria quando ainda não existe). */
  upsert(profile: BrandVisualProfile): Promise<BrandVisualProfile>;
};
