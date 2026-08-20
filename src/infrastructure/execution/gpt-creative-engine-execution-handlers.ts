import type {
  ExecutionTaskHandlerPort,
  ExecutionTaskHandlerRequest,
  ExecutionTaskHandlerResult,
  ExecutionTaskInputs,
} from "../../application/execution/execution-handler.port.js";
import { createDefaultExecutionContractRegistry, type ExecutionContract } from "../../application/execution/execution-contract-registry.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";
import type { RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type { PreparedCommandRepositoryPort } from "../../application/ports/prepared-command-repository.port.js";
import type { ContentGenerationHistoryPort } from "../../application/ports/content-generation-history.port.js";
import type { CreativeEngineRunRepositoryPort } from "../../application/ports/creative-engine-run-repository.port.js";
import type { CreativeContextAsset } from "../../shared/utils/gpt-creative-plan.types.js";
import { buildCreativeContext, type BuildCreativeContextDeps } from "../../application/creative-engine/build-creative-context.js";
import { runGptCreativeEngine, type GptCreativeEngineDeps } from "../../application/creative-engine/run-gpt-creative-engine.js";

/**
 * Handlers de execução do motor GPT — migração "GPT como motor criativo único" (PR 6/9).
 * DELIBERADAMENTE independentes de `real-skill-execution-handlers.ts` (nunca importam de lá —
 * ver `scripts/check-creative-engine-isolation.mjs`): reimplementam localmente só a mecânica
 * neutra (leitura de `PreparedCommand`, empacotamento do payload de execução, validação de
 * contrato), nunca reaproveitam Bianca/Pedro/Lucas nem os tipos de layout do motor legado.
 *
 * `visual_generation` roda o motor GPT INTEIRO (creative_context → creative_plan → geração →
 * composição → quality gate → Repair Loop, tudo dentro de `run-gpt-creative-engine.ts`) — se o
 * gate reprovar e esgotar as tentativas de reparo, esta task falha e `quality_review` nunca
 * chega a rodar (a task seguinte no DAG). Por isso `quality_review` aqui só FORMATA o veredito já
 * decidido (nunca redecide, nunca aplica um score com autoridade real — `overallScore` é só
 * compatibilidade de schema).
 */

const contractRegistry = createDefaultExecutionContractRegistry();

function requireContract(capability: ExecutionCapability, taskType: TaskType): ExecutionContract {
  const contract = contractRegistry.get({ capability, taskType });
  if (!contract) throw new Error(`EXECUTION_SKILL_CONTRACT_MISSING: ${capability}/${taskType}`);
  return contract;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstPayload(inputs: ExecutionTaskInputs, port: string): Record<string, unknown> {
  return normalizeObject(inputs[port]?.[0]?.payload);
}

function unwrapExecutionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return normalizeObject(payload.output ?? payload);
}

function buildExecutionPayload(input: { skillId: string; taskId: string; output: Record<string, unknown>; warnings: string[] }, inputs: ExecutionTaskInputs): Record<string, unknown> {
  return {
    skillId: input.skillId,
    taskId: input.taskId,
    output: input.output,
    artifacts: [],
    warnings: input.warnings,
    upstreamInputs: inputs,
    provider: "gpt-creative-engine",
    real: true,
  };
}

function validateOutputContract(contract: ExecutionContract, output: Record<string, unknown>): string | undefined {
  const result = contractRegistry.validateSkillOutput(contract, output);
  return result.ok ? undefined : result.message;
}

function failure(code: string, message: string, category: "policy_violation" | "invalid_output" | "internal"): ExecutionTaskHandlerResult {
  return { ok: false, error: { code, message, category, retryable: false } };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Monta os assets reais a partir de `PreparedCommand.validatedInputs` — hoje só
 * `referenceImageUrl` (produto real, mesmo campo que o motor legado já usa) e `logoUrl`
 * existem no schema do briefing. Suporte completo a `referenceAssets[]` com papel
 * (screenshot/logo/product_photo explícitos) chega no PR 7 (superfície de API/UI) — este mapeamento
 * é propositalmente aditivo: quando `referenceAssets` existir no `validatedInputs`, é usado
 * diretamente; na ausência, cai para os campos únicos já existentes, nunca quebra.
 */
function buildAssetsFromValidatedInputs(validatedInputs: Record<string, string>): CreativeContextAsset[] {
  const assets: CreativeContextAsset[] = [];

  const explicitAssets = parseJsonArray(validatedInputs.referenceAssets);
  for (const item of explicitAssets) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const url = optionalString(record.url);
    const role = optionalString(record.role);
    if (!url || !role) continue;
    if (role !== "product_photo" && role !== "screenshot" && role !== "logo" && role !== "reference_style" && role !== "other") continue;
    assets.push({ url, role, description: optionalString(record.description) ?? "" });
  }
  if (assets.length > 0) return assets;

  const referenceImageUrl = optionalString(validatedInputs.referenceImageUrl);
  if (referenceImageUrl) assets.push({ url: referenceImageUrl, role: "product_photo", description: "" });
  const logoUrl = optionalString(validatedInputs.logoUrl);
  if (logoUrl) assets.push({ url: logoUrl, role: "logo", description: "" });
  const screenshotUrl = optionalString(validatedInputs.screenshotUrl);
  if (screenshotUrl) assets.push({ url: screenshotUrl, role: "screenshot", description: "" });

  return assets;
}

function parseForbiddenElements(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export type GptCreativeEngineVisualTaskHandlerDeps = GptCreativeEngineDeps &
  BuildCreativeContextDeps & {
    runtimeRepository: RuntimeRepositoryPort;
    preparedCommandRepository: PreparedCommandRepositoryPort;
    /** Ausente em memória (in-memory) desativa a persistência auditável — nunca bloqueia a
     * geração; é sempre best-effort (nunca deve derrubar a execução por falha de escrita). */
    creativeEngineRunRepository?: CreativeEngineRunRepositoryPort;
  };

export class GptCreativeEngineVisualTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly deps: GptCreativeEngineVisualTaskHandlerDeps) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "visual_design" && taskType === "visual_generation";
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract("visual_design", "visual_generation");

    const runtimePlan = await this.deps.runtimeRepository.getById(request.task.runtimePlanId);
    if (!runtimePlan) return failure("GPT_CREATIVE_ENGINE_RUNTIME_PLAN_NOT_FOUND", `RuntimePlan "${request.task.runtimePlanId}" não encontrado.`, "internal");
    const preparedCommand = await this.deps.preparedCommandRepository.getById(runtimePlan.sourceContext.preparedCommandId);
    if (!preparedCommand) return failure("GPT_CREATIVE_ENGINE_PREPARED_COMMAND_NOT_FOUND", `PreparedCommand "${runtimePlan.sourceContext.preparedCommandId}" não encontrado.`, "internal");

    const validatedInputs = preparedCommand.validatedInputs;
    const assets = buildAssetsFromValidatedInputs(validatedInputs);

    const creativeContext = await buildCreativeContext(this.deps, {
      workspaceId: request.context.workspaceId,
      brandName: stringValue(validatedInputs.brandName, "Marca"),
      objective: stringValue(validatedInputs.objective, "Criar peça visual atrativa."),
      channel: stringValue(validatedInputs.channel, "instagram"),
      // `aspectRatio` chega no PR 7 — até lá, cai para "4:5" (formato mais comum de feed).
      format: stringValue(validatedInputs.aspectRatio, "4:5"),
      ideaText: stringValue(validatedInputs.offerOrSubject, stringValue(validatedInputs.objective, "")),
      assets,
      forbiddenElements: parseForbiddenElements(validatedInputs.forbiddenElements),
    });

    const creativeEngineRunId = `cer-${request.task.id}`;
    const result = await runGptCreativeEngine(this.deps, {
      executionRunId: request.context.executionRunId,
      creativeEngineRunId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      creativeContext,
    });

    await this.persistRun(request, creativeEngineRunId, result).catch(() => undefined);

    if (!result.publishable || result.error) {
      return failure(result.errorCode ?? "GPT_CREATIVE_ENGINE_FAILED", result.error ?? "O motor GPT não produziu uma peça publicável.", "invalid_output");
    }

    const output: Record<string, unknown> = {
      generationSummary: `Peça gerada pelo motor GPT (${result.generationMethod ?? "generation"}) — ${result.compositedAssetRoles.length} asset(s) real(is) composto(s) determinísticamente.`,
      imageCount: 1,
      images: [
        {
          uri: result.finalImageUrl,
          width: result.finalImageWidth,
          height: result.finalImageHeight,
          prompt: result.finalImagePrompt,
          mimeType: "image/jpeg",
          altText: result.creativePlan?.title,
        },
      ],
      warnings: result.warnings,
      title: result.creativePlan?.title,
      description: result.creativePlan?.description,
      // Bloco de auditoria do motor GPT — nunca validado pelo schema Zod (passthrough), lido só
      // por `quality_review` (task seguinte) e pela tela de revisão/relatório final.
      creativeEngine: {
        engineMode: "gpt",
        creativeEngineRunId,
        directorModel: result.directorModel,
        imageModel: result.imageModel,
        creativeContext: result.creativeContext,
        creativePlan: result.creativePlan,
        finalImagePrompt: result.finalImagePrompt,
        generationMethod: result.generationMethod,
        assetsUsed: result.assetsUsed,
        compositionSteps: result.compositionSteps,
        qualityGate: result.qualityGate,
        repairRounds: result.repairRounds,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: result.latencyMs,
      },
    };

    const invalid = validateOutputContract(contract, output);
    if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");

    return {
      ok: true,
      value: {
        outputs: [{ outputPort: contract.outputPort, payload: buildExecutionPayload({ skillId: "gpt-creative-director", taskId: request.task.id, output, warnings: result.warnings }, request.inputs) }],
        warnings: result.warnings,
      },
    };
  }

  private async persistRun(request: ExecutionTaskHandlerRequest, creativeEngineRunId: string, result: Awaited<ReturnType<typeof runGptCreativeEngine>>): Promise<void> {
    if (!this.deps.creativeEngineRunRepository) return;
    await this.deps.creativeEngineRunRepository.create({
      id: creativeEngineRunId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      executionRunId: request.context.executionRunId,
      taskRunId: request.task.id,
      engineMode: "gpt",
      planningTemplate: "content_request-gpt-creative-v3",
      directorModel: result.directorModel ?? "unknown",
      imageModel: result.imageModel,
      generationMethod: result.generationMethod,
      creativeContext: result.creativeContext,
      creativePlan: result.creativePlan,
      finalImagePrompt: result.finalImagePrompt,
      assetsUsed: result.assetsUsed,
      compositionSteps: result.compositionSteps,
      qualityGate: result.qualityGate,
      repairRounds: result.repairRounds,
      finalImageUrl: result.finalImageUrl,
      finalImageWidth: result.finalImageWidth,
      finalImageHeight: result.finalImageHeight,
      publishable: result.publishable,
      estimatedCostUsd: result.estimatedCostUsd,
      latencyMs: result.latencyMs,
      status: result.publishable ? "completed" : "failed",
      errorCode: result.errorCode,
    });
  }
}

