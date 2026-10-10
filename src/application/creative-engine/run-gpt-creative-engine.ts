import { BRAND_DENSITY_TO_PLAN, type AppliedBrandRule, type BrandIdentity } from "../../shared/utils/brand-identity.js";
import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import type { ScreenshotTextInventoryStorePort } from "../ports/screenshot-text-inventory-store.port.js";
import { resolveScreenshotTextInventory, type ScreenshotTextInventory } from "./screenshot-text-inventory.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import { extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";
import { evaluateInstitutionalBaseAlpha, resolveEditorialFamilyFromContext, scanEditorialBaseText, type EditorialBaseAlphaCoverage, type EditorialBaseTextDiagnostic } from "./editorial-base-checks.js";
import { describePtBrCopyWarnings, findPtBrMissingAccents } from "../../shared/utils/ptbr-copy-check.js";
import {
  buildCreativePlanPrompt,
  buildImageGenerationPromptFromPlan,
  diagnoseCreativePlanInvalidity,
  parseCreativePlan,
  resolveEditorialProductAssetRequirement,
  type ChosenCreativeDirection,
  type CreativeContext,
  type CreativePlan,
  type CreativePlanAssetRole,
  type CreativePlanParseOptions,
  type CreativePlanRect,
  type CreativePlanTextZone,
} from "../../shared/utils/gpt-creative-plan.types.js";
import { exploreCreativeDirections, type CreativeDirectionExploration } from "./explore-creative-directions.js";
import type { CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { resolveProductRenderMode, type AssetSuitabilityScore, type ProductRenderModeDecision } from "../../shared/utils/product-asset.types.js";
import {
  evaluateCreativeQualityGate,
  rectsOverlap,
  type CreativeQualityGateResult,
  type CreativeQualityIssue,
} from "./evaluate-creative-quality-gate.js";
import { buildCreativePlanRepairPrompt, classifyRepairStrategy, MAX_CREATIVE_REPAIR_ROUNDS, routeCreativeRepair, type CreativeRepairRound } from "./creative-repair.js";
import { evaluateVisualQualityScore, buildAestheticRepairInstructions, type VisualQualityScoreResult } from "./evaluate-visual-quality-score.js";
import { analyzePreCompositionImage, checkGlobalTextLegibility, type PreCompositionAnalysis } from "./analyze-pre-composition-image.js";
import {
  resolveActualTextZoneRect,
  chooseTextBackingTreatment,
  textBackingTreatmentToRendererStyle,
  sortTextZonesByPriority,
  expandBboxWithPadding,
  widenToCommercialBand,
  findMatchingCommercialZone,
  overlapsKnownAssetSubstantially,
  type RegionSemanticFlags,
  type SafeAreaCandidateRegion,
} from "./resolve-actual-safe-area.js";
import { neutralizeGhostTextZone } from "./neutralize-ghost-text.js";
import { applyTextBudgetSimplification, degradeOptionalZonesOnUnresolvedOverlap, isLayoutOverdense } from "./manage-text-budget.js";
import { isEditorialCompositionError, type EditorialCreativeAssetBuffer, type RenderEditorialCreativeInput, type RenderEditorialCreativeResult } from "./editorial-composition.types.js";
import { describeEditorialTextGaps, findEditorialRequiredTextsWithoutContent, resolveEditorialRequiredTexts } from "./editorial-text-contract.js";
import { describeReferenceAssetDecision, isReferenceAssetError, ReferenceAssetError, type ReferenceAssetResolverPort, type ReferenceAssetScope } from "../assets/reference-asset-policy.js";

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

export type CompositionStepKind = "screenshot_mockup" | "logo_overlay" | "text_zones" | "safe_area_adjustment" | "editorial_geometry_validation" | "editorial_composition";

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
  /** Cache do SCREENSHOT_TEXT_INVENTORY (tenant + workspace + hash do asset). Injetado = o modo
   * editorial lê o inventário do screenshot real antes do gate (uma leitura por arquivo novo);
   * ausente = gate só com a regra espacial da região do screenshot (comportamento anterior). */
  screenshotTextInventoryStore?: ScreenshotTextInventoryStorePort;
  /** Composição determinística (sharp) — injetada como porta, nunca importada de
   * `src/infrastructure` diretamente (camada de aplicação não depende de infraestrutura
   * concreta). `placement` vem sempre do `creative_plan.assetPlacements`. */
  compositeLogo(input: { imageBuffer: Buffer; logoBuffer: Buffer; placement?: CreativePlanRect; onTreatmentChosen?: (treatment: string) => void }): Promise<Buffer>;
  compositeScreenshot(input: { imageBuffer: Buffer; screenshotBuffer: Buffer; placement: CreativePlanRect; frame?: "phone" | "laptop" }): Promise<Buffer>;
  renderTextZones(input: {
    baseImageBuffer: Buffer;
    zones: CreativePlan["textZones"];
    accentColor?: string;
    fontScale?: number;
  }): Promise<{ buffer: Buffer; renderedZones: unknown[] }>;
  renderEditorialCreative?(input: RenderEditorialCreativeInput): Promise<RenderEditorialCreativeResult>;
  /** Mesma decodificação/normalização que o renderer editorial usa (MIME por conteúdo, decode,
   * orientação, asset vazio). Chamada ANTES de qualquer IA no modo editorial; lança
   * `EditorialCompositionError` (PRODUCT_ASSET_DECODE_FAILED/EDITORIAL_ASSET_DECODE_FAILED/
   * PRODUCT_ASSET_EMPTY). */
  preflightEditorialAsset?(asset: EditorialCreativeAssetBuffer): Promise<{ detectedMime: string }>;
  /** Autoriza (origem/posse) e lê reference assets pelo storage gerenciado — ver
   * `reference-asset-policy.ts`. Obrigatório sempre que o contexto tem assets. */
  referenceAssetResolver?: ReferenceAssetResolverPort;
  computeAssetSuitability?(buffer: Buffer): Promise<AssetSuitabilityScore | undefined>;
  readImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }>;
  /** Cobertura de alfa da imagem base (modo editorial) — preflight antes do renderer. */
  measureImageAlpha?(buffer: Buffer): Promise<EditorialBaseAlphaCoverage>;
  /** ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — medida determinística e gratuita do
   * fundo real de uma região (ver `region-pixel-stats.ts`). Opcional e best-effort: `undefined`
   * (não injetado, ou falha de leitura) cai no tratamento mais conservador
   * (`chooseTextBackingTreatment`), nunca bloqueia a execução. */
  computeRegionPixelStats?(imageBuffer: Buffer, rect: CreativePlanRect): Promise<{ meanLuminance: number; stdDevLuminance: number } | undefined>;
  /** ETAPA 3 — borra uma região (percentual do canvas) ANTES de desenhar texto determinístico por
   * cima, pra neutralizar texto fantasma que o modelo de imagem desenhou sozinho (ver
   * `region-pixel-stats.ts`). Opcional: sem isso injetado, o motor cai direto no tratamento de
   * scrim (mais fraco, mas nunca pior que o comportamento anterior a esta rodada). */
  applyLocalBlur?(imageBuffer: Buffer, rect: CreativePlanRect, sigma?: number): Promise<Buffer>;
  /** ETAPA 3.1 — véu semi-opaco adaptativo aplicado POR CIMA do blur local (ver
   * `region-pixel-stats.ts`), parte da defesa escalável contra texto fantasma
   * (`neutralize-ghost-text.ts`). Opcional: sem isso injetado, a neutralização de texto fantasma
   * cai no tratamento mais simples (`chooseTextBackingTreatment`), nunca bloqueia a execução. */
  applyLocalScrim?(imageBuffer: Buffer, rect: CreativePlanRect, opacity: number, color: "light" | "dark"): Promise<Buffer>;
  /** ETAPA 3.1 — recorta só uma região (percentual do canvas) pra reverificação visual isolada
   * (`neutralize-ghost-text.ts`) — nunca a peça inteira. */
  extractRegionBuffer?(imageBuffer: Buffer, rect: CreativePlanRect): Promise<Buffer | undefined>;
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
  /** Auditoria de custo urgente — teto de gasto (USD) para ESTA execução, checado antes de cada
   * chamada paga (exploração, plano, imagem, gates, reparo). `undefined` = sem teto (comportamento
   * histórico). Ao ser atingido, o pipeline para IMEDIATAMENTE — nunca faz "só mais uma chamada" —
   * com `errorCode: "CREATIVE_ENGINE_BUDGET_EXCEEDED"` e `costBreakdown` completo até aquele
   * ponto, nunca publica nada parcial. */
  maxBudgetUsd?: number;
  /** Caminho experimental: a IA gera a cena/foto, mas texto/preco/CTA/logo/produto/screenshot sao
   * renderizados pelo compositor editorial deterministico. Nunca e ligado por padrao. */
  experimentalEditorialMode?: boolean;
  /** `true` só quando o worker comprovou homologação editorial (flag + allowlist + trusted actor) —
   * única condição em que o namespace SYSTEM_QA_ASSET (`qa-assets/`) é aceito. */
  qaReferenceAssetsAllowed?: boolean;
};

/** Auditoria de custo urgente — breakdown por etapa, pedido explicitamente pelo usuário. Cada
 * categoria soma o custo de TODAS as chamadas daquele tipo na execução inteira (inicial +
 * reparo); `repairRoundsCost` é DELIBERADAMENTE uma sobreposição das outras categorias (não uma
 * fatia exclusiva) — responde diretamente "quanto do gasto veio de rodadas de reparo", que é
 * exatamente o risco que motivou esta auditoria (repair loops consumindo crédito sem controle). */
export type CreativeEngineCostBreakdown = {
  /** Chamadas de plano ao modelo diretor — inicial + toda correção (`gpt_replan` técnico e
   * estético). */
  director: number;
  /** Exploração barata de 2-3 direções antes do plano (`explore-creative-directions.ts`). */
  directionExploration: number;
  /** Toda geração de imagem — inicial + cada rodada de reparo. Historicamente o passo mais caro
   * do pipeline (ver `gpt-image-1-pricing.ts`), e o único que nunca era contabilizado antes desta
   * auditoria (`OpenAiCreativeImageProvider` sempre devolvia custo $0). */
  imageGeneration: number;
  /** ETAPA 3 (Rodada 4) — a análise de visão da imagem BASE (texto espúrio/fantasma, regiões
   * candidatas, slot de screenshot), ver `analyze-pre-composition-image.ts`. Deliberadamente
   * barata (uma chamada de texto, nunca uma nova imagem) — existe PRA EVITAR gastar uma nova
   * geração de imagem por um problema que o renderer já resolve sozinho. */
  preCompositionAnalysis: number;
  /** ETAPA 3.1 (Rodada 4) — reverificações de visão (só o recorte da região tratada) durante a
   * neutralização de texto fantasma (`neutralize-ghost-text.ts`) — deliberadamente barato (texto
   * curto, imagem pequena, pergunta sim/não), existe pra EVITAR gastar uma nova geração de imagem
   * inteira quando o tratamento local já resolveu. */
  ghostTextNeutralization: number;
  /** Gate técnico (`checkCreativeVisualIntegrity` + `checkProductionGuidelinesCompliance`) — toda
   * rodada em que o gate técnico roda. */
  technicalQualityGate: number;
  /** Modo editorial: leitura de texto da IMAGEM BASE (uma chamada leve de visão, só a base). */
  baseTextScan?: number;
  /** Modo editorial: leitura do texto do SCREENSHOT real (inventário; zero quando veio do cache). */
  screenshotTextInventory?: number;
  /** Visual Quality Score — só roda depois que o gate técnico já passou, toda rodada em que isso
   * acontece. */
  visualQualityScore: number;
  /** Soma de TUDO que ocorreu depois que a primeira rodada de reparo começou (qualquer categoria
   * acima) — nunca uma fatia exclusiva, ver comentário do tipo. */
  repairRoundsCost: number;
  /** Soma de todas as categorias (nunca inclui `repairRoundsCost`, que já está contido nas
   * outras) — sempre igual a `estimatedCostUsd`. */
  total: number;
};

