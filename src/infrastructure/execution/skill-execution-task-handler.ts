import type { ExecutionTaskHandlerPort, ExecutionTaskHandlerRequest, ExecutionTaskHandlerResult } from "../../application/execution/execution-handler.port.js";
import { mapExecutionCapabilityToSkillCapability } from "../../application/execution/capability-mapping.js";
import type { HelenaSkillManagerPort } from "../../application/skills/helena.contract.js";
import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillArtifact, SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";

export class SkillExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(
    private readonly deps: {
      helena: HelenaSkillManagerPort;
      supportedCapabilities: readonly ExecutionCapability[];
      provider?: string;
    },
  ) {}

  canHandle(capability: ExecutionCapability, _taskType: TaskType): boolean {
    return this.deps.supportedCapabilities.includes(capability);
  }

  async validateAvailability(capability: ExecutionCapability): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const mapping = mapExecutionCapabilityToSkillCapability(capability);
    const record = await this.deps.helena.findSkillByCapability(mapping.skillCapability as SkillCapability);
    if (!record?.manifest || !record.skill) {
      return { ok: false, code: "SKILL_NOT_FOUND", message: `Nenhuma Skill pronta para capability "${mapping.skillCapability}".` };
    }
    return { ok: true };
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") {
      return {
        ok: false,
        error: { code: "SKILL_HANDLER_REQUIRES_REAL_MODE", message: "SkillExecutionTaskHandler só executa em mode real.", category: "policy_violation", retryable: false },
      };
    }

    const mapping = mapExecutionCapabilityToSkillCapability(request.task.capability);
    const skillCapability = mapping.skillCapability as SkillCapability;
    const record = await this.deps.helena.findSkillByCapability(skillCapability);
    if (!record?.manifest) {
      return {
        ok: false,
        error: { code: "SKILL_NOT_FOUND", message: `Nenhuma Skill pronta para capability "${skillCapability}".`, category: "configuration", retryable: false },
      };
    }

    try {
      const result = await this.deps.helena.executeSkill({
        requestedBy: "execution",
        capability: skillCapability,
        input: buildSkillInput(request),
        context: {
          executionId: request.context.executionRunId,
          taskId: request.task.id,
          correlationId: request.context.executionRunId,
          locale: "pt-BR",
          tenantId: request.context.tenantId,
          dryRun: false,
          metadata: {
            runtimePlanId: request.task.runtimePlanId,
            runtimeTaskId: request.task.id,
            executionCapability: request.task.capability,
            provider: this.deps.provider ?? "helena",
          },
        },
      });
      return convertSkillResponse(request, result.response as SkillResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao executar Skill.";
      return { ok: false, error: classifySkillError(message) };
    }
  }
}

function buildSkillInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  return {
    executionCapability: request.task.capability,
    taskType: request.task.type,
    tenantId: request.context.tenantId,
    inputs: request.inputs,
    workflowContext: {
      executionRunId: request.context.executionRunId,
      runtimePlanId: request.task.runtimePlanId,
      runtimeTaskId: request.task.id,
      mode: request.context.mode,
    },
  };
}

function convertSkillResponse(request: ExecutionTaskHandlerRequest, response: SkillResponse): ExecutionTaskHandlerResult {
  if (response.status !== "completed") {
    return {
      ok: false,
      error: {
        code: response.error?.code ?? "SKILL_FAILED",
        message: response.error?.message ?? `Skill retornou status "${response.status}".`,
        category: response.status === "needs_more_context" ? "invalid_input" : "provider_unavailable",
        retryable: response.error?.recoverable ?? response.status !== "needs_more_context",
      },
    };
  }

  const outputPort = outputPortForTaskType(request.task.type);
  if (!outputPort) {
    return {
      ok: false,
      error: { code: "SKILL_OUTPUT_PORT_UNSUPPORTED", message: `Task ${request.task.type} não possui porta de saída real registrada.`, category: "invalid_output", retryable: false },
    };
  }

  return {
    ok: true,
    value: {
      outputs: [
        {
          outputPort,
          payload: {
            skillId: response.skillId,
            taskId: response.taskId,
            output: normalizeOutput(response.output),
            artifacts: response.artifacts.map(convertSkillArtifact),
            warnings: response.warnings,
            real: true,
          },
        },
      ],
    },
  };
}

function outputPortForTaskType(taskType: TaskType): string | undefined {
  if (taskType === "research") return "context";
  return undefined;
}

function convertSkillArtifact(artifact: SkillArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    status: artifact.status,
    uri: artifact.uri,
    file: artifact.file,
    dimensions: artifact.dimensions,
    metadata: artifact.metadata,
    items: artifact.items?.map(convertSkillArtifact),
  };
}

function normalizeOutput(output: unknown): Record<string, unknown> {
  if (typeof output === "object" && output !== null && !Array.isArray(output)) return output as Record<string, unknown>;
  return { value: output };
}

function classifySkillError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return { code: "SKILL_TIMEOUT", message, category: "timeout" as const, retryable: true };
  if (lower.includes("rate")) return { code: "SKILL_RATE_LIMITED", message, category: "rate_limited" as const, retryable: true };
  if (lower.includes("auth") || lower.includes("unauthorized")) return { code: "SKILL_AUTHENTICATION_FAILED", message, category: "authentication" as const, retryable: false };
  return { code: "SKILL_INTERNAL_ERROR", message, category: "internal" as const, retryable: false };
}
