import type {
  AuthenticityClass,
  ShotAuthenticityRole,
  VisualAssetMetadata,
  VisualAssetSearchQuery,
} from "../../../application/ports/visual-asset-provider.port.js";
import { HUMAN_TAG_SIGNAL, PRODUCT_TAG_SIGNAL, CONTEXT_TAG_SIGNAL, END_CARD_TAG_SIGNAL } from "../visual-asset-tag-signals.js";
import { classifyVisualAsset } from "../asset-authenticity-policy/classify-visual-asset.js";
import { scoreAssetLayered, scoreTotalLayered, weightsForRole } from "../asset-authenticity-policy/layered-scoring.js";
import { resolveWithAuthenticityPolicy, type ScoredCandidate } from "../asset-authenticity-policy/hard-authenticity-constraint.js";
import { computeSceneCoverage, type SceneCoverageResult } from "./scene-coverage.js";
import type { MicroShot, MicroShotPriority } from "./microshot.model.js";

/**
 * COMPOSITE SHOT COVERAGE INTEGRATION — ponte de orquestração, não uma nova Engine: integra
 * `visual-asset-tag-signals.ts` (existente), `asset-authenticity-policy/*` (existente,
 * inalterado) e `scene-coverage.ts` (existente, `computeSceneCoverage` reaproveitado sem
 * modificação — seção 3: "reutilizar o Scene Coverage existente") para permitir que um Shot cujo
 * requisito é composto (várias sub-features que nenhum asset único cobre) seja resolvido por
 * VÁRIOS assets — um por requisito atômico — em vez de cair direto em Developer Assisted Mode.
 *
 * NUNCA roda antes da resolução de asset único falhar (seção 10: composição é fallback, nunca
 * padrão) — o chamador (`VisualAssetResolver`) só invoca isto quando o melhor candidato único já
 * ficou abaixo da nota mínima.
 */

const MIN_ATOMIC_UNITS_FOR_COMPOSITE = 2;
/** Mesmo piso de `shot-decomposer.ts`/`shot-render-planner.ts` (MIN_CLIP_DURATION_SECONDS) — nunca um valor novo e paralelo. Abaixo disso um segmento é invisível/ilegível (seção 7). */
const MIN_SEGMENT_DURATION_SECONDS = 0.6;

/**
 * Tokens estruturais nunca viram requisito atômico próprio: descrevem o Shot inteiro (papel
 * humano/produto/marca — já cobertos por `HUMAN_TAG_SIGNAL`/`PRODUCT_TAG_SIGNAL`/
 * `END_CARD_TAG_SIGNAL`, seção 5/6) ou a marca da campanha (`brandKeywords`, todo Shot da mesma
 * campanha os carrega). Nunca uma lista nova por empresa — reaproveita vocabulário e campos já
 * existentes.
 */
function structuralTagExclusions(query: VisualAssetSearchQuery): Set<string> {
  const excluded = new Set<string>([...HUMAN_TAG_SIGNAL, ...PRODUCT_TAG_SIGNAL, ...END_CARD_TAG_SIGNAL]);
  for (const keyword of query.brandKeywords ?? []) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) continue;
    excluded.add(normalized.replace(/\s+/g, "-"));
    for (const word of normalized.split(/\s+/)) excluded.add(word);
  }
  return excluded;
}

function assetMatchesTag(asset: VisualAssetMetadata, tag: string): boolean {
  const haystack = [asset.theme, asset.emotion, ...asset.tags].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(tag);
}

export type AtomicRequirementCluster = {
  microShotId: string;
  description: string;
  atomicType: "feature" | "context";
  tags: string[];
};

/**
 * Detecta se o requisito do Shot é composto e, se sim, agrupa candidatos por requisito atômico
 * (seção 2/4). Algoritmo guiado por DADOS REAIS (quais candidatos de fato cobrem cada tag), nunca
 * por adivinhação semântica de texto (seção "IMPORTANTE": "não transformar requisitos distintos em
 * correspondência semântica artificial"): agrupa gulosamente a partir da tag mais RARA (menos
 * candidatos cobrindo) para a mais comum, removendo do restante toda tag que o candidato escolhido
 * também cobre — tags ubíquas (compartilhadas por quase todo candidato, ex.: marca/formato) nunca
 * formam cluster próprio porque sempre são "varridas" pelo primeiro cluster real que se forma.
 *
 * Retorna `undefined` quando não há estrutura composta genuína (menos de 2 clusters distintos) —
 * o chamador deve seguir para Developer Assisted Mode exatamente como antes (seção 10).
 */
