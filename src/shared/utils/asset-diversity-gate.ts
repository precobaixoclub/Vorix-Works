import type {
  VisualAssetCreationPackage,
  VisualAssetKind,
  VisualAssetMetadata,
  VisualAssetResolved,
  VisualAssetSearchQuery,
  VisualSequenceRole,
} from "../../application/ports/visual-asset-provider.port.js";
import {
  DEFAULT_ASSET_DIVERSITY_REQUIREMENTS,
  type AssetDiversityRequirements,
  type AssetQualityProfile,
} from "../../application/ports/asset-quality-profile.js";
import { CONTEXT_TAG_SIGNAL, END_CARD_TAG_SIGNAL, HUMAN_TAG_SIGNAL, PRODUCT_TAG_SIGNAL } from "./visual-asset-tag-signals.js";
import { isProceduralFootage } from "../../application/ports/media-catalog.port.js";

/**
 * ASSET DIVERSITY GATE — módulo puro e determinístico (nenhum I/O), vive em `src/shared/utils`
 * (não é uma Skill nem infraestrutura — mesmo espírito de `cinematic-reference-library.ts` e
 * `creative-director-engine.ts`, importado diretamente pelas Skills sem violar ADR 0002) que
 * calcula a diversidade visual real de uma execução (a partir dos `VisualAssetResolved[]` já
 * devolvidos pelo `VisualAssetResolverPort`) e decide se ela é suficiente para o perfil de
 * qualidade pedido. Chamado por Rafa ANTES de renderizar — nunca pelo compilador FFmpeg nem pelo
 * SHOT RENDER ENGINE, que continuam desconhecendo por completo a existência deste gate.
 *
 * A causa raiz do problema que este módulo resolve: `VisualAssetResolver` já garantia que cada
 * Shot individualmente recebesse *algum* asset (inclusive via `shot_reuse_fallback`), mas nunca
 * validava a composição do vídeo INTEIRO — 20 Shots podiam convergir silenciosamente para 5
 * arquivos físicos reciclados, 0 vídeos reais e nenhuma cena de contexto humano, sem que o
 * workflow jamais pausasse. Este módulo fecha essa lacuna sem alterar o algoritmo de scoring do
 * resolver nem a lógica de renderização.
 */

export type AssetDiversityMetrics = {
  totalShots: number;
  distinctAssetIds: number;
  /** Métrica oficial de diversidade — arquivos físicos distintos (caminho normalizado), nunca `asset.id` (ver `physicalKeyForAsset`). */
  distinctPhysicalFiles: number;
  physicalFileHashes: string[];
  /** Fração dos Shots cujo arquivo físico já havia sido usado em outro Shot (0 a 1). */
  reuseRatio: number;
  maxUsagePerPhysicalFile: number;
  /** Shots consecutivos com o mesmo arquivo físico e SEM `continuityGroup` compartilhado — nunca reuso intencional. */
  consecutiveReuseViolations: number;
  /** Maior sequência de Shots consecutivos com o mesmo arquivo físico DENTRO de um `continuityGroup` compartilhado. */
  longestContinuityRun: number;
  /** Fração dos Shots que são vídeo/b-roll real (nunca mockup animado nem zoom sobre fotografia). */
  videoRatio: number;
  physicalVideoCount: number;
  physicalBrollCount: number;
  animatedPhotoCount: number;
  mockupCount: number;
  photosUsed: number;
  humanAssetCount: number;
  productAssetCount: number;
  contextAssetCount: number;
  endCardAssetCount: number;
  /** Shots com requisito estrito (humano/produto/mockup/screenshot) que ainda assim saíram com um asset reutilizado/fallback. */
  unresolvedStrictShots: number;
};

export type FlaggedShotReason =
  | "over_used_asset"
  | "consecutive_reuse"
  | "insufficient_video"
  | "insufficient_human"
  | "insufficient_product"
  | "insufficient_context"
  | "insufficient_end_card"
  | "unresolved_strict"
  // PRODUCTION READINESS (src/shared/utils/production-readiness.ts) — motivos adicionais gerados
  // pelas regras de diversidade mais estritas do Production Plan (zero tolerância, sem exceção de
  // continuityGroup), reaproveitando este mesmo tipo para poder reusar `buildAssistedPackagesForFlaggedShots`.
  | "same_asset_consecutive"
  | "same_couple_reused"
  | "same_framing_consecutive"
  | "same_composition_consecutive_scene"
  | "same_mockup_reused";

