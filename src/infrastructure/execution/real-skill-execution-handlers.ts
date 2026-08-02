import type { ExecutionTaskHandlerPort, ExecutionTaskHandlerRequest, ExecutionTaskHandlerResult, ExecutionTaskInputs } from "../../application/execution/execution-handler.port.js";
import { createDefaultExecutionContractRegistry, type ExecutionContract } from "../../application/execution/execution-contract-registry.js";
import { mapExecutionCapabilityToSkillCapability } from "../../application/execution/capability-mapping.js";
import type { HelenaSkillManagerPort } from "../../application/skills/helena.contract.js";
import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillArtifact, SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";

type SkillCallResult = {
  output: Record<string, unknown>;
  artifacts: Record<string, unknown>[];
  warnings: string[];
  skillId: string;
  taskId: string;
};

const contractRegistry = createDefaultExecutionContractRegistry();

export class SingleSkillExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(
    private readonly deps: {
      helena: HelenaSkillManagerPort;
      capability: ExecutionCapability;
      taskType: TaskType;
      skillCapability: string;
      outputPort: string;
      provider?: string;
    },
  ) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === this.deps.capability && taskType === this.deps.taskType;
  }

  async validateAvailability(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    return validateSkillsAvailable(this.deps.helena, [this.deps.skillCapability]);
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    try {
      const skillInput = buildSingleSkillInput(request, this.deps.skillCapability);
      const result = await callSkill(this.deps.helena, this.deps.skillCapability, skillInput, request);
      const invalid = validateOutputContract(contract, result.output);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");
      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: this.deps.outputPort,
            payload: buildExecutionPayload(result, request.inputs, this.deps.provider ?? "helena"),
          }],
          warnings: result.warnings,
        },
      };
    } catch (error) {
      return { ok: false, error: classifySkillError(error) };
    }
  }
}

export class VisualPipelineExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly deps: { helena: HelenaSkillManagerPort; provider?: string }) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "visual_design" && taskType === "visual_generation";
  }

  async validateAvailability(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    return validateSkillsAvailable(this.deps.helena, ["art_direction", "social_media_design", "image_generation"]);
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    try {
      const structure = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
      const sofia = await callSkill(this.deps.helena, "art_direction", buildSofiaInput(request, structure), request);
      const bianca = await callSkill(this.deps.helena, "social_media_design", buildBiancaInput(request, structure, sofia.output), request);
      const pedro = await callSkill(this.deps.helena, "image_generation", buildPedroInput(request, structure, bianca.output), request);
      const invalid = validateOutputContract(contract, pedro.output);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");
      const warnings = [...sofia.warnings, ...bianca.warnings, ...pedro.warnings];
      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: contract.outputPort,
            payload: {
              ...buildExecutionPayload(pedro, request.inputs, this.deps.provider ?? "helena"),
              visualPipeline: {
                artDirection: sofia.output,
                designSpec: bianca.output,
                imageGeneration: pedro.output,
                skillIds: [sofia.skillId, bianca.skillId, pedro.skillId],
              },
            },
          }],
          warnings,
        },
      };
    } catch (error) {
      return { ok: false, error: classifySkillError(error) };
    }
  }
}

async function validateSkillsAvailable(helena: HelenaSkillManagerPort, capabilities: readonly string[]): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  for (const capability of capabilities) {
    const record = await helena.findSkillByCapability(capability as SkillCapability);
    if (!record?.manifest || !record.skill) {
      return { ok: false, code: "SKILL_NOT_FOUND", message: `Nenhuma Skill pronta para capability "${capability}".` };
    }
  }
  return { ok: true };
}

async function callSkill(helena: HelenaSkillManagerPort, skillCapability: string, input: Record<string, unknown>, request: ExecutionTaskHandlerRequest): Promise<SkillCallResult> {
  const response = await helena.executeSkill<Record<string, unknown>, Record<string, unknown>>({
    requestedBy: "execution",
    capability: skillCapability as SkillCapability,
    input,
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
        skillCapability,
      },
    },
  });
  return convertSkillResponse(response.response as SkillResponse);
}

