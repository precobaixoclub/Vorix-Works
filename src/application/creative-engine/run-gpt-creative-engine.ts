import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import {
  buildCreativePlanPrompt,
  buildImageGenerationPromptFromPlan,
  parseCreativePlan,
  type CreativeContext,
  type CreativePlan,
  type CreativePlanAssetRole,
  type CreativePlanRect,
} from "../../shared/utils/gpt-creative-plan.types.js";
import type { CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { resolveProductRenderMode, type AssetSuitabilityScore, type ProductRenderModeDecision } from "../../shared/utils/product-asset.types.js";
import {
  evaluateCreativeQualityGate,
  type CreativeQualityGateResult,
} from "./evaluate-creative-quality-gate.js";
import { buildCreativePlanRepairPrompt, MAX_CREATIVE_REPAIR_ROUNDS, routeCreativeRepair, type CreativeRepairRound } from "./creative-repair.js";

/**
 * Motor criativo GPT — migração "GPT como motor criativo único" (PR 5/9). Promove
 * `runGptParallelCreativePrototype` (`run-gpt-creative-prototype.ts`) de script isolado para o
 * módulo real: `creative_context` chega pronto (montado por `build-creative-context.ts`, nunca
 * construído aqui dentro), toda chamada ao Ícaro carrega `executionId`/`correlationId` para
 * correlacionar com `icaro_ai_calls` (migração PR 1), a guarda de imagem é a mínima do motor GPT
 * (`creative-engine-image-guard.ts`, nunca a do Pedro), falhas de composição de asset real são
 * SEMPRE hard failure (PR 4), e existe um Repair Loop real: o quality gate descreve o problema, o
 * MESMO modelo diretor corrige (`gpt_replan`) — nunca o motor/renderer legado "refazendo" a
 * direção de arte — e só defeitos puramente geométricos de uma zona já delegada ao renderer
 * (`renderer_reflow`) são corrigidos sem nova chamada de IA.
 *
 * Filosofia preservada do protótipo: o GPT concentra direção criativa; o código só garante que
 * assets factuais reais (produto, screenshot, logo) nunca sejam inventados/redesenhados quando
 * existe pixel real disponível.
 */

export async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export type CompositionStepKind = "screenshot_mockup" | "logo_overlay" | "text_zones";

export type CompositionStep = {
  step: CompositionStepKind;
  rect?: CreativePlanRect;
  ok: boolean;
  detail: string;
};

export const GENERATION_METHODS = ["generation", "edit", "original_asset_composition"] as const;
export type GenerationMethod = (typeof GENERATION_METHODS)[number];

export type GptCreativeEngineDeps = {
  /** Instância do Ícaro DEDICADA ao motor criativo (modelo forte configurado especificamente
   * para o papel de diretor criativo — nunca a instância legada compartilhada com João/Maria/
   * Bianca/Pedro/Lucas). Wiring real fica para o PR 6 (container.ts); aqui é só a porta. */
  creativeBrain: IcaroBrainPort;
  objectStorage: ObjectStoragePort;
  /** Composição determinística (sharp) — injetada como porta, nunca importada de
   * `src/infrastructure` diretamente (camada de aplicação não depende de infraestrutura
   * concreta). `placement` vem sempre do `creative_plan.assetPlacements`. */
  compositeLogo(input: { imageBuffer: Buffer; logoBuffer: Buffer; placement?: CreativePlanRect }): Promise<Buffer>;
  compositeScreenshot(input: { imageBuffer: Buffer; screenshotBuffer: Buffer; placement: CreativePlanRect; frame?: "phone" | "laptop" }): Promise<Buffer>;
  renderTextZones(input: {
    baseImageBuffer: Buffer;
    zones: CreativePlan["textZones"];
    accentColor?: string;
    fontScale?: number;
  }): Promise<{ buffer: Buffer; renderedZones: unknown[] }>;
  computeAssetSuitability?(buffer: Buffer): Promise<AssetSuitabilityScore | undefined>;
  readImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }>;
  now?(): Date;
};

export type GptCreativeEngineInput = {
  executionRunId: string;
  creativeEngineRunId: string;
  tenantId: string;
  workspaceId: string;
  /** Já pronto — ver `build-creative-context.ts`. Este módulo nunca reinterpreta ou reconstrói o
   * contexto, só o usa. */
  creativeContext: CreativeContext;
};