export function detectAtomicClusters(
  query: VisualAssetSearchQuery,
  candidates: VisualAssetMetadata[],
  shotId: string,
): AtomicRequirementCluster[] | undefined {
  const excluded = structuralTagExclusions(query);
  const candidateTags = Array.from(new Set(query.requiredTags.map((tag) => tag.toLowerCase()))).filter((tag) => !excluded.has(tag));
  if (candidateTags.length < MIN_ATOMIC_UNITS_FOR_COMPOSITE) return undefined;

  // Quantos candidatos cobrem cada tag — a base do agrupamento guloso.
  const coveringAssetIdsByTag = new Map<string, Set<string>>();
  for (const tag of candidateTags) {
    const covering = new Set(candidates.filter((asset) => assetMatchesTag(asset, tag)).map((asset) => asset.id));
    coveringAssetIdsByTag.set(tag, covering);
  }

  // IMPORTANTE: tags SEM nenhum candidato cobrindo ainda formam seu próprio cluster (vazio,
  // sem vencedor possível) — nunca são silenciosamente descartadas do requisito. Um requisito
  // atômico obrigatório sem candidato algum deve BLOQUEAR a composição inteira (seção 9), não
  // desaparecer como se nunca tivesse sido pedido.
  const remainingTags = new Set(candidateTags);
  const clusters: AtomicRequirementCluster[] = [];
  let clusterIndex = 0;

  while (remainingTags.size > 0) {
    // Tag mais rara primeiro — nunca a mais comum, que só reflete formato/marca (seção "IMPORTANTE").
    const sortedTags = Array.from(remainingTags).sort((a, b) => (coveringAssetIdsByTag.get(a)!.size - coveringAssetIdsByTag.get(b)!.size) || a.localeCompare(b));
    const seedTag = sortedTags[0];
    const coveringSeed = coveringAssetIdsByTag.get(seedTag)!;

    // Dentro dos candidatos que cobrem a tag-semente, escolhe o que cobre MAIS tags restantes ao
    // mesmo tempo — assim um único asset que já serve 2 requisitos vira 1 cluster, não 2 forçados.
    let bestAssetId: string | undefined;
    let bestCoverCount = -1;
    for (const assetId of coveringSeed) {
      const coverCount = Array.from(remainingTags).filter((tag) => coveringAssetIdsByTag.get(tag)!.has(assetId)).length;
      if (coverCount > bestCoverCount) {
        bestCoverCount = coverCount;
        bestAssetId = assetId;
      }
    }
    if (!bestAssetId) {
      // Nenhum candidato cobre esta tag — cluster próprio, sem candidatos, para que
      // `resolveAtomicUnit` reporte "sem vencedor" e a composição inteira seja rejeitada
      // (seção 9), em vez de fingir que o requisito nunca existiu.
      clusterIndex += 1;
      clusters.push({
        microShotId: `${shotId}::composite-${clusterIndex}`,
        description: `feature: ${seedTag}`,
        atomicType: "feature",
        tags: [seedTag],
      });
      remainingTags.delete(seedTag);
      continue;
    }

    const tagsCoveredByCluster = Array.from(remainingTags).filter((tag) => coveringAssetIdsByTag.get(tag)!.has(bestAssetId));
    const winningAsset = candidates.find((asset) => asset.id === bestAssetId);
    const isContext = Boolean(winningAsset && [...HUMAN_TAG_SIGNAL, ...CONTEXT_TAG_SIGNAL].some((signal) => winningAsset.tags.map((t) => t.toLowerCase()).includes(signal)));

    clusterIndex += 1;
    clusters.push({
      microShotId: `${shotId}::composite-${clusterIndex}`,
      description: `${isContext ? "context" : "feature"}: ${tagsCoveredByCluster.join("_")}`,
      atomicType: isContext ? "context" : "feature",
      tags: tagsCoveredByCluster,
    });
    for (const tag of tagsCoveredByCluster) remainingTags.delete(tag);
  }

  if (clusters.length < MIN_ATOMIC_UNITS_FOR_COMPOSITE) return undefined;
  // Composição genuína exige >= 2 assets DISTINTOS vencendo clusters diferentes — se todos os
  // clusters convergem para o mesmo candidato dominante, é o mesmo resultado que a resolução
  // simples já tentou e falhou (seção 10: nunca degradar/duplicar o caminho simples).
  return clusters;
}