export type FlaggedShot = {
  shotId: string;
  sceneOrder: number;
  shotOrder?: number;
  shotPurpose?: VisualSequenceRole;
  reason: FlaggedShotReason;
  reasonMessage: string;
  rejectedAssetId?: string;
  entry: VisualAssetResolved;
};

export type AssetDiversityGateResult = {
  qualityProfile: AssetQualityProfile;
  requirements: AssetDiversityRequirements;
  metrics: AssetDiversityMetrics;
  /** `true` quando não há falha nenhuma, OU quando há falhas mas o perfil não bloqueia (`requirements.blocksOnFailure === false`). */
  passed: boolean;
  failures: string[];
  flaggedShots: FlaggedShot[];
};

/**
 * Chave física oficial de um caminho de arquivo — SEMPRE o caminho absoluto normalizado
 * (minúsculas, barras unificadas). Usada tanto por `physicalKeyForAsset` (a partir de um
 * `VisualAssetMetadata` completo) quanto pelo adaptador de renderização (que só tem o
 * `absolutePath` cru de `VideoRenderAsset`, sem o restante do metadata) — para que as duas
 * pontas nunca divirjam sobre o que conta como "o mesmo arquivo físico".
 */
export function physicalKeyForAssetPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Chave física oficial de um asset — SEMPRE o caminho absoluto normalizado (minúsculas, barras
 * unificadas), nunca `asset.id`. IDs diferentes apontando para o mesmo arquivo (ex.: um bug de
 * autoria manual do manifesto) nunca inflam a contagem de diversidade real.
 */
export function physicalKeyForAsset(asset: VisualAssetMetadata): string {
  return physicalKeyForAssetPath(asset.absolutePath);
}

function isRealVideoKind(kind: VisualAssetKind): boolean {
  return kind === "video" || kind === "b_roll";
}

/**
 * MEDIA INTELLIGENCE ENGINE (seção 7) — um `kind` de vídeo/b-roll só conta como filmagem real
 * quando NÃO existe classificação de filmagem explícita marcando-o como procedural
 * (`procedural_background`/`motion_graphics`/`animated_still`/`mockup_animation`). Quando o
 * catálogo não anexou classificação nenhuma (candidato de um provider legado, ex.: biblioteca
 * local sem passar pelo Media Intelligence Engine), o comportamento anterior é preservado
 * integralmente — só `kind` decide, como sempre decidiu.
 */
function isRealVideoAsset(asset: VisualAssetMetadata): boolean {
  if (!isRealVideoKind(asset.kind)) return false;
  return !isProceduralFootage(asset.footageClassification);
}