export type GptCreativeEngineResult = {
  engineMode: "gpt";
  directorModel?: string;
  imageModel?: string;
  creativeContext: CreativeContext;
  creativePlan?: CreativePlan;
  finalImagePrompt?: string;
  generationMethod?: GenerationMethod;
  productRenderDecision?: ProductRenderModeDecision;
  assetsUsed: { role: CreativePlanAssetRole; url: string }[];
  compositedAssetRoles: CreativePlanAssetRole[];
  compositionSteps: CompositionStep[];
  qualityGate?: CreativeQualityGateResult;
  repairRounds: CreativeRepairRound[];
  finalImageUrl?: string;
  finalImageWidth?: number;
  finalImageHeight?: number;
  publishable: boolean;
  estimatedCostUsd: number;
  latencyMs: number;
  warnings: string[];
  error?: string;
  errorCode?: string;
};

const SPECIALIST_ID = "gpt-creative-director";

function buildObjectKey(tenantId: string, suffix: string): string {
  return `gpt-creative-engine/${tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${suffix}.jpg`;
}

async function requestCreativePlan(
  icaro: IcaroBrainPort,
  context: CreativeContext,
  executionId: string,
  correlationId: string,
): Promise<{ plan?: CreativePlan; response?: IcaroAIResponse }> {
  const response = await icaro.request({
    taskType: "analysis",
    prompt: buildCreativePlanPrompt(context),
    specialistId: SPECIALIST_ID,
    executionId,
    correlationId,
    imageUrls: context.assets.map((asset) => asset.url),
    expectedOutput: "json",
    priority: "quality",
    temperature: 0.4,
    maxTokens: 1_600,
    timeoutMs: 45_000,
  });
  if (response.status !== "completed") return { response };
  try {
    return { plan: parseCreativePlan(extractJson(String(response.content ?? ""), "GPT Creative Plan")), response };
  } catch {
    return { response };
  }
}

/** Deriva a guarda mínima do motor GPT a partir do `creative_plan` já produzido — nunca a
 * cláusula de supressão de texto do motor legado (ver `creative-engine-image-guard.ts`). */
function buildGuardInputFromPlan(plan: CreativePlan, context: CreativeContext): CreativeEngineImageGuardInput {
  const preservedAssetRoles = context.assets
    .map((asset) => asset.role)
    .filter((role): role is CreativePlanAssetRole => role === "product_photo" || role === "screenshot" || role === "logo");
  return {
    aspectRatio: context.format,
    preservedAssetRoles,
    confirmedFacts: context.confirmedFacts,
    forbiddenElements: [...(context.forbiddenElements ?? []), ...plan.forbiddenElements],
  };
}

async function requestGeneratedImage(
  icaro: IcaroBrainPort,
  input: { prompt: string; format: string; referenceImageUrl?: string; creativeGuard: CreativeEngineImageGuardInput; executionId: string; correlationId: string },
): Promise<{ uri?: string; response?: IcaroAIResponse }> {
  const response = await icaro.request({
    taskType: "image_generation",
    prompt: input.prompt,
    specialistId: SPECIALIST_ID,
    executionId: input.executionId,
    correlationId: input.correlationId,
    timeoutMs: 90_000,
    context: {
      imageCount: 1,
      imageAspectRatio: input.format,
      referenceImageUrl: input.referenceImageUrl,
      creativeGuard: input.creativeGuard,
    },
    expectedOutput: "json",
    priority: "quality",
    maxTokens: 500,
  });
  if (response.status !== "completed") return { response };
  try {
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "GPT Creative Engine Image")) as { images?: Array<{ uri?: string }> };
    return { uri: parsed.images?.[0]?.uri, response };
  } catch {
    return { response };
  }
}

