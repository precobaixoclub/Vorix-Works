import type { WorkflowIntent } from "../../domain/workflows/workflow.contract.js";
import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";

export type ExecutionPlanStepType = "skill" | "human_gate" | "system";

/**
 * Declaração genérica e estrutural de como preencher parte da entrada de uma etapa a partir da
 * saída (já concluída) de outra etapa do mesmo plano. Nunca referencia um tipo de Skill — apenas
 * nomes de campo em texto — para que Arthur e Caio nunca precisem importar tipos de nenhuma Skill
 * (ADR 0002). `targetField: null` substitui o input inteiro da etapa pelo valor resolvido (ex.:
 * Maria recebe o briefing do João diretamente, sem envelope). `sourcePath` é um caminho separado
 * por ponto dentro do `output` da etapa de origem (ex.: "sofiaBriefing", "quality.score"); omitido,
 * usa o `output` inteiro. `pick`, quando o valor resolvido é um array de objetos, mantém em cada
 * item somente essas chaves — cobre o caso de reduzir uma lista de imagens a `{ uri, mimeType }`.
 */
export type ExecutionPlanInputBinding = {
  targetField: string | null;
  fromStepId: string;
  sourcePath?: string;
  pick?: string[];
};

export type ExecutionPlanStep = {
  id: string;
  order: number;
  type: ExecutionPlanStepType;
  name: string;
  skillCapability?: SkillCapability;
  instructions: string;
  input: Record<string, unknown>;
  inputBindings?: ExecutionPlanInputBinding[];
  expectedOutput: string;
  dependsOn: string[];
};

export type ExecutionPlanTenantContext = {
  clientId: string;
  tenantId?: string;
  source: "input" | "valentina";
};

export type ExecutionPlan = {
  id: string;
  intent: WorkflowIntent;
  createdBy: "arthur";
  tenant: ExecutionPlanTenantContext;
  steps: ExecutionPlanStep[];
  acceptanceCriteria: string[];
};