function normalizedAssetText(asset: VisualAssetMetadata): string {
  return [asset.theme, asset.emotion, asset.kind, ...asset.tags]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function hasTagSignal(asset: VisualAssetMetadata, signals: string[]): boolean {
  const text = normalizedAssetText(asset);
  return signals.some((signal) => text.includes(signal));
}

function isStrictQuery(query: VisualAssetSearchQuery): boolean {
  return Boolean(
    query.productRequirement?.strict
    || query.humanRequirement?.strict
    || query.mockupRequirement?.strict
    || query.screenshotRequirement?.strict,
  );
}

/** `true` quando o Shot recebeu o asset via reuso forçado (dedupe exaurido) ou fallback abaixo da nota mínima — nunca uma seleção genuína e única. */
function isReuseSelection(entry: VisualAssetResolved): boolean {
  const reason = entry.selectionReason ?? "";
  return reason.startsWith("shot_reuse") || Boolean(entry.reusedFromShotId);
}

/** Só entradas em modo Shot (`shotId` presente) participam do Diversity Gate — o modo cena legado nunca pediu 15-20 Shots por vídeo. */
function shotEntriesOf(resolved: VisualAssetResolved[]): Array<VisualAssetResolved & { shotId: string }> {
  return resolved.filter((entry): entry is VisualAssetResolved & { shotId: string } => typeof entry.shotId === "string" && entry.shotId.length > 0);
}

export function computeAssetDiversityMetrics(resolved: VisualAssetResolved[]): AssetDiversityMetrics {
  const shots = shotEntriesOf(resolved);
  const totalShots = shots.length;

  const distinctAssetIds = new Set(shots.map((entry) => entry.asset.id)).size;
  const physicalKeys = shots.map((entry) => physicalKeyForAsset(entry.asset));
  const distinctPhysicalKeys = new Set(physicalKeys);
  const distinctPhysicalFiles = distinctPhysicalKeys.size;

  const usageByPhysicalKey = new Map<string, number>();
  for (const key of physicalKeys) usageByPhysicalKey.set(key, (usageByPhysicalKey.get(key) ?? 0) + 1);
  const maxUsagePerPhysicalFile = usageByPhysicalKey.size > 0 ? Math.max(...usageByPhysicalKey.values()) : 0;
  const reuseRatio = totalShots > 0 ? (totalShots - distinctPhysicalFiles) / totalShots : 0;

  const ordered = [...shots].sort((a, b) => (a.sceneOrder - b.sceneOrder) || ((a.shotOrder ?? 0) - (b.shotOrder ?? 0)));
  let consecutiveReuseViolations = 0;
  let longestContinuityRun = ordered.length > 0 ? 1 : 0;
  let currentContinuityRun = 1;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const samePhysicalFile = physicalKeyForAsset(previous.asset) === physicalKeyForAsset(current.asset);
    if (!samePhysicalFile) {
      currentContinuityRun = 1;
      continue;
    }
    const sharesContinuityGroup = Boolean(current.continuityGroup) && current.continuityGroup === previous.continuityGroup;
    if (!sharesContinuityGroup) {
      consecutiveReuseViolations += 1;
      currentContinuityRun = 1;
      continue;
    }
    currentContinuityRun += 1;
    longestContinuityRun = Math.max(longestContinuityRun, currentContinuityRun);
  }

  const physicalVideoCount = shots.filter((entry) => entry.asset.kind === "video" && isRealVideoAsset(entry.asset)).length;
  const physicalBrollCount = shots.filter((entry) => entry.asset.kind === "b_roll" && isRealVideoAsset(entry.asset)).length;
  const animatedPhotoCount = shots.filter((entry) => entry.asset.kind === "cinemagraph").length;
  const mockupCount = shots.filter((entry) => entry.asset.kind === "mockup").length;
  const photosUsed = shots.filter((entry) => entry.asset.kind === "photo").length;
  const videoRatio = totalShots > 0 ? (physicalVideoCount + physicalBrollCount) / totalShots : 0;

  const humanAssetCount = shots.filter((entry) => hasTagSignal(entry.asset, HUMAN_TAG_SIGNAL)).length;
  const productAssetCount = shots.filter((entry) => hasTagSignal(entry.asset, PRODUCT_TAG_SIGNAL)).length;
  const contextAssetCount = shots.filter((entry) => hasTagSignal(entry.asset, CONTEXT_TAG_SIGNAL)).length;
  const endCardAssetCount = shots.filter((entry) => hasTagSignal(entry.asset, END_CARD_TAG_SIGNAL)).length;

  const unresolvedStrictShots = shots.filter((entry) => isStrictQuery(entry.query) && isReuseSelection(entry)).length;

  return {
    totalShots,
    distinctAssetIds,
    distinctPhysicalFiles,
    physicalFileHashes: [...distinctPhysicalKeys],
    reuseRatio,
    maxUsagePerPhysicalFile,
    consecutiveReuseViolations,
    longestContinuityRun,
    videoRatio,
    physicalVideoCount,
    physicalBrollCount,
    animatedPhotoCount,
    mockupCount,
    photosUsed,
    humanAssetCount,
    productAssetCount,
    contextAssetCount,
    endCardAssetCount,
    unresolvedStrictShots,
  };
}

