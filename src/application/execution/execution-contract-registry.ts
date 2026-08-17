import { z } from "zod";
import type { SideEffectPolicy } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability, PlanningArtifactType, TaskType } from "../../domain/planning/planning.model.js";
import type { RuntimeDetails } from "../ports/runtime-repository.port.js";
import type { ExecutionTaskInputs } from "./execution-handler.port.js";
import type { ExecutionFeatureFlags } from "./feature-flags.js";

export type ExecutionContractLimits = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxArtifacts: number;
  maxDepth: number;
  maxStringLength: number;
  maxItems: number;
};

export type ExecutionContract = {
  schemaId: string;
  schemaVersion: number;
  capability: ExecutionCapability;
  taskType: TaskType;
  inputPort?: string;
  outputPort: string;
  artifactType: PlanningArtifactType;
  cardinality: { min: number; max: number };
  acceptedArtifactTypes: readonly PlanningArtifactType[];
  inputSchema: z.ZodType<unknown>;
  skillOutputSchema: z.ZodType<unknown>;
  executionOutputSchema: z.ZodType<unknown>;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  limits: ExecutionContractLimits;
  featureFlag?: keyof ExecutionFeatureFlags;
  sideEffectPolicy: SideEffectPolicy;
  skillCapabilities: readonly string[];
};

export type ContractValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const DEFAULT_LIMITS: ExecutionContractLimits = {
  maxInputBytes: 32_000,
  maxOutputBytes: 64_000,
  maxArtifacts: 8,
  maxDepth: 24,
  maxStringLength: 8_000,
  maxItems: 100,
};

const baseSkillOutput = z.object({}).passthrough();
const executionPayloadSchema = z.object({
  skillId: z.string().min(1),
  taskId: z.string().min(1),
  output: z.record(z.string(), z.unknown()),
  artifacts: z.array(z.record(z.string(), z.unknown())),
  warnings: z.array(z.string()),
  upstreamInputs: z.record(z.string(), z.unknown()),
  provider: z.string().min(1),
  real: z.literal(true),
}).passthrough();

const researchOutputSchema = baseSkillOutput.extend({
  campaignObjective: z.string().min(1),
  recommendedFormatLabel: z.string().min(1),
  recommendedChannel: z.string().min(1),
  recommendedCta: z.string().min(1),
});

const planningOutputSchema = baseSkillOutput.extend({
  overallStrategy: z.string().min(1),
  objective: z.string().min(1),
  mariaBriefing: z.record(z.string(), z.unknown()),
  sofiaBriefing: z.record(z.string(), z.unknown()),
});

const copyOutputSchema = baseSkillOutput.extend({
  title: z.string().min(1),
  caption: z.string().min(1),
  cta: z.string().min(1),
  hashtags: z.array(z.string()).min(1),
});

const visualOutputSchema = baseSkillOutput.extend({
  generationSummary: z.string().min(1),
  imageCount: z.number().int().nonnegative(),
  images: z.array(z.record(z.string(), z.unknown())).min(1),
});

const contentBriefOutputSchema = baseSkillOutput.extend({
  objective: z.string().min(1),
  channel: z.string().min(1),
  format: z.string().min(1),
});

const qualityReviewOutputSchema = baseSkillOutput.extend({
  reviewStatus: z.string().min(1),
  overallScore: z.number(),
  approvalRecommended: z.boolean(),
});

const distributionOutputSchema = baseSkillOutput.extend({
  overallStatus: z.string().min(1),
  publishMode: z.literal("dry_run"),
  requestedChannels: z.array(z.string()).min(1),
});

const noInputSchema = z.record(z.string(), z.array(z.object({
  artifactId: z.string(),
  checksum: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
}))).optional();

export class ExecutionContractRegistry {
  private readonly contracts = new Map<string, ExecutionContract>();

  register(contract: ExecutionContract): void {
    const key = keyFor(contract.capability, contract.taskType, contract.schemaVersion);
    if (this.contracts.has(key)) throw new Error(`EXECUTION_CONTRACT_DUPLICATE: ${key}`);
    this.contracts.set(key, contract);
  }

  get(input: { capability: ExecutionCapability; taskType: TaskType; schemaVersion?: number }): ExecutionContract | undefined {
    return this.contracts.get(keyFor(input.capability, input.taskType, input.schemaVersion ?? 1));
  }