export type AtomicUnitResolution = {
  cluster: AtomicRequirementCluster;
  winner?: ScoredCandidate;
  discarded: { assetId: string; score: number }[];
  hardConstraintApplied?: { reason: string; overriddenAssetId: string; overriddenScore: number };
};

/** Pontua candidatos para UM requisito atômico — reaproveita `scoreAssetLayered`/`scoreTotalLayered`/`resolveWithAuthenticityPolicy` (Official Asset Priority & Authenticity Policy) inalterados, só com uma query estreitada para a(s) tag(s) do cluster (seção 5: autenticidade por componente). */
export function resolveAtomicUnit(input: {
  cluster: AtomicRequirementCluster;
  query: VisualAssetSearchQuery;
  candidates: VisualAssetMetadata[];
  shotAuthenticityRole: ShotAuthenticityRole;
  minimumScore: number;
}): AtomicUnitResolution {
  const { cluster, query, candidates, shotAuthenticityRole, minimumScore } = input;
  const narrowedQuery: VisualAssetSearchQuery = { ...query, requiredTags: cluster.tags };
  // Seção 6 — requisitos de contexto humano/ambiental nunca aplicam a Hard Authenticity
  // Constraint (autenticidade não pode dominar um Shot de contexto), mesmo quando o Shot pai é
  // "product"/"brand_identity". Requisitos de feature herdam o papel real do Shot.
  const roleForUnit: ShotAuthenticityRole = cluster.atomicType === "context" ? "human_emotional" : shotAuthenticityRole;
  const weights = weightsForRole(roleForUnit);

  // GATE DE RELEVÂNCIA DE CONTEÚDO — um requisito atômico é estreito por natureza (1-3 tags);
  // sem este filtro, `authenticity` (25-30% do peso em Shots de produto/marca) sozinho pode
  // fazer um candidato oficial mas TOPICAMENTE IRRELEVANTE (nenhuma tag/tema relacionado a ESTE
  // requisito específico) vencer um cluster que ele não representa de verdade — autenticidade
  // decide ENTRE candidatos relevantes (seção 5), nunca substitui relevância. Reaproveita a MESMA
  // checagem textual usada para formar os clusters (`assetMatchesTag`), nunca uma fórmula nova.
  const relevantCandidates = candidates.filter((asset) => cluster.tags.some((tag) => assetMatchesTag(asset, tag)));

  const scored: ScoredCandidate[] = relevantCandidates
    .map((asset) => {
      const authenticityClass = classifyVisualAsset(asset);
      const breakdown = scoreAssetLayered(asset, narrowedQuery, authenticityClass);
      return { asset, authenticityClass, breakdown, score: scoreTotalLayered(breakdown, weights) };
    })
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));

  const resolution = resolveWithAuthenticityPolicy({
    scoredDescending: scored,
    role: roleForUnit,
    minimumScore,
    shotId: cluster.microShotId,
    sceneOrder: query.sceneOrder,
  });

  return {
    cluster,
    winner: resolution.winner && resolution.winner.score >= minimumScore ? resolution.winner : undefined,
    discarded: scored.filter((entry) => entry.asset.id !== resolution.winner?.asset.id).slice(0, 5).map((entry) => ({ assetId: entry.asset.id, score: entry.score })),
    hardConstraintApplied: resolution.hardConstraintApplied,
  };
}

/**
 * Todo cluster atômico nasce de `requiredTags` (nunca de uma lista "niceToHave" separada — a
 * query não distingue tag obrigatória de opcional, seção 2), então toda unidade é "obrigatorio"
 * — uma unidade sem vencedor bloqueia a composição inteira (seção 9: requisito obrigatório
 * ausente aciona Assisted Mode), nunca é silenciosamente tratada como opcional.
 */
const ATOMIC_CLUSTER_PRIORITY: MicroShotPriority = "obrigatorio";