export function evaluateAssetDiversityGate(
  resolved: VisualAssetResolved[],
  qualityProfile: AssetQualityProfile,
  requirementsOverride?: Partial<AssetDiversityRequirements>,
): AssetDiversityGateResult {
  const requirements: AssetDiversityRequirements = {
    ...DEFAULT_ASSET_DIVERSITY_REQUIREMENTS[qualityProfile],
    ...requirementsOverride,
  };
  const metrics = computeAssetDiversityMetrics(resolved);
  const failures: string[] = [];

  if (metrics.totalShots === 0) {
    return { qualityProfile, requirements, metrics, passed: true, failures, flaggedShots: [] };
  }

  if (metrics.distinctPhysicalFiles < requirements.minDistinctPhysicalFiles) {
    failures.push(`Apenas ${metrics.distinctPhysicalFiles} arquivo(s) físico(s) distinto(s) para ${metrics.totalShots} Shot(s); mínimo exigido: ${requirements.minDistinctPhysicalFiles}.`);
  }
  const usageRatio = metrics.maxUsagePerPhysicalFile / metrics.totalShots;
  if (usageRatio > requirements.maxAssetUsageRatio) {
    failures.push(`Um arquivo físico ocupa ${Math.round(usageRatio * 100)}% dos Shots; máximo permitido: ${Math.round(requirements.maxAssetUsageRatio * 100)}%.`);
  }
  if (metrics.consecutiveReuseViolations > 0) {
    failures.push(`${metrics.consecutiveReuseViolations} Shot(s) consecutivo(s) reutilizam o mesmo arquivo físico sem continuityGroup — reuso não intencional.`);
  }
  if (metrics.longestContinuityRun > requirements.maxConsecutiveSameAsset) {
    failures.push(`Sequência de continuidade com ${metrics.longestContinuityRun} Shot(s) consecutivo(s) usando o mesmo arquivo; máximo permitido: ${requirements.maxConsecutiveSameAsset}.`);
  }
  if (metrics.videoRatio < requirements.minVideoRatio) {
    failures.push(`Apenas ${Math.round(metrics.videoRatio * 100)}% dos Shots são vídeo/b-roll real; mínimo exigido: ${Math.round(requirements.minVideoRatio * 100)}%.`);
  }
  if (metrics.humanAssetCount < requirements.minHumanAssets) {
    failures.push(`Apenas ${metrics.humanAssetCount} asset(s) humano(s); mínimo exigido: ${requirements.minHumanAssets}.`);
  }
  if (metrics.productAssetCount < requirements.minProductAssets) {
    failures.push(`Apenas ${metrics.productAssetCount} asset(s) real(is) de produto; mínimo exigido: ${requirements.minProductAssets}.`);
  }
  if (metrics.contextAssetCount < requirements.minContextAssets) {
    failures.push(`Apenas ${metrics.contextAssetCount} asset(s) de contexto; mínimo exigido: ${requirements.minContextAssets}.`);
  }
  if (metrics.endCardAssetCount < requirements.minEndCardAssets) {
    failures.push(`Nenhum asset específico de end card encontrado; mínimo exigido: ${requirements.minEndCardAssets}.`);
  }
  if (metrics.unresolvedStrictShots > requirements.maxUnresolvedStrictShots) {
    failures.push(`${metrics.unresolvedStrictShots} Shot(s) estrito(s) (humano/produto/mockup/screenshot) saíram com asset reutilizado/fallback; máximo permitido: ${requirements.maxUnresolvedStrictShots}.`);
  }

  const passed = failures.length === 0 || !requirements.blocksOnFailure;
  const flaggedShots = passed ? [] : flagShotsForFailures(resolved, metrics, requirements);

  return { qualityProfile, requirements, metrics, passed, failures, flaggedShots };
}

/**
 * Seleciona quais Shots precisam de um asset novo para que a execução volte a atender aos
 * requisitos falhos — nunca todos os Shots, só os "elos mais fracos": Shots já sinalizados como
 * reuso/fallback primeiro, depois os Shots com menor score entre os que usam arquivos
 * sobre-utilizados. Cada Shot é flagado no máximo uma vez (o motivo mais específico vence).
 */
