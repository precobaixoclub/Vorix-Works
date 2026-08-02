import { isRequirementResolved } from "./requirement-state.js";
import { REQUIREMENT_CATEGORY_FAMILY, REQUIREMENT_CATEGORY_GROUP_LABEL, type RequirementFamily } from "./requirement-taxonomy.js";
import type { CoverageGraph } from "./coverage-graph.js";
import type { RequirementCategory } from "./requirement-taxonomy.js";
import type { RequirementState } from "./requirement-state.js";
import type { RequirementSource } from "./shot-requirement.model.js";

/**
 * UNIFIED COVERAGE MODEL — relatório (seção 13 da sprint): `Shot | Requirement | Status |
 * Evidence | Source`, mais agregações por cena/categoria/geral/histórico. Construído inteiramente
 * a partir do `CoverageGraph` — nunca recalcula nada, só formata o que o grafo já decidiu.
 */

export type CoverageMatrixRow = {
  shotId: string;
  sceneOrder: number;
  requirementId: string;
  category: RequirementCategory;
  status: RequirementState;
  evidence: string;
  source: RequirementSource;
};

export function buildCoverageMatrix(graph: CoverageGraph): CoverageMatrixRow[] {
  const rows: CoverageMatrixRow[] = [];
  for (const shot of graph.shots) {
    for (const evaluation of shot.requirementEvaluations) {
      rows.push({
        shotId: shot.shotId,
        sceneOrder: shot.sceneOrder,
        requirementId: evaluation.requirement.requirementId,
        category: evaluation.requirement.category,
        status: evaluation.state,
        evidence: evaluation.evidence.detail,
        source: evaluation.requirement.source,
      });
    }
  }
  return rows.sort((a, b) => (a.sceneOrder - b.sceneOrder) || a.shotId.localeCompare(b.shotId) || a.category.localeCompare(b.category));
}

export type CoverageFraction = { resolved: number; total: number; ratio: number };

function fractionOf(rows: CoverageMatrixRow[]): CoverageFraction {
  const total = rows.length;
  const resolved = rows.filter((row) => isRequirementResolved(row.status)).length;
  return { resolved, total, ratio: total > 0 ? resolved / total : 1 };
}

export function coverageByScene(matrix: CoverageMatrixRow[]): Map<number, CoverageFraction> {
  const bySceneOrder = new Map<number, CoverageMatrixRow[]>();
  for (const row of matrix) {
    const bucket = bySceneOrder.get(row.sceneOrder) ?? [];
    bucket.push(row);
    bySceneOrder.set(row.sceneOrder, bucket);
  }
  return new Map([...bySceneOrder.entries()].map(([sceneOrder, rows]) => [sceneOrder, fractionOf(rows)]));
}

export function coverageByCategory(matrix: CoverageMatrixRow[]): Map<RequirementFamily, CoverageFraction> {
  const byFamily = new Map<RequirementFamily, CoverageMatrixRow[]>();
  for (const row of matrix) {
    const family = REQUIREMENT_CATEGORY_FAMILY[row.category];
    const bucket = byFamily.get(family) ?? [];
    bucket.push(row);
    byFamily.set(family, bucket);
  }
  return new Map([...byFamily.entries()].map(([family, rows]) => [family, fractionOf(rows)]));
}

export function coverageOverall(matrix: CoverageMatrixRow[]): CoverageFraction {
  return fractionOf(matrix);
}

export type CoverageHistoryEntry = { executionId: string; generatedAt: string; overall: CoverageFraction; byCategory: Record<string, CoverageFraction> };

/** Acumula um novo ponto de série histórica — nunca recalcula execuções passadas, só anexa (seção 13: "Coverage Histórico"). */
export function appendCoverageHistory(history: CoverageHistoryEntry[], entry: CoverageHistoryEntry): CoverageHistoryEntry[] {
  return [...history.filter((existing) => existing.executionId !== entry.executionId), entry];
}

export function formatCoverageMatrixText(matrix: CoverageMatrixRow[]): string {
  const lines = ["Shot | Requirement | Status | Evidence | Source", "-----|-------------|--------|----------|-------"];
  for (const row of matrix) {
    lines.push(`${row.shotId} | ${row.category} | ${row.status} | ${row.evidence} | ${row.source}`);
  }
  return lines.join("\n");
}

export function formatCategoryGroupLabel(family: RequirementFamily): string {
  return REQUIREMENT_CATEGORY_GROUP_LABEL[family];
}