export type CreativeEngineArtifactProvenance = {
  compositionMode: "standard" | "editorial_experimental";
  /** Qual Brand Profile gerou a peça (auditável): perfil, versão, regras aplicadas e snapshot da
   * identidade usada. Ausente = SYSTEM_DEFAULT (workspace sem identidade estruturada). */
  brandProfile?: {
    source: "BRAND_PROFILE";
    profileId: string;
    workspaceId: string;
    version: number;
    updatedAt: string;
    appliedBrandRules: AppliedBrandRule[];
    identity: BrandIdentity;
  };
  baseImage?: {
    url: string;
    width?: number;
    height?: number;
    source: "ai_generated_pre_renderer";
    publishable: false;
  };
  finalImage?: {
    url: string;
    width?: number;
    height?: number;
    source: "final_rendered_image";
    publishable: boolean;
  };
  productAsset?: {
    role: "product_photo";
    url: string;
    source: "input_asset";
  };
  inputAssets: { role: CreativePlanAssetRole; url: string; source: "input_asset" }[];
  imagePromptSanitization?: {
    promptChars: number;
    containsHeadline: boolean;
    containsPrice: boolean;
    containsCta: boolean;
  };
  renderedGeometry?: RenderEditorialCreativeResult["renderedGeometry"];
  /** Prova em pixel de cada asset composto (ver `EditorialAssetVerification`). */
  assetVerification?: RenderEditorialCreativeResult["assetVerification"];
  /** Observabilidade da homologação: variante escolhida pelo compositor editorial e por quê (nunca muda comportamento). */
  editorialComposition?: { selectedVariant: string; variantSelectionReasons: string[]; diagnostics: RenderEditorialCreativeResult["composition"] };
  /** Cobertura de alfa da base da IA (preflight editorial). */
  baseAlphaCoverage?: EditorialBaseAlphaCoverage & { nonOpaqueRatio: number; requestedBackground?: string };
  /** Leitura de texto da base da IA (antes do renderer). */
  baseTextDiagnostic?: EditorialBaseTextDiagnostic;
  /** Ledger de proveniência textual usado pelo gate. */
  textProvenanceLedger?: unknown;
  /** SCREENSHOT_TEXT_INVENTORY do screenshot real (proveniência de texto; nunca fato comercial). */
  screenshotTextInventory?: Omit<ScreenshotTextInventory, "texts"> & { textCount: number; texts: { normalizedText: string; occurrenceCount: number }[]; gateDecision?: { status: string; reason: string } };
};

export type GptCreativeEngineResult = {
  engineMode: "gpt";
  compositionMode?: "standard" | "editorial_experimental";
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
  /** ETAPA 3 (Rodada 4) — resultado da análise de visão da imagem base, quando executada (ver
   * `analyze-pre-composition-image.ts`). `undefined` quando não havia zona de renderer/screenshot
   * pra analisar, ou a chamada falhou (best-effort, nunca bloqueia a peça). Exposto para auditoria
   * e para os cenários de smoke local validarem o comportamento sem reimplementar a lógica. */
  preCompositionAnalysis?: PreCompositionAnalysis;
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
  /** Auditoria de custo urgente — mesmo total de `estimatedCostUsd`, quebrado por etapa. Sempre
   * presente (mesmo em falha antes de qualquer chamada paga — nesse caso, todas as categorias
   * zeradas). */
  costBreakdown: CreativeEngineCostBreakdown;
  artifactProvenance?: CreativeEngineArtifactProvenance;
  latencyMs: number;
  warnings: string[];
  error?: string;
  errorCode?: string;
};

const SPECIALIST_ID = "gpt-creative-director";

function buildObjectKey(tenantId: string, suffix: string): string {
  return `gpt-creative-engine/${tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${suffix}.jpg`;
}