function flagShotsForFailures(
  resolved: VisualAssetResolved[],
  metrics: AssetDiversityMetrics,
  requirements: AssetDiversityRequirements,
): FlaggedShot[] {
  const shots = shotEntriesOf(resolved);
  const flaggedByShotId = new Map<string, FlaggedShot>();

  const flag = (entry: VisualAssetResolved & { shotId: string }, reason: FlaggedShotReason, reasonMessage: string) => {
    if (flaggedByShotId.has(entry.shotId)) return;
    flaggedByShotId.set(entry.shotId, {
      shotId: entry.shotId,
      sceneOrder: entry.sceneOrder,
      shotOrder: entry.shotOrder,
      shotPurpose: entry.shotPurpose,
      reason,
      reasonMessage,
      rejectedAssetId: entry.asset.id,
      entry,
    });
  };

  // 1) Shots estritos sem asset genuíno.
  for (const entry of shots) {
    if (isStrictQuery(entry.query) && isReuseSelection(entry)) {
      flag(entry, "unresolved_strict", "Shot com requisito estrito (humano/produto/mockup/screenshot) recebeu asset reutilizado/fallback em vez de um candidato compatível.");
    }
  }

  // 2) Shots consecutivos sem continuityGroup — o segundo (e seguintes) da sequência é o candidato a substituição.
  const ordered = [...shots].sort((a, b) => (a.sceneOrder - b.sceneOrder) || ((a.shotOrder ?? 0) - (b.shotOrder ?? 0)));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const samePhysicalFile = physicalKeyForAsset(previous.asset) === physicalKeyForAsset(current.asset);
    if (!samePhysicalFile) continue;
    const sharesContinuityGroup = Boolean(current.continuityGroup) && current.continuityGroup === previous.continuityGroup;
    if (!sharesContinuityGroup) {
      flag(current, "consecutive_reuse", `Shot repete o mesmo arquivo físico do Shot anterior (${previous.shotId}) sem continuityGroup.`);
    } else if (index >= 2) {
      // Dentro de um continuityGroup, só a partir do 3º Shot consecutivo é que vira violação.
      const beforePrevious = ordered[index - 2];
      const sameRun = physicalKeyForAsset(beforePrevious.asset) === physicalKeyForAsset(current.asset)
        && beforePrevious.continuityGroup === current.continuityGroup;
      if (sameRun) flag(current, "consecutive_reuse", `Sequência de continuidade excede o máximo de ${requirements.maxConsecutiveSameAsset} Shots consecutivos com o mesmo arquivo.`);
    }
  }

  // 3) Arquivo(s) sobre-utilizado(s): flag os usos além do permitido, priorizando os de menor score.
  const allowedUsage = Math.max(1, Math.floor(requirements.maxAssetUsageRatio * metrics.totalShots));
  const byPhysicalKey = new Map<string, Array<VisualAssetResolved & { shotId: string }>>();
  for (const entry of shots) {
    const key = physicalKeyForAsset(entry.asset);
    const bucket = byPhysicalKey.get(key) ?? [];
    bucket.push(entry);
    byPhysicalKey.set(key, bucket);
  }
  for (const bucket of byPhysicalKey.values()) {
    if (bucket.length <= allowedUsage) continue;
    const sortedByScore = [...bucket].sort((a, b) => a.score - b.score);
    for (const entry of sortedByScore.slice(0, bucket.length - allowedUsage)) {
      flag(entry, "over_used_asset", `Arquivo físico usado em ${bucket.length} Shots, acima do limite de ${allowedUsage} (${Math.round(requirements.maxAssetUsageRatio * 100)}% de ${metrics.totalShots}).`);
    }
  }

  // 4) Categorias abaixo do mínimo (vídeo/humano/produto/contexto/end card): converte os Shots
  // reutilizados/de menor score restantes (ainda não flagados) em pedidos da categoria faltante.
  const remaining = () => shots
    .filter((entry) => !flaggedByShotId.has(entry.shotId))
    .sort((a, b) => (isReuseSelection(b) ? 1 : 0) - (isReuseSelection(a) ? 1 : 0) || a.score - b.score);

  const minVideoCount = Math.ceil(requirements.minVideoRatio * metrics.totalShots);
  let videoGap = Math.max(0, minVideoCount - (metrics.physicalVideoCount + metrics.physicalBrollCount));
  for (const entry of remaining()) {
    if (videoGap <= 0) break;
    if (isRealVideoAsset(entry.asset)) continue;
    flag(entry, "insufficient_video", `Cobertura de vídeo/b-roll real abaixo do mínimo (${Math.round(requirements.minVideoRatio * 100)}%); este Shot deve virar um pedido de vídeo real.${isProceduralFootage(entry.asset.footageClassification) ? " Asset atual é procedural/sintético, nunca conta como filmagem real (Media Intelligence Engine)." : ""}`);
    videoGap -= 1;
  }

  let humanGap = Math.max(0, requirements.minHumanAssets - metrics.humanAssetCount);
  for (const entry of remaining()) {
    if (humanGap <= 0) break;
    if (hasTagSignal(entry.asset, HUMAN_TAG_SIGNAL)) continue;
    flag(entry, "insufficient_human", `Menos de ${requirements.minHumanAssets} asset(s) humano(s) na execução; este Shot deve virar um pedido com pessoa real.`);
    humanGap -= 1;
  }

  let productGap = Math.max(0, requirements.minProductAssets - metrics.productAssetCount);
  for (const entry of remaining()) {
    if (productGap <= 0) break;
    if (hasTagSignal(entry.asset, PRODUCT_TAG_SIGNAL)) continue;
    flag(entry, "insufficient_product", `Menos de ${requirements.minProductAssets} asset(s) real(is) de produto na execução; este Shot deve virar um pedido com produto/interface real.`);
    productGap -= 1;
  }

  let contextGap = Math.max(0, requirements.minContextAssets - metrics.contextAssetCount);
  for (const entry of remaining()) {
    if (contextGap <= 0) break;
    if (hasTagSignal(entry.asset, CONTEXT_TAG_SIGNAL)) continue;
    flag(entry, "insufficient_context", `Menos de ${requirements.minContextAssets} asset(s) de contexto na execução; este Shot deve virar um pedido de contexto real.`);
    contextGap -= 1;
  }

  if (metrics.endCardAssetCount < requirements.minEndCardAssets) {
    const ctaShot = [...shots].reverse().find((entry) => !flaggedByShotId.has(entry.shotId) && (entry.shotPurpose === "closing"))
      ?? [...shots].reverse().find((entry) => !flaggedByShotId.has(entry.shotId));
    if (ctaShot) flag(ctaShot, "insufficient_end_card", "Nenhum asset específico de end card (logo/marca/CTA/URL) encontrado; este Shot deve virar o end card real.");
  }

  return [...flaggedByShotId.values()];
}