/** Converte clusters resolvidos em `MicroShot[]` só para reaproveitar `computeSceneCoverage`/`computeMicroShotWeights` (Scene Coverage já existente) sem duplicar a fórmula de peso/cobertura (seção 3). */
export function clustersToMicroShots(units: AtomicUnitResolution[], shotId: string): MicroShot[] {
  return units.map((unit, index) => ({
    id: unit.cluster.microShotId,
    parentShot: shotId,
    purpose: unit.cluster.description,
    duration: 0,
    priority: ATOMIC_CLUSTER_PRIORITY,
    requiredElements: unit.cluster.tags,
    preferredCamera: unit.cluster.atomicType === "context" ? "medium" : "screen",
    preferredMovement: "static",
    emotion: "neutro",
    transitionIn: index === 0 ? "cut" : "dissolve",
    transitionOut: index === units.length - 1 ? "cut" : "dissolve",
  }));
}

export type CompositeCoverageEvaluation = {
  units: AtomicUnitResolution[];
  microShots: MicroShot[];
  coverage: SceneCoverageResult;
  allUnitsResolved: boolean;
  distinctAssetCount: number;
};

/** Seção 3 — cobertura agregada via `computeSceneCoverage` (Unified Coverage Model / Scene Coverage já existente, sem alteração). Cada unidade só entra em `assignments` quando teve vencedor >= nota mínima — uma unidade obrigatória sem vencedor deixa o Shot inteiro sem cobertura suficiente, nunca finge cumprida. */
export function evaluateCompositeCoverage(units: AtomicUnitResolution[], shotId: string): CompositeCoverageEvaluation {
  const microShots = clustersToMicroShots(units, shotId);
  const assignments = new Map<string, VisualAssetMetadata[]>();
  for (const unit of units) {
    if (unit.winner) assignments.set(unit.cluster.microShotId, [unit.winner.asset]);
  }
  const coverage = computeSceneCoverage(shotId, microShots, assignments);
  const distinctAssetIds = new Set(units.filter((unit) => unit.winner).map((unit) => unit.winner!.asset.id));
  return {
    units,
    microShots,
    coverage,
    allUnitsResolved: units.every((unit) => Boolean(unit.winner)),
    distinctAssetCount: distinctAssetIds.size,
  };
}

/** Seção 7 — verifica se o Shot tem duração suficiente para expor cada segmento pelo mínimo legível. Quando a duração do Shot é desconhecida (`shotDurationSeconds` ausente), não bloqueia — a checagem de duração acontece depois, em `buildShotTimelineForRender`, que sempre conhece a duração real. */
export function hasSufficientDurationForSegments(shotDurationSeconds: number | undefined, segmentCount: number): boolean {
  if (shotDurationSeconds === undefined) return true;
  return shotDurationSeconds / segmentCount >= MIN_SEGMENT_DURATION_SECONDS;
}

/** NARRATIVE TIMING REBALANCING (seção 4/5) — informação estruturada do déficit, para o planejador temporal decidir sem precisar reinterpretar texto livre. `requiredMinimumDuration` nunca é um número fixo — é sempre `segmentCount * minimumSegmentDuration` calculado a partir do que a composição real encontrou. */
export type CompositeTimingRequirement = {
  segmentCount: number;
  minimumSegmentDuration: number;
  transitionOverhead: number;
  requiredMinimumDuration: number;
};

export type CompositeSceneAttemptResult = {
  accepted: boolean;
  reason: string;
  units: AtomicUnitResolution[];
  coverage?: SceneCoverageResult;
  aggregateCoveragePercent?: number;
  /** Presente sempre que a composição foi rejeitada especificamente por falta de duração (nunca por conteúdo/cobertura) — consumido pelo Narrative Timing Rebalancing. */
  timingRequirement?: CompositeTimingRequirement;
};

