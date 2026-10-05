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
  type CreativePlanTextZone,
} from "../../shared/utils/gpt-creative-plan.types.js";
import { exploreCreativeDirections, type CreativeDirectionExploration } from "./explore-creative-directions.js";
import type { CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { resolveProductRenderMode, type AssetSuitabilityScore, type ProductRenderModeDecision } from "../../shared/utils/product-asset.types.js";
import {
  evaluateCreativeQualityGate,
  type CreativeQualityGateResult,
  type CreativeQualityIssue,
} from "./evaluate-creative-quality-gate.js";
import { buildCreativePlanRepairPrompt, classifyRepairStrategy, MAX_CREATIVE_REPAIR_ROUNDS, routeCreativeRepair, type CreativeRepairRound } from "./creative-repair.js";
import { evaluateVisualQualityScore, buildAestheticRepairInstructions, type VisualQualityScoreResult } from "./evaluate-visual-quality-score.js";
import { analyzePreCompositionImage, type PreCompositionAnalysis } from "./analyze-pre-composition-image.js";
import { resolveActualTextZoneRect, chooseTextBackingTreatment, textBackingTreatmentToRendererStyle, type RegionSemanticFlags, type SafeAreaCandidateRegion } from "./resolve-actual-safe-area.js";
import { neutralizeGhostTextZone } from "./neutralize-ghost-text.js";

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

export type CompositionStepKind = "screenshot_mockup" | "logo_overlay" | "text_zones" | "safe_area_adjustment";

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
  compositeLogo(input: { imageBuffer: Buffer; logoBuffer: Buffer; placement?: CreativePlanRect; onTreatmentChosen?: (treatment: string) => void }): Promise<Buffer>;
  compositeScreenshot(input: { imageBuffer: Buffer; screenshotBuffer: Buffer; placement: CreativePlanRect; frame?: "phone" | "laptop" }): Promise<Buffer>;
  renderTextZones(input: {
    baseImageBuffer: Buffer;
    zones: CreativePlan["textZones"];
    accentColor?: string;
    fontScale?: number;
  }): Promise<{ buffer: Buffer; renderedZones: unknown[] }>;
  computeAssetSuitability?(buffer: Buffer): Promise<AssetSuitabilityScore | undefined>;
  readImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }>;
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
    if (response.status !== "completed") {
      // Achado real em produção (incidente de quota OpenAI): quota/crédito esgotado NUNCA se
      // resolve tentando de novo com o MESMO prompt — insistir só gastava a 2ª tentativa de JSON
      // contra um erro que vai repetir idêntico. Aborta já na 1ª falha nesse caso específico
      // (`isProviderQuotaExhausted`, abaixo); qualquer outro motivo de falha continua tentando de
      // novo normalmente, comportamento inalterado.
      if (isProviderQuotaExhausted(response)) break;
      continue;
    }
    try {
      const plan = parseCreativePlan(extractJson(String(response.content ?? ""), "GPT Creative Plan"));
      if (plan) return { plan, response };
    } catch {
      // tenta de novo (ou desiste, se for a última tentativa)
    }
  }
  return { response: lastResponse };
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
): Promise<{ imageBuffer: Buffer; zones: CreativePlanTextZone[]; steps: string[]; unrecoverableGhostTextZoneKinds: string[] }> {
  let imageBuffer = input.imageBuffer;
  const zones: CreativePlanTextZone[] = [];
  const steps: string[] = [];
  const unrecoverableGhostTextZoneKinds: string[] = [];
  const occupiedRects = [...input.occupiedRects];
  const regionFlags: Partial<Record<SafeAreaCandidateRegion, RegionSemanticFlags>> = input.analysis?.regions ?? {};

  for (const zone of input.rendererZones) {
    const ghostFinding = input.analysis?.spuriousTexts.find((finding) => finding.classification === "ghost_text" && finding.matchedZoneKind === zone.kind);
    // Sem dado de visão confiável pra esta zona (chamada falhou, ou plano antigo), assume limpa —
    // nunca realoca às cegas sem evidência real de ocupação.
    const plannedIsClear = (input.analysis?.plannedZonesClear[zone.kind] ?? true) && !ghostFinding;

    const decision = resolveActualTextZoneRect({
      plannedRect: zone.rect,
      plannedRectIsClear: plannedIsClear,
      regionFlags,
      occupiedRects,
    });

    // Texto fantasma só continua "ativo" se NÃO conseguimos fugir dele reposicionando — se a zona
    // foi realocada pra uma região livre, o texto fantasma original fica fora da nova área.
    const hasGhostTextHere = Boolean(ghostFinding) && !decision.relocated;

    if (hasGhostTextHere && deps.applyLocalBlur && deps.applyLocalScrim && deps.extractRegionBuffer && deps.computeRegionPixelStats) {
      // ETAPA 3.1 (achado do smoke real: blur sozinho às vezes não bastou) — trata, reavalia a
      // região tratada (visão, isolada), escala até 2 vezes, nunca cobre com texto sem confirmar.
      const neutralization = await neutralizeGhostTextZone(deps.creativeBrain, {
        computeRegionPixelStats: deps.computeRegionPixelStats,
        applyLocalBlur: deps.applyLocalBlur,
        applyLocalScrim: deps.applyLocalScrim,
        extractRegionBuffer: deps.extractRegionBuffer,
        objectStorage: deps.objectStorage,
      }, {
        imageBuffer,
        rect: decision.rect,
        tenantId: input.tenantId,
        specialistId: input.specialistId,
        onCost: input.onCost,
      });
      imageBuffer = neutralization.imageBuffer;

      if (!neutralization.result.neutralizedLocally) {
        unrecoverableGhostTextZoneKinds.push(zone.kind);
        steps.push(`${zone.kind}: texto fantasma NÃO neutralizado após ${neutralization.result.passes} passe(s) (intensidade "${neutralization.result.finalIntensity}") — UNRECOVERABLE_GHOST_TEXT.`);
        occupiedRects.push(decision.rect);
        zones.push({ ...zone, rect: decision.rect });
        continue;
      }

      occupiedRects.push(decision.rect);
      zones.push({
        ...zone,
        rect: decision.rect,
        backingStyle: "none",
        textColorOverride: neutralization.result.backgroundIsDark ? "light" : "dark",
      });
      steps.push(
        `${zone.kind}: ${decision.relocated ? `realocado para região "${decision.relocatedTo}"` : "manteve posição planejada"}, ` +
          `texto fantasma NEUTRALIZADO LOCALMENTE em ${neutralization.result.passes} passe(s) (intensidade final "${neutralization.result.finalIntensity}") — GHOST_TEXT_NEUTRALIZED_LOCALLY, nenhuma nova geração de imagem.`,
      );
      continue;
    }

    // Fallback ETAPA 3 (sem reverificação): se os deps novos da ETAPA 3.1 não estiverem
    // disponíveis (ex.: ambiente/teste que só injeta `applyLocalBlur`), texto fantasma ainda força
    // pelo menos o blur simples — nunca silenciosamente ignorado só porque a reverificação não
    // está disponível.
    const pixelStats = await deps.computeRegionPixelStats?.(imageBuffer, decision.rect);
    const treatment = chooseTextBackingTreatment({ pixelStats, hasGhostTextHere, plannedBackingStyle: zone.backingStyle });

    if (treatment === "local_blur" && deps.applyLocalBlur) {
      imageBuffer = await deps.applyLocalBlur(imageBuffer, decision.rect);
    }

    occupiedRects.push(decision.rect);
    zones.push({ ...zone, rect: decision.rect, backingStyle: textBackingTreatmentToRendererStyle(treatment) });
    steps.push(
      `${zone.kind}: ${decision.relocated ? `realocado para região "${decision.relocatedTo}"` : "manteve posição planejada"}, tratamento="${treatment}"` +
        (hasGhostTextHere ? " (texto fantasma detectado nesta região — reverificação indisponível, sem escalonamento)" : ""),
    );
  }

  return { imageBuffer, zones, steps, unrecoverableGhostTextZoneKinds };
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

  // Ponto 9 da auditoria "qualidade visual e direção de arte" — uma ÚNICA chamada de texto barata
  // ANTES do plano detalhado, pra ancorar o plano numa direção criativa concreta (e, via
  // `context.recentHistory`, evitar repetir o conceito visual de peças recentes — ponto 10). Best-
  // effort: `undefined` (chamada falhou/resposta incompleta) segue direto pro plano SEM âncora,
  // comportamento idêntico ao motor antes desta etapa existir.
  const chosenCreativeDirection = budgetExceeded()
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

  const { plan: initialPlan, response: planResponse } = await requestCreativePlan(
    deps.creativeBrain,
    context,
    input.executionRunId,
    input.creativeEngineRunId,
    (response) => track("director", response),
    chosenDirectionAnchor,
  );
  directorModel = planResponse?.model?.id;
  if (!initialPlan) {
    return isProviderQuotaExhausted(planResponse)
      ? fail("PROVIDER_QUOTA_EXHAUSTED: crédito/quota da OpenAI esgotado — não é possível gerar a peça até a conta ser regularizada.", "PROVIDER_QUOTA_EXHAUSTED")
      : fail("Não foi possível obter um creative_plan válido do GPT.", "CREATIVE_PLAN_INVALID");
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

    if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });

    const { uri, response: imageResponse } = await requestGeneratedImage(deps.creativeBrain, {
      prompt: imagePrompt,
      format: context.format,
      referenceImageUrl: productAsset?.url,
      creativeGuard,
      executionId: input.executionRunId,
      correlationId: input.creativeEngineRunId,
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

    // ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — achado do smoke de produção: pedir ao
    // modelo "não desenhe texto aqui" não é suficiente, ele pode desenhar mesmo assim. Analisa a
    // imagem BASE (antes de qualquer composição determinística) pra ter dado REAL sobre texto
    // espúrio/fantasma e ocupação de regiões, nunca só a instrução estática do plano.
    const rendererOwnedZonesForAnalysis = plan.textZones.filter((zone) => zone.renderedBy === "renderer");
    const screenshotPlacementForAnalysis = screenshotAsset ? plan.assetPlacements.find((candidate) => candidate.role === "screenshot") : undefined;
    let preCompositionAnalysis: PreCompositionAnalysis | undefined;
    if (rendererOwnedZonesForAnalysis.length > 0 || screenshotPlacementForAnalysis) {
      if (budgetExceeded()) return failBudgetExceeded({ creativePlan: plan, finalImagePrompt: imagePrompt, repairRounds });
      preCompositionAnalysis = await analyzePreCompositionImage(deps.creativeBrain, {
        imageUrl: uri,
        rendererOwnedZones: rendererOwnedZonesForAnalysis,
        allowedRenderedTexts: plan.allowedRenderedTexts,
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

    const rendererZones = safeAreaAdjustment.zones;
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

      const qualityGate = await evaluateCreativeQualityGate(deps.creativeBrain, {
        finalImageUrl: uploaded.url,
        finalImageWidth,
        finalImageHeight,
        expectedAspectRatio: context.format,
        compositedAssetRoles,
        context,
        plan,
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
