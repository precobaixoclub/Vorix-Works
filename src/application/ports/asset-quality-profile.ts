/**
 * ASSET DIVERSITY GATE — perfis de qualidade de resolução de assets visuais, consumidos por
 * `VisualAssetResolverPort`/`VisualAssetResolver` e por Rafa (Skill `rafa-video-rendering`) para
 * decidir o quão rigorosa a seleção de assets precisa ser antes de uma renderização ser
 * considerada pronta. `src/application/ports` não é uma Skill — importar daqui não viola o
 * isolamento entre Skills (ADR 0002).
 *
 * - `draft`: permite reuso amplo, aceita fundo procedural, nunca bloqueia por ausência de vídeo.
 *   Destinado apenas a testes técnicos e demonstrações rápidas.
 * - `standard`: limita repetição e exige variedade mínima, mas pode concluir com warnings —
 *   nunca pausa a renderização.
 * - `premium`: não permite concluir com diversidade visual insuficiente. Quando a biblioteca não
 *   atende aos requisitos mínimos, entra em Developer Assisted Mode em vez de renderizar.
 */
export const ASSET_QUALITY_PROFILES = ["draft", "standard", "premium"] as const;

export type AssetQualityProfile = (typeof ASSET_QUALITY_PROFILES)[number];

export function isAssetQualityProfile(value: unknown): value is AssetQualityProfile {
  return typeof value === "string" && (ASSET_QUALITY_PROFILES as readonly string[]).includes(value);
}

/**
 * Requisitos mínimos de diversidade visual, avaliados pelo Asset Diversity Gate (ver
 * `src/infrastructure/visual-assets/asset-diversity-gate.ts`) depois que todos os Shots de uma
 * execução já foram resolvidos, mas antes da renderização começar. Todos os valores são
 * configuráveis — os defaults por perfil (`DEFAULT_ASSET_DIVERSITY_REQUIREMENTS`) refletem os
 * requisitos mínimos premium pedidos para Reels/vídeos de 20 a 30 segundos (15 a 20 Shots).
 */
export type AssetDiversityRequirements = {
  /** Mínimo de arquivos físicos distintos (nunca IDs distintos — ver normalização por caminho físico). */
  minDistinctPhysicalFiles: number;
  /** Nenhum arquivo físico pode ocupar mais do que esta fração dos Shots (0 a 1). */
  maxAssetUsageRatio: number;
  /** Máximo de Shots consecutivos com o mesmo arquivo físico — mesmo dentro de um continuityGroup. */
  maxConsecutiveSameAsset: number;
  /** Fração mínima de Shots que precisam ser vídeo/b-roll real (nunca mockup animado ou zoom sobre foto). */
  minVideoRatio: number;
  /** Mínimo de Shots cujo asset físico tem sinal humano real (pessoa/casal/contexto humano). */
  minHumanAssets: number;
  /** Mínimo de Shots cujo asset físico tem sinal de produto real (mockup/interface/screenshot). */
  minProductAssets: number;
  /** Mínimo de Shots cujo asset físico tem sinal de contexto (foto-contexto/contexto-humano). */
  minContextAssets: number;
  /** Mínimo de Shots com asset específico para end card (cta/logo/marca/url). */
  minEndCardAssets: number;
  /** Máximo de Shots com requisito estrito (humano/produto/mockup/screenshot) que ainda ficaram sem asset compatível. */
  maxUnresolvedStrictShots: number;
  /**
   * PRODUCTION READINESS — nota mínima aceitável (0 a 1) do Production Readiness Score calculado
   * por `src/shared/utils/production-readiness.ts` antes de uma renderização ser autorizada. É uma
   * média geométrica ponderada pelo elo mais fraco entre as coberturas nomeadas (visual, humana,
   * produto, emocional, vídeo, diversidade de cena, variedade de asset) — propositalmente mais dura
   * que uma média aritmética, para que uma única cobertura crítica fraca (ex.: 0% de vídeo real)
   * derrube a nota mesmo com todas as outras coberturas altas.
   */
  minProductionReadiness: number;
  /** Quando true, falhar qualquer requisito acima bloqueia a renderização (WAITING_ASSISTED_GENERATION). Quando false, apenas gera warnings. */
  blocksOnFailure: boolean;
};

export const DEFAULT_ASSET_DIVERSITY_REQUIREMENTS: Record<AssetQualityProfile, AssetDiversityRequirements> = {
  draft: {
    minDistinctPhysicalFiles: 0,
    maxAssetUsageRatio: 1,
    maxConsecutiveSameAsset: Number.POSITIVE_INFINITY,
    minVideoRatio: 0,
    minHumanAssets: 0,
    minProductAssets: 0,
    minContextAssets: 0,
    minEndCardAssets: 0,
    maxUnresolvedStrictShots: Number.POSITIVE_INFINITY,
    minProductionReadiness: 0,
    blocksOnFailure: false,
  },
  standard: {
    minDistinctPhysicalFiles: 6,
    maxAssetUsageRatio: 0.40,
    maxConsecutiveSameAsset: 3,
    minVideoRatio: 0,
    minHumanAssets: 1,
    minProductAssets: 1,
    minContextAssets: 0,
    minEndCardAssets: 1,
    maxUnresolvedStrictShots: Number.POSITIVE_INFINITY,
    minProductionReadiness: 0.45,
    blocksOnFailure: false,
  },
  premium: {
    minDistinctPhysicalFiles: 12,
    maxAssetUsageRatio: 0.20,
    maxConsecutiveSameAsset: 2,
    minVideoRatio: 0.40,
    minHumanAssets: 3,
    minProductAssets: 3,
    minContextAssets: 2,
    minEndCardAssets: 1,
    maxUnresolvedStrictShots: 0,
    minProductionReadiness: 0.70,
    blocksOnFailure: true,
  },
};