  list(): readonly ExecutionContract[] {
    return [...this.contracts.values()].sort((left, right) => left.capability.localeCompare(right.capability));
  }

  validateInputs(contract: ExecutionContract, inputs: ExecutionTaskInputs): ContractValidationResult {
    const limitFailure = validatePayloadLimits(inputs, contract.limits, "input");
    if (limitFailure) return limitFailure;
    const parsed = contract.inputSchema.safeParse(inputs);
    if (!parsed.success) return { ok: false, code: "EXECUTION_INPUT_SCHEMA_INVALID", message: z.prettifyError(parsed.error) };
    const count = contract.inputPort ? inputs[contract.inputPort]?.length ?? 0 : 0;
    if (count < contract.cardinality.min || count > contract.cardinality.max) {
      return { ok: false, code: "EXECUTION_INPUT_CARDINALITY_INVALID", message: `Input "${contract.inputPort ?? "root"}" tem cardinalidade ${count}; esperado ${contract.cardinality.min}-${contract.cardinality.max}.` };
    }
    return { ok: true };
  }

  validateSkillOutput(contract: ExecutionContract, output: unknown): ContractValidationResult {
    const limitFailure = validatePayloadLimits(output, contract.limits, "output");
    if (limitFailure) return limitFailure;
    const parsed = contract.skillOutputSchema.safeParse(output);
    if (!parsed.success) return { ok: false, code: "SKILL_OUTPUT_SCHEMA_INVALID", message: z.prettifyError(parsed.error) };
    return { ok: true };
  }

  validateExecutionOutput(contract: ExecutionContract, output: unknown): ContractValidationResult {
    const limitFailure = validatePayloadLimits(output, contract.limits, "output");
    if (limitFailure) return limitFailure;
    const parsed = contract.executionOutputSchema.safeParse(output);
    if (!parsed.success) return { ok: false, code: "EXECUTION_OUTPUT_SCHEMA_INVALID", message: z.prettifyError(parsed.error) };
    return { ok: true };
  }

  validateRuntimeCompatibility(contract: ExecutionContract, runtimeDetails: RuntimeDetails, runtimeTaskId: string): ContractValidationResult {
    const output = runtimeDetails.outputs.find((candidate) => candidate.runtimeTaskId === runtimeTaskId && candidate.portKey === contract.outputPort);
    if (!output) return { ok: false, code: "EXECUTION_CONTRACT_OUTPUT_PORT_MISSING", message: `RuntimeTask "${runtimeTaskId}" não declara outputPort "${contract.outputPort}".` };
    if (output.artifactType !== contract.artifactType && contract.capability !== "visual_design") {
      return { ok: false, code: "EXECUTION_CONTRACT_ARTIFACT_TYPE_MISMATCH", message: `Runtime output "${contract.outputPort}" produz "${output.artifactType}", contrato exige "${contract.artifactType}".` };
    }
    const input = contract.inputPort ? runtimeDetails.inputs.find((candidate) => candidate.runtimeTaskId === runtimeTaskId && candidate.portKey === contract.inputPort) : undefined;
    if (contract.inputPort && !input) return { ok: false, code: "EXECUTION_CONTRACT_INPUT_PORT_MISSING", message: `RuntimeTask "${runtimeTaskId}" não declara inputPort "${contract.inputPort}".` };
    if (input && !contract.acceptedArtifactTypes.some((type) => input.acceptedArtifactTypes.includes(type))) {
      return { ok: false, code: "EXECUTION_CONTRACT_INPUT_TYPE_MISMATCH", message: `Input "${input.portKey}" não aceita nenhum artifactType exigido pelo contrato.` };
    }
    return { ok: true };
  }
}

export function createDefaultExecutionContractRegistry(): ExecutionContractRegistry {
  const registry = new ExecutionContractRegistry();
  for (const contract of DEFAULT_EXECUTION_CONTRACTS) registry.register(contract);
  return registry;
}

