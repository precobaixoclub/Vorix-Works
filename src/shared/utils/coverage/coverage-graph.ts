import type {
  VisualAssetCreationPackage,
  VisualAssetResolved,
  VisualAssetSearchQuery,
} from "../../../application/ports/visual-asset-provider.port.js";
import type { AssetDiversityRequirements } from "../../../application/ports/asset-quality-profile.js";
import { assetSignalFromVisualAssetMetadata } from "./asset-signal.js";
import { evaluateRequirement, type RequirementEvaluation } from "./requirement-evaluator.js";
import { buildRequirementId, type ShotRequirement, type ShotRequirementSet } from "./shot-requirement.model.js";

/**
 * UNIFIED COVERAGE MODEL — COVERAGE GRAPH (seção 4 da sprint): `Shot → Requirements → Candidate →
 * Validation → Approval → Coverage`. Todo componente que precisa saber "o que falta" navega por
 * ESTE grafo, nunca recalcula por conta própria.
 *
 * A peça central que corrige a causa raiz das divergências documentadas na sprint (Gap Analysis
 * "nenhum vídeo faltando" vs. Production Readiness "Video Coverage 0%") é `deriveVideoElevatedShotIds`
 * abaixo: hoje, um Shot cujo `desiredType` original era "photo" continua marcado como "encontrado"
 * pelo Gap Analysis mesmo depois do Asset Diversity Gate decidir — DEPOIS da resolução, só dentro
 * de Rafa, nunca escrito de volta no `asset-report.json` — que aquele Shot precisa virar vídeo real
 * para a campanha atingir `minVideoRatio`. Esta função recalcula a MESMA elevação de forma
 * independente e reutilizável, para que Footage Acquisition (`run-command.ts`) possa aplicá-la ANTES
 * de perguntar ao Gap Analysis "o que falta" — as duas perguntas passam a nascer do mesmo cálculo.
 */

type ShotEntry = VisualAssetResolved & { shotId: string };
type PendingEntry = VisualAssetCreationPackage & { shotId: string };

function foundShotsOf(resolved: VisualAssetResolved[]): ShotEntry[] {
  return resolved.filter((entry): entry is ShotEntry => typeof entry.shotId === "string" && entry.shotId.length > 0);
}

function pendingShotsOf(pending: VisualAssetCreationPackage[]): PendingEntry[] {
  return pending.filter((entry): entry is PendingEntry => typeof entry.shotId === "string" && entry.shotId.length > 0);
}

function isReuseSelection(entry: VisualAssetResolved): boolean {
  const reason = entry.selectionReason ?? "";
  return reason.startsWith("shot_reuse") || Boolean(entry.reusedFromShotId);
}

const REAL_VIDEO_PROBE: ShotRequirement = {
  requirementId: "probe::real_video",
  shotId: "probe",
  sceneOrder: 0,
  category: "real_video",
  description: "sonda interna — nunca exposta em relatório",
  weight: 1,
  mandatory: true,
  validationMethod: "structured_field",
  source: "shot_plan",
};

function isRealVideo(entry: VisualAssetResolved): boolean {
  return evaluateRequirement(REAL_VIDEO_PROBE, assetSignalFromVisualAssetMetadata(entry.asset)).state === "fulfilled";
}

/**
 * Quais Shots (já resolvidos) precisam ser reclassificados como vídeo real para que a campanha
 * atinja `minVideoRatio` — MESMA ordem de seleção do Asset Diversity Gate (Shots reutilizados/
 * fallback primeiro, depois os de menor score), recalculada de forma independente e reutilizável.
 */
export function deriveVideoElevatedShotIds(input: {
  resolved: VisualAssetResolved[];
  pending: VisualAssetCreationPackage[];
  minVideoRatio: number;
}): Set<string> {
  const found = foundShotsOf(input.resolved);
  const missing = pendingShotsOf(input.pending);
  const totalShots = found.length + missing.length;
  if (totalShots === 0 || input.minVideoRatio <= 0) return new Set();

  const currentVideoCount = found.filter(isRealVideo).length;
  const minVideoCount = Math.ceil(input.minVideoRatio * totalShots);
  let gap = Math.max(0, minVideoCount - currentVideoCount);
  if (gap === 0) return new Set();

  const candidates = found
    .filter((entry) => !isRealVideo(entry))
    .sort((a, b) => (isReuseSelection(b) ? 1 : 0) - (isReuseSelection(a) ? 1 : 0) || a.score - b.score);

  const elevated = new Set<string>();
  for (const entry of candidates) {
    if (gap <= 0) break;
    elevated.add(entry.shotId);
    gap -= 1;
  }
  return elevated;
}

function needsProduct(query: VisualAssetSearchQuery): boolean {
  return Boolean(query.productRequirement || query.mockupRequirement || query.screenshotRequirement) || query.shotPurpose === "product";
}

function needsHuman(query: VisualAssetSearchQuery): boolean {
  return Boolean(query.humanRequirement) || query.shotPurpose === "human_interaction" || query.shotPurpose === "reaction";
}

