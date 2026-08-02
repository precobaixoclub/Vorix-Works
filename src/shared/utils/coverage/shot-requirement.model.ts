import type { RequirementCategory } from "./requirement-taxonomy.js";

/**
 * UNIFIED COVERAGE MODEL — `ShotRequirement` (seção 1 da sprint): definição formal única dos
 * requisitos de um Shot, consumida por Gap Analysis, Production Readiness, Asset Diversity Gate,
 * Footage Acquisition, Visual Validation, Product Compositing, Lucas e o Autonomous Execution
 * Engine. Nenhum desses componentes mais calcula "cobertura" com critério próprio — todos leem
 * este mesmo tipo (via `coverage-graph.ts`).
 */

export type RequirementValidationMethod =
  /** Comparado contra um campo estruturado do asset (deviceType/screenVisible/humanInteractionScore/kind) — nunca tag. */
  | "structured_field"
  /** Sem campo estruturado disponível — cai para correspondência de tag/tema, sinalizado como tal (nunca finge ser `structured_field`). */
  | "tag_based"
  /** Só um humano decide (aprovação de footage/tela de produto) — nunca automatizável. */
  | "human_approval"
  /** Geometria de marcação de cantos (Product Compositing) — nunca inferida, sempre de keyframes reais. */
  | "geometry"
  /** Derivado de uma regra agregada da campanha (ex.: minVideoRatio), nunca de um campo do próprio asset. */
  | "derived_aggregate"
  /** Categoria fora do alcance de avaliação por asset visual nesta sprint (ex.: áudio/narração) — documentado, nunca fingido. */
  | "not_evaluable";

export type RequirementSource =
  /** Declarado pelo próprio Shot no plano original (Bruno/Vanessa via VisualAssetSearchQuery/MediaShotPlanEntry). */
  | "shot_plan"
  /** Elevado por uma regra agregada de diversidade da campanha (ex.: "faltam vídeos, este Shot vira vídeo obrigatório"). */
  | "diversity_requirement"
  /** Nasce do próprio perfil de qualidade (ex.: exigência de end card). */
  | "quality_profile";

export type ShotRequirement = {
  requirementId: string;
  shotId: string;
  sceneOrder: number;
  shotOrder?: number;
  category: RequirementCategory;
  description: string;
  /** 0 a 1 — peso relativo do requisito na cobertura do Shot (requisitos obrigatórios pesam mais nas agregações). */
  weight: number;
  mandatory: boolean;
  validationMethod: RequirementValidationMethod;
  source: RequirementSource;
};

export type ShotRequirementSet = {
  shotId: string;
  sceneOrder: number;
  shotOrder?: number;
  sceneName: string;
  requirements: ShotRequirement[];
};

export function buildRequirementId(shotId: string, category: RequirementCategory, suffix?: string): string {
  return suffix ? `${shotId}::${category}::${suffix}` : `${shotId}::${category}`;
}
