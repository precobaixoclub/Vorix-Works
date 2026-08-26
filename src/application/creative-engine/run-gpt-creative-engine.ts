import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import {
  buildCreativePlanPrompt,
  buildImageGenerationPromptFromPlan,
  parseCreativePlan,
  type ChosenCreativeDirection,
  type CreativeContext,
  type CreativePlan,
  type CreativePlanAssetRole,
  type CreativePlanRect,
} from "../../shared/utils/gpt-creative-plan.types.js";
import { exploreCreativeDirections, type CreativeDirectionExploration } from "./explore-creative-directions.js";
import type { CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { resolveProductRenderMode, type AssetSuitabilityScore, type ProductRenderModeDecision } from "../../shared/utils/product-asset.types.js";
import {
  evaluateCreativeQualityGate,
  type CreativeQualityGateResult,
} from "./evaluate-creative-quality-gate.js";
import { buildCreativePlanRepairPrompt, MAX_CREATIVE_REPAIR_ROUNDS, routeCreativeRepair, type CreativeRepairRound } from "./creative-repair.js";
import { evaluateVisualQualityScore, buildAestheticRepairInstructions, type VisualQualityScoreResult } from "./evaluate-visual-quality-score.js";

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
  /** Auditoria "qualidade visual e direção de arte" — DELIBERADAMENTE separado de `qualityGate`
   * (pass/fail técnico). `undefined` quando o gate técnico nunca chegou a passar (score nunca roda
   * antes disso) OU quando a chamada de visão falhou/veio incompleta (best-effort, nunca bloqueia
   * a peça por uma falha de leitura da IA — ver `evaluateVisualQualityScore`). */
  visualQualityScore?: VisualQualityScoreResult;
  /** Auditoria "qualidade visual e direção de arte", ponto 9 — exploração barata de 2-3 direções
   * criativas ANTES do plano detalhado (ver `explore-creative-directions.ts`). `undefined` quando
   * a chamada falhou/veio incompleta (best-effort — a geração segue sem âncora, exatamente como
   * funcionava antes desta etapa existir). */
  chosenCreativeDirection?: CreativeDirectionExploration;
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

// Achado ao vivo em produção: a primeira resposta do plano veio com JSON malformado/incompleto
// (falha passageira do modelo, não do nosso código — mesma classe já corrigida pro plano de
// REPARO, ver `MAX_REPAIR_JSON_ATTEMPTS` abaixo) e derrubava a execução inteira na hora, sem
// nenhuma chance de reparo (o plano nem chega a existir, então não há o que reparar). Mesma
// segunda tentativa com o MESMO prompt antes de desistir.
const MAX_INITIAL_PLAN_JSON_ATTEMPTS = 2;

// Achado ao vivo em produção: mesmo com o retry acima, DUAS tentativas seguidas vieram com JSON
// inválido — sugere corte por limite de tokens, não só falha aleatória passageira. O schema do
// plano cresceu bastante desde que `1_600` foi escolhido (regras novas empurram o diretor a
// definir MAIS `textZones` com geometria completa — headline/subheadline/CTA agora todos com
// `renderedBy`/`rect` — além de todos os campos de texto livre já existentes). Mais espaço de
// sobra nunca piora nada; cortar o JSON no meio sempre reprova o plano inteiro.
const CREATIVE_PLAN_MAX_TOKENS = 2_400;

async function requestCreativePlan(
  icaro: IcaroBrainPort,
  context: CreativeContext,
  executionId: string,
  correlationId: string,
  track: (response: IcaroAIResponse | undefined) => void,
  chosenDirection?: ChosenCreativeDirection,
): Promise<{ plan?: CreativePlan; response?: IcaroAIResponse }> {
  let lastResponse: IcaroAIResponse | undefined;
  for (let jsonAttempt = 1; jsonAttempt <= MAX_INITIAL_PLAN_JSON_ATTEMPTS; jsonAttempt++) {
    const response = await icaro.request({
      taskType: "analysis",
      prompt: buildCreativePlanPrompt(context, chosenDirection),
      specialistId: SPECIALIST_ID,
      executionId,
      correlationId,
      imageUrls: context.assets.map((asset) => asset.url),
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.4,
      maxTokens: CREATIVE_PLAN_MAX_TOKENS,
      timeoutMs: 45_000,
    });
    track(response);
    lastResponse = response;
    if (response.status !== "completed") continue;
    try {
      const plan = parseCreativePlan(extractJson(String(response.content ?? ""), "GPT Creative Plan"));
      if (plan) return { plan, response };
    } catch {
      // tenta de novo (ou desiste, se for a última tentativa)
    }
  }
  return { response: lastResponse };
}

// Achado ao vivo em produção (mesma classe de bug do plano inicial, ver `MAX_INITIAL_PLAN_JSON_ATTEMPTS`
// acima): uma resposta de CORREÇÃO com JSON malformado/incompleto também acontece — mesma segunda
// tentativa com o MESMO prompt antes de desistir. Fatorado aqui porque a partir da auditoria
// "qualidade visual e direção de arte" existem DUAS origens de correção (gate técnico e Visual
// Quality Score abaixo do piso) que precisam do mesmo mecanismo de reparo — nunca duplicar a lógica
// de retry entre elas.
const MAX_REPAIR_JSON_ATTEMPTS = 2;

async function requestRepairedPlan(
  icaro: IcaroBrainPort,
  previousPlan: CreativePlan,
  context: CreativeContext,
  instructions: readonly string[],
  executionId: string,
  correlationId: string,
  track: (response: IcaroAIResponse | undefined) => void,
): Promise<CreativePlan | undefined> {
  const repairPrompt = buildCreativePlanRepairPrompt(previousPlan, context, instructions);
  for (let jsonAttempt = 1; jsonAttempt <= MAX_REPAIR_JSON_ATTEMPTS; jsonAttempt++) {
    const repairResponse = await icaro.request({
      taskType: "analysis",
      prompt: repairPrompt,
      specialistId: SPECIALIST_ID,
      executionId,
      correlationId,
      imageUrls: context.assets.map((asset) => asset.url),
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.4,
      maxTokens: CREATIVE_PLAN_MAX_TOKENS,
      timeoutMs: 45_000,
    });
    track(repairResponse);
    if (repairResponse.status === "completed") {
      try {
        const plan = parseCreativePlan(extractJson(String(repairResponse.content ?? ""), "GPT Creative Plan Repair"));
        if (plan) return plan;
      } catch {
        // tenta de novo (ou desiste, se for a última tentativa)
      }
    }
  }
  return undefined;
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
      chosenCreativeDirection,
      ...extra,
    };
  }

  // Ponto 9 da auditoria "qualidade visual e direção de arte" — uma ÚNICA chamada de texto barata
  // ANTES do plano detalhado, pra ancorar o plano numa direção criativa concreta (e, via
  // `context.recentHistory`, evitar repetir o conceito visual de peças recentes — ponto 10). Best-
  // effort: `undefined` (chamada falhou/resposta incompleta) segue direto pro plano SEM âncora,
  // comportamento idêntico ao motor antes desta etapa existir.
  const chosenCreativeDirection = await exploreCreativeDirections(deps.creativeBrain, context, {
    specialistId: SPECIALIST_ID,
    executionId: input.executionRunId,
    correlationId: input.creativeEngineRunId,
  });
  const chosenDirectionAnchor: ChosenCreativeDirection | undefined = chosenCreativeDirection
    ? chosenCreativeDirection.candidates[chosenCreativeDirection.chosenIndex]
    : undefined;

  const { plan: initialPlan, response: planResponse } = await requestCreativePlan(
    deps.creativeBrain,
    context,
    input.executionRunId,
    input.creativeEngineRunId,
    track,
    chosenDirectionAnchor,
  );
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
        // Auditoria "qualidade visual e direção de arte" — o gate técnico só garante que a peça
        // NÃO TEM defeito grave; nunca garantiu que ela é boa. Visual Quality Score roda só aqui
        // (nunca antes do gate técnico passar — sem sentido avaliar estética de algo já quebrado).
        const visualQualityScore = await evaluateVisualQualityScore(deps.creativeBrain, {
          finalImageUrl: uploaded.url,
          plan,
          brandColors: context.brandColors,
          specialistId: SPECIALIST_ID,
        });

        // `undefined` (chamada falhou/resposta incompleta) nunca bloqueia — best-effort, mesmo
        // espírito do resto do gate. Só um resultado EXPLÍCITO abaixo do piso reprova.
        if (!visualQualityScore || !visualQualityScore.belowThreshold) {
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
            visualQualityScore,
            chosenCreativeDirection,
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

        if (repairAttempt >= MAX_CREATIVE_REPAIR_ROUNDS) {
          return fail(
            "CREATIVE_VISUAL_QUALITY_BELOW_THRESHOLD: a peça passou no quality gate técnico, mas ficou abaixo do piso mínimo de qualidade visual mesmo após as rodadas de reparo disponíveis.",
            "CREATIVE_VISUAL_QUALITY_BELOW_THRESHOLD",
            { creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, visualQualityScore, repairRounds, compositionSteps: textCompositionSteps, finalImageUrl: uploaded.url, finalImageWidth, finalImageHeight },
          );
        }

        // Reparo estético sempre volta ao GPT (`gpt_replan`) — nunca `renderer_reflow`: nenhum
        // defeito de qualidade visual (hierarquia, composição, direção genérica) é puramente
        // geométrico-de-renderer. Compartilha o MESMO contador `repairAttempt`/limite do gate
        // técnico — ver auditoria, ponto 15 ("não aumentar complexidade/custo indefinidamente").
        const aestheticInstructions = buildAestheticRepairInstructions(visualQualityScore);
        repairRounds.push({ round: repairAttempt + 1, route: "gpt_replan", issues: [], instructions: aestheticInstructions, resolved: false });
        repairAttempt += 1;

        const repairedPlan = await requestRepairedPlan(deps.creativeBrain, plan, context, aestheticInstructions, input.executionRunId, input.creativeEngineRunId, track);
        if (!repairedPlan) {
          return fail("Não foi possível obter um creative_plan de correção estética válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", {
            creativePlan: plan,
            finalImagePrompt: imagePrompt,
            qualityGate,
            visualQualityScore,
            repairRounds,
            compositionSteps: textCompositionSteps,
          });
        }

        plan = repairedPlan;
        continue outerImageRound;
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
      // `requestRepairedPlan` já cobre a segunda tentativa em caso de JSON malformado/incompleto
      // (achado ao vivo em produção, ver comentário na definição da função) — nunca conta como uma
      // rodada de reparo nova (o `repairAttempt` já foi incrementado acima, pra continuar contra o
      // limite de rounds normal).
      const repairedPlan = await requestRepairedPlan(deps.creativeBrain, plan, context, routed.instructions, input.executionRunId, input.creativeEngineRunId, track);

      if (!repairedPlan) {
        return fail("Não foi possível obter um creative_plan de correção válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", {
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