/**
 * Orquestrador principal (seção 4: Multi-Asset Resolution). Chamado pelo `VisualAssetResolver`
 * SÓ quando a resolução de asset único já falhou (seção 10). Passos, na ordem da seção 4:
 *   1) detecta clusters de requisito atômico a partir de candidatos reais (`detectAtomicClusters`);
 *   2) resolve cada cluster com a MESMA política de autenticidade/score de sempre, reivindicando
 *      cada asset vencedor para evitar que 2 clusters usem o mesmo arquivo (seção 4.4);
 *   3) verifica duração mínima por segmento quando a duração do Shot é conhecida (seção 7);
 *   4) agrega cobertura via Scene Coverage já existente (seção 3) e só aceita quando TODA unidade
 *      obrigatória tem vencedor E a cobertura agregada atinge `minimumScore` (mesmo piso de
 *      sempre — seção "IMPORTANTE": nunca abaixar o threshold de 62).
 * Nunca aceita parcialmente — se qualquer unidade obrigatória falha, `accepted: false` e o
 * chamador segue para Developer Assisted Mode exatamente como antes.
 */
export function attemptCompositeSceneResolution(input: {
  query: VisualAssetSearchQuery;
  candidates: VisualAssetMetadata[];
  shotAuthenticityRole: ShotAuthenticityRole;
  minimumScore: number;
  shotId: string;
}): CompositeSceneAttemptResult {
  const { query, candidates, shotAuthenticityRole, minimumScore, shotId } = input;
  const clusters = detectAtomicClusters(query, candidates, shotId);
  if (!clusters) {
    return { accepted: false, reason: "Requisito do Shot não é composto (menos de 2 requisitos atômicos com candidato real distinto) — sem oportunidade de composição.", units: [] };
  }

  const claimedAssetIds = new Set<string>();
  const units: AtomicUnitResolution[] = [];
  for (const cluster of clusters) {
    const availableCandidates = candidates.filter((asset) => !claimedAssetIds.has(asset.id));
    const unit = resolveAtomicUnit({ cluster, query, candidates: availableCandidates, shotAuthenticityRole, minimumScore });
    if (unit.winner) claimedAssetIds.add(unit.winner.asset.id);
    units.push(unit);
  }

  const distinctAssetCount = new Set(units.filter((unit) => unit.winner).map((unit) => unit.winner!.asset.id)).size;
  if (distinctAssetCount < MIN_ATOMIC_UNITS_FOR_COMPOSITE) {
    return { accepted: false, reason: `Apenas ${distinctAssetCount} asset(s) distinto(s) vencendo requisitos atômicos — mesmo resultado que a resolução simples já tentou, sem ganho real de composição.`, units };
  }

  const unresolvedMandatory = units.filter((unit) => !unit.winner);
  if (unresolvedMandatory.length > 0) {
    return {
      accepted: false,
      reason: `Requisito(s) atômico(s) obrigatório(s) sem candidato adequado: ${unresolvedMandatory.map((unit) => unit.cluster.description).join(", ")}.`,
      units,
    };
  }

  if (!hasSufficientDurationForSegments(query.shotDurationSeconds, units.length)) {
    const timingRequirement: CompositeTimingRequirement = {
      segmentCount: units.length,
      minimumSegmentDuration: MIN_SEGMENT_DURATION_SECONDS,
      transitionOverhead: 0,
      requiredMinimumDuration: Number.parseFloat((units.length * MIN_SEGMENT_DURATION_SECONDS).toFixed(3)),
    };
    return {
      accepted: false,
      reason: `Duração do Shot (${query.shotDurationSeconds}s) insuficiente para ${units.length} segmentos com exposição mínima de ${MIN_SEGMENT_DURATION_SECONDS}s cada.`,
      units,
      timingRequirement,
    };
  }

  const evaluation = evaluateCompositeCoverage(units, shotId);
  const aggregateCoveragePercent = Math.round(evaluation.coverage.coverage * 100);
  if (aggregateCoveragePercent < minimumScore) {
    return {
      accepted: false,
      reason: `Cobertura agregada (${aggregateCoveragePercent}%) abaixo da nota mínima (${minimumScore}) — composição não aceita.`,
      units,
      coverage: evaluation.coverage,
      aggregateCoveragePercent,
    };
  }

  return { accepted: true, reason: `Composição aceita: ${units.length} requisito(s) atômico(s), ${distinctAssetCount} asset(s) distinto(s), cobertura agregada ${aggregateCoveragePercent}%.`, units, coverage: evaluation.coverage, aggregateCoveragePercent };
}

export { MIN_ATOMIC_UNITS_FOR_COMPOSITE, MIN_SEGMENT_DURATION_SECONDS };
export type { AuthenticityClass };