function convertSkillResponse(response: SkillResponse): SkillCallResult {
  if (response.status !== "completed") {
    const error = new Error(response.error?.message ?? `Skill retornou status "${response.status}".`);
    error.name = response.error?.code ?? response.status;
    throw error;
  }
  return {
    output: normalizeObject(response.output),
    artifacts: response.artifacts.map(convertSkillArtifact),
    warnings: response.warnings,
    skillId: response.skillId,
    taskId: response.taskId,
  };
}

function buildSingleSkillInput(request: ExecutionTaskHandlerRequest, skillCapability: string): Record<string, unknown> {
  if (request.task.capability === "editorial_research") return buildResearchInput(request);
  if (request.task.capability === "strategic_planning") return buildStrategyInput(request);
  if (request.task.capability === "copywriting") return buildCopyInput(request);
  if (request.task.capability === "distribution") return buildDistributionInput(request);
  return { ...baseInput(request), skillCapability, inputs: request.inputs };
}

function buildResearchInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    desiredChannel: "instagram",
    desiredObjective: "Criar campanha de marketing.",
  };
}

function buildStrategyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const editorialBrief = unwrapExecutionPayload(firstPayload(request.inputs, "context"));
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    desiredChannel: stringValue(editorialBrief.recommendedChannel, "instagram"),
    desiredFormat: stringValue(editorialBrief.recommendedFormatLabel, "carrossel"),
    desiredObjective: stringValue(editorialBrief.campaignObjective, "Criar campanha de marketing."),
    editorialBrief,
  };
}

function buildCopyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const strategy = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
  const briefing = normalizeObject(strategy.mariaBriefing);
  return {
    objective: stringValue(briefing.objective ?? strategy.objective, "Criar campanha de marketing."),
    channel: stringValue(briefing.channel ?? strategy.channel, "instagram"),
    format: stringValue(briefing.format ?? strategy.format, "carrossel"),
    targetAudience: stringValue(briefing.targetAudience ?? strategy.targetAudience, "público principal"),
    toneOfVoice: stringValue(briefing.toneOfVoice ?? strategy.toneOfVoice, "claro e persuasivo"),
    cta: stringValue(briefing.cta ?? strategy.recommendedCta, "Saiba mais"),
    keyMessage: stringValue(briefing.keyMessage ?? strategy.centralPromise, "Mensagem principal da campanha"),
    keywords: stringArray(briefing.keywords),
    forbiddenTerms: stringArray(briefing.forbiddenTerms),
    mandatoryWords: stringArray(briefing.mandatoryWords),
    preferredHashtags: stringArray(briefing.preferredHashtags),
    language: "pt-BR",
    additionalContext: JSON.stringify({ executionRunId: request.context.executionRunId }),
  };
}

function buildSofiaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    joaoSofiaBriefing: normalizeObject(strategy.sofiaBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    visualObjective: stringValue(strategy.objective, "Criar peça visual da campanha."),
  };
}

function buildBiancaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>, sofia: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    sofiaDirection: sofia,
    sofiaBriefing: normalizeObject(sofia.biancaBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    recommendedSlideCount: numberValue(strategy.recommendedSlideCount, undefined),
  };
}

function buildPedroInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>, bianca: Record<string, unknown>): Record<string, unknown> {
  const imageCount = numberValue(strategy.recommendedSlideCount, 1) ?? 1;
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    biancaDesign: bianca,
    biancaPedroBriefing: normalizeObject(bianca.pedroBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    imageCount,
    desiredAspectRatio: stringValue(bianca.recommendedAspectRatio, "1:1"),
  };
}

function buildDistributionInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const decision = unwrapExecutionPayload(firstPayload(request.inputs, "decision"));
  const reviewedInputs = normalizeObject(decision.reviewedInputs);
  const copyPayload = unwrapExecutionPayload(firstPayloadFromReviewed(reviewedInputs, "copy"));
  const visualPayload = unwrapExecutionPayload(firstPayloadFromReviewed(reviewedInputs, "visual"));
  const strategy = unwrapExecutionPayload(firstPayload(normalizeObject(copyPayload.upstreamInputs) as ExecutionTaskInputs, "structure"));
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    mariaCopy: copyPayload.output ?? copyPayload,
    pedroImages: visualPayload.output ?? visualPayload,
    lucasReview: { reviewStatus: "approved", approvalRecommended: true, overallScore: 100 },
    humanApproval: { decision: decision.decision ?? "approved", approved: true },
    channels: ["instagram"],
    publishMode: "dry_run",
  };
}

function baseInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  return {
    tenantId: request.context.tenantId,
    workflowContext: {
      executionRunId: request.context.executionRunId,
      runtimePlanId: request.task.runtimePlanId,
      runtimeTaskId: request.task.id,
      executionCapability: request.task.capability,
    },
  };
}

function buildExecutionPayload(result: SkillCallResult, inputs: ExecutionTaskInputs, provider: string): Record<string, unknown> {
  return {
    skillId: result.skillId,
    taskId: result.taskId,
    output: result.output,
    artifacts: result.artifacts,
    warnings: result.warnings,
    upstreamInputs: inputs,
    provider,
    real: true,
  };
}

function requireContract(capability: ExecutionCapability, taskType: TaskType): ExecutionContract {
  const contract = contractRegistry.get({ capability, taskType });
  if (!contract) throw new Error(`EXECUTION_SKILL_CONTRACT_MISSING: ${capability}/${taskType}`);
  return contract;
}

function validateOutputContract(contract: ExecutionContract, output: Record<string, unknown>): string | undefined {
  const result = contractRegistry.validateSkillOutput(contract, output);
  return result.ok ? undefined : result.message;
}

function firstPayload(inputs: ExecutionTaskInputs, port: string): Record<string, unknown> {
  const payload = inputs[port]?.[0]?.payload;
  return normalizeObject(payload);
}

function firstPayloadFromReviewed(reviewedInputs: Record<string, unknown>, port: string): Record<string, unknown> {
  const entries = reviewedInputs[port];
  if (Array.isArray(entries) && entries[0] && typeof entries[0] === "object") return normalizeObject((entries[0] as { payload?: unknown }).payload);
  return {};
}

function unwrapExecutionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return normalizeObject(payload.output ?? payload);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function classifySkillError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido ao executar Skill.";
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return { code: "SKILL_TIMEOUT", message, category: "timeout" as const, retryable: true };
  if (lower.includes("rate")) return { code: "SKILL_RATE_LIMITED", message, category: "rate_limited" as const, retryable: true };
  if (lower.includes("auth") || lower.includes("unauthorized")) return { code: "SKILL_AUTHENTICATION_FAILED", message, category: "authentication" as const, retryable: false };
  if (lower.includes("schema") || lower.includes("output")) return { code: "SKILL_INVALID_OUTPUT", message, category: "invalid_output" as const, retryable: false };
  return { code: error instanceof Error && error.name !== "Error" ? error.name : "SKILL_INTERNAL_ERROR", message, category: "internal" as const, retryable: false };
}

function failure(code: string, message: string, category: "policy_violation" | "invalid_output"): ExecutionTaskHandlerResult {
  return { ok: false, error: { code, message, category, retryable: false } };
}

export function skillCapabilitiesForExecutionCapability(capability: ExecutionCapability): readonly string[] {
  if (capability === "visual_design") return ["art_direction", "social_media_design", "image_generation"];
  return [mapExecutionCapabilityToSkillCapability(capability).skillCapability];
}
