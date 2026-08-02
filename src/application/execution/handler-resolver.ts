import type { ExecutionMode, HandlerFallbackPolicy } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";
import { mapExecutionCapabilityToSkillCapability, type ExecutionCapabilityMapping } from "./capability-mapping.js";
import type { ExecutionFeatureFlags } from "./feature-flags.js";
import type { ExecutionHandlerDescriptor, ExecutionHandlerRegistry } from "./handler-registry.js";

export type HandlerResolution =
  | { ok: true; descriptor: ExecutionHandlerDescriptor; capabilityMapping?: ExecutionCapabilityMapping; fallbackPolicy: HandlerFallbackPolicy }
  | { ok: false; error: { code: string; message: string; fallbackPolicy: HandlerFallbackPolicy; capabilityMapping?: ExecutionCapabilityMapping } };

export class ExecutionHandlerResolver {
  constructor(private readonly registry: ExecutionHandlerRegistry) {}

  resolve(input: { capability: ExecutionCapability; taskType: TaskType; executionMode: ExecutionMode; featureFlags: ExecutionFeatureFlags }): HandlerResolution {
    const fallbackPolicy = fallbackPolicyFor(input.capability);
    const capabilityMapping = input.executionMode === "real" ? mapExecutionCapabilityToSkillCapability(input.capability) : undefined;

    if (input.executionMode === "real" && !input.featureFlags.realExecutionEnabled) {
      return {
        ok: false,
        error: {
          code: "REAL_EXECUTION_DISABLED",
          message: "REAL_EXECUTION_ENABLED está desligado.",
          fallbackPolicy,
          capabilityMapping,
        },
      };
    }

    if (input.executionMode === "real" && input.capability === "editorial_research" && !input.featureFlags.realExecutionResearchEnabled) {
      return {
        ok: false,
        error: {
          code: "REAL_EXECUTION_RESEARCH_DISABLED",
          message: "REAL_EXECUTION_RESEARCH_ENABLED está desligado para editorial_research.",
          fallbackPolicy,
          capabilityMapping,
        },
      };
    }

    const disabledCapabilityFlag = disabledRealCapabilityFlag(input.capability, input.featureFlags);
    if (input.executionMode === "real" && disabledCapabilityFlag) {
      return {
        ok: false,
        error: {
          code: "REAL_CAPABILITY_DISABLED",
          message: `${disabledCapabilityFlag} está desligado para capability "${input.capability}".`,
          fallbackPolicy,
          capabilityMapping,
        },
      };
    }

    const candidates = this.registry.findCandidates(input).filter((candidate) => !(input.executionMode === "real" && candidate.provider === "deterministic"));
    if (candidates.length > 0) return { ok: true, descriptor: candidates[0], capabilityMapping, fallbackPolicy };

    if (input.executionMode === "real" && fallbackPolicy === "deterministic_fallback" && input.featureFlags.realExecutionEnabled === false) {
      const fallback = this.registry.findCandidates({ ...input, executionMode: "dry_run" })[0];
      if (fallback) return { ok: true, descriptor: fallback, capabilityMapping, fallbackPolicy };
    }

    return {
      ok: false,
      error: {
        code: "EXECUTION_HANDLER_NOT_AVAILABLE",
        message: `Nenhum handler habilitado para capability="${input.capability}" em mode="${input.executionMode}".`,
        fallbackPolicy,
        capabilityMapping,
      },
    };
  }
}

export function fallbackPolicyFor(capability: ExecutionCapability): HandlerFallbackPolicy {
  return capability === "human_review" ? "deterministic_fallback" : "fail_closed";
}

function disabledRealCapabilityFlag(capability: ExecutionCapability, flags: ExecutionFeatureFlags): string | undefined {
  if (capability === "strategic_planning" && !flags.realPlanningEnabled) return "REAL_PLANNING_ENABLED";
  if (capability === "copywriting" && !flags.realCopyEnabled) return "REAL_COPY_ENABLED";
  if (capability === "visual_design" && !flags.realVisualEnabled) return "REAL_VISUAL_ENABLED";
  if (capability === "distribution" && !flags.realDistributionEnabled) return "REAL_DISTRIBUTION_ENABLED";
  return undefined;
}
