import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import {
  buildCreativePlanPrompt,
  buildImageGenerationPromptFromPlan,
  parseCreativePlan,
  type CreativeContext,
  type CreativeContextAsset,
  type CreativePlan,
  type CreativePlanAssetRole,
} from "../../shared/utils/gpt-creative-plan.types.js";
import { commercialFactsFromReferenceIntelligence, type CommercialFact } from "../../shared/utils/commercial-fact-normalizer.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";
import { resolveProductRenderMode, type AssetSuitabilityScore, type ProductRenderModeDecision } from "../../shared/utils/product-asset.types.js";
import { evaluateGptPrototypeQualityGate, type GptPrototypeQualityGateResult } from "./evaluate-gpt-prototype-quality-gate.js";

/**
 * Protótipo Paralelo — GPT/OpenAI como motor criativo principal (ver plano em
 * `run-gpt-creative-prototype.md`, sessão de auditoria "Rodada 3"). Orquestração isolada, fora do
 * execution engine/planning/runtime — NUNCA chamada pela pipeline principal (Sofia/Bianca/Pedro/
 * Lucas continuam exatamente como estavam). Único ponto de entrada:
 * `scripts/run-gpt-creative-prototype.mjs`.
 *
 * Filosofia: o GPT concentra direção criativa (via `creative_plan`); o código só garante que
 * assets factuais reais (produto, screenshot, logo) nunca sejam inventados nem redesenhados por
 * um modelo generativo quando existe pixel real disponível; o gate final cobre só falhas graves.
 */

export async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export type RunGptCreativePrototypeDeps = {
  icaro: IcaroBrainPort;
  objectStorage: ObjectStoragePort;
  /** Mesma porta que `generate-visual-from-idea.ts` já usa — reaproveitada sem alteração para
   * extrair fatos comerciais REAIS de imagens de referência (nunca inventados pelo GPT). */
  referenceIntelligenceExtractor?: { extract(imageUrls: string[]): Promise<ReferenceIntelligence | undefined> };
  /** Composição determinística (sharp) — injetada como porta, não importada de
   * `src/infrastructure` diretamente (a camada de aplicação não depende de infraestrutura
   * concreta; `scripts/run-gpt-creative-prototype.mjs`, o composition root deste protótipo, é
   * quem liga as implementações reais de `logo-compositor.ts`/`screenshot-mockup-compositor.ts`). */
  compositeLogo(input: { imageBuffer: Buffer; logoBuffer: Buffer }): Promise<Buffer>;
  compositeScreenshot(input: { imageBuffer: Buffer; screenshotBuffer: Buffer }): Promise<Buffer>;
  computeAssetSuitability?(buffer: Buffer): Promise<AssetSuitabilityScore | undefined>;
  readImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }>;
};

export type RunGptCreativePrototypeInput = {
  tenantId: string;
  brandName: string;
  objective: string;
  channel: string;
  /** Proporção do formato final, ex.: "4:5", "9:16", "1:1". */
  format: string;
  ideaText: string;
  assets: CreativeContextAsset[];
  brandColors?: string[];
  forbiddenElements?: string[];
  /** Identifica esta execução nos logs/custo do Ícaro — sempre um valor fixo do protótipo, nunca
   * um id de Skill real (isto não é uma Skill, ver ADR 0002). */
  specialistId: string;
};

export type RunGptCreativePrototypeResult = {
  creativeContext: CreativeContext;
  creativePlan?: CreativePlan;
  productRenderDecision?: ProductRenderModeDecision;
  compositedAssetRoles: CreativePlanAssetRole[];
  finalImageUrl?: string;
  finalImageWidth?: number;
  finalImageHeight?: number;
  qualityGate?: GptPrototypeQualityGateResult;
  warnings: string[];
  error?: string;
};

function formatConfirmedFacts(facts: CommercialFact[]): string[] {
  const labels: Record<string, string> = {
    current_price: "Preço atual",
    previous_price: "Preço anterior",
    discount_percent: "Desconto",
    promotion: "Promoção",
    rating: "Avaliação",
    sales_count: "Unidades vendidas",
    shipping: "Frete",
    payment_terms: "Condição de pagamento",
  };
  return facts.map((fact) => `${labels[fact.type] ?? fact.type}: ${fact.value}${fact.currency ? ` ${fact.currency}` : ""}`);
}

async function buildCreativeContext(deps: RunGptCreativePrototypeDeps, input: RunGptCreativePrototypeInput): Promise<CreativeContext> {
  let confirmedFacts: string[] = [];
  const referenceUrls = input.assets.filter((asset) => asset.role === "product_photo" || asset.role === "screenshot").map((asset) => asset.url);
  if (deps.referenceIntelligenceExtractor && referenceUrls.length > 0) {
    const intelligence = await deps.referenceIntelligenceExtractor.extract(referenceUrls).catch(() => undefined);
    if (intelligence?.commercialFacts) confirmedFacts = formatConfirmedFacts(commercialFactsFromReferenceIntelligence(intelligence.commercialFacts));
  }

  return {
    brandName: input.brandName,
    objective: input.objective,
    channel: input.channel,
    format: input.format,
    ideaText: input.ideaText,
    assets: input.assets,
    confirmedFacts,
    brandColors: input.brandColors,
    forbiddenElements: input.forbiddenElements,
  };
}