export type GptCreativeEngineQualityTaskHandlerDeps = {
  contentGenerationHistory?: ContentGenerationHistoryPort;
};

export class GptCreativeEngineQualityTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly deps: GptCreativeEngineQualityTaskHandlerDeps) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "human_review" && taskType === "quality_review";
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract("human_review", "quality_review");

    const visualPayload = unwrapExecutionPayload(firstPayload(request.inputs, "visual"));
    const creativeEngineBlock = normalizeObject(visualPayload.creativeEngine);
    const plan = normalizeObject(creativeEngineBlock.creativePlan);

    // O quality gate real (com Repair Loop) já rodou DENTRO do motor GPT
    // (`run-gpt-creative-engine.ts`), como parte da task `visual_generation` — se chegamos aqui,
    // é porque ele já passou (reprovação esgotada faz `visual_generation` falhar e o DAG nunca
    // chega a agendar esta task). Por isso esta task só FORMATA o veredito, nunca redecide.
    const output: Record<string, unknown> = {
      reviewStatus: "approved",
      // Campo de COMPATIBILIDADE DE SCHEMA apenas — o motor GPT nunca usa score como autoridade
      // (requisito da migração "GPT como motor criativo único"); 100 aqui só satisfaz
      // `qualityReviewOutputSchema`, nunca é lido como julgamento de qualidade real.
      overallScore: 100,
      approvalRecommended: true,
      issues: [],
      creativeEngine: creativeEngineBlock,
    };

    const invalid = validateOutputContract(contract, output);
    if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");

    await this.recordHistory(request, plan, creativeEngineBlock).catch(() => undefined);

    return {
      ok: true,
      value: {
        outputs: [{ outputPort: contract.outputPort, payload: buildExecutionPayload({ skillId: "gpt-creative-quality-gate", taskId: request.task.id, output, warnings: [] }, request.inputs) }],
      },
    };
  }

  private async recordHistory(request: ExecutionTaskHandlerRequest, plan: Record<string, unknown>, creativeEngineBlock: Record<string, unknown>): Promise<void> {
    if (!this.deps.contentGenerationHistory || Object.keys(plan).length === 0) return;
    await this.deps.contentGenerationHistory.recordGeneration({
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      executionRunId: request.context.executionRunId,
      headline: optionalString(plan.headline),
      title: optionalString(plan.title),
      caption: optionalString(plan.description),
      cta: optionalString(plan.cta),
      visualConcept: optionalString(plan.visualDirection),
      compositionSummary: optionalString(plan.compositionIntent),
      reviewStatus: "approved",
      engineMode: "gpt",
      creativeEngineRunId: optionalString(creativeEngineBlock.creativeEngineRunId),
      description: optionalString(plan.description),
    });
  }
}