/**
 * Converte Shots bloqueados em pacotes de criação assistida (`VisualAssetCreationPackage[]`),
 * agrupando solicitações semelhantes (mesmo tipo + mesmo sujeito esperado) em um único pacote
 * quando um asset novo puder legitimamente servir a vários Shots sem prejudicar a diversidade
 * (ex.: dois Shots de "contexto humano/álbum" podem pedir o mesmo tipo de vídeo curto).
 */
export function buildAssistedPackagesForFlaggedShots(
  flaggedShots: FlaggedShot[],
  artifactsRootDir: string,
  executionId: string,
): VisualAssetCreationPackage[] {
  const groups = new Map<string, FlaggedShot[]>();
  for (const flagged of flaggedShots) {
    const query = flagged.entry.query;
    const requiredKind = requiredKindForReason(flagged.reason, query.desiredKind);
    const subject = requiredSubjectFor(flagged, query);
    const groupKey = `${requiredKind}::${subject}::${flagged.reason}`;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(flagged);
    groups.set(groupKey, bucket);
  }

  const packages: VisualAssetCreationPackage[] = [];
  for (const bucket of groups.values()) {
    const primary = bucket[0];
    const query = primary.entry.query;
    const requiredKind = requiredKindForReason(primary.reason, query.desiredKind);
    const extension = requiredKind === "video" || requiredKind === "b_roll" ? "mp4" : "png";
    const expectedRelativePath = `visual-assets/scene-${String(primary.sceneOrder).padStart(2, "0")}-shot-${String(primary.shotOrder ?? 0).padStart(2, "0")}.${extension}`;
    const subject = requiredSubjectFor(primary, query);
    packages.push({
      sceneOrder: primary.sceneOrder,
      sceneName: primary.entry.sceneName,
      expectedRelativePath,
      expectedAbsolutePath: `${artifactsRootDir}/${executionId}/${expectedRelativePath}`.replace(/\\/g, "/"),
      width: query.targetWidth,
      height: query.targetHeight,
      aspectRatio: query.targetAspectRatio,
      prompt: buildAssistedPrompt({ flagged: primary, requiredKind, subject, coversCount: bucket.length }),
      tags: query.requiredTags,
      emotion: query.emotion,
      narrativeFunction: query.narrativeFunction,
      license: {
        name: "Gerado localmente pela IA desenvolvedora para uso do cliente (Asset Diversity Gate)",
        allowsCommercialUse: true,
        requiresAttribution: false,
      },
      shotId: primary.shotId,
      shotPurpose: primary.shotPurpose,
      requiredKind,
      requiredSubject: subject,
      requiredAction: query.theme,
      requiredFraming: query.framing,
      requiredMovement: query.movement,
      requiredDurationSeconds: requiredKind === "video" || requiredKind === "b_roll" || requiredKind === "cinemagraph" ? 4 : undefined,
      requiredLighting: query.lighting,
      rejectedAssetId: primary.rejectedAssetId,
      rejectionReason: primary.reasonMessage,
      continuityGroup: query.continuityGroup,
      coversShotIds: bucket.map((item) => item.shotId),
    });
  }
  return packages;
}