async function requestCreativePlan(icaro: IcaroBrainPort, context: CreativeContext, specialistId: string): Promise<CreativePlan | undefined> {
  const response = await icaro.request({
    taskType: "analysis",
    prompt: buildCreativePlanPrompt(context),
    specialistId,
    imageUrls: context.assets.map((asset) => asset.url),
    expectedOutput: "json",
    priority: "quality",
    temperature: 0.4,
    maxTokens: 1_200,
    timeoutMs: 45_000,
  });
  if (response.status !== "completed") return undefined;
  try {
    return parseCreativePlan(extractJson(String(response.content ?? ""), "GPT Creative Plan"));
  } catch {
    return undefined;
  }
}

async function requestGeneratedImage(
  icaro: IcaroBrainPort,
  input: { prompt: string; specialistId: string; format: string; referenceImageUrl?: string },
): Promise<{ uri: string } | undefined> {
  const response = await icaro.request({
    taskType: "image_generation",
    prompt: input.prompt,
    specialistId: input.specialistId,
    timeoutMs: 90_000,
    context: {
      imageCount: 1,
      imageAspectRatio: input.format,
      referenceImageUrl: input.referenceImageUrl,
    },
    expectedOutput: "json",
    priority: "quality",
    maxTokens: 500,
  });
  if (response.status !== "completed") return undefined;
  try {
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "GPT Prototype Image")) as { images?: Array<{ uri?: string }> };
    const uri = parsed.images?.[0]?.uri;
    return uri ? { uri } : undefined;
  } catch {
    return undefined;
  }
}

function buildObjectKey(tenantId: string, suffix: string): string {
  return `gpt-creative-prototype/${tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${suffix}.jpg`;
}

export async function runGptParallelCreativePrototype(
  deps: RunGptCreativePrototypeDeps,
  input: RunGptCreativePrototypeInput,
): Promise<RunGptCreativePrototypeResult> {
  const warnings: string[] = [];
  const creativeContext = await buildCreativeContext(deps, input);

  const creativePlan = await requestCreativePlan(deps.icaro, creativeContext, input.specialistId);
  if (!creativePlan) {
    return { creativeContext, compositedAssetRoles: [], warnings, error: "Não foi possível obter um creative_plan válido do GPT." };
  }

  // Produto real: SEMPRE tratado como referência real na geração (mesmo mecanismo que Pedro já
  // usa por padrão, `/v1/images/edits`) — `computeAssetSuitabilityScore`/`resolveProductRenderMode`
  // entram aqui só como SINAL DE AUDITORIA (registrado no resultado, nunca decide silenciosamente
  // qual chamada fazer). Recorte pixel-a-pixel (modo `original_asset`, igual ao motor atual) fica
  // FORA de escopo deste protótipo — limitação documentada no relatório final.
  const productAsset = input.assets.find((asset) => asset.role === "product_photo");
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

  const imagePrompt = buildImageGenerationPromptFromPlan(creativePlan, creativeContext);
  const generated = await requestGeneratedImage(deps.icaro, {
    prompt: imagePrompt,
    specialistId: input.specialistId,
    format: input.format,
    referenceImageUrl: productAsset?.url,
  });
  if (!generated) {
    return { creativeContext, creativePlan, productRenderDecision, compositedAssetRoles: [], warnings, error: "Ícaro não devolveu uma imagem gerada." };
  }

  let currentBuffer: Buffer;
  try {
    currentBuffer = await fetchAsBuffer(generated.uri);
  } catch (error) {
    return { creativeContext, creativePlan, productRenderDecision, compositedAssetRoles: [], warnings, error: `Falha ao baixar a imagem gerada: ${error instanceof Error ? error.message : "erro desconhecido"}.` };
  }

  const compositedAssetRoles: CreativePlanAssetRole[] = [];

  const screenshotAsset = input.assets.find((asset) => asset.role === "screenshot");
  if (screenshotAsset) {
    try {
      const screenshotBuffer = await fetchAsBuffer(screenshotAsset.url);
      currentBuffer = await deps.compositeScreenshot({ imageBuffer: currentBuffer, screenshotBuffer });
      compositedAssetRoles.push("screenshot");
    } catch (error) {
      warnings.push(`Não foi possível compor o screenshot real: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
    }
  }

  const logoAsset = input.assets.find((asset) => asset.role === "logo");
  if (logoAsset) {
    try {
      const logoBuffer = await fetchAsBuffer(logoAsset.url);
      currentBuffer = await deps.compositeLogo({ imageBuffer: currentBuffer, logoBuffer });
      compositedAssetRoles.push("logo");
    } catch (error) {
      warnings.push(`Não foi possível compor a logo real: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
    }
  }

  const uploaded = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "final"), body: currentBuffer, contentType: "image/jpeg" });

  const dimensions = await deps.readImageDimensions(currentBuffer);
  const finalImageWidth = dimensions.width ?? 0;
  const finalImageHeight = dimensions.height ?? 0;

  const qualityGate = await evaluateGptPrototypeQualityGate(deps.icaro, {
    finalImageUrl: uploaded.url,
    finalImageWidth,
    finalImageHeight,
    expectedAspectRatio: input.format,
    compositedAssetRoles,
    context: creativeContext,
    specialistId: input.specialistId,
  });

  return {
    creativeContext,
    creativePlan,
    productRenderDecision,
    compositedAssetRoles,
    finalImageUrl: uploaded.url,
    finalImageWidth,
    finalImageHeight,
    qualityGate,
    warnings,
  };
}