/**
 * Constrói o conjunto de requisitos DECLARADOS de cada Shot (a partir do que o Resolver já recebeu
 * de Bruno/Vanessa) mais os requisitos ELEVADOS pelas regras agregadas de diversidade da campanha
 * (`deriveVideoElevatedShotIds`) — a MESMA definição de requisito usada por todo o resto do grafo.
 */
export function buildShotRequirementSets(input: {
  resolved: VisualAssetResolved[];
  pending: VisualAssetCreationPackage[];
  requirements: AssetDiversityRequirements;
}): ShotRequirementSet[] {
  const found = foundShotsOf(input.resolved);
  const missing = pendingShotsOf(input.pending);
  const elevatedToVideo = deriveVideoElevatedShotIds({ resolved: input.resolved, pending: input.pending, minVideoRatio: input.requirements.minVideoRatio });

  const sets = new Map<string, ShotRequirementSet>();

  const ensureSet = (shotId: string, sceneOrder: number, shotOrder: number | undefined, sceneName: string): ShotRequirementSet => {
    const existing = sets.get(shotId);
    if (existing) return existing;
    const created: ShotRequirementSet = { shotId, sceneOrder, shotOrder, sceneName, requirements: [] };
    sets.set(shotId, created);
    return created;
  };

  const addRequirement = (set: ShotRequirementSet, requirement: Omit<ShotRequirement, "requirementId" | "shotId" | "sceneOrder" | "shotOrder">) => {
    set.requirements.push({
      ...requirement,
      requirementId: buildRequirementId(set.shotId, requirement.category),
      shotId: set.shotId,
      sceneOrder: set.sceneOrder,
      shotOrder: set.shotOrder,
    });
  };

  for (const entry of found) {
    const set = ensureSet(entry.shotId, entry.sceneOrder, entry.shotOrder, entry.sceneName);
    if (needsHuman(entry.query)) {
      addRequirement(set, { category: "human", description: entry.query.humanRequirement?.subject ?? "Presença humana exigida pelo Shot.", weight: 1, mandatory: Boolean(entry.query.humanRequirement?.strict), validationMethod: "tag_based", source: "shot_plan" });
    }
    if (needsProduct(entry.query)) {
      addRequirement(set, { category: "product_screen", description: "Tela de produto pronta para composição exigida pelo Shot.", weight: 1, mandatory: true, validationMethod: "structured_field", source: "shot_plan" });
      addRequirement(set, { category: "interaction", description: "Interação humana com o dispositivo exigida pelo Shot.", weight: 0.6, mandatory: false, validationMethod: "structured_field", source: "shot_plan" });
    }
    if (elevatedToVideo.has(entry.shotId)) {
      addRequirement(set, { category: "real_video", description: "Elevado a vídeo real: cobertura de vídeo da campanha abaixo do mínimo exigido.", weight: 1, mandatory: true, validationMethod: "derived_aggregate", source: "diversity_requirement" });
    }
  }

  for (const entry of missing) {
    const set = ensureSet(entry.shotId, entry.sceneOrder, undefined, entry.sceneName);
    const category = entry.requiredKind === "video" || entry.requiredKind === "b_roll" ? "real_video" : entry.requiredKind === "mockup" ? "mockup" : "photo";
    addRequirement(set, { category, description: entry.requiredSubject ?? "Asset pendente de resolução.", weight: 1, mandatory: true, validationMethod: "structured_field", source: "shot_plan" });
  }

  return [...sets.values()].sort((a, b) => (a.sceneOrder - b.sceneOrder) || ((a.shotOrder ?? 0) - (b.shotOrder ?? 0)));
}

export type CoverageGraphShotNode = {
  shotId: string;
  sceneOrder: number;
  shotOrder?: number;
  sceneName: string;
  requirementEvaluations: RequirementEvaluation[];
};

export type CoverageGraph = { shots: CoverageGraphShotNode[] };

/** Percorre `Shot → Requirements → Candidate → Validation → Approval → Coverage` (seção 4): cada requisito é avaliado contra o asset resolvido do próprio Shot (ou `undefined` quando o Shot ainda está pendente). */
export function buildCoverageGraph(input: {
  resolved: VisualAssetResolved[];
  pending: VisualAssetCreationPackage[];
  requirements: AssetDiversityRequirements;
}): CoverageGraph {
  const sets = buildShotRequirementSets(input);
  const assetByShotId = new Map(foundShotsOf(input.resolved).map((entry) => [entry.shotId, entry.asset] as const));

  const shots: CoverageGraphShotNode[] = sets.map((set) => {
    const asset = assetByShotId.get(set.shotId);
    const signal = asset ? assetSignalFromVisualAssetMetadata(asset) : undefined;
    return {
      shotId: set.shotId,
      sceneOrder: set.sceneOrder,
      shotOrder: set.shotOrder,
      sceneName: set.sceneName,
      requirementEvaluations: set.requirements.map((requirement) => evaluateRequirement(requirement, signal)),
    };
  });

  return { shots };
}