export const DEFAULT_EXECUTION_CONTRACTS: readonly ExecutionContract[] = [
  contract({
    schemaId: "research.context",
    capability: "editorial_research",
    taskType: "research",
    outputPort: "context",
    artifactType: "document",
    cardinality: { min: 0, max: 0 },
    acceptedArtifactTypes: [],
    skillOutputSchema: researchOutputSchema,
    requiredFields: ["campaignObjective", "recommendedFormatLabel", "recommendedChannel", "recommendedCta"],
    optionalFields: ["recommendedSlideCount", "keyInsights"],
    featureFlag: "realExecutionResearchEnabled",
    sideEffectPolicy: "external_read",
    skillCapabilities: ["editorial_planning"],
  }),
  contract({
    schemaId: "campaign_structure.structure",
    capability: "strategic_planning",
    taskType: "campaign_structure",
    inputPort: "context",
    outputPort: "structure",
    artifactType: "document",
    cardinality: { min: 1, max: 1 },
    acceptedArtifactTypes: ["document"],
    skillOutputSchema: planningOutputSchema,
    requiredFields: ["overallStrategy", "objective", "mariaBriefing", "sofiaBriefing"],
    optionalFields: ["targetAudience", "channel", "format", "recommendedCta"],
    featureFlag: "realPlanningEnabled",
    sideEffectPolicy: "external_read",
    skillCapabilities: ["marketing_strategy"],
  }),
  contract({
    schemaId: "copy_generation.copy",
    capability: "copywriting",
    taskType: "copy_generation",
    inputPort: "structure",
    outputPort: "copy",
    artifactType: "text",
    cardinality: { min: 1, max: 1 },
    acceptedArtifactTypes: ["document"],
    skillOutputSchema: copyOutputSchema,
    requiredFields: ["title", "caption", "cta", "hashtags"],
    optionalFields: ["variations", "warnings"],
    featureFlag: "realCopyEnabled",
    sideEffectPolicy: "external_read",
    skillCapabilities: ["copywriting"],
  }),
  contract({
    schemaId: "visual_generation.visual",
    capability: "visual_design",
    taskType: "visual_generation",
    inputPort: "structure",
    outputPort: "visual",
    artifactType: "carousel",
    cardinality: { min: 1, max: 1 },
    acceptedArtifactTypes: ["document"],
    skillOutputSchema: visualOutputSchema,
    requiredFields: ["generationSummary", "imageCount", "images"],
    optionalFields: ["warnings", "assetRefs"],
    featureFlag: "realVisualEnabled",
    sideEffectPolicy: "external_write",
    skillCapabilities: ["art_direction", "social_media_design", "image_generation"],
    // O payload real embute o prompt final completo e NÃO truncado (`image.prompt` — Pedro guarda
    // o `finalPrompt` original para auditoria; só o adapter da OpenAI corta o que de fato envia,
    // ver `openai-image-provider-adapter.ts`) por imagem, mais os outputs inteiros de Sofia e
    // Bianca (`visualPipeline.artDirection`/`designSpec`) — os defaults de 64KB/8000 caracteres
    // (pensados para texto/copy) estouram sempre em produção real, mesmo com uma única imagem
    // (`finalPrompt` sozinho já passa de 100000 caracteres). Carrossel (até 4 imagens) tem a
    // margem mais folgada de propósito. `maxInputBytes` também precisou subir (achado ao vivo,
    // "EXECUTION_INPUT_LIMIT_EXCEEDED") — desde que `copy_generation` passou a alimentar
    // `visual_generation` no grafo `content_request-visual-only-v2`, o input combinado inclui as
    // até 3 tentativas de Maria (`attempts[].prompt`, cada uma já embutindo briefing+estratégia
    // inteiros), que sozinhas estouram os 32KB default.
    limits: { maxInputBytes: 500_000, maxOutputBytes: 2_000_000, maxStringLength: 150_000 },
  }),
  contract({
    schemaId: "content_brief.structure",
    capability: "content_brief",
    taskType: "content_brief",
    outputPort: "structure",
    artifactType: "document",
    cardinality: { min: 0, max: 0 },
    acceptedArtifactTypes: [],
    skillOutputSchema: contentBriefOutputSchema,
    requiredFields: ["objective", "channel", "format"],
    optionalFields: ["targetAudience", "offerOrSubject", "recommendedSlideCount"],
    sideEffectPolicy: "external_read",
    skillCapabilities: [],
  }),
  contract({
    schemaId: "quality_review.review",
    capability: "human_review",
    taskType: "quality_review",
    inputPort: "visual",
    outputPort: "review",
    artifactType: "document",
    cardinality: { min: 1, max: 1 },
    acceptedArtifactTypes: ["image", "video", "carousel"],
    skillOutputSchema: qualityReviewOutputSchema,
    requiredFields: ["reviewStatus", "overallScore", "approvalRecommended"],
    optionalFields: ["issues", "suggestions", "checklist"],
    sideEffectPolicy: "external_read",
    skillCapabilities: ["quality_review"],
    // Input combina structure + copy + visual — visual sozinho já carrega o prompt final de Pedro
    // (100KB+, ver contrato `visual_generation` acima) mais os outputs inteiros de Sofia/Bianca;
    // mesma folga aplicada aqui. `maxOutputBytes` também precisa da mesma folga: o payload de
    // execução (`buildExecutionPayload`) embute `upstreamInputs` — os MESMOS inputs gigantes —
    // dentro do próprio artefato de saída desta task (achado ao vivo, "EXECUTION_OUTPUT_LIMIT_
    // EXCEEDED" mesmo com a saída do Lucas em si sendo pequena).
    limits: { maxInputBytes: 2_500_000, maxOutputBytes: 2_500_000, maxStringLength: 150_000 },
  }),
  contract({
    schemaId: "publication.manifest",
    capability: "distribution",
    taskType: "publication",
    inputPort: "decision",
    outputPort: "manifest",
    artifactType: "document",
    cardinality: { min: 1, max: 1 },
    acceptedArtifactTypes: ["document"],
    skillOutputSchema: distributionOutputSchema,
    requiredFields: ["overallStatus", "publishMode", "requestedChannels"],
    optionalFields: ["publishedChannels", "failedChannels", "warnings"],
    featureFlag: "realDistributionEnabled",
    sideEffectPolicy: "publication_preview",
    skillCapabilities: ["social_publishing"],
  }),
] as const;

