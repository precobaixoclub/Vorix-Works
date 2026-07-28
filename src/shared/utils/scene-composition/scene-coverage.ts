import { assetSignalFromVisualAssetMetadata, type AssetSignal } from "../coverage/asset-signal.js";
import { evaluateRequirement } from "../coverage/requirement-evaluator.js";
import { isRequirementResolved } from "../coverage/requirement-state.js";
import type { RequirementCategory } from "../coverage/requirement-taxonomy.js";
import type { ShotRequirement } from "../coverage/shot-requirement.model.js";
import type { VisualAssetMetadata } from "../../../application/ports/visual-asset-provider.port.js";
import type { MicroShot } from "./microshot.model.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — SHOT COVERAGE (seção 3) e COVERAGE BY COMPOSITION (seção
 * 13). Nunca altera `coverage-graph.ts`/`requirement-evaluator.ts` (Unified Coverage Model,
 * protegido nesta sprint) — só os IMPORTA como peça pronta para avaliar candidatos individuais,
 * exatamente como Production Readiness/Gap Analysis já fazem. A novidade desta sprint é a
 * AGREGAÇÃO: hoje "1 asset = 1 Shot = 100%"; agora um Shot é decomposto em MicroShots com peso
 * próprio, e a cobertura do Shot é a SOMA dos pesos dos MicroShots cumpridos — nunca mais um único
 * asset precisando satisfazer 100% sozinho.
 */

/** Peso relativo de cada MicroShot dentro do Shot — obrigatório pesa mais que desejável, soma sempre 1.0 entre os MicroShots do mesmo Shot pai (seção 3: "Asset A 30% + Asset B 20% + ... = 100%"). */
export function computeMicroShotWeights(microShots: MicroShot[]): Map<string, number> {
  const rawWeights = microShots.map((microShot) => (microShot.priority === "obrigatorio" ? 1.4 : 1));
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const weights = new Map<string, number>();
  microShots.forEach((microShot, index) => weights.set(microShot.id, rawWeights[index] / total));
  return weights;
}

/** Mapeia os `requiredElements` informais do decompositor para categorias reais do Unified Coverage Model, quando existe sinal estruturado equivalente — nunca inventa validação para o que não tem sinal (scene_context/texture_or_environment/brand_or_cta ficam de fora, avaliados só pela presença de um asset real). */
const ELEMENT_TO_CATEGORY: Partial<Record<string, RequirementCategory>> = {
  human: "human",
  screen_visible: "phone_screen",
  device: "device",
};

function probe(category: RequirementCategory): ShotRequirement {
  return { requirementId: "probe", shotId: "probe", sceneOrder: 0, category, description: "sonda interna", weight: 1, mandatory: true, validationMethod: "structured_field", source: "shot_plan" };
}

export type MicroShotFulfillment = { microShotId: string; fulfilled: boolean; assignedAssetCount: number; detail: string };

/** Um MicroShot é cumprido quando (a) tem ao menos um asset atribuído E (b) os `requiredElements` com sinal estruturado equivalente (`ELEMENT_TO_CATEGORY`) são satisfeitos por PELO MENOS UM dos assets atribuídos — nunca exige que o MESMO asset satisfaça todos ao mesmo tempo (seção 13: vários assets, um requisito). */
export function evaluateMicroShotFulfillment(microShot: MicroShot, assignedAssets: VisualAssetMetadata[]): MicroShotFulfillment {
  if (assignedAssets.length === 0) {
    return { microShotId: microShot.id, fulfilled: false, assignedAssetCount: 0, detail: "Nenhum asset atribuído a este microplano." };
  }

  const signals = assignedAssets.map(assetSignalFromVisualAssetMetadata);
  const structuredElements = microShot.requiredElements.map((element) => ELEMENT_TO_CATEGORY[element]).filter((category): category is RequirementCategory => Boolean(category));

  if (structuredElements.length === 0) {
    return { microShotId: microShot.id, fulfilled: true, assignedAssetCount: assignedAssets.length, detail: "Sem requisito estruturado equivalente — cumprido pela presença de asset real atribuído." };
  }

  const unsatisfied = structuredElements.filter((category) => !signals.some((signal) => isRequirementResolved(evaluateRequirement(probe(category), signal).state)));
  return {
    microShotId: microShot.id,
    fulfilled: unsatisfied.length === 0,
    assignedAssetCount: assignedAssets.length,
    detail: unsatisfied.length === 0
      ? `Todos os requisitos estruturados (${structuredElements.join(", ")}) cumpridos pelo conjunto de ${assignedAssets.length} asset(s).`
      : `Requisito(s) não cumprido(s) por nenhum dos ${assignedAssets.length} asset(s) atribuídos: ${unsatisfied.join(", ")}.`,
  };
}

export type SceneCoverageResult = {
  parentShotId: string;
  coverage: number;
  microShotFulfillments: MicroShotFulfillment[];
  contributingAssetCount: number;
};

/** Cobertura do Shot (seção 3) = soma dos pesos dos MicroShots cumpridos — nunca mais "1 asset = 100%". */
export function computeSceneCoverage(parentShotId: string, microShots: MicroShot[], assignments: Map<string, VisualAssetMetadata[]>): SceneCoverageResult {
  const weights = computeMicroShotWeights(microShots);
  const microShotFulfillments = microShots.map((microShot) => evaluateMicroShotFulfillment(microShot, assignments.get(microShot.id) ?? []));

  let coverage = 0;
  for (const fulfillment of microShotFulfillments) {
    if (fulfillment.fulfilled) coverage += weights.get(fulfillment.microShotId) ?? 0;
  }

  const contributingAssetIds = new Set<string>();
  for (const assets of assignments.values()) for (const asset of assets) contributingAssetIds.add(asset.id);

  return { parentShotId, coverage: Math.min(1, coverage), microShotFulfillments, contributingAssetCount: contributingAssetIds.size };
}

export type { AssetSignal };