function buildImagePromptSanitizationAudit(prompt: string, plan: CreativePlan, context: CreativeContext): CreativeEngineArtifactProvenance["imagePromptSanitization"] {
  const priceFacts = extractCommercialFactsFromText(context.confirmedFacts.join("\n"))
    .filter((fact) => fact.type === "current_price")
    .map((fact) => fact.value);
  return {
    promptChars: prompt.length,
    containsHeadline: Boolean(plan.headline.trim() && prompt.includes(plan.headline)),
    containsPrice: priceFacts.some((price) => prompt.includes(price)),
    containsCta: Boolean(plan.cta.trim() && prompt.includes(plan.cta)),
  };
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

/** ETAPA 3.2 (Rodada 4) — achado do smoke real: a 2ª tentativa recebia o MESMO prompt da 1ª, sem
 * nenhum feedback sobre o que invalidou a resposta anterior — podia (e às vezes repetia) o mesmo
 * erro estrutural. Anexa a causa diagnosticada (`diagnoseCreativePlanInvalidity`) como instrução
 * concreta de correção, mesmo princípio já usado no reparo pós-gate (`buildCreativePlanRepairPrompt`),
 * mas aqui ainda ANTES de existir um `creative_plan` válido pra reparar. */
function appendPlanRetryDiagnostic(prompt: string, diagnostic: string | undefined): string {
  if (!diagnostic) return prompt;
  return `${prompt}\n\nSUA RESPOSTA ANTERIOR FALHOU NESTA VALIDAÇÃO ESPECÍFICA: ${diagnostic} Corrija EXATAMENTE isso na nova resposta, mantendo o resto do plano coerente.`;
}

async function requestCreativePlan(
  icaro: IcaroBrainPort,
  context: CreativeContext,
  executionId: string,
  correlationId: string,
  track: (response: IcaroAIResponse | undefined) => void,
  chosenDirection?: ChosenCreativeDirection,
  parseOptions: CreativePlanParseOptions = {},
): Promise<{ plan?: CreativePlan; response?: IcaroAIResponse; lastDiagnostic?: string; repeatedDiagnostic?: boolean }> {
  let lastResponse: IcaroAIResponse | undefined;
  let previousDiagnostic: string | undefined;
  let lastDiagnostic: string | undefined;
  let repeatedDiagnostic = false;
  for (let jsonAttempt = 1; jsonAttempt <= MAX_INITIAL_PLAN_JSON_ATTEMPTS; jsonAttempt++) {
    const response = await icaro.request({
      taskType: "analysis",
      prompt: appendPlanRetryDiagnostic(buildCreativePlanPrompt(context, chosenDirection), jsonAttempt > 1 ? previousDiagnostic : undefined),
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
    if (response.status !== "completed") {
      // Achado real em produção (incidente de quota OpenAI): quota/crédito esgotado NUNCA se
      // resolve tentando de novo com o MESMO prompt — insistir só gastava a 2ª tentativa de JSON
      // contra um erro que vai repetir idêntico. Aborta já na 1ª falha nesse caso específico
      // (`isProviderQuotaExhausted`, abaixo); qualquer outro motivo de falha continua tentando de
      // novo normalmente, comportamento inalterado.
      if (isProviderQuotaExhausted(response)) break;
      continue;
    }
    // `extractJson` por dentro do try/catch (igual ao comportamento histórico antes desta
    // auditoria): uma resposta sem NENHUM JSON reconhecível lança, e isso precisa continuar
    // significando "tenta de novo", nunca derrubar a execução inteira.
    let rawContent: string | undefined;
    try {
      rawContent = extractJson(String(response.content ?? ""), "GPT Creative Plan");
      const plan = parseCreativePlan(rawContent, parseOptions);
      if (plan) return { plan, response };
    } catch {
      // tenta de novo (ou desiste, se for a última tentativa)
    }
    lastDiagnostic = rawContent !== undefined ? diagnoseCreativePlanInvalidity(rawContent, parseOptions) : "Ícaro não devolveu nenhum JSON reconhecível na resposta.";
    repeatedDiagnostic = Boolean(lastDiagnostic && previousDiagnostic && lastDiagnostic === previousDiagnostic);
    previousDiagnostic = lastDiagnostic;
  }
  return { response: lastResponse, lastDiagnostic, repeatedDiagnostic };
}

/** Ver comentário em `requestCreativePlan` — mesmo sinal usado em todos os pontos do motor que
 * decidem entre "tenta de novo" e "aborta já" (plano inicial, reparo, geração de imagem). */
function isProviderQuotaExhausted(response: IcaroAIResponse | undefined): boolean {
  return response?.error?.kind === "quota_exhausted";
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
): Promise<{ plan?: CreativePlan; response?: IcaroAIResponse }> {
  const repairPrompt = buildCreativePlanRepairPrompt(previousPlan, context, instructions);
  let lastResponse: IcaroAIResponse | undefined;
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
    lastResponse = repairResponse;
    if (repairResponse.status === "completed") {
      try {
        const plan = parseCreativePlan(extractJson(String(repairResponse.content ?? ""), "GPT Creative Plan Repair"));
        if (plan) return { plan, response: repairResponse };
      } catch {
        // tenta de novo (ou desiste, se for a última tentativa)
      }
      // Ver comentário em `requestCreativePlan`/`isProviderQuotaExhausted` — mesma regra: quota
      // esgotada nunca se resolve tentando de novo com o mesmo prompt.
    } else if (isProviderQuotaExhausted(repairResponse)) {
      break;
    }
  }
  return { response: lastResponse };
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
  input: { prompt: string; format: string; referenceImageUrl?: string; creativeGuard: CreativeEngineImageGuardInput; executionId: string; correlationId: string; background?: "opaque" },
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
      ...(input.background ? { imageBackground: input.background } : {}),
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

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — ajusta, ANTES de qualquer composição
 * determinística, a geometria/tratamento de cada zona `renderedBy: "renderer"` a partir de dados
 * REAIS da imagem base (nunca só a instrução estática do plano). Nunca consome uma rodada de
 * reparo (`MAX_CREATIVE_REPAIR_ROUNDS`) — é um ajuste de composição silencioso, sempre tentado
 * antes de considerar qualquer coisa "falha" (brief, ponto 22: "não consumir repair round
 * desnecessariamente").
 *
 * Ordem de preferência (brief, ponto 7): 1) reposicionar pra outra região livre; 2) só se não
 * houver região livre, aplicar o tratamento de fundo mais forte necessário no lugar original
 * (blur local pra texto fantasma, scrim/card pra fundo ruidoso/pouco contrastante) — nunca
 * regenerar a imagem por um problema que esta função já resolve.
 */
async function applySafeAreaAdjustments(
  deps: GptCreativeEngineDeps,
  input: {
    imageBuffer: Buffer;
    rendererZones: readonly CreativePlanTextZone[];
    analysis: PreCompositionAnalysis | undefined;
    occupiedRects: readonly CreativePlanRect[];
    tenantId: string;
    specialistId: string;
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<{ imageBuffer: Buffer; zones: CreativePlanTextZone[]; steps: string[]; unrecoverableGhostTextZoneKinds: string[]; unresolvedOverlapKinds: string[] }> {
  let imageBuffer = input.imageBuffer;
  const zones: CreativePlanTextZone[] = [];
  const steps: string[] = [];
  const unrecoverableGhostTextZoneKinds: string[] = [];
  // ETAPA 3.3 (Rodada 4) — "VISUAL TEXT BUDGET" (brief, ponto 12/16): zonas que continuam
  // sobrepondo um asset/outra zona mesmo DEPOIS da tentativa de realocação (nenhuma região
  // candidata genuinamente livre) — sinal de layout congestionado, usado pelo chamador pra decidir
  // se descarta conteúdo OPCIONAL (ver `manage-text-budget.ts`), nunca decidido aqui dentro.
  const unresolvedOverlapKinds: string[] = [];
  const occupiedRects = [...input.occupiedRects];
  const regionFlags: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>> = input.analysis?.regions ?? {};
  const hasFullNeutralizationDeps = Boolean(deps.applyLocalBlur && deps.applyLocalScrim && deps.extractRegionBuffer && deps.computeRegionPixelStats);

  // ETAPA 3.2 (Rodada 4) — achado do smoke real da ETAPA 3.1: tratar só o retângulo PLANEJADO da
  // zona não é garantia de cobrir onde o modelo REALMENTE desenhou o texto espúrio (pode estar
  // fora dele, ou em mais de um lugar). Trata CADA achado de texto espúrio na sua localização REAL
  // (bbox reportada pela visão, com margem de segurança — nunca só a bbox exata), independente de
  // qual zona ele "corresponde" — uma passada ANTES do loop de zonas, que agora só cuida de
  // ocupação/geometria, não mais de texto fantasma por zona.
  const treatedFindingRects: CreativePlanRect[] = [];
  if (hasFullNeutralizationDeps && input.analysis?.spuriousTexts.length) {
    for (const finding of input.analysis.spuriousTexts) {
      // ETAPA 3.3.3 (Rodada 4) — achado da auditoria: correspondência de zona agora combina sinal
      // SEMÂNTICO (matchedZoneKind, só existe pra achados "ghost_text") com sobreposição
      // GEOMÉTRICA real (bbox vs. retângulo da zona) — um CTA/preço INVENTADO pelo modelo
      // (classificado "unauthorized_text", nunca recebe matchedZoneKind por definição do schema)
      // mas desenhado exatamente onde o botão/preço real ficaria agora também se beneficia da
      // ampliação de largura, em vez de só os achados que a visão rotulou como "ghost_text".
      const fallbackZone = findMatchingCommercialZone(finding, input.rendererZones);
      const rawRect = finding.bbox ?? fallbackZone?.rect;
      if (!rawRect) {
        steps.push(`texto espúrio "${finding.text}" (${finding.classification}) sem localização (bbox ausente e sem zona correspondente) — não foi possível tratar.`);
        continue;
      }
      // ETAPA 3.3.3 — achado da auditoria (imagem real confirmou): texto legível DENTRO de um
      // asset real já posicionado (logo/screenshot colado por composição determinística) nunca é
      // texto espúrio do modelo — é o próprio asset. Protege pela GEOMETRIA real do asset, nunca
      // por comparação textual (nunca uma whitelist de palavras como "LOGO"/nome da marca — se o
      // mesmo texto aparecer FORA da região real do asset, continua contando normalmente).
      if (overlapsKnownAssetSubstantially(rawRect, input.occupiedRects)) {
        steps.push(`texto "${finding.text}" (${finding.classification}) sobrepõe substancialmente um asset real já posicionado (logo/screenshot) — tratado como parte do asset, nunca como texto espúrio; nenhum tratamento aplicado.`);
        continue;
      }
      // ETAPA 3.3.2 (Rodada 4) — achado real do smoke de produção: o texto fantasma de uma zona
      // comercial (headline/cta/price) pode sair como um banner estilizado muito mais LARGO do
      // que a bbox que a visão reporta (confirmado por pixel: ghost text real em ~84% da largura
      // do canvas, zona de CTA planejada com só 40%) — a bbox da visão sozinha, mesmo com
      // padding, nunca cobre isso de forma confiável. Quando o achado corresponde a uma zona
      // comercial conhecida, a LARGURA do retângulo de TRATAMENTO (nunca a altura/posição
      // vertical, que continua vindo da bbox real detectada — nunca "infla" pra cobrir uma área
      // vertical distante só porque bateu com o kind de uma zona) é ampliada pra pelo menos a
      // faixa comercial segura do canvas — garantia ESTRUTURAL de cobertura horizontal, nunca
      // dependente só da precisão da visão. Nunca afeta o retângulo final que o renderer desenha
      // (o card/zona continua do tamanho/posição que o Director decidiu).
      const paddedRect = expandBboxWithPadding(rawRect);
      const treatmentRect = fallbackZone ? widenToCommercialBand(paddedRect) : paddedRect;
      const neutralization = await neutralizeGhostTextZone(deps.creativeBrain, {
        computeRegionPixelStats: deps.computeRegionPixelStats!,
        applyLocalBlur: deps.applyLocalBlur!,
        applyLocalScrim: deps.applyLocalScrim!,
        extractRegionBuffer: deps.extractRegionBuffer!,
        objectStorage: deps.objectStorage,
      }, {
        imageBuffer,
        rect: treatmentRect,
        tenantId: input.tenantId,
        specialistId: input.specialistId,
        onCost: input.onCost,
      });
      imageBuffer = neutralization.imageBuffer;
      treatedFindingRects.push(treatmentRect);

      if (!neutralization.result.neutralizedLocally) {
        unrecoverableGhostTextZoneKinds.push(finding.matchedZoneKind ?? finding.classification);
        steps.push(`texto espúrio "${finding.text}" (${finding.classification}, bbox real ${finding.bbox ? "detectada" : "via zona planejada (fallback)"}) NÃO neutralizado após ${neutralization.result.passes} passe(s) (intensidade "${neutralization.result.finalIntensity}") — UNRECOVERABLE_GHOST_TEXT.`);
        continue;
      }
      steps.push(
        `texto espúrio "${finding.text}" (${finding.classification}, bbox real ${finding.bbox ? "detectada" : "via zona planejada (fallback)"}) NEUTRALIZADO LOCALMENTE em ${neutralization.result.passes} passe(s) (intensidade final "${neutralization.result.finalIntensity}") — GHOST_TEXT_NEUTRALIZED_LOCALLY, nenhuma nova geração de imagem.`,
      );
    }
  }
  occupiedRects.push(...treatedFindingRects);

  // Zonas: agora só cuidam de OCUPAÇÃO (produto/rosto/texto detectado pela visão nas 6 regiões, ou
  // sobreposição GEOMÉTRICA determinística com um asset real já posicionado — ver comentário em
  // `TEXT_ZONE_KIND_PRIORITY`) — texto fantasma já foi tratado na passada acima, na localização
  // REAL, nunca mais por zona. Processadas em ordem de PRIORIDADE (headline > price > cta > ...)
  // pra decidir quem relocaliza quando duas zonas colidem entre si.
  for (const zone of sortTextZonesByPriority(input.rendererZones)) {
    // ETAPA 3.2 — achado do smoke real: `TEXT_ZONE_OVERLAPS_ASSET` (headline sobre a logo) chegou
    // ao gate técnico porque só a visão decidia "ocupado"; um retângulo conhecido com certeza
    // (asset real já posicionado, ou outra zona de maior prioridade) precisa derrubar
    // `plannedIsClear` mesmo que a visão não tenha reportado nada ali.
    const overlapsKnownOccupiedRect = occupiedRects.some((rect) => rectsOverlap(zone.rect, rect));
    const plannedIsClear = (input.analysis?.plannedZonesClear[zone.kind] ?? true) && !overlapsKnownOccupiedRect;

    const decision = resolveActualTextZoneRect({
      plannedRect: zone.rect,
      plannedRectIsClear: plannedIsClear,
      regionFlags,
      occupiedRects,
    });

    const pixelStats = await deps.computeRegionPixelStats?.(imageBuffer, decision.rect);
    const treatment = chooseTextBackingTreatment({ pixelStats, hasGhostTextHere: false, plannedBackingStyle: zone.backingStyle });

    occupiedRects.push(decision.rect);
    zones.push({ ...zone, rect: decision.rect, backingStyle: textBackingTreatmentToRendererStyle(treatment) });
    if (overlapsKnownOccupiedRect && !decision.relocated) unresolvedOverlapKinds.push(zone.kind);
    steps.push(
      `${zone.kind}: ${decision.relocated ? `realocado para região "${decision.relocatedTo}"` : "manteve posição planejada"}, tratamento="${treatment}"` +
        (overlapsKnownOccupiedRect && !decision.relocated ? " (sobrepunha um asset/zona conhecida e nenhuma região alternativa estava livre)" : ""),
    );
  }

  return { imageBuffer, zones, steps, unrecoverableGhostTextZoneKinds, unresolvedOverlapKinds };
}

export async function runGptCreativeEngine(deps: GptCreativeEngineDeps, input: GptCreativeEngineInput): Promise<GptCreativeEngineResult> {
  const startedAt = (deps.now?.() ?? new Date()).getTime();
  const warnings: string[] = [];
  const context = input.creativeContext;
  let estimatedCostUsd = 0;
  let latencyMs = 0;
  let directorModel: string | undefined;
  let imageModel: string | undefined;

  // Auditoria de custo urgente — breakdown por etapa + teto de gasto por execução. `repairRoundsCost`
  // é sobreposição deliberada das outras categorias (ver `CreativeEngineCostBreakdown`);
  // `isRepairRound` vira `true` de propósito e NUNCA volta a `false` na mesma execução — a partir
  // do momento em que a primeira rodada de reparo começa, todo gasto seguinte É gasto de reparo,
  // mesmo que a categoria específica (imagem, gate, plano) mude entre uma rodada e outra.
  const costBreakdown: CreativeEngineCostBreakdown = {
    director: 0,
    directionExploration: 0,
    imageGeneration: 0,
    preCompositionAnalysis: 0,
    ghostTextNeutralization: 0,
    technicalQualityGate: 0,
    baseTextScan: 0,
    screenshotTextInventory: 0,
    visualQualityScore: 0,
    repairRoundsCost: 0,
    total: 0,
  };
  let isRepairRound = false;

  const track = (category: keyof Omit<CreativeEngineCostBreakdown, "repairRoundsCost" | "total">, response: IcaroAIResponse | undefined) => {
    if (!response) return;
    const cost = response.cost?.estimated ?? 0;
    costBreakdown[category] += cost;
    costBreakdown.total += cost;
    if (isRepairRound) costBreakdown.repairRoundsCost += cost;
    estimatedCostUsd += cost;
    latencyMs += response.durationMs ?? 0;
  };

  // Checado ANTES de cada chamada paga (nunca depois) — o pipeline nunca faz "só mais uma
  // chamada" quando o teto já foi atingido por uma rodada anterior. `undefined` (sem teto
  // configurado) preserva o comportamento histórico: nunca interrompe.
  function budgetExceeded(): boolean {
    return input.maxBudgetUsd !== undefined && costBreakdown.total >= input.maxBudgetUsd;
  }

  function failBudgetExceeded(extra: Partial<GptCreativeEngineResult> = {}): GptCreativeEngineResult {
    return fail(
      `CREATIVE_ENGINE_BUDGET_EXCEEDED: o teto de gasto configurado para esta execução (US$ ${input.maxBudgetUsd?.toFixed(4)}) foi atingido — US$ ${costBreakdown.total.toFixed(4)} gastos até aqui. Pipeline interrompido antes de qualquer chamada nova.`,
      "CREATIVE_ENGINE_BUDGET_EXCEEDED",
      extra,
    );
  }

  function fail(error: string, errorCode: string, extra: Partial<GptCreativeEngineResult> = {}): GptCreativeEngineResult {
    return {
      engineMode: "gpt",
      compositionMode: input.experimentalEditorialMode ? "editorial_experimental" : "standard",
      directorModel,
      imageModel,
      creativeContext: context,
      assetsUsed: [],
      compositedAssetRoles: [],
      compositionSteps: [],
      repairRounds: [],
      publishable: false,
      estimatedCostUsd,
      costBreakdown,
      latencyMs: Math.max(latencyMs, (deps.now?.() ?? new Date()).getTime() - startedAt),
      warnings,
      error,
      errorCode,
      chosenCreativeDirection,
      ...extra,
    };
  }

  // Preflight de assets editoriais ANTES de QUALQUER chamada de IA (achado do Smoke A
  // execution-muyzgzli-th8xse: um product_photo inválido só era descoberto no renderer, depois do
  // diretor e da geração de imagem pagos). Mesma decodificação do renderer (porta injetada, sem
  // implementação paralela); os buffers baixados aqui são reaproveitados depois — sem download
  // duplicado. Autorização editorial (tenant/workspace/trusted actor/allowlist) já aconteceu no
  // handler do worker antes de chegar aqui.
  // `let` declarado antes do preflight: `fail()` lê este valor e pode ser chamado antes da
  // exploração de direções existir.
  let chosenCreativeDirection: CreativeDirectionExploration | undefined;
  const preflightedAssetBuffers = new Map<string, Buffer>();
  // Autorização de reference assets (os dois modos) ANTES de qualquer leitura ou IA: as URLs do
  // contexto também viram `imageUrls` das chamadas de visão. Política única em
  // `reference-asset-policy.ts`; leitura sempre pelo storage gerenciado, nunca `fetch` de URL livre.
  const referenceScope: ReferenceAssetScope = {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    qaNamespaceAllowed: input.qaReferenceAssetsAllowed === true,
  };
  if (context.assets.length > 0) {
    if (!deps.referenceAssetResolver) {
      return fail(
        "REFERENCE_ASSET_RESOLVER_MISSING: reference assets exigem referenceAssetResolver injetado — nenhuma URL é baixada nem enviada à IA sem autorização de origem/posse.",
        "REFERENCE_ASSET_RESOLVER_MISSING",
      );
    }
    for (const asset of context.assets) {
      const decision = deps.referenceAssetResolver.authorize(asset.url, referenceScope);
      if (!decision.ok) {
        console.warn(describeReferenceAssetDecision({ scope: referenceScope, role: asset.role, result: decision }));
        const error = new ReferenceAssetError(decision.code, decision.reasonCategory);
        return fail(error.message, error.code);
      }
    }
  }

  if (input.experimentalEditorialMode) {
    const editorialInputAssets = context.assets.filter((asset) => asset.role === "product_photo" || asset.role === "screenshot" || asset.role === "logo");
    if (editorialInputAssets.length > 0 && !deps.preflightEditorialAsset) {
      return fail(
        "EDITORIAL_ASSET_PREFLIGHT_MISSING: experimentalEditorialMode=true exige preflightEditorialAsset injetado — assets editoriais nunca seguem para a IA sem validação de decode.",
        "EDITORIAL_ASSET_PREFLIGHT_MISSING",
      );
    }
    for (const asset of editorialInputAssets) {
      let buffer: Buffer;
      try {
        buffer = await loadAssetBuffer(asset.url);
      } catch (error) {
        if (isReferenceAssetError(error)) return fail(error.message, error.code);
        return fail(
          `EDITORIAL_ASSET_DOWNLOAD_FAILED: falha ao baixar asset real "${asset.role}" antes de qualquer IA: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          "EDITORIAL_ASSET_DOWNLOAD_FAILED",
        );
      }
      try {
        await deps.preflightEditorialAsset!({ role: asset.role, url: asset.url, buffer });
      } catch (error) {
        if (isEditorialCompositionError(error)) return fail(error.message, error.code);
        return fail(
          `EDITORIAL_ASSET_DECODE_FAILED: preflight do asset "${asset.role}" falhou: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          asset.role === "product_photo" ? "PRODUCT_ASSET_DECODE_FAILED" : "EDITORIAL_ASSET_DECODE_FAILED",
        );
      }
      preflightedAssetBuffers.set(asset.url, buffer);
    }
  }
  async function loadAssetBuffer(url: string): Promise<Buffer> {
    const cached = preflightedAssetBuffers.get(url);
    if (cached) return cached;
    if (!deps.referenceAssetResolver) throw new ReferenceAssetError("REFERENCE_ASSET_SOURCE_NOT_ALLOWED", "resolver_missing");
    return deps.referenceAssetResolver.load(url, referenceScope);
  }

  // Ponto 9 da auditoria "qualidade visual e direção de arte" — uma ÚNICA chamada de texto barata
  // ANTES do plano detalhado, pra ancorar o plano numa direção criativa concreta (e, via
  // `context.recentHistory`, evitar repetir o conceito visual de peças recentes — ponto 10). Best-
  // effort: `undefined` (chamada falhou/resposta incompleta) segue direto pro plano SEM âncora,
  // comportamento idêntico ao motor antes desta etapa existir.
  chosenCreativeDirection = budgetExceeded()
    ? undefined
    : await exploreCreativeDirections(deps.creativeBrain, context, {
        specialistId: SPECIALIST_ID,
        executionId: input.executionRunId,
        correlationId: input.creativeEngineRunId,
        onCost: (response) => track("directionExploration", response),
      });
  const chosenDirectionAnchor: ChosenCreativeDirection | undefined = chosenCreativeDirection
    ? chosenCreativeDirection.candidates[chosenCreativeDirection.chosenIndex]
    : undefined;

  if (budgetExceeded()) return failBudgetExceeded();

  const { plan: initialPlan, response: planResponse, lastDiagnostic: planDiagnostic, repeatedDiagnostic: planRepeatedDiagnostic } = await requestCreativePlan(
    deps.creativeBrain,
    context,
    input.executionRunId,
    input.creativeEngineRunId,
    (response) => track("director", response),
    chosenDirectionAnchor,
    // Modo editorial: geometria de textZones vinda do diretor é descartada (o renderer recalcula),
    // então geometria inválida não rejeita o plano nem consome a 2ª tentativa do diretor.
    { compositionMode: input.experimentalEditorialMode ? "editorial_experimental" : "standard" },
  );
  directorModel = planResponse?.model?.id;
  if (initialPlan?.editorialTextZoneNormalization) {
    warnings.push(
      `EDITORIAL_PLAN_NORMALIZED: geometria de textZones do diretor descartada (o renderer editorial recalcula): ${initialPlan.editorialTextZoneNormalization.discardedGeometry.map((zone) => `${zone.kind} — ${zone.reason}`).join("; ")}.`,
    );
  }
  if (initialPlan?.editorialLayoutPlanNormalization) {
    warnings.push(
      `EDITORIAL_LAYOUT_PLAN_NORMALIZED: kinds de layoutPlan do diretor normalizados antes de retry: ${initialPlan.editorialLayoutPlanNormalization.normalizedKinds.map((item) => `layoutPlan[${item.index}].${item.field}=${item.invalidValue} normalizedTo=${item.normalizedTo}; allowed=${item.allowedValues.join("|")}; reason=${item.reason}`).join("; ")}.`,
    );
  }
  if (!initialPlan) {
    if (isProviderQuotaExhausted(planResponse)) {
      return fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED");
    }
    // ETAPA 3.2 (Rodada 4) — achado do smoke real: quando o MESMO erro estrutural se repete nas 2
    // tentativas (mesmo depois de receber a causa exata na 2ª), é um sinal de que o Director está
    // preso num padrão, não um acaso — nomear isso distinto (`CREATIVE_PLAN_REPEAT_INVALID`) nunca
    // tenta uma 3ª vez (continua gastando zero imagens), só torna a causa visível pro operador.
    return planRepeatedDiagnostic
      ? fail(`CREATIVE_PLAN_REPEAT_INVALID: o mesmo erro estrutural se repetiu em ambas as tentativas do plano inicial — causa: ${planDiagnostic}`, "CREATIVE_PLAN_REPEAT_INVALID")
      : fail(`Não foi possível obter um creative_plan válido do GPT.${planDiagnostic ? ` Causa: ${planDiagnostic}` : ""}`, "CREATIVE_PLAN_INVALID");
  }

  const screenshotAsset = context.assets.find((asset) => asset.role === "screenshot");
  const logoAsset = context.assets.find((asset) => asset.role === "logo");
  const productAsset = context.assets.find((asset) => asset.role === "product_photo");

  let productRenderDecision: ProductRenderModeDecision | undefined;
  if (productAsset) {
    try {
      const buffer = await loadAssetBuffer(productAsset.url);
      const suitability = await deps.computeAssetSuitability?.(buffer);
      productRenderDecision = resolveProductRenderMode({ hasReferenceImage: true, suitability });
    } catch (error) {
      warnings.push(`Não foi possível avaliar o asset de produto: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
    }
  }

  // Modo editorial: a base é SÓ ambiente — a foto real do produto nunca vai como entrada de edição
  // do modelo de imagem (Smoke A cer-runtime-muzle2ms-1wftsl: a base recriou o relógio a partir da
  // referência). O produto real é composto depois, exclusivamente pelo renderer.
  const imageReferenceUrl = input.experimentalEditorialMode ? undefined : productAsset?.url;
  const generationMethod: GenerationMethod = imageReferenceUrl ? "edit" : "generation";
  const repairRounds: CreativeRepairRound[] = [];
  let plan = initialPlan;
  let repairAttempt = 0;

  if (input.experimentalEditorialMode) {
    const productRequirement = resolveEditorialProductAssetRequirement(plan, context);
    if (!productRequirement.ok) {
      return fail(
        `REQUIRED_PRODUCT_ASSET_MISSING: ${productRequirement.reason}`,
        "REQUIRED_PRODUCT_ASSET_MISSING",
        { creativePlan: plan, repairRounds },
      );
    }
    // Contrato de texto (achado do Smoke A cer-runtime-muyx4qzs-hoinur): texto que o plano exige
    // mas não escreveu nunca vira peça — falha aqui, antes de gastar a geração de imagem.
    const textsWithoutContent = findEditorialRequiredTextsWithoutContent(resolveEditorialRequiredTexts(plan, context));
    if (textsWithoutContent.length > 0) {
      return fail(
        `EDITORIAL_REQUIRED_TEXT_MISSING: o plano exige texto(s) que não chegariam ao renderer: ${describeEditorialTextGaps(textsWithoutContent)}.`,
        "EDITORIAL_REQUIRED_TEXT_MISSING",
        { creativePlan: plan, repairRounds },
      );
    }
    // Preflight de copy pt-BR: só aviso, nunca autocorreção — o renderer desenha o texto exato.
    const copyWarnings = findPtBrMissingAccents({
      headline: plan.headline,
      subheadline: plan.subheadline,
      cta: plan.cta,
      ...Object.fromEntries(plan.textZones.map((zone, index) => [`textZones[${index}].${zone.kind}`, zone.text])),
    });
    if (copyWarnings.length > 0) {
      warnings.push(`PTBR_COPY_WARNING: possível acento ausente na copy (não corrigido automaticamente): ${describePtBrCopyWarnings(copyWarnings)}.`);
    }
  }

  outerImageRound: for (;;) {
    if (screenshotAsset && !plan.assetPlacements.some((placement) => placement.role === "screenshot")) {
      return fail(
        "CREATIVE_PLAN_MISSING_ASSET_PLACEMENT: o creative_plan não definiu a geometria (assetPlacements) do screenshot real — a posição precisa ser decidida antes da geração, nunca improvisada depois.",
        "CREATIVE_PLAN_MISSING_ASSET_PLACEMENT",
        { creativePlan: plan, repairRounds },
      );
    }

    // ETAPA 3.3 (Rodada 4) — "VISUAL TEXT BUDGET", preflight de densidade (brief, ponto 11): nunca
    // gasta uma geração de imagem só pra descobrir uma geometria que o próprio plano já mostra ser
    // inviável. Roda sobre a geometria DECLARADA (ainda não existe pixel real nesse ponto) — quando
    // o layout já está congestionado, descarta conteúdo OPCIONAL (nunca `requiredRenderedFacts`,
    // nunca headline) ANTES de desenhar. `plan` (pristine, decisão do diretor) nunca é sobrescrito —
    // só `planForGeneration` (derivado) é usado daqui pra frente nesta rodada de imagem, mesmo
    // princípio já usado por `planForGate`.
    // Modo editorial: o renderer ignora a geometria declarada pelo diretor e mede o próprio layout
    // (geometria final + TEXT_OVERFLOW/COLLISION/SAFE_AREA_VIOLATION). Simplificar sobre a
    // geometria declarada removia a subheadline exigida pelo plano (Smoke A) — não roda aqui.
    const densityPreflight = !input.experimentalEditorialMode && isLayoutOverdense(plan.textZones, plan.assetPlacements) ? applyTextBudgetSimplification(plan) : undefined;
    // Brand Profile: densidade da marca vira a densidade do plano (só no modo editorial — o renderer
    // é quem a interpreta; as regras de legibilidade/geometria continuam soberanas).
    const brandRules: AppliedBrandRule[] = [...(context.appliedBrandRules ?? [])];
    const brandDensity = input.experimentalEditorialMode ? context.brandIdentity?.identity.density : undefined;
    const planBeforeBrand = densityPreflight?.plan ?? plan;
    const planForGeneration = brandDensity && planBeforeBrand.visualDensity !== BRAND_DENSITY_TO_PLAN[brandDensity]
      ? { ...planBeforeBrand, visualDensity: BRAND_DENSITY_TO_PLAN[brandDensity] }
      : planBeforeBrand;
    if (brandDensity) brandRules.push({ code: "BRAND_DENSITY", detail: `densidade da marca ${brandDensity} → visualDensity ${planForGeneration.visualDensity} (diretor: ${planBeforeBrand.visualDensity})`, outcome: "APPLIED" });
    if (densityPreflight && densityPreflight.droppedZones.length > 0) {
      warnings.push(
        `ETAPA 3.3 — DENSITY_PREFLIGHT: layout denso detectado antes da geração (${plan.textZones.length} zona(s) de texto + ${plan.assetPlacements.length} asset(s)) — conteúdo OPCIONAL removido da arte: ${densityPreflight.droppedZones.map((zone) => zone.kind).join(", ")} (continua disponível só como legenda/descrição, nunca na peça).`,
      );
    }

    const editorialFamily = input.experimentalEditorialMode ? resolveEditorialFamilyFromContext(context) : undefined;
    // Base institucional é a protagonista e precisa ser opaca (cenário B: 2 de 3 bases vieram como
    // recorte com transparência sob background "auto").
    const requestedBackground = editorialFamily === "premium_institutional" ? ("opaque" as const) : undefined;
    const imagePrompt = buildImageGenerationPromptFromPlan(planForGeneration, context, {
      compositionMode: input.experimentalEditorialMode ? "editorial_experimental" : "standard",
      ...(editorialFamily ? { editorialFamily } : {}),
    });
    const creativeGuard = buildGuardInputFromPlan(plan, context);

    if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });

    const { uri, response: imageResponse } = await requestGeneratedImage(deps.creativeBrain, {
      prompt: imagePrompt,
      format: context.format,
      referenceImageUrl: imageReferenceUrl,
      creativeGuard,
      executionId: input.executionRunId,
      correlationId: input.creativeEngineRunId,
      ...(requestedBackground ? { background: requestedBackground } : {}),
    });
    track("imageGeneration", imageResponse);
    imageModel = imageResponse?.model?.id ?? imageModel;
    if (!uri) {
      return isProviderQuotaExhausted(imageResponse)
        ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar a imagem até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds })
        : fail("Ícaro não devolveu uma imagem gerada.", "IMAGE_GENERATION_FAILED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
    }

    let baseWithAssetsBuffer: Buffer;
    try {
      baseWithAssetsBuffer = await fetchAsBuffer(uri);
    } catch (error) {
      return fail(`Falha ao baixar a imagem gerada: ${error instanceof Error ? error.message : "erro desconhecido"}.`, "IMAGE_DOWNLOAD_FAILED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
    }

    if (input.experimentalEditorialMode) {
      if (!deps.renderEditorialCreative) {
        return fail(
          "EDITORIAL_RENDERER_MISSING: experimentalEditorialMode=true exige renderEditorialCreative injetado. O motor atual foi preservado; o caminho editorial nao cai silenciosamente no compositor antigo.",
          "EDITORIAL_RENDERER_MISSING",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
        );
      }

      let baseImageArtifact: CreativeEngineArtifactProvenance["baseImage"];
      try {
        const baseUpload = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "editorial-base"), body: baseWithAssetsBuffer, contentType: "image/jpeg" });
        const baseDimensions = await deps.readImageDimensions(baseWithAssetsBuffer);
        baseImageArtifact = {
          url: baseUpload.url,
          width: baseDimensions.width,
          height: baseDimensions.height,
          source: "ai_generated_pre_renderer",
          publishable: false,
        };
      } catch (error) {
        return fail(
          `EDITORIAL_BASE_IMAGE_PERSIST_FAILED: falha ao persistir imagem base para auditoria: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          "EDITORIAL_BASE_IMAGE_PERSIST_FAILED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
        );
      }

      // Preflight de alfa ANTES do renderer: base institucional significativamente transparente
      // falha fechada (sem preencher o buraco em silêncio e sem regenerar escondido).
      let baseAlphaCoverage: CreativeEngineArtifactProvenance["baseAlphaCoverage"];
      if (deps.measureImageAlpha) {
        const coverage = await deps.measureImageAlpha(baseWithAssetsBuffer);
        const alphaVerdict = evaluateInstitutionalBaseAlpha(coverage);
        baseAlphaCoverage = { ...coverage, nonOpaqueRatio: alphaVerdict.nonOpaqueRatio, ...(requestedBackground ? { requestedBackground } : {}) };
        if (editorialFamily === "premium_institutional" && !alphaVerdict.ok) {
          return fail(
            `INSTITUTIONAL_BASE_ALPHA_INVALID: ${alphaVerdict.reason}.`,
            "INSTITUTIONAL_BASE_ALPHA_INVALID",
            { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, artifactProvenance: { compositionMode: "editorial_experimental", baseImage: baseImageArtifact, baseAlphaCoverage } as CreativeEngineArtifactProvenance },
          );
        }
      } else if (editorialFamily === "premium_institutional") {
        warnings.push("ALPHA_PREFLIGHT_UNAVAILABLE: medidor de alfa não injetado — base institucional não verificada.");
      }

      // Prova direta de texto da BASE (antes de qualquer texto/asset do renderer): uma chamada leve
      // de visão só sobre a base. Alimenta o ledger de proveniência do gate.
      const baseTextDiagnostic = baseImageArtifact
        ? await scanEditorialBaseText(deps.creativeBrain, { baseImageUrl: baseImageArtifact.url, baseImageBuffer: baseWithAssetsBuffer, specialistId: SPECIALIST_ID, onCost: (response) => track("baseTextScan", response) })
        : undefined;

      const editorialAssets: EditorialCreativeAssetBuffer[] = [];
      for (const asset of [productAsset, screenshotAsset, logoAsset].filter((candidate): candidate is NonNullable<typeof productAsset> => Boolean(candidate))) {
        try {
          editorialAssets.push({ role: asset.role, url: asset.url, buffer: await loadAssetBuffer(asset.url) });
        } catch (error) {
          return fail(
            `EDITORIAL_ASSET_DOWNLOAD_FAILED: falha ao baixar asset real "${asset.role}" para composicao editorial: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
            "EDITORIAL_ASSET_DOWNLOAD_FAILED",
            { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
          );
        }
      }
      // Versões de logo do Brand Profile (assets FORNECIDOS da biblioteca do workspace): o renderer
      // escolhe a compatível com o fundo real. Falha ao baixar uma versão nunca derruba a peça —
      // a logo padrão continua disponível; fica registrado.
      for (const brandLogo of context.brandIdentity?.logos ?? []) {
        if (editorialAssets.some((asset) => asset.url === brandLogo.url && !asset.brandLogo)) {
          const index = editorialAssets.findIndex((asset) => asset.url === brandLogo.url);
          editorialAssets[index] = { ...editorialAssets[index]!, brandLogo: { assetId: brandLogo.assetId, variant: brandLogo.variant, backgrounds: brandLogo.backgrounds, priority: brandLogo.priority } };
          continue;
        }
        try {
          editorialAssets.push({ role: "logo", url: brandLogo.url, buffer: await loadAssetBuffer(brandLogo.url), brandLogo: { assetId: brandLogo.assetId, variant: brandLogo.variant, backgrounds: brandLogo.backgrounds, priority: brandLogo.priority } });
        } catch {
          brandRules.push({ code: "LOGO_VARIANT_UNAVAILABLE", detail: `logo ${brandLogo.variant} (${brandLogo.assetId}) não pôde ser carregada`, outcome: "SKIPPED" });
        }
      }

      // SCREENSHOT_TEXT_INVENTORY: o que existe de texto DENTRO do screenshot real, lido do próprio
      // asset (cache por hash no mesmo tenant/workspace). Só proveniência para o gate — nunca fato.
      const screenshotBufferForInventory = screenshotAsset ? editorialAssets.find((asset) => asset.role === "screenshot" && asset.url === screenshotAsset.url)?.buffer : undefined;
      const screenshotTextInventory = screenshotAsset && screenshotBufferForInventory && deps.screenshotTextInventoryStore
        ? await resolveScreenshotTextInventory(
            { icaro: deps.creativeBrain, store: deps.screenshotTextInventoryStore, ...(deps.now ? { now: deps.now } : {}) },
            { tenantId: input.tenantId, workspaceId: input.workspaceId, assetUrl: screenshotAsset.url, buffer: screenshotBufferForInventory, specialistId: SPECIALIST_ID, onCost: (response) => track("screenshotTextInventory", response) },
          )
        : undefined;

      let editorial: RenderEditorialCreativeResult;
      try {
        editorial = await deps.renderEditorialCreative({
          baseImageBuffer: baseWithAssetsBuffer,
          context,
          plan: planForGeneration,
          assets: editorialAssets,
        });
      } catch (error) {
        if (isEditorialCompositionError(error)) {
          return fail(error.message, error.code, { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
        }
        return fail(
          `EDITORIAL_COMPOSITION_FAILED: falha no compositor editorial experimental: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          "EDITORIAL_COMPOSITION_FAILED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
        );
      }

      const editorialCompositionSteps: CompositionStep[] = [
        {
          step: "editorial_geometry_validation",
          ok: editorial.geometry.valid,
          detail: editorial.geometry.valid
            ? `Geometria editorial validada (${editorial.family}); ${editorial.geometry.boxes.length} componente(s) medido(s).`
            : `Geometria editorial reprovada (${editorial.family}): ${editorial.geometry.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
        },
      ];
      if (!editorial.geometry.valid) {
        return fail(
          "EDITORIAL_GEOMETRY_INVALID: o compositor editorial detectou overflow/colisao/mascara antes de publicar a peca.",
          "EDITORIAL_GEOMETRY_INVALID",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: editorialCompositionSteps },
        );
      }
      editorialCompositionSteps.push({
        step: "editorial_composition",
        ok: true,
        detail: `Familia editorial "${editorial.family}" renderizada; roles compostos: ${editorial.compositedAssetRoles.length > 0 ? editorial.compositedAssetRoles.join(", ") : "nenhum"}.`,
      });

      const uploaded = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "editorial-final"), body: editorial.buffer, contentType: "image/jpeg" });
      const dimensions = await deps.readImageDimensions(editorial.buffer);
      const finalImageWidth = dimensions.width ?? 0;
      const finalImageHeight = dimensions.height ?? 0;

      if (budgetExceeded()) {
        return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: editorialCompositionSteps, finalImageUrl: uploaded.url, finalImageWidth, finalImageHeight });
      }

      const renderedTexts = editorial.renderedTextZones.map((zone) => zone.text);
      const planForGate: CreativePlan = {
        ...plan,
        textZones: editorial.renderedTextZones,
        assetPlacements: editorial.renderedAssetPlacements,
        allowedRenderedTexts: [...new Set([...plan.allowedRenderedTexts, ...renderedTexts])],
      };
      const artifactProvenance: CreativeEngineArtifactProvenance = {
        compositionMode: "editorial_experimental",
        baseImage: baseImageArtifact,
        finalImage: {
          url: uploaded.url,
          width: finalImageWidth,
          height: finalImageHeight,
          source: "final_rendered_image",
          publishable: false,
        },
        productAsset: productAsset ? { role: "product_photo", url: productAsset.url, source: "input_asset" } : undefined,
        inputAssets: editorialAssets.map((asset) => ({ role: asset.role, url: asset.url, source: "input_asset" })),
        imagePromptSanitization: buildImagePromptSanitizationAudit(imagePrompt, planForGeneration, context),
        renderedGeometry: editorial.renderedGeometry,
        assetVerification: editorial.assetVerification,
        ...(editorial.composition ? { editorialComposition: { selectedVariant: editorial.composition.variant, variantSelectionReasons: editorial.composition.selectionReasons, diagnostics: editorial.composition } } : {}),
        ...(baseAlphaCoverage ? { baseAlphaCoverage } : {}),
        ...(baseTextDiagnostic ? { baseTextDiagnostic } : {}),
        ...(screenshotTextInventory
          ? { screenshotTextInventory: { ...screenshotTextInventory, textCount: screenshotTextInventory.texts.length, texts: screenshotTextInventory.texts.map((entry) => ({ normalizedText: entry.normalizedText, occurrenceCount: entry.occurrenceCount })) } }
          : {}),
        ...(context.brandIdentity
          ? {
              brandProfile: {
                source: "BRAND_PROFILE" as const,
                profileId: context.brandIdentity.profileId,
                workspaceId: context.brandIdentity.workspaceId,
                version: context.brandIdentity.version,
                updatedAt: context.brandIdentity.updatedAt,
                appliedBrandRules: [...brandRules, ...(editorial.composition?.brandRules ?? [])],
                identity: context.brandIdentity.identity,
              },
            }
          : {}),
      };
      const qualityGate = await evaluateCreativeQualityGate(deps.creativeBrain, {
        finalImageUrl: uploaded.url,
        finalImageWidth,
        finalImageHeight,
        expectedAspectRatio: context.format,
        compositedAssetRoles: editorial.compositedAssetRoles,
        context,
        plan: planForGate,
        specialistId: SPECIALIST_ID,
        assetPixelEvidence: editorial.assetVerification ?? [],
        ...(baseTextDiagnostic ? { baseTextDiagnostic } : {}),
        // Paleta da marca aplicada de forma determinística pelo renderer (superfícies + destaque).
        brandPaletteRenderedDeterministically: Boolean(context.brandIdentity && editorial.composition?.brandRules?.some((rule) => rule.code === "BRAND_SURFACES") && editorial.composition.brandRules.some((rule) => rule.code === "BRAND_ACCENT")),
        ...(screenshotTextInventory ? { screenshotTextInventory } : {}),
        ownership: { tenantId: input.tenantId, workspaceId: input.workspaceId },
        onCost: (response) => track("technicalQualityGate", response),
      });
      if (qualityGate.screenshotInventoryDecision && artifactProvenance.screenshotTextInventory) artifactProvenance.screenshotTextInventory.gateDecision = qualityGate.screenshotInventoryDecision;
      if (qualityGate.textProvenanceLedger) artifactProvenance.textProvenanceLedger = qualityGate.textProvenanceLedger;
      if (qualityGate.paletteDiagnostics && artifactProvenance.brandProfile) {
        artifactProvenance.brandProfile.appliedBrandRules.push(...qualityGate.paletteDiagnostics.map((item) => ({ code: item.decision, detail: `paleta da marca aplicada pelo renderer; visão discordou: ${item.visionReasoning ?? "—"}`, outcome: "PROFILE_PREVAILED" as const })));
      }

      if (qualityGate.verdict !== "pass") {
        return fail("CREATIVE_QUALITY_GATE_NOT_PASSED: o caminho editorial experimental gerou a peca, mas o Quality Gate tecnico reprovou.", "CREATIVE_QUALITY_GATE_NOT_PASSED", {
          creativePlan: planForGate,
          finalImagePrompt: imagePrompt,
          qualityGate,
          repairRounds,
          compositionSteps: editorialCompositionSteps,
          artifactProvenance,
          finalImageUrl: uploaded.url,
          finalImageWidth,
          finalImageHeight,
        });
      }

      if (budgetExceeded()) {
        return failBudgetExceeded({ creativePlan: planForGate, finalImagePrompt: imagePrompt, qualityGate, repairRounds, compositionSteps: editorialCompositionSteps, artifactProvenance, finalImageUrl: uploaded.url, finalImageWidth, finalImageHeight });
      }
      const visualQualityScore = await evaluateVisualQualityScore(deps.creativeBrain, {
        finalImageUrl: uploaded.url,
        plan: planForGate,
        brandColors: context.brandColors,
        specialistId: SPECIALIST_ID,
        onCost: (response) => track("visualQualityScore", response),
      });
      if (visualQualityScore?.requiresRepair) {
        return fail("CREATIVE_VISUAL_QUALITY_BELOW_THRESHOLD: o caminho editorial passou no gate tecnico, mas o score visual pediu reparo; nesta integracao experimental o motor para para avaliacao em vez de gastar nova rodada automaticamente.", "CREATIVE_VISUAL_QUALITY_BELOW_THRESHOLD", {
          creativePlan: planForGate,
          finalImagePrompt: imagePrompt,
          qualityGate,
          visualQualityScore,
          repairRounds,
          compositionSteps: editorialCompositionSteps,
          artifactProvenance,
          finalImageUrl: uploaded.url,
          finalImageWidth,
          finalImageHeight,
        });
      }

      artifactProvenance.finalImage = { ...artifactProvenance.finalImage!, publishable: true };

      return {
        engineMode: "gpt",
        compositionMode: "editorial_experimental",
        directorModel,
        imageModel,
        creativeContext: context,
        creativePlan: planForGate,
        finalImagePrompt: imagePrompt,
        generationMethod,
        productRenderDecision,
        assetsUsed: editorialAssets.map((asset) => ({ role: asset.role, url: asset.url })),
        compositedAssetRoles: editorial.compositedAssetRoles,
        compositionSteps: editorialCompositionSteps,
        qualityGate,
        visualQualityScore,
        chosenCreativeDirection,
        repairRounds,
        artifactProvenance,
        finalImageUrl: uploaded.url,
        finalImageWidth,
        finalImageHeight,
        publishable: true,
        estimatedCostUsd,
        costBreakdown,
        latencyMs: Math.max(latencyMs, (deps.now?.() ?? new Date()).getTime() - startedAt),
        warnings,
      };
    }

    // ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — achado do smoke de produção: pedir ao
    // modelo "não desenhe texto aqui" não é suficiente, ele pode desenhar mesmo assim. Analisa a
    // imagem BASE (antes de qualquer composição determinística) pra ter dado REAL sobre texto
    // espúrio/fantasma e ocupação de regiões, nunca só a instrução estática do plano.
    const rendererOwnedZonesForAnalysis = planForGeneration.textZones.filter((zone) => zone.renderedBy === "renderer");
    const screenshotPlacementForAnalysis = screenshotAsset ? plan.assetPlacements.find((candidate) => candidate.role === "screenshot") : undefined;
    let preCompositionAnalysis: PreCompositionAnalysis | undefined;
    if (rendererOwnedZonesForAnalysis.length > 0 || screenshotPlacementForAnalysis) {
      if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
      preCompositionAnalysis = await analyzePreCompositionImage(deps.creativeBrain, {
        imageUrl: uri,
        rendererOwnedZones: rendererOwnedZonesForAnalysis,
        allowedRenderedTexts: planForGeneration.allowedRenderedTexts,
        hasScreenshotSlot: Boolean(screenshotPlacementForAnalysis),
        specialistId: SPECIALIST_ID,
        onCost: (response) => track("preCompositionAnalysis", response),
      });
    }

    // Screenshot slot: o modelo já "assou" uma interface completa (provavelmente falsa) na região
    // reservada pro screenshot real — não é um problema de geometria que o renderer resolva
    // sozinho (o conteúdo já está nos pixels), então roteia direto pro reparo normal (gpt_replan),
    // sem gastar screenshot/logo/texto/upload/gate técnico desta rodada.
    if (preCompositionAnalysis?.screenshotSlotLooksFake === true) {
      const screenshotSlotIssues: CreativeQualityIssue[] = [
        {
          code: "SCREENSHOT_SLOT_MISMATCH",
          message: "A imagem base já mostra uma interface/tela completa (provavelmente falsa) na região reservada para o screenshot real — essa região deveria estar vazia/neutra, pronta para receber o screenshot real por composição determinística.",
          source: "vision",
        },
      ];
      const routedScreenshot = routeCreativeRepair(screenshotSlotIssues, repairAttempt);
      repairRounds.push({ round: repairAttempt + 1, route: routedScreenshot.route, issues: screenshotSlotIssues, instructions: routedScreenshot.instructions, resolved: false, strategies: screenshotSlotIssues.map(classifyRepairStrategy) });

      if (routedScreenshot.route === "unrecoverable") {
        return fail(
          "CREATIVE_QUALITY_GATE_NOT_PASSED: a imagem base já mostra uma interface falsa na região do screenshot, e o limite de tentativas de reparo foi atingido.",
          "CREATIVE_QUALITY_GATE_NOT_PASSED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
        );
      }

      repairAttempt += 1;
      isRepairRound = true;
      if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });

      const screenshotSlotRepair = await requestRepairedPlan(deps.creativeBrain, plan, context, routedScreenshot.instructions, input.executionRunId, input.creativeEngineRunId, (response) => track("director", response));
      if (!screenshotSlotRepair.plan) {
        return isProviderQuotaExhausted(screenshotSlotRepair.response)
          ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar ou corrigir a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds })
          : fail("Não foi possível obter um creative_plan de correção válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
      }
      plan = screenshotSlotRepair.plan;
      continue outerImageRound;
    }

    const compositedAssetRoles: CreativePlanAssetRole[] = [];
    const assetsUsed: { role: CreativePlanAssetRole; url: string }[] = [];
    const roundCompositionSteps: CompositionStep[] = [];

    if (screenshotAsset) {
      const placement = plan.assetPlacements.find((candidate) => candidate.role === "screenshot")!;
      try {
        const screenshotBuffer = await loadAssetBuffer(screenshotAsset.url);
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
        const logoBuffer = await loadAssetBuffer(logoAsset.url);
        let logoTreatment = "direct";
        baseWithAssetsBuffer = await deps.compositeLogo({
          imageBuffer: baseWithAssetsBuffer,
          logoBuffer,
          placement: placement?.rect,
          onTreatmentChosen: (treatment) => { logoTreatment = treatment; },
        });
        compositedAssetRoles.push("logo");
        assetsUsed.push({ role: "logo", url: logoAsset.url });
        // ETAPA 3 (Rodada 4) — tratamento adaptativo (ver `logo-compositor.ts`): nunca mais
        // sempre "cartão branco", registrado aqui pra auditoria/smoke local.
        roundCompositionSteps.push({ step: "logo_overlay", rect: placement?.rect, ok: true, detail: `Logo real colada (tratamento="${logoTreatment}").` });
      } catch (error) {
        return fail(
          `Falha ao compor a logo real: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          "LOGO_COMPOSITE_FAILED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps },
        );
      }
    }
    if (productAsset) assetsUsed.push({ role: "product_photo", url: productAsset.url });

    // ETAPA 3 (Rodada 4) — ajusta geometria/tratamento de cada zona do renderer a partir de dados
    // REAIS da imagem (texto fantasma/espúrio, ocupação de regiões) ANTES de desenhar texto por
    // cima — nunca consome uma rodada de reparo, é um ajuste de composição sempre tentado.
    const assetOccupiedRects = plan.assetPlacements.filter((placement) => placement.role === "logo" || placement.role === "screenshot").map((placement) => placement.rect);
    const safeAreaAdjustment = await applySafeAreaAdjustments(deps, {
      imageBuffer: baseWithAssetsBuffer,
      rendererZones: rendererOwnedZonesForAnalysis,
      analysis: preCompositionAnalysis,
      occupiedRects: assetOccupiedRects,
      tenantId: input.tenantId,
      specialistId: SPECIALIST_ID,
      onCost: (response) => track("ghostTextNeutralization", response),
    });
    baseWithAssetsBuffer = safeAreaAdjustment.imageBuffer;
    if (safeAreaAdjustment.steps.length > 0) {
      roundCompositionSteps.push({ step: "safe_area_adjustment", ok: true, detail: safeAreaAdjustment.steps.join("; ") });
    }

    // ETAPA 3.1 — texto fantasma que resistiu a 2 passes escalados de blur+véu, confirmado por
    // reverificação de visão: nenhum tratamento local a mais resolveria. Roteia pro reparo normal
    // (gpt_replan), sem gastar screenshot/logo/upload/gate técnico desta rodada.
    if (safeAreaAdjustment.unrecoverableGhostTextZoneKinds.length > 0) {
      const unrecoverableIssues: CreativeQualityIssue[] = safeAreaAdjustment.unrecoverableGhostTextZoneKinds.map((kind) => ({
        code: "UNRECOVERABLE_GHOST_TEXT",
        message: `A zona "${kind}" tem texto fantasma (desenhado pelo modelo de imagem) que continuou legível mesmo após 2 passes escalados de blur+véu local, confirmado por reverificação de visão — nenhum tratamento local a mais resolveria.`,
        source: "vision",
      }));
      const routedGhostText = routeCreativeRepair(unrecoverableIssues, repairAttempt);
      repairRounds.push({ round: repairAttempt + 1, route: routedGhostText.route, issues: unrecoverableIssues, instructions: routedGhostText.instructions, resolved: false, strategies: unrecoverableIssues.map(classifyRepairStrategy) });

      if (routedGhostText.route === "unrecoverable") {
        return fail(
          "CREATIVE_QUALITY_GATE_NOT_PASSED: texto fantasma não pôde ser neutralizado localmente mesmo após 2 passes escalados, e o limite de tentativas de reparo foi atingido.",
          "CREATIVE_QUALITY_GATE_NOT_PASSED",
          { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds },
        );
      }

      repairAttempt += 1;
      isRepairRound = true;
      if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });

      const ghostTextRepair = await requestRepairedPlan(deps.creativeBrain, plan, context, routedGhostText.instructions, input.executionRunId, input.creativeEngineRunId, (response) => track("director", response));
      if (!ghostTextRepair.plan) {
        return isProviderQuotaExhausted(ghostTextRepair.response)
          ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar ou corrigir a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds })
          : fail("Não foi possível obter um creative_plan de correção válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
      }
      plan = ghostTextRepair.plan;
      continue outerImageRound;
    }

    // ETAPA 3.2 (Rodada 4) — achado do smoke real da ETAPA 3.1: a reverificação LOCAL (só o
    // recorte da região tratada) confirmava sucesso, mas o gate final (peça inteira) ainda
    // encontrava o mesmo texto duplicado em outro lugar não coberto pelo tratamento. Depois de
    // TODAS as regiões detectadas já terem sido tratadas, uma checagem GLOBAL da imagem base
    // tratada inteira — só roda quando havia algo pra verificar (nunca gasta a chamada à toa).
    // Só roda quando havia ALGO detectado E a capacidade completa de tratamento local estava
    // disponível (senão nada foi tratado nesta rodada — rodar o recheck global não serviria pra
    // nada além de gastar uma chamada extra, já que não há como agir sobre o que ele encontrar).
    const hasFullNeutralizationCapability = Boolean(deps.applyLocalBlur && deps.applyLocalScrim && deps.extractRegionBuffer && deps.computeRegionPixelStats);
    if (preCompositionAnalysis?.spuriousTexts && preCompositionAnalysis.spuriousTexts.length > 0 && hasFullNeutralizationCapability) {
      if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps });
      // ETAPA 3.3.3 (Rodada 4) — achado da auditoria: a reverificação global rodava sobre a
      // imagem JÁ com a logo real colada, mas nunca sabia ONDE a logo real está — texto legível
      // DENTRO dela (ex.: o wordmark/placeholder do próprio asset) era flagrado como "não
      // autorizado", um falso positivo confirmado (imagem real do smoke). Passa a região REAL da
      // logo (nunca uma whitelist de palavras) pra visão poder excluir especificamente aquela
      // área — se o mesmo texto aparecer FORA dela, continua contando normalmente.
      const logoPlacementRect = plan.assetPlacements.find((placement) => placement.role === "logo")?.rect;
      const globalCheckUpload = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "global-recheck"), body: baseWithAssetsBuffer, contentType: "image/jpeg" });
      let globalCheck = await checkGlobalTextLegibility(deps.creativeBrain, {
        imageUrl: globalCheckUpload.url,
        allowedRenderedTexts: planForGeneration.allowedRenderedTexts,
        logoRegion: logoPlacementRect,
        specialistId: SPECIALIST_ID,
        onCost: (response) => track("ghostTextNeutralization", response),
      });

      // ETAPA 3.3 (Rodada 4) — achado do smoke real da ETAPA 3.2: a reverificação global agora
      // devolve achados ESTRUTURADOS (texto/bbox/confiança), não só um booleano (brief, ponto 1).
      // Quando aponta uma ocorrência residual COM localização, trata-a na mesma localização REAL
      // (mesmo mecanismo da análise pré-composição), numa ÚNICA rodada residual extra (brief, ponto
      // 3: "INICIAL + 1 RESIDUAL, nunca um loop"), e reverifica uma ÚLTIMA vez antes de desistir.
      let globalResidualPassApplied = false;
      const treatableResidualFindings = globalCheck.residualFindings.filter((finding) => finding.bbox);
      if (globalCheck.hasUnresolvedText && treatableResidualFindings.length > 0) {
        globalResidualPassApplied = true;
        for (const finding of treatableResidualFindings) {
          if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps });
          // ETAPA 3.3.3 — mesma proteção geométrica do passe inicial: texto que sobrepõe
          // substancialmente um asset real já posicionado nunca é tratado como espúrio.
          if (overlapsKnownAssetSubstantially(finding.bbox!, assetOccupiedRects)) {
            roundCompositionSteps.push({
              step: "safe_area_adjustment",
              ok: true,
              detail: `GLOBAL_RESIDUAL_BBOX: texto "${finding.text}" (${finding.classification}) sobrepõe substancialmente um asset real já posicionado — tratado como parte do asset, nenhum tratamento aplicado.`,
            });
            continue;
          }
          // ETAPA 3.3.2/3.3.3 — mesma garantia estrutural de cobertura do passe inicial (ver
          // comentário acima, em `applySafeAreaAdjustments`): correspondência de zona combina
          // sinal semântico (matchedZoneKind) com sobreposição geométrica real — amplia só a
          // LARGURA, nunca a posição/altura vertical (que continua vindo da bbox real detectada).
          const residualFallbackZone = findMatchingCommercialZone(finding, rendererOwnedZonesForAnalysis);
          const residualPaddedRect = expandBboxWithPadding(finding.bbox!);
          const residualTreatmentRect = residualFallbackZone ? widenToCommercialBand(residualPaddedRect) : residualPaddedRect;
          const residualNeutralization = await neutralizeGhostTextZone(deps.creativeBrain, {
            computeRegionPixelStats: deps.computeRegionPixelStats!,
            applyLocalBlur: deps.applyLocalBlur!,
            applyLocalScrim: deps.applyLocalScrim!,
            extractRegionBuffer: deps.extractRegionBuffer!,
            objectStorage: deps.objectStorage,
          }, {
            imageBuffer: baseWithAssetsBuffer,
            rect: residualTreatmentRect,
            tenantId: input.tenantId,
            specialistId: SPECIALIST_ID,
            onCost: (response) => track("ghostTextNeutralization", response),
          });
          baseWithAssetsBuffer = residualNeutralization.imageBuffer;
          roundCompositionSteps.push({
            step: "safe_area_adjustment",
            ok: residualNeutralization.result.neutralizedLocally,
            detail: `GLOBAL_RESIDUAL_BBOX: texto "${finding.text}" (${finding.classification}) reportado pela reverificação global (fora da detecção inicial) tratado na bbox real — ${residualNeutralization.result.neutralizedLocally ? "neutralizado" : "NÃO neutralizado"} em ${residualNeutralization.result.passes} passe(s).`,
          });
        }
        if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps });
        const residualCheckUpload = await deps.objectStorage.put({ key: buildObjectKey(input.tenantId, "global-recheck-final"), body: baseWithAssetsBuffer, contentType: "image/jpeg" });
        globalCheck = await checkGlobalTextLegibility(deps.creativeBrain, {
          imageUrl: residualCheckUpload.url,
          allowedRenderedTexts: planForGeneration.allowedRenderedTexts,
          logoRegion: logoPlacementRect,
          specialistId: SPECIALIST_ID,
          onCost: (response) => track("ghostTextNeutralization", response),
        });
      }

      roundCompositionSteps.push({
        step: "safe_area_adjustment",
        ok: !globalCheck.hasUnresolvedText,
        detail: globalCheck.hasUnresolvedText
          ? `GLOBAL_FINAL_RECHECK${globalResidualPassApplied ? " (após 1 passe residual)" : ""}: ainda há texto não autorizado/duplicado legível na peça.`
          : `GLOBAL_FINAL_RECHECK${globalResidualPassApplied ? " (após 1 passe residual, recuperado)" : ""}: confirmado — nenhum texto não autorizado/duplicado legível na imagem base tratada.`,
      });

      if (globalCheck.hasUnresolvedText) {
        const globalIssues: CreativeQualityIssue[] = [{
          code: "UNRECOVERABLE_GLOBAL_TEXT",
          message: globalResidualPassApplied
            ? "A reverificação GLOBAL (peça inteira) encontrou texto não autorizado/duplicado legível mesmo depois de tratar todas as regiões detectadas inicialmente E a rodada residual de recuperação — nenhum tratamento local a mais resolveria."
            : "A reverificação GLOBAL (peça inteira) encontrou texto não autorizado/duplicado legível mesmo depois de tratar todas as regiões detectadas individualmente, sem localização suficiente para uma rodada residual de recuperação.",
          source: "vision",
        }];
        const routedGlobal = routeCreativeRepair(globalIssues, repairAttempt);
        repairRounds.push({ round: repairAttempt + 1, route: routedGlobal.route, issues: globalIssues, instructions: routedGlobal.instructions, resolved: false, strategies: globalIssues.map(classifyRepairStrategy) });

        if (routedGlobal.route === "unrecoverable") {
          return fail(
            "CREATIVE_QUALITY_GATE_NOT_PASSED: a reverificação global encontrou texto não resolvido mesmo após o tratamento local e a rodada residual, e o limite de tentativas de reparo foi atingido.",
            "CREATIVE_QUALITY_GATE_NOT_PASSED",
            { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: roundCompositionSteps },
          );
        }

        repairAttempt += 1;
        isRepairRound = true;
        if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });

        const globalRepair = await requestRepairedPlan(deps.creativeBrain, plan, context, routedGlobal.instructions, input.executionRunId, input.creativeEngineRunId, (response) => track("director", response));
        if (!globalRepair.plan) {
          return isProviderQuotaExhausted(globalRepair.response)
            ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar ou corrigir a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds })
            : fail("Não foi possível obter um creative_plan de correção válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", { creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
        }
        plan = globalRepair.plan;
        continue outerImageRound;
      }
    }

    // ETAPA 3.3 (Rodada 4) — "VISUAL TEXT BUDGET", degradação PÓS-geometria real (brief, ponto 12):
    // o preflight (acima) só via a geometria DECLARADA; agora a geometria é REAL (pós-relocalização
    // com dados de visão/pixel). Quando 2+ zonas continuam sobrepondo um asset/outra zona mesmo
    // sem região candidata livre (`unresolvedOverlapKinds`), isso é o sinal explícito do brief de
    // "card_fallback virando solução pra tudo" — descarta conteúdo OPCIONAL em vez de publicar uma
    // peça cheia de caixas empilhadas, nunca gera uma imagem nova só por isso.
    const densityDegradation = degradeOptionalZonesOnUnresolvedOverlap(safeAreaAdjustment.zones, plan, safeAreaAdjustment.unresolvedOverlapKinds);
    if (densityDegradation.droppedZones.length > 0) {
      roundCompositionSteps.push({
        step: "safe_area_adjustment",
        ok: true,
        detail: `OVERDENSE_LAYOUT: ${densityDegradation.droppedZones.length} zona(s) opcional(is) removida(s) da composição por congestionamento pós-geometria real (${densityDegradation.droppedZones.map((zone) => zone.kind).join(", ")}) — nenhuma nova geração de imagem.`,
      });
    }
    const rendererZones = densityDegradation.zones;
    // Geometria final (ver `planForGate` abaixo) nunca pode autorizar um texto que não vai mais ser
    // desenhado — some junto da zona descartada em QUALQUER das duas simplificações desta rodada
    // (preflight sobre o plano declarado + degradação sobre a geometria real), nunca só uma delas.
    const allDroppedTexts = new Set([...(densityPreflight?.droppedZones ?? []), ...densityDegradation.droppedZones].map((zone) => zone.text));
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

      if (budgetExceeded()) {
        return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds, compositionSteps: textCompositionSteps, finalImageUrl: uploaded.url, finalImageWidth, finalImageHeight });
      }

      // ETAPA 3.2 (Rodada 4) — achado real ao escrever os testes desta etapa: os checks
      // determinísticos de geometria (`checkAssetPlacementOverlap`/`checkTextZoneCollisions`/
      // `checkSafeAreaCompliance`) recebiam `plan.textZones` — os retângulos ORIGINAIS declarados
      // pelo Director, nunca os retângulos REALOCADOS por `applySafeAreaAdjustments`. Resultado:
      // uma colisão genuinamente corrigida em tempo de composição (ex.: headline que sobrepunha a
      // logo, movida pra uma região livre) ainda assim reprovava o gate, porque o gate olhava pra
      // geometria antiga. `planForGate` é o MESMO plano, só com `textZones` trocado pelos
      // retângulos REAIS que vão pro compositor — nunca usado pro reparo em si (`plan` original
      // continua sendo o que volta pro Director, pra não confundi-lo sobre o que ele decidiu).
      // ETAPA 3.3 — `allowedRenderedTexts` também precisa refletir a geometria FINAL: um texto cuja
      // zona foi descartada pelo "VISUAL TEXT BUDGET" (preflight ou degradação pós-geometria) nunca
      // pode continuar "autorizado" — senão o próprio gate reprovaria por `MISSING_REQUIRED_TEXT`
      // um texto que o motor decidiu, de propósito, não desenhar mais.
      const planForGate: CreativePlan = {
        ...plan,
        textZones: rendererZones,
        allowedRenderedTexts: plan.allowedRenderedTexts.filter((text) => !allDroppedTexts.has(text)),
      };
      const qualityGate = await evaluateCreativeQualityGate(deps.creativeBrain, {
        finalImageUrl: uploaded.url,
        finalImageWidth,
        finalImageHeight,
        expectedAspectRatio: context.format,
        compositedAssetRoles,
        context,
        plan: planForGate,
        specialistId: SPECIALIST_ID,
        onCost: (response) => track("technicalQualityGate", response),
      });

      if (qualityGate.verdict === "pass") {
        // Auditoria "qualidade visual e direção de arte" — o gate técnico só garante que a peça
        // NÃO TEM defeito grave; nunca garantiu que ela é boa. Visual Quality Score roda só aqui
        // (nunca antes do gate técnico passar — sem sentido avaliar estética de algo já quebrado).
        if (budgetExceeded()) {
          return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, repairRounds, compositionSteps: textCompositionSteps, finalImageUrl: uploaded.url, finalImageWidth, finalImageHeight });
        }
        const visualQualityScore = await evaluateVisualQualityScore(deps.creativeBrain, {
          finalImageUrl: uploaded.url,
          plan,
          brandColors: context.brandColors,
          specialistId: SPECIALIST_ID,
          onCost: (response) => track("visualQualityScore", response),
        });

        // `undefined` (chamada falhou/resposta incompleta) nunca bloqueia — best-effort, mesmo
        // espírito do resto do gate. Rodada 4 (benchmark de qualidade criativa) — achado
        // confirmado: um dip isolado de score estético (`belowThreshold`, ex.: média 6.2, uma
        // dimensão 3.8) consumia a MESMA única rodada de reparo compartilhada com falhas técnicas
        // duras, sem motivo concreto nomeado ("retry desperdiçado"). Só `requiresRepair`
        // (catastrófico, ver `evaluate-visual-quality-score.ts`) aciona reparo agora —
        // `belowThreshold` sozinho publica normalmente, vira só dado de telemetria.
        if (!visualQualityScore || !visualQualityScore.requiresRepair) {
          return {
            engineMode: "gpt",
            compositionMode: "standard",
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
            preCompositionAnalysis,
            qualityGate,
            visualQualityScore,
            chosenCreativeDirection,
            repairRounds,
            finalImageUrl: uploaded.url,
            finalImageWidth,
            finalImageHeight,
            publishable: true,
            estimatedCostUsd,
            costBreakdown,
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
        repairRounds.push({ round: repairAttempt + 1, route: "gpt_replan", issues: [], instructions: aestheticInstructions, resolved: false, strategies: [] });
        repairAttempt += 1;
        // Auditoria de custo urgente — a partir daqui, todo gasto seguinte É gasto de reparo
        // (nunca volta a `false` na mesma execução, ver `costBreakdown.repairRoundsCost`).
        isRepairRound = true;

        if (budgetExceeded()) {
          return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, visualQualityScore, repairRounds, compositionSteps: textCompositionSteps });
        }

        const aestheticRepair = await requestRepairedPlan(deps.creativeBrain, plan, context, aestheticInstructions, input.executionRunId, input.creativeEngineRunId, (response) => track("director", response));
        if (!aestheticRepair.plan) {
          // Achado real em produção (incidente de quota OpenAI): "não foi possível obter um plano
          // válido" soa como falha criativa (JSON malformado) — nunca como o que de fato aconteceu
          // quando é quota/crédito esgotado. Código e mensagem distintos pro operador nunca
          // confundir os dois motivos.
          return isProviderQuotaExhausted(aestheticRepair.response)
            ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar ou corrigir a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", {
                creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, visualQualityScore, repairRounds, compositionSteps: textCompositionSteps,
              })
            : fail("Não foi possível obter um creative_plan de correção estética válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", {
                creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, visualQualityScore, repairRounds, compositionSteps: textCompositionSteps,
              });
        }
        const repairedPlan = aestheticRepair.plan;

        plan = repairedPlan;
        continue outerImageRound;
      }

      const routed = routeCreativeRepair(qualityGate.issues, repairAttempt);
      repairRounds.push({ round: repairAttempt + 1, route: routed.route, issues: qualityGate.issues, instructions: routed.instructions, resolved: false, strategies: qualityGate.issues.map(classifyRepairStrategy) });

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
      // Auditoria de custo urgente — a partir daqui, todo gasto seguinte É gasto de reparo (nunca
      // volta a `false` na mesma execução). Marcado ANTES do `if renderer_reflow` de propósito:
      // mesmo aquela rota (sem chamada de IA, custo zero) já é tecnicamente uma rodada de reparo —
      // se o loop seguir depois dela, o gasto seguinte continua corretamente atribuído.
      isRepairRound = true;

      if (routed.route === "renderer_reflow") {
        fontScale = Math.max(0.4, fontScale * 0.75);
        continue innerTextRound;
      }

      if (budgetExceeded()) {
        return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, repairRounds, compositionSteps: textCompositionSteps });
      }

      // gpt_replan — sempre volta ao MESMO modelo diretor, nunca ao motor/renderer legado.
      // `requestRepairedPlan` já cobre a segunda tentativa em caso de JSON malformado/incompleto
      // (achado ao vivo em produção, ver comentário na definição da função) — nunca conta como uma
      // rodada de reparo nova (o `repairAttempt` já foi incrementado acima, pra continuar contra o
      // limite de rounds normal).
      const gateRepair = await requestRepairedPlan(deps.creativeBrain, plan, context, routed.instructions, input.executionRunId, input.creativeEngineRunId, (response) => track("director", response));

      if (!gateRepair.plan) {
        return isProviderQuotaExhausted(gateRepair.response)
          ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar ou corrigir a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED", {
              creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, repairRounds, compositionSteps: textCompositionSteps,
            })
          : fail("Não foi possível obter um creative_plan de correção válido do GPT, mesmo após nova tentativa.", "CREATIVE_PLAN_REPAIR_INVALID", {
              creativePlan: plan, finalImagePrompt: imagePrompt, qualityGate, repairRounds, compositionSteps: textCompositionSteps,
            });
      }

      plan = gateRepair.plan;
      continue outerImageRound;
    }
  }
}