function requiredKindForReason(reason: FlaggedShotReason, fallback: VisualAssetKind): VisualAssetKind {
  if (reason === "insufficient_video") return "video";
  return fallback;
}

function requiredSubjectFor(flagged: FlaggedShot, query: VisualAssetSearchQuery): string {
  if (flagged.reason === "insufficient_human") return query.humanRequirement?.subject ?? "casal recém-noivos em contexto real";
  if (flagged.reason === "insufficient_product") return query.productRequirement?.productName ?? "produto real (mockup/interface do site)";
  if (flagged.reason === "insufficient_context") return "contexto humano de casamento (convidados, celebração, ambiente)";
  if (flagged.reason === "insufficient_end_card") return "end card com logo oficial, mockup do produto e URL";
  if (flagged.reason === "same_couple_reused") return "pessoa/casal diferente do já usado nos demais Shots deste vídeo";
  if (flagged.reason === "same_mockup_reused") return "mockup/interface diferente do já usado nos demais Shots deste vídeo";
  return query.theme;
}

function buildAssistedPrompt(input: { flagged: FlaggedShot; requiredKind: VisualAssetKind; subject: string; coversCount: number }): string {
  const { flagged, requiredKind, subject, coversCount } = input;
  const query = flagged.entry.query;
  return [
    `Crie um asset ${requiredKind === "video" || requiredKind === "b_roll" ? "de vídeo" : "de imagem"} real para o Shot ${flagged.shotId} (cena ${flagged.sceneOrder}, ${flagged.entry.sceneName}).`,
    `Motivo: ${flagged.reasonMessage}`,
    `Asset anterior rejeitado: ${flagged.rejectedAssetId ?? "nenhum"}.`,
    `Sujeito esperado: ${subject}.`,
    `Função narrativa do Shot: ${flagged.shotPurpose ?? query.narrativeFunction}.`,
    query.framing ? `Enquadramento: ${query.framing}.` : undefined,
    query.movement ? `Movimento: ${query.movement}.` : undefined,
    query.lighting ? `Iluminação: ${query.lighting}.` : undefined,
    `Resolução obrigatória: ${query.targetWidth}x${query.targetHeight}, proporção ${query.targetAspectRatio}.`,
    (requiredKind === "video" || requiredKind === "b_roll") ? "Formato: MP4/MOV/WebM real, nunca uma fotografia com zoom aplicado nem um mockup animado." : undefined,
    coversCount > 1 ? `Este asset também cobre outros ${coversCount - 1} Shot(s) semelhante(s) — deve funcionar para todos sem perder diversidade.` : undefined,
    "Estilo: fotografia/filmagem editorial premium, natural, sem aparência de banco genérico, sem texto embutido, sem watermark.",
    "Evitar: placeholder, ícone, clipart, tela/dashboard como protagonista quando o Shot é sobre pessoas, mãos distorcidas, baixa resolução.",
  ].filter(Boolean).join("\n");
}