function contract(
  input: Omit<ExecutionContract, "schemaVersion" | "inputSchema" | "executionOutputSchema" | "limits"> &
    Partial<Pick<ExecutionContract, "inputSchema" | "executionOutputSchema">> & { limits?: Partial<ExecutionContractLimits> },
): ExecutionContract {
  return {
    ...input,
    schemaVersion: 1,
    inputSchema: input.inputSchema ?? noInputSchema,
    executionOutputSchema: input.executionOutputSchema ?? executionPayloadSchema,
    limits: { ...DEFAULT_LIMITS, ...input.limits },
  };
}

function keyFor(capability: ExecutionCapability, taskType: TaskType, schemaVersion: number): string {
  return `${capability}:${taskType}:v${schemaVersion}`;
}

function validatePayloadLimits(value: unknown, limits: ExecutionContractLimits, phase: "input" | "output"): ContractValidationResult | undefined {
  const stats = collectStats(value);
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  const code = phase === "input" ? "EXECUTION_INPUT_LIMIT_EXCEEDED" : "EXECUTION_OUTPUT_LIMIT_EXCEEDED";
  if (bytes > (phase === "input" ? limits.maxInputBytes : limits.maxOutputBytes)) return { ok: false, code, message: `${phase} excede limite de bytes.` };
  if (stats.depth > limits.maxDepth) return { ok: false, code, message: `${phase} excede profundidade máxima.` };
  if (stats.maxStringLength > limits.maxStringLength) return { ok: false, code, message: `${phase} excede tamanho máximo de string.` };
  if (stats.maxItems > limits.maxItems) return { ok: false, code, message: `${phase} excede quantidade máxima de itens.` };
  return undefined;
}

function collectStats(value: unknown, depth = 0): { depth: number; maxStringLength: number; maxItems: number } {
  if (typeof value === "string") return { depth, maxStringLength: value.length, maxItems: 0 };
  if (!value || typeof value !== "object") return { depth, maxStringLength: 0, maxItems: 0 };
  const entries = Array.isArray(value) ? value : Object.values(value);
  return entries.reduce(
    (stats, item) => {
      const child = collectStats(item, depth + 1);
      return {
        depth: Math.max(stats.depth, child.depth),
        maxStringLength: Math.max(stats.maxStringLength, child.maxStringLength),
        maxItems: Math.max(stats.maxItems, entries.length, child.maxItems),
      };
    },
    { depth, maxStringLength: 0, maxItems: entries.length },
  );
}