export async function runGptCreativeEngine(deps: GptCreativeEngineDeps, input: GptCreativeEngineInput): Promise<GptCreativeEngineResult> {
  const startedAt = (deps.now?.() ?? new Date()).getTime();
  const warnings: string[] = [];
  const context = input.creativeContext;
  let estimatedCostUsd = 0;
  let latencyMs = 0;
  let directorModel: string | undefined;
  let imageModel: string | undefined;

  const track = (response: IcaroAIResponse | undefined) => {
    if (!response) return;
    estimatedCostUsd += response.cost?.estimated ?? 0;
    latencyMs += response.durationMs ?? 0;
  };

  function fail(error: string, errorCode: string, extra: Partial<GptCreativeEngineResult> = {}): GptCreativeEngineResult {
    return {
      engineMode: "gpt",
      directorModel,
      imageModel,
      creativeContext: context,
      assetsUsed: [],
      compositedAssetRoles: [],
      compositionSteps: [],
      repairRounds: [],
      publishable: false,
      estimatedCostUsd,
      latencyMs: Math.max(latencyMs, (deps.now?.() ?? new Date()).getTime() - startedAt),
      warnings,
      error,
      errorCode,
      ...extra,
    };
  }

  const { plan: initialPlan, response: planResponse } = await requestCreativePlan(
    deps.creativeBrain,
    context,
    input.executionRunId,
    input.creativeEngineRunId,
  );
  track(planResponse);
  directorModel = planResponse?.model?.id;
  if (!initialPlan) {
    return fail("Não foi possível obter um creative_plan válido do GPT.", "CREATIVE_PLAN_INVALID");
  }

  const screenshotAsset = context.assets.find((asset) => asset.role === "screenshot");
  const logoAsset = context.assets.find((asset) => asset.role === "logo");
  const productAsset = context.assets.find((asset) => asset.role === "product_photo");

  let productRenderDecision: ProductRenderModeDecision | undefined;
  if (productAsset) {
    try {
      const buffer = await fetchAsBuffer(productAsset.url);
      const suitability = await deps.computeAssetSuitability?.(buffer);
      productRenderDecision = resolveProductRenderMode({ hasReferenceImage: true, suitability });
    } catch (error) {
      warnings.push(`Não foi possível avaliar o asset de produto: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
    }
  }

  const generationMethod: GenerationMethod = productAsset ? "edit" : "generation";
  const repairRounds: CreativeRepairRound[] = [];
  let plan = initialPlan;
  let repairAttempt = 0;

  outerImageRound: for (;;) {
    if (screenshotAsset && !plan.assetPlacements.some((placement) => placement.role === "screenshot")) {
      return fail(
        "CREATIVE_PLAN_MISSING_ASSET_PLACEMENT: o creative_plan não definiu a geometria (assetPlacements) do screenshot real — a posição precisa ser decidida antes da geração, nunca improvisada depois.",
        "CREATIVE_PLAN_MISSING_ASSET_PLACEMENT",
        { creativePlan: plan, repairRounds },
      );
    }

    const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
    const creativeGuard = buildGuardInputFromPlan(plan, context);
    const { uri, response: imageResponse } = await requestGeneratedImage(deps.creativeBrain, {
      prompt: imagePrompt,
      format: context.format,
      referenceImageUrl: productAsset?.url,
      creativeGuard,
      executionId: input.executionRunId,
      correlationId: input.creativeEngineRunId,
    });
    track(imageResponse);
    imageModel = imageResponse?.model?.id ?? imageModel;
    if (!uri) {
      return fail("Ícaro não devolveu uma imagem gerada.", "IMAGE_GENERATION_FAILED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
    }

    let baseWithAssetsBuffer: Buffer;
    try {
      baseWithAssetsBuffer = await fetchAsBuffer(uri);
    } catch (error) {
      return fail(`Falha ao baixar a imagem gerada: ${error instanceof Error ? error.message : "erro desconhecido"}.`, "IMAGE_DOWNLOAD_FAILED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
    }

    const compositedAssetRoles: CreativePlanAssetRole[] = [];
    const assetsUsed: { role: CreativePlanAssetRole; url: string }[] = [];
    const roundCompositionSteps: CompositionStep[] = [];

    if (screenshotAsset) {
      const placement = plan.assetPlacements.find((candidate) => candidate.role === "screenshot")!;
      try {
        const screenshotBuffer = await fetchAsBuffer(screenshotAsset.url);
        baseWithAssetsBuffer = await deps.compositeScreenshot({
          imageBuffer: baseWithAssetsBuffer,
          screenshotBuffer,
          placement: placement.rect,
          frame: placement.frame === "laptop" ? "laptop" : "phone",
        });
        compositedAssetRoles.push("screenshot");
        assetsUsed.push({ role: "screenshot", url: screenshotAsset.url });
        roundCompositionSteps.push({ step: "screenshot_mockup", rect: placement.rect, ok: true, detail: "Screenshot real colado na geometria do creative_plan." });
      } catch (error) {
        return fail(
          `Falha ao compor o screenshot real: ${error instanceof Error ? error.message : "erro desconhecido"} — nunca publica com uma possível interface fictícia visível.`,
          "SCREENSHOT_COMPOSITE_FAILED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps },
        );
      }
    }

    if (logoAsset) {
      const placement = plan.assetPlacements.find((candidate) => candidate.role === "logo");
      try {
        const logoBuffer = await fetchAsBuffer(logoAsset.url);
        baseWithAssetsBuffer = await deps.compositeLogo({ imageBuffer: baseWithAssetsBuffer, logoBuffer, placement: placement?.rect });
        compositedAssetRoles.push("logo");
        assetsUsed.push({ role: "logo", url: logoAsset.url });
        roundCompositionSteps.push({ step: "logo_overlay", rect: placement?.rect, ok: true, detail: "Logo real colada." });
      } catch (error) {
        return fail(
          `Falha ao compor a logo real: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          "LOGO_COMPOSITE_FAILED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps },
        );
      }
    }
    if (productAsset) assetsUsed.push({ role: "product_photo", url: productAsset.url });

    const rendererZones = plan.textZones.filter((zone) => zone.renderedBy === "renderer");
    let fontScale = 1;

    innerTextRound: for (;;) {
      let finalBuffer = baseWithAssetsBuffer;
      const textCompositionSteps = [...roundCompositionSteps];
      if (rendererZones.length > 0) {
        try {
          const rendered = await deps.renderTextZones({
            baseImageBuffer: baseWithAssetsBuffer,
            zones: rendererZones,
            accentColor: context.brandColors?.[0],
            fontScale,
          });
          finalBuffer = rendered.buffer;
          textCompositionSteps.push({ step: "text_zones", ok: true, detail: `${rendererZones.length} zona(s) de texto renderizada(s) (fontScale=${fontScale.toFixed(2)}).` });
        } catch (error) {
          return fail(
            `Falha ao renderizar zonas de texto: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
            "TEXT_ZONES_RENDER_FAILED",
            { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: textCompositionSteps },
          );
        }
      }

      const uploaded = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "final"), body: finalBuffer, contentType: "image/jpeg" });
      const dimensions = await deps.readImageDimensions(finalBuffer);
      const finalImageWidth = dimensions.width ?? 0;
      const finalImageHeight = dimensions.height ?? 0;

      const qualityGate = await evaluateCreativeQualityGate(deps.creativeBrain, {
        finalImageUrl: uploaded.url,
        finalImageWidth,
        finalImageHeight,
        expectedAspectRatio: context.format,
        compositedAssetRoles,
        context,
        plan,
        specialistId: SPECIALIST_ID,
      });

      if (qualityGate.verdict === "pass") {
        return {
          engineMode: "gpt",
          directorModel,
          imageModel,
          creativeContext: context,
          creativePlan: plan,
          finalImagePrompt: imagePrompt,
          generationMethod,
          productRenderDecision,
          assetsUsed,
          compositedAssetRoles,
          compositionSteps: textCompositionSteps,
          qualityGate,
          repairRounds,
          finalImageUrl: uploaded.url,
          finalImageWidth,
          finalImageHeight,
          publishable: true,
          estimatedCostUsd,
          latencyMs: Math.max(latencyMs, (deps.now?.() ?? new Date()).getTime() - startedAt),
          warnings,
        };
      }

      const routed = routeCreativeRepair(qualityGate.issues, repairAttempt);
      repairRounds.push({ round: repairAttempt + 1, route: routed.route, issues: qualityGate.issues, instructions: routed.instructions, resolved: false });

      if (routed.route === "unrecoverable") {
        return fail("CREATIVE_QUALITY_GATE_NOT_PASSED: o quality gate reprovou a peça e o limite de tentativas de reparo foi atingido.", "CREATIVE_QUALITY_GATE_NOT_PASSED", {
          creativePlan: plan,
          finalImagePrompt: imagePrompt,
          qualityGate,
          repairRounds,
          compositionSteps: textCompositionSteps,
          finalImageUrl: uploaded.url,
          finalImageWidth,
          finalImageHeight,
        });
      }

      repairAttempt += 1;

      if (routed.route === "renderer_reflow") {
        fontScale = Math.max(0.4, fontScale * 0.75);
        continue innerTextRound;
      }

      // gpt_replan — sempre volta ao MESMO modelo diretor, nunca ao motor/renderer legado.
      const repairPrompt = buildCreativePlanRepairPrompt(plan, context, routed.instructions);
      const repairResponse = await deps.creativeBrain.request({
        taskType: "analysis",
        prompt: repairPrompt,
        specialistId: SPECIALIST_ID,
        executionId: input.executionRunId,
        correlationId: input.creativeEngineRunId,
        imageUrls: context.assets.map((asset) => asset.url),
        expectedOutput: "json",
        priority: "quality",
        temperature: 0.4,
        maxTokens: 1_600,
        timeoutMs: 45_000,
      });
      track(repairResponse);
      const repairedPlan = repairResponse.status === "completed"
        ? (() => {
            try {
              return parseCreativePlan(extractJson(String(repairResponse.content ?? ""), "GPT Creative Plan Repair"));
            } catch {
              return undefined;
            }
          })()
        : undefined;

      if (!repairedPlan) {
        return fail("Não foi possível obter um creative_plan de correção válido do GPT.", "CREATIVE_PLAN_REPAIR_INVALID", {
          creativePlan: plan,
          finalImagePrompt: imagePrompt,
          qualityGate,
          repairRounds,
          compositionSteps: textCompositionSteps,
        });
      }

      plan = repairedPlan;
      continue outerImageRound;
    }
  }
}
