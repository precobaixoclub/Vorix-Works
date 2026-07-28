import type { WorkflowIntent } from "../../domain/workflows/workflow.contract.js";
import type { ExecutionPlan } from "./execution-plan.contract.js";
import type { ArthurPlanningOutput, ArthurTextCommandInput } from "./arthur.types.js";

export type ArthurDecisionContext = {
  intent: WorkflowIntent;
  clientId: string;
  tenantId?: string;
  tenantSource?: "input" | "valentina";
  availableSkillIds: string[];
  availableCapabilities: string[];
  constraints: string[];
  /** Ver `ArthurTextCommandInput.musicFilePath`. */
  musicFilePath?: string;
};

export type ArthurOrchestratorPort = {
  createExecutionPlan(context: ArthurDecisionContext): Promise<ExecutionPlan>;
};

export type ArthurTextCommandPlannerPort = {
  planFromText(input: ArthurTextCommandInput): Promise<ArthurPlanningOutput>;
};

export type ArthurResponsibility =
  | "select_skills"
  | "order_execution"
  | "prepare_skill_inputs"
  | "validate_skill_outputs"
  | "compose_workflow_result";
