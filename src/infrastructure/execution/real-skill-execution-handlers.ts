import type { ExecutionTaskHandlerPort, ExecutionTaskHandlerRequest, ExecutionTaskHandlerResult, ExecutionTaskInputs } from "../../application/execution/execution-handler.port.js";
import { createDefaultExecutionContractRegistry, type ExecutionContract } from "../../application/execution/execution-contract-registry.js";
import { mapExecutionCapabilityToSkillCapability } from "../../application/execution/capability-mapping.js";
import type { HelenaSkillManagerPort } from "../../application/skills/helena.contract.js";
import type { PreparedCommandRepositoryPort } from "../../application/ports/prepared-command-repository.port.js";
import type { RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type { ContentGenerationHistoryPort } from "../../application/ports/content-generation-history.port.js";
import type { QualityFeedbackPort } from "../../application/quality-feedback/quality-feedback.port.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillArtifact, SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";
import { compositeLogoOntoImage, type LogoCorner } from "../media/logo-compositor.js";
import { parseReferenceIntelligence, type ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";
import { parseCommercialFacts, type CommercialFact } from "../../shared/utils/commercial-fact-normalizer.js";
import { RENDERER_OWNED_ZONE_TYPES, type AdLayoutSpec, type AdLayoutZoneType, type PerformanceCreativePlan } from "../../shared/utils/ad-layout.types.js";
import { renderAdCreativeOverlay } from "../rendering/ad-creative-renderer.js";
import { resolveProductRenderMode, type ProductRenderMode } from "../../shared/utils/product-asset.types.js";
import { analyzeProductBackground, extractProductAsset } from "../image-processing/product-background.js";

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
  constructor(
    private readonly deps: {
      helena: HelenaSkillManagerPort;
      provider?: string;
      clara?: ClaraKnowledgePort;
      objectStorage?: ObjectStoragePort;
      runtimeRepository?: RuntimeRepositoryPort;
      preparedCommandRepository?: PreparedCommandRepositoryPort;
    },
  ) {}

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
      // "copy" só existe no grafo novo `content_request-visual-only-v2` (Maria rodando antes da
      // imagem) — em `campaign_creation`, copy_generation e visual_generation rodam em paralelo e
      // este input fica vazio, preservando o comportamento anterior (Pedro cai no fallback de
      // `strategy.displayTitle`, hoje inexistente também, então sem texto autorizado — igual antes).
      const copy = unwrapExecutionPayload(firstPayload(request.inputs, "copy"));
      // URL da imagem de referência (`PreparedCommand.validatedInputs.referenceImageUrl`, ver
      // `generate-visual-from-idea.ts`) — mesma cadeia `RuntimeTask.runtimePlanId →
      // RuntimePlan.sourceContext.preparedCommandId → PreparedCommand.validatedInputs` já usada por
      // `ContentBriefExecutionTaskHandler`. Não passa pelo grafo (não é saída de nenhuma Skill),
      // então é lida direto do banco aqui — best-effort, nunca trava a geração.
      const referenceImageUrl = await lookupReferenceImageUrl(this.deps, request).catch(() => undefined);
      // Product Asset Pipeline (Rodada 2, Prioridade 1) — precisa rodar ANTES de Bianca (ela decide
      // se inclui uma zona `heroProduct` a partir do resultado). Best-effort: qualquer falha
      // inesperada aqui cai no mesmo fallback conservador de "sem referência" (GENERATED_REFERENCE
      // se não há URL, REFERENCE_EDIT se há) — nunca trava a geração.
      const productAsset = await resolveProductAssetPipeline(this.deps, request, referenceImageUrl).catch(() => resolveProductRenderMode({ hasReferenceImage: Boolean(referenceImageUrl) }));
      const sofia = await callSkill(this.deps.helena, "art_direction", buildSofiaInput(request, structure), request);
      const bianca = await callSkill(this.deps.helena, "social_media_design", buildBiancaInput(request, structure, sofia.output, copy, productAsset), request);
      const pedro = await callSkill(this.deps.helena, "image_generation", buildPedroInput(request, structure, copy, suppressUnauthorizedCta(bianca.output), referenceImageUrl, productAsset), request);
      // Performance Creative Engine (Fase 7): compõe preço/desconto/headline/CTA/etc como pixels
      // reais sobre a imagem do Pedro, ANTES da logo — best-effort por imagem (uma falha aqui
      // nunca derruba a geração inteira), mas deliberadamente NUNCA volta a deixar o modelo
      // desenhar esses elementos como fallback (o Pedro já foi instruído a deixar essas áreas
      // limpas, ver `buildCleanZoneInstruction`) — uma falha aqui produz uma imagem visivelmente
      // incompleta (sem preço/CTA), nunca uma imagem com um valor comercial errado ou inventado.
      const overlayResult = await applyAdCreativeOverlay(this.deps, request, pedro.output, bianca.output).catch((error) => ({
        output: pedro.output,
        warnings: [`Não foi possível compor os elementos comerciais determinísticos: ${error instanceof Error ? error.message : "erro desconhecido"}.`],
      }));
      // Logo real colada por cima (requisito "não foi aplicada a logo") — Sofia/Bianca já sabem a
      // cor/estilo da marca (contexto pro modelo), mas a IA nunca desenha o arquivo da logo em si
      // com fidelidade; isto cola o arquivo de verdade, best-effort (nunca derruba a geração se a
      // logo não estiver cadastrada ou o download/composição falhar).
      const logoResult = await applyLogoToGeneratedImages(this.deps, request, overlayResult.output, bianca.output).catch((error) => ({
        output: overlayResult.output,
        warnings: [`Não foi possível aplicar a logo: ${error instanceof Error ? error.message : "erro desconhecido"}.`],
      }));
      const finalPedroOutput = logoResult.output;
      const invalid = validateOutputContract(contract, finalPedroOutput);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");
      const warnings = [...sofia.warnings, ...bianca.warnings, ...pedro.warnings, ...overlayResult.warnings, ...logoResult.warnings];
      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: contract.outputPort,
            payload: {
              ...buildExecutionPayload({ ...pedro, output: finalPedroOutput }, request.inputs, this.deps.provider ?? "helena"),
              visualPipeline: {
                artDirection: sofia.output,
                designSpec: bianca.output,
                imageGeneration: finalPedroOutput,
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

async function lookupReferenceImageUrl(
  deps: { runtimeRepository?: RuntimeRepositoryPort; preparedCommandRepository?: PreparedCommandRepositoryPort },
  request: ExecutionTaskHandlerRequest,
): Promise<string | undefined> {
  if (!deps.runtimeRepository || !deps.preparedCommandRepository) return undefined;
  const runtimePlan = await deps.runtimeRepository.getById(request.task.runtimePlanId);
  if (!runtimePlan) return undefined;
  const preparedCommand = await deps.preparedCommandRepository.getById(runtimePlan.sourceContext.preparedCommandId);
  return preparedCommand?.validatedInputs.referenceImageUrl?.trim() || undefined;
}

export type ProductAssetPipelineResult = { mode: ProductRenderMode; reasoning: string; heroProductAssetUrl?: string };

/**
 * Product Asset Pipeline (Rodada 2, Prioridade 1) — decide se o produto REAL da imagem de
 * referência pode virar o hero asset da peça (`ORIGINAL_ASSET`), se só dá pra usar como entrada de
 * edição (`REFERENCE_EDIT`, comportamento já existente via `/v1/images/edits`), ou se não há
 * referência disponível (`GENERATED_REFERENCE`, o modelo recria a partir da descrição). Roda ANTES
 * de Bianca — ela precisa saber a decisão pra decidir se inclui uma zona `heroProduct` no
 * `adLayoutSpec`. Best-effort em toda a cadeia: qualquer falha (download, análise, extração, upload)
 * nunca trava a geração — degrada um degrau (nunca pula direto pro pior caso só porque uma etapa
 * específica falhou).
 */
async function resolveProductAssetPipeline(
  deps: { objectStorage?: ObjectStoragePort },
  request: ExecutionTaskHandlerRequest,
  referenceImageUrl: string | undefined,
): Promise<ProductAssetPipelineResult> {
  if (!referenceImageUrl) {
    return resolveProductRenderMode({ hasReferenceImage: false });
  }
  let buffer: Buffer;
  try {
    buffer = await fetchAsBuffer(referenceImageUrl);
  } catch (error) {
    return {
      mode: "reference_edit",
      reasoning: `Não foi possível baixar a imagem de referência para análise de fundo: ${error instanceof Error ? error.message : "erro desconhecido"}. Usa como entrada de edição.`,
    };
  }

  const analysis = await analyzeProductBackground(buffer);
  const decision = resolveProductRenderMode({ hasReferenceImage: true, analysis });
  if (decision.mode !== "original_asset" || !deps.objectStorage || !analysis?.dominantBackgroundColor) {
    return decision;
  }

  const assetBuffer = await extractProductAsset(buffer, analysis.dominantBackgroundColor);
  if (!assetBuffer) {
    return {
      mode: "reference_edit",
      reasoning: "O fundo parecia uniforme, mas o recorte não produziu um resultado confiável — usa a referência como entrada de edição em vez de arriscar um recorte quebrado.",
    };
  }

  try {
    const key = `product-assets/${request.context.tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-asset.png`;
    const uploaded = await deps.objectStorage.put({ key, body: assetBuffer, contentType: "image/png" });
    return { ...decision, heroProductAssetUrl: uploaded.url };
  } catch (error) {
    return {
      mode: "reference_edit",
      reasoning: `Recorte do produto extraído, mas falhou ao hospedar: ${error instanceof Error ? error.message : "erro desconhecido"}. Usa a referência como entrada de edição.`,
    };
  }
}

/**
 * Performance Creative Engine (Fase 7): baixa cada imagem gerada pelo Pedro e compõe as zonas
 * "renderer-owned" de `adLayoutSpec` (preço, desconto, headline, CTA, avaliação, prova social,
 * benefícios, specs, badge) como pixels reais, via `renderAdCreativeOverlay`. Só roda quando
 * Bianca produziu `performanceCreativePlan`/`adLayoutSpec` (ausência = mesmo comportamento de
 * antes desta funcionalidade existir, texto continua saindo do modelo). Anexa
 * `typographyGeometry` a cada imagem — insumo determinístico do quality gate de tipografia do
 * Lucas (Fase 16), sem precisar de nenhuma chamada de IA.
 */
async function applyAdCreativeOverlay(
  deps: { objectStorage?: ObjectStoragePort },
  request: ExecutionTaskHandlerRequest,
  pedroOutput: Record<string, unknown>,
  biancaOutput: Record<string, unknown>,
): Promise<{ output: Record<string, unknown>; warnings: string[] }> {
  const plan = biancaOutput.performanceCreativePlan as PerformanceCreativePlan | undefined;
  const adLayoutSpec = biancaOutput.adLayoutSpec as AdLayoutSpec | undefined;
  if (!deps.objectStorage || !plan || !adLayoutSpec) return { output: pedroOutput, warnings: [] };
  const images = Array.isArray(pedroOutput.images) ? (pedroOutput.images as Record<string, unknown>[]) : [];
  if (images.length === 0) return { output: pedroOutput, warnings: [] };

  const palette = Array.isArray(biancaOutput.suggestedPalette) ? (biancaOutput.suggestedPalette as unknown[]).filter((color): color is string => typeof color === "string") : [];
  const brandColors = palette.length > 0 ? { accentColor: palette[0] } : undefined;

  const warnings: string[] = [];
  const updatedImages: Record<string, unknown>[] = [];
  for (const image of images) {
    const uri = typeof image.uri === "string" ? image.uri : undefined;
    if (!uri) {
      updatedImages.push(image);
      continue;
    }
    try {
      const imageBuffer = await fetchAsBuffer(uri);
      const result = await renderAdCreativeOverlay({ baseImageBuffer: imageBuffer, adLayoutSpec, plan, brandColors });
      const key = `ai-generated/${request.context.tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-overlay.png`;
      const uploaded = await deps.objectStorage.put({ key, body: result.buffer, contentType: "image/png" });
      updatedImages.push({ ...image, uri: uploaded.url, typographyGeometry: result.typographyGeometry });
    } catch (error) {
      warnings.push(`Não foi possível compor os elementos comerciais determinísticos numa das imagens: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
      updatedImages.push(image);
    }
  }
  return { output: { ...pedroOutput, images: updatedImages }, warnings };
}

/**
 * Baixa a logo real da marca (`IdentityContext.logoUri`, Clara) e cada imagem gerada, cola a logo
 * por cima (`compositeLogoOntoImage`) e reenvia pro Object Storage, substituindo `image.uri` pela
 * versão com logo. Best-effort em cada camada — sem `clara`/`objectStorage` configurados, sem logo
 * cadastrada, ou qualquer falha de rede/composição numa imagem específica, a imagem ORIGINAL segue
 * adiante sem logo em vez de travar a geração inteira.
 */
async function applyLogoToGeneratedImages(
  deps: { clara?: ClaraKnowledgePort; objectStorage?: ObjectStoragePort },
  request: ExecutionTaskHandlerRequest,
  pedroOutput: Record<string, unknown>,
  biancaOutput: Record<string, unknown>,
): Promise<{ output: Record<string, unknown>; warnings: string[] }> {
  if (!deps.clara || !deps.objectStorage) return { output: pedroOutput, warnings: [] };
  const images = Array.isArray(pedroOutput.images) ? (pedroOutput.images as Record<string, unknown>[]) : [];
  if (images.length === 0) return { output: pedroOutput, warnings: [] };

  const context = await deps.clara.requestContext({
    requester: { id: "visual-pipeline-logo-compositor", type: "system", name: "Logo Compositor" },
    clientId: request.context.tenantId,
    modules: ["IdentityContext"],
    reason: "Compor a logo real da marca sobre a peça gerada.",
  });
  const identity = latestByUpdatedAt(context.modules.IdentityContext);
  const logoUri = typeof identity?.payload.logoUri === "string" ? identity.payload.logoUri : undefined;
  if (!logoUri) return { output: pedroOutput, warnings: [] };

  const logoBuffer = await fetchAsBuffer(logoUri);
  const corner = resolveLogoCorner(typeof biancaOutput.logoPlacement === "string" ? biancaOutput.logoPlacement : undefined);
  const warnings: string[] = [];
  const updatedImages: Record<string, unknown>[] = [];
  for (const image of images) {
    const uri = typeof image.uri === "string" ? image.uri : undefined;
    if (!uri) {
      updatedImages.push(image);
      continue;
    }
    try {
      const imageBuffer = await fetchAsBuffer(uri);
      const composited = await compositeLogoOntoImage({ imageBuffer, logoBuffer, corner });
      const key = `ai-generated/${request.context.tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-logo.jpg`;
      const result = await deps.objectStorage.put({ key, body: composited, contentType: "image/jpeg" });
      updatedImages.push({ ...image, uri: result.url });
    } catch (error) {
      warnings.push(`Não foi possível aplicar a logo em uma das imagens: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
      updatedImages.push(image);
    }
  }
  return { output: { ...pedroOutput, images: updatedImages }, warnings };
}

/**
 * Bianca já planeja `logoPlacement` como texto livre ("canto superior esquerdo", "inferior
 * direito"...) — extrai canto/borda por palavra-chave em vez de tentar parsear a frase inteira.
 * Padrão "top-left" quando não há sinal claro: convenção mais comum de marca em anúncio de
 * e-commerce (bottom-right é mais convenção de "marca d'água de foto") e o que o próprio usuário
 * pediu explicitamente para o Preço Baixo Club.
 */
function resolveLogoCorner(logoPlacementHint: string | undefined): LogoCorner {
  const normalized = (logoPlacementHint ?? "").toLowerCase();
  const isBottom = /inferior|abaixo|embaixo|bottom|baixo/.test(normalized);
  const isRight = /direit|right/.test(normalized);
  return `${isBottom ? "bottom" : "top"}-${isRight ? "right" : "left"}`;
}

function latestByUpdatedAt<TRecord extends { updatedAt: string }>(records?: TRecord[]): TRecord | undefined {
  if (!records || records.length === 0) return undefined;
  return [...records].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0];
}

async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** `reviewStatus` que o gate considera aprovado — mesmos thresholds que Lucas já usa internamente
 * (`warningScoreThreshold`), sem reinventar um novo número. */
const QUALITY_GATE_APPROVED_STATUSES = new Set(["approved", "approved_with_warnings"]);

/**
 * Quality gate real (requisito "não apresentar ao usuário se não atingir o padrão mínimo") —
 * reaproveita Lucas integralmente (`quality_review`, capability `human_review` já mapeada para a
 * skill capability "quality_review" em `capability-mapping.ts`, nunca antes exercitada porque
 * `approval` é hardcoded no motor de execução e nunca passa por aqui). Roda uma única vez por
 * execução; se reprovar, a TASK falha (`QUALITY_GATE_NOT_PASSED`) e a execução inteira vai para
 * `state:"failed"` — a "regeneração automática" (no máximo 1 tentativa extra) acontece um nível
 * acima, no caller HTTP (`production.route.ts`), disparando uma execução nova do zero: Lucas roda
 * DEPOIS de `visual_generation` já ter produzido seu único artefato por task (`execution_artifacts_
 * task_output_uq`), então não há como esta task "consertar e reemitir" a copy/imagem de uma task
 * anterior sem violar essa invariante — regenerar a execução inteira é o jeito correto de tentar de
 * novo com conteúdo realmente diferente.
 */
export class QualityGateExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(
    private readonly deps: {
      helena: HelenaSkillManagerPort;
      provider?: string;
      contentGenerationHistory?: ContentGenerationHistoryPort;
      runtimeRepository?: RuntimeRepositoryPort;
      preparedCommandRepository?: PreparedCommandRepositoryPort;
    },
  ) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "human_review" && taskType === "quality_review";
  }

  async validateAvailability(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    return validateSkillsAvailable(this.deps.helena, ["quality_review"]);
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    try {
      const structure = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
      const copy = unwrapExecutionPayload(firstPayload(request.inputs, "copy"));
      // Raw (não `unwrapExecutionPayload`) de propósito: `visualPipeline.artDirection`/`.designSpec`
      // (saída de Sofia/Bianca) só existe no payload bruto de `visual_generation`, não em `.output`
      // (que é só a saída do Pedro).
      const visualRaw = firstPayload(request.inputs, "visual");
      // Mesma busca best-effort de `VisualPipelineExecutionTaskHandler` — precisa de novo aqui
      // porque a checagem de fidelidade visual de Lucas (`checkProductFidelity`) precisa da URL da
      // imagem de referência REAL, não só da descrição em texto dela.
      const referenceImageUrl = await lookupReferenceImageUrl(this.deps, request).catch(() => undefined);
      const lucas = await callSkill(this.deps.helena, "quality_review", buildLucasInput(request, structure, copy, visualRaw, referenceImageUrl), request);

      if (!passesQualityGate(lucas.output)) {
        return failure("QUALITY_GATE_NOT_PASSED", summarizeTopIssues(lucas.output), "invalid_output");
      }

      const invalid = validateOutputContract(contract, lucas.output);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");

      // Memória editorial: só grava peças que passaram no quality gate (nunca ensina o sistema a
      // repetir algo reprovado). Best-effort — falha aqui nunca deveria derrubar uma geração que já
      // passou no gate.
      if (this.deps.contentGenerationHistory) {
        const visualPipeline = normalizeObject(visualRaw.visualPipeline);
        const sofiaOutput = normalizeObject(visualPipeline.artDirection);
        await this.deps.contentGenerationHistory
          .recordGeneration({
            tenantId: request.context.tenantId,
            workspaceId: request.context.workspaceId,
            executionRunId: request.context.executionRunId,
            marketingObjective: valueOrUndefined(structure.marketingObjective),
            headline: valueOrUndefined(copy.imageHeadline),
            title: valueOrUndefined(copy.title),
            caption: valueOrUndefined(copy.caption),
            cta: valueOrUndefined(copy.cta),
            visualConcept: valueOrUndefined(sofiaOutput.visualConcept),
            qualityScore: numberValue(lucas.output.overallScore, undefined),
            reviewStatus: valueOrUndefined(lucas.output.reviewStatus),
          })
          .catch(() => undefined);
      }

      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: contract.outputPort,
            payload: buildExecutionPayload(lucas, request.inputs, this.deps.provider ?? "helena"),
          }],
          warnings: lucas.warnings,
        },
      };
    } catch (error) {
      return { ok: false, error: classifySkillError(error) };
    }
  }
}

function passesQualityGate(output: Record<string, unknown>): boolean {
  return typeof output.reviewStatus === "string" && QUALITY_GATE_APPROVED_STATUSES.has(output.reviewStatus);
}

function summarizeTopIssues(output: Record<string, unknown>): string {
  const status = stringValue(output.reviewStatus, "rejected");
  const score = numberValue(output.overallScore, undefined);
  const issues = Array.isArray(output.issues) ? (output.issues as Array<{ message?: unknown }>) : [];
  const topMessages = issues
    .slice(0, 3)
    .map((issueItem) => (typeof issueItem.message === "string" ? issueItem.message : undefined))
    .filter((message): message is string => Boolean(message));
  const scoreLabel = score === undefined ? "" : ` (nota ${score}/100)`;
  return `Peça não passou no quality gate — status "${status}"${scoreLabel}.${topMessages.length ? ` Principais motivos: ${topMessages.join(" | ")}` : ""}`;
}

/**
 * Monta o input de Lucas a partir das saídas reais de João/Maria/Sofia/Bianca/Pedro já produzidas
 * nesta execução — espelha por convenção (mesmo padrão do resto do arquivo) o formato real de
 * `LucasQualityReviewRequestInput`, sem importar nada do skill do Lucas.
 */
function buildLucasInput(
  request: ExecutionTaskHandlerRequest,
  structure: Record<string, unknown>,
  copy: Record<string, unknown>,
  visualRaw: Record<string, unknown>,
  referenceImageUrl?: string,
): Record<string, unknown> {
  const visualOutput = normalizeObject(visualRaw.output);
  const visualPipeline = normalizeObject(visualRaw.visualPipeline);
  const sofiaOutput = normalizeObject(visualPipeline.artDirection);
  const biancaOutput = normalizeObject(visualPipeline.designSpec);
  const copyQuality = normalizeObject(copy.quality);
  const creativeBrief = normalizeObject(structure.creativeBrief);
  const base = baseInput(request);
  // Geometria exata que o renderer determinístico usou (Performance Creative Engine, Fase 16) —
  // só a primeira imagem por ora (peça única é o caso comum; carrossel fica pra uma rodada
  // futura). Ausente quando o overlay não rodou nesta geração (mesmo comportamento de antes).
  const firstImage = Array.isArray(visualOutput.images) ? (visualOutput.images as Record<string, unknown>[])[0] : undefined;
  const typographyGeometry = Array.isArray(firstImage?.typographyGeometry) ? firstImage.typographyGeometry : undefined;
  // Achado ao vivo (Rodada 2): quando `productRenderMode === "original_asset"`, o produto na
  // imagem final é literalmente o mesmo recorte de pixels da referência (composto pelo renderer,
  // nunca redesenhado por IA) — fidelidade já é garantida por construção. Pedir uma checagem de
  // visão pra "confirmar" isso só adiciona ruído/custo: o modelo pode confundir um elemento de
  // cenário que o próprio Pedro desenhou como apoio pro produto (ex.: um pedestal) com uma
  // tentativa (inexistente) de redesenhar o produto, reprovando uma peça correta.
  const productRenderMode = normalizeObject(biancaOutput.performanceCreativePlan).productRenderMode;
  const skipProductFidelityCheck = productRenderMode === "original_asset";

  return {
    ...base,
    workflowContext: { ...normalizeObject(base.workflowContext), ...(referenceImageUrl && !skipProductFidelityCheck ? { referenceImageUrl } : {}) },
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    typographyGeometry,
    joaoStrategy: {
      objective: stringValue(structure.objective, ""),
      targetAudience: stringValue(structure.targetAudience, ""),
      channel: stringValue(structure.channel, "instagram"),
      toneOfVoice: stringValue(structure.toneOfVoice, ""),
      angle: stringValue(structure.angle, ""),
      centralPromise: stringValue(structure.centralPromise, ""),
      valueProposition: stringValue(structure.valueProposition, ""),
      keyMessages: stringArray(structure.keyMessages),
      recommendedCta: stringValue(structure.recommendedCta, ""),
      risks: stringArray(structure.risks),
    },
    // Requisito de "quality gate obrigatório" (fidelidade + checagem comercial) — Lucas nunca
    // recebia o creative brief do João antes disto, então não tinha como saber se a oferta é
    // evidência real (imagem de referência) ou catálogo genérico, nem o que não pode ser inventado.
    creativeBrief: Object.keys(creativeBrief).length > 0 ? {
      productOrService: stringValue(creativeBrief.productOrService, ""),
      offer: valueOrUndefined(creativeBrief.offer),
      commercialFactsSource: stringValue(creativeBrief.commercialFactsSource, "none"),
      nonInventableInfo: stringArray(creativeBrief.nonInventableInfo),
    } : undefined,
    referenceIntelligence: structure.referenceIntelligence && typeof structure.referenceIntelligence === "object" ? structure.referenceIntelligence : undefined,
    mariaCopy: {
      title: stringValue(copy.title, ""),
      caption: stringValue(copy.caption, ""),
      cta: stringValue(copy.cta, ""),
      hashtags: stringArray(copy.hashtags),
      keywords: stringArray(copy.keywords),
      summary: stringValue(copy.summary, ""),
      objective: stringValue(copy.objective, ""),
      toneUsed: stringValue(copy.toneUsed, ""),
      identifiedAudience: stringValue(copy.identifiedAudience, ""),
      qualityScore: numberValue(copyQuality.score, undefined),
      qualityPassed: typeof copyQuality.passed === "boolean" ? copyQuality.passed : undefined,
      claims: Array.isArray(copy.claims) ? copy.claims : undefined,
    },
    sofiaDirection: Object.keys(sofiaOutput).length > 0 ? {
      visualConcept: stringValue(sofiaOutput.visualConcept, ""),
      recommendedStyle: stringValue(sofiaOutput.recommendedStyle, ""),
      suggestedPalette: stringArray(sofiaOutput.suggestedPalette),
      recommendedFormat: stringValue(sofiaOutput.recommendedFormat, ""),
      recommendedAspectRatio: stringValue(sofiaOutput.recommendedAspectRatio, ""),
      visualConstraints: stringArray(sofiaOutput.visualConstraints),
      visualRisks: stringArray(sofiaOutput.visualRisks),
    } : undefined,
    biancaDesign: Object.keys(biancaOutput).length > 0 ? {
      designConcept: stringValue(biancaOutput.designConcept, ""),
      gridSystem: stringValue(biancaOutput.gridSystem, ""),
      slides: Array.isArray(biancaOutput.slides) ? biancaOutput.slides : [],
      designRisks: stringArray(biancaOutput.designRisks),
    } : undefined,
    pedroImages: Object.keys(visualOutput).length > 0 ? {
      imageCount: numberValue(visualOutput.imageCount, 0) ?? 0,
      images: Array.isArray(visualOutput.images) ? visualOutput.images : [],
    } : undefined,
    channel: stringValue(structure.channel, "instagram"),
    format: stringValue(structure.format, "carrossel"),
  };
}

const NO_CTA_INSTRUCTION = "Nenhum — não incluir nenhum botão, texto ou elemento de CTA nesta peça. Comunicar apenas por composição visual, sem nenhum texto legível.";

/**
 * Bianca sempre projeta um CTA visível (`ctaPlacement`, `typographyScale.cta` — campos
 * obrigatórios em `evaluateProductionReadiness`, Pedro nunca aceita omiti-los) porque seu design
 * pressupõe que sempre existe uma copy real definindo o texto do botão. Maria já roda de verdade
 * no grafo `content_request-visual-only-v2` e produz um CTA real (`copy.cta`) — mas ele fica só na
 * legenda/publicação, nunca dentro da imagem: decisão de produto (não técnica), pra não repetir o
 * bug já corrigido de CTA/botão inventado aparecendo renderizado na peça. Sobrescreve só os campos
 * de CTA do design de Bianca com uma instrução explícita de "não incluir", preservando o resto
 * (grid, cor, logo, tipografia) intacto — ver também `buildPedroInput`, que nunca repassa
 * `workflowContext.mariaCopy`/`.cta` pelo mesmo motivo.
 */
function suppressUnauthorizedCta(design: Record<string, unknown>): Record<string, unknown> {
  const typographyScale = normalizeObject(design.typographyScale);
  return {
    ...design,
    ctaPlacement: NO_CTA_INSTRUCTION,
    ...(Object.keys(typographyScale).length > 0 ? { typographyScale: { ...typographyScale, cta: "Sem CTA nesta peça" } } : {}),
  };
}

/**
 * Empacota `PreparedCommand.validatedInputs` (o que o usuário realmente digitou — objective,
 * offerOrSubject, targetAudience, channel, contentFormat) num "structure" no mesmo formato que
 * `campaign_structure` produz, sem chamar nenhuma Skill nem IA. Existe só para o pipeline reduzido
 * `content_request-visual-only-v1` (ver `arthur-planner.ts`) — permite `VisualPipelineExecutionTaskHandler`
 * funcionar sem depender de `campaign_structure`/`REAL_PLANNING_ENABLED`, e é também a correção do
 * problema mais profundo descoberto nesta sprint: os outros handlers "reais" deste arquivo nunca
 * liam o conteúdo de verdade do usuário (`buildResearchInput`/`buildStrategyInput` usam texto fixo)
 * — este handler lê `PreparedCommand.validatedInputs` de verdade via `runtimeRepository`/
 * `preparedCommandRepository` (a cadeia `RuntimeTask.runtimePlanId` → `RuntimePlan.sourceContext.
 * preparedCommandId` → `PreparedCommand.validatedInputs`, já modelada desde a Sprint 10).
 */
export class ContentBriefExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(
    private readonly deps: {
      runtimeRepository: RuntimeRepositoryPort;
      preparedCommandRepository: PreparedCommandRepositoryPort;
      contentGenerationHistory?: ContentGenerationHistoryPort;
      qualityFeedback?: QualityFeedbackPort;
    },
  ) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "content_brief" && taskType === "content_brief";
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    const runtimePlan = await this.deps.runtimeRepository.getById(request.task.runtimePlanId);
    if (!runtimePlan) {
      return { ok: false, error: { code: "CONTENT_BRIEF_RUNTIME_PLAN_NOT_FOUND", message: `RuntimePlan "${request.task.runtimePlanId}" não encontrado.`, category: "internal", retryable: false } };
    }
    const preparedCommand = await this.deps.preparedCommandRepository.getById(runtimePlan.sourceContext.preparedCommandId);
    if (!preparedCommand) {
      return { ok: false, error: { code: "CONTENT_BRIEF_PREPARED_COMMAND_NOT_FOUND", message: `PreparedCommand "${runtimePlan.sourceContext.preparedCommandId}" não encontrado.`, category: "internal", retryable: false } };
    }

    const structure = buildContentBriefStructure(preparedCommand.validatedInputs);
    // Memória editorial (requisito "antes de gerar uma peça nova, consultar as últimas peças
    // geradas/aprovadas") — best-effort: qualquer falha aqui (repositório indisponível, etc.)
    // nunca deveria travar a geração, só deixar de avisar sobre repetição.
    const editorialMemory = await buildEditorialMemoryText(this.deps, request.context.workspaceId).catch(() => undefined);
    if (editorialMemory) structure.editorialMemory = editorialMemory;
    const invalid = validateOutputContract(contract, structure);
    if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");

    return {
      ok: true,
      value: {
        outputs: [{
          outputPort: contract.outputPort,
          payload: {
            skillId: "content-brief-deterministic",
            taskId: request.task.id,
            output: structure,
            artifacts: [],
            warnings: [],
            upstreamInputs: request.inputs,
            provider: "helena",
            real: true,
          },
        }],
      },
    };
  }
}

/**
 * Empacota o que o usuário digitou de verdade num "context" flat, consumido só por
 * `campaign_structure` (João) — desde a introdução do grafo `content_request-visual-only-v2`,
 * `content_brief` não alimenta mais Sofia/Bianca/Pedro diretamente (isso agora passa por
 * `campaign_structure` → `copy_generation` de verdade). Sem CTA/displayTitle/sofiaBriefing
 * pré-computados aqui: quem decide ângulo, CTA e texto da imagem agora é João/Maria reais, não
 * mais este empacotador determinístico.
 */
const EDITORIAL_MEMORY_HISTORY_LIMIT = 5;
const EDITORIAL_MEMORY_REJECTION_LIMIT = 5;

/**
 * Texto compacto pronto para prompt (mesmo padrão de `referenceContext`) com headlines/CTAs/
 * conceitos das últimas peças aprovadas deste workspace e os motivos de rejeição recentes —
 * propagado como `avoidRepeating` para João/Maria/Sofia (`buildStrategyInput`/`buildCopyInput`/
 * `buildSofiaInput`). `undefined` quando não há nada a evitar ainda (workspace novo) ou quando os
 * dois ports não foram configurados — nesse caso o comportamento é idêntico ao de antes desta
 * memória existir.
 */
async function buildEditorialMemoryText(
  deps: { contentGenerationHistory?: ContentGenerationHistoryPort; qualityFeedback?: QualityFeedbackPort },
  workspaceId: string,
): Promise<string | undefined> {
  const parts: string[] = [];

  if (deps.contentGenerationHistory) {
    const recent = await deps.contentGenerationHistory.getRecentForWorkspace(workspaceId, EDITORIAL_MEMORY_HISTORY_LIMIT);
    const headlines = recent.map((entry) => entry.headline).filter((value): value is string => Boolean(value?.trim()));
    const ctas = [...new Set(recent.map((entry) => entry.cta).filter((value): value is string => Boolean(value?.trim())))];
    const concepts = recent.map((entry) => entry.visualConcept).filter((value): value is string => Boolean(value?.trim()));
    if (headlines.length) parts.push(`Headlines recentes já usadas (não repetir): ${headlines.join(" | ")}.`);
    if (ctas.length) parts.push(`CTAs recentes já usados (variar): ${ctas.join(" | ")}.`);
    if (concepts.length) parts.push(`Conceitos visuais recentes já usados (não repetir enquadramento/composição): ${concepts.join(" | ")}.`);
  }

  if (deps.qualityFeedback) {
    const signals = await deps.qualityFeedback.getRecentRejectionSignalsForWorkspace(workspaceId, EDITORIAL_MEMORY_REJECTION_LIMIT);
    if (signals.recurringReasons.length) parts.push(`O usuário já rejeitou peças recentes por: ${signals.recurringReasons.join(", ")}.`);
    if (signals.comments.length) parts.push(`Comentários de rejeição recentes: ${signals.comments.slice(0, 3).join(" | ")}.`);
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildContentBriefStructure(validatedInputs: Record<string, string>): Record<string, unknown> {
  const objective = stringValue(validatedInputs.objective, "Criar peça visual atrativa.");
  const offerOrSubject = stringValue(validatedInputs.offerOrSubject, objective);
  // Descrição derivada por visão computacional das imagens de referência anexadas na ideia (ver
  // `generate-visual-from-idea.ts`, `describeReferenceImages`) — sem isto, a IA nunca sabia o que
  // as imagens de referência mostravam (ex.: "tênis unissex"), só o texto da ideia. Dobrado em
  // `offerOrSubject` porque é exatamente o campo que `buildStrategyInput` usa como parte do
  // `originalRequest` real entregue a João.
  const referenceContext = validatedInputs.referenceContext?.trim();
  const subject = referenceContext ? `${offerOrSubject} (referência visual: ${referenceContext})` : offerOrSubject;
  const targetAudience = stringValue(validatedInputs.targetAudience, "público principal do workspace");
  const channel = stringValue(validatedInputs.channel, "instagram");
  const format = stringValue(validatedInputs.contentFormat, "image");
  return {
    objective,
    offerOrSubject: subject,
    targetAudience,
    channel,
    format,
    recommendedSlideCount: format === "carousel" ? 4 : undefined,
    // Fatos estruturados extraídos das imagens de referência (produto, preço, desconto, oferta) —
    // repassado como JSON bruto (mesmo padrão de `referenceContext`); João é quem faz o parse
    // (`parseReferenceIntelligence`) e decide como usar. Sem isto, preço/desconto visíveis numa
    // foto de referência nunca chegavam a nenhum lugar do pipeline (achado ao vivo).
    referenceIntelligence: validatedInputs.referenceIntelligence,
    // Fatos comerciais extraídos do texto livre da ideia (Commercial Fact Normalizer, Rodada 2) —
    // mesmo padrão de JSON bruto acima; João reidrata via `parseCommercialFacts`.
    textCommercialFacts: validatedInputs.textCommercialFacts,
  };
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

/**
 * `context` para `campaign_creation` vem sempre de `research` (Eduardo — forma "editorial brief":
 * `campaignObjective`/`recommendedFormatLabel`/`recommendedChannel`). Para `content_request`,
 * `context` vem de `content_brief` (forma flat: `objective`/`channel`/`format`, sem etapa de
 * pesquisa) — o `??` cai para essa forma sem alterar em nada o caminho de `campaign_creation`,
 * onde `recommendedFormatLabel`/`campaignObjective` sempre existem.
 */
function buildStrategyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const upstream = unwrapExecutionPayload(firstPayload(request.inputs, "context"));
  const isEditorialBrief = typeof upstream.recommendedFormatLabel === "string" && typeof upstream.campaignObjective === "string";
  const flatSubject = stringValue(upstream.offerOrSubject, "");
  const flatObjective = stringValue(upstream.objective, "");
  const originalRequest = isEditorialBrief
    ? "Execution real controlada a partir de RuntimePlan validado."
    : [flatSubject, flatObjective].filter(Boolean).join(" — ") || "Execution real controlada a partir de RuntimePlan validado.";
  return {
    ...baseInput(request),
    originalRequest,
    desiredChannel: stringValue(upstream.recommendedChannel ?? upstream.channel, "instagram"),
    desiredFormat: stringValue(upstream.recommendedFormatLabel ?? upstream.format, "carrossel"),
    desiredObjective: stringValue(upstream.campaignObjective ?? upstream.objective, "Criar campanha de marketing."),
    editorialBrief: isEditorialBrief ? upstream : undefined,
    avoidRepeating: typeof upstream.editorialMemory === "string" ? upstream.editorialMemory : undefined,
    // Fatos estruturados da(s) imagem(ns) de referência (preço, desconto, oferta, o que preservar)
    // — só existe no caminho `content_request` (content_brief nunca alimenta `campaign_creation`
    // com isto), `undefined` preserva o comportamento de sempre nesse caminho.
    referenceIntelligence: parseReferenceIntelligence(typeof upstream.referenceIntelligence === "string" ? upstream.referenceIntelligence : undefined),
    // Fatos comerciais extraídos do texto livre da ideia (Commercial Fact Normalizer, Rodada 2) —
    // mesmo caminho condicional de `referenceIntelligence` acima; lista vazia quando ausente.
    textCommercialFacts: parseCommercialFacts(typeof upstream.textCommercialFacts === "string" ? upstream.textCommercialFacts : undefined),
  };
}

function buildCopyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const strategy = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
  const briefing = normalizeObject(strategy.mariaBriefing);
  // `creativeBrief.productOrService` (função pura, nunca passa pelo aprimoramento de IA de João —
  // ver o mesmo raciocínio em `buildSofiaInput`) é o sinal mais confiável do produto/assunto real.
  // Anexado ao `additionalContext` como reforço: `keyMessage` (abaixo) já deveria carregar isso via
  // `buildKeyMessages`, mas depende de `keyMessages[0]` sobreviver ao aprimoramento de IA — esta é
  // uma segunda via, determinística, pro caso de a primeira falhar.
  const creativeBrief = normalizeObject(strategy.creativeBrief);
  const productOrService = valueOrUndefined(creativeBrief.productOrService);
  const baseAdditionalContext = stringValue(briefing.additionalContext, JSON.stringify({ executionRunId: request.context.executionRunId }));
  // Repassado de `strategy.referenceIntelligence` (João já carrega isto no próprio output, ver
  // `JoaoMarketingStrategyCore.referenceIntelligence`) — objeto já validado/parseado, nunca uma
  // string bruta aqui. `undefined` quando João não tinha Reference Intelligence disponível
  // (comportamento idêntico a antes desta funcionalidade existir).
  const referenceIntelligence = strategy.referenceIntelligence && typeof strategy.referenceIntelligence === "object"
    ? (strategy.referenceIntelligence as ReferenceIntelligence)
    : undefined;
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
    // João já monta `mariaBriefing.marketingObjective`/`.additionalContext` (com a orientação
    // estrutural por objetivo) — antes disto, `additionalContext` era sobrescrito por um JSON sem
    // valor nenhum pra Maria, descartando o texto real que João preparou.
    marketingObjective: valueOrUndefined(briefing.marketingObjective ?? strategy.marketingObjective),
    avoidRepeating: typeof strategy.editorialMemory === "string" ? strategy.editorialMemory : undefined,
    additionalContext: productOrService ? `${baseAdditionalContext} Produto/assunto real: ${productOrService}.` : baseAdditionalContext,
    referenceIntelligence,
  };
}

function buildSofiaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>): Record<string, unknown> {
  // `enrichVisualConcept` (sofia-art-direction.skill.ts) deriva a CENA a partir só deste campo —
  // se ele for só o objetivo abstrato ("vender X com desconto"), a cena nunca reflete o produto/
  // referência de verdade (achado ao vivo: imagem gerada "nada a ver" com a referência anexada).
  // `objective` continua primeiro, de propósito, pra manter a intenção declarada como âncora
  // principal. `creativeBrief.productOrService` (`buildCreativeBrief`, joao-marketing-strategy.
  // skill.ts) é o sinal mais confiável do assunto real: função pura, nunca passa pelo
  // aprimoramento de IA — que preserva o detalhe específico de forma inconsistente entre
  // `centralPromise`/`valueProposition`/`keyMessages" a cada chamada (achado ao vivo: uma geração
  // saiu com `centralPromise` específico mas `valueProposition` genérico). Combinar os quatro
  // garante que a cena não perca o produto/referência mesmo quando a IA variar em qual campo
  // preservou o detalhe.
  const objective = stringValue(strategy.objective, "");
  const creativeBrief = normalizeObject(strategy.creativeBrief);
  const productOrService = stringValue(creativeBrief.productOrService, "");
  const centralPromise = stringValue(strategy.centralPromise, "");
  const valueProposition = stringValue(strategy.valueProposition, "");
  const visualObjective = [objective, productOrService, centralPromise, valueProposition]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .join(" — ") || "Criar peça visual da campanha.";
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    joaoSofiaBriefing: normalizeObject(strategy.sofiaBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    visualObjective,
  };
}

function buildBiancaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>, sofia: Record<string, unknown>, copy: Record<string, unknown>, productAsset: ProductAssetPipelineResult): Record<string, unknown> {
  const hasCopy = Object.keys(copy).length > 0;
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    sofiaDirection: sofia,
    sofiaBriefing: normalizeObject(sofia.biancaBriefing),
    // Product Asset Pipeline (Rodada 2, Prioridade 1) — Bianca usa isto pra decidir se inclui uma
    // zona `heroProduct` no `adLayoutSpec` (ver `buildPerformanceCreativePlan`/`buildAdLayoutSpec`).
    productAsset,
    // Requisito do Performance Creative Engine (Fase 2): Bianca precisa da copy real da Maria pra
    // montar `performanceCreativePlan`/`adLayoutSpec` — antes disto ela nunca recebia `copy`.
    // Ausente em `campaign_creation` (copy/visual rodam em paralelo lá) — `hasCopy` reflete isso,
    // igual ao resto deste handler nunca fingir dado que não existe.
    mariaCopy: hasCopy ? {
      title: stringValue(copy.title, ""),
      cta: stringValue(copy.cta, ""),
      imageHeadline: valueOrUndefined(copy.imageHeadline),
      claims: Array.isArray(copy.claims) ? copy.claims : undefined,
    } : undefined,
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    recommendedSlideCount: numberValue(strategy.recommendedSlideCount, undefined),
  };
}

const ZONE_TYPE_LABEL: Record<AdLayoutZoneType, string> = {
  price: "o preço",
  discount: "o selo de desconto",
  headline: "a manchete/título",
  cta: "o botão de chamada para ação",
  rating: "a avaliação",
  salesProof: "a prova social/quantidade vendida",
  benefits: "a lista de benefícios",
  specs: "as especificações",
  badge: "o selo de urgência/promoção",
  logo: "a logo",
  heroProduct: "o produto",
};

function describeZonePosition(position: AdLayoutSpec["zones"][number]["position"]): string {
  const verticalThird = position.yPct < 33 ? "superior" : position.yPct < 66 ? "central" : "inferior";
  const horizontalThird = position.xPct < 33 ? "esquerda" : position.xPct < 66 ? "central" : "direita";
  return `região ${verticalThird}-${horizontalThird} (${Math.round(position.xPct)}-${Math.round(position.xPct + position.widthPct)}% da largura, ${Math.round(position.yPct)}-${Math.round(position.yPct + position.heightPct)}% da altura)`;
}

/** Fase 7: instrução em linguagem natural pro Pedro deixar as zonas "renderer-owned" visualmente
 * limpas — sem texto, sem elemento gráfico pesado, sem alto contraste — porque o renderer
 * determinístico (`ad-creative-renderer.ts`) vai compor preço/desconto/CTA/etc ali depois, como
 * pixels reais. `undefined` quando não há nenhuma zona renderer-owned com conteúdo (nada a
 * comunicar ao Pedro, comportamento idêntico a antes desta funcionalidade existir). */
function buildCleanZoneInstruction(adLayoutSpec: AdLayoutSpec): string | undefined {
  const ownedZones = adLayoutSpec.zones.filter((zone) => RENDERER_OWNED_ZONE_TYPES.includes(zone.type));
  if (ownedZones.length === 0) return undefined;
  const descriptions = ownedZones.map((zone) => `${ZONE_TYPE_LABEL[zone.type]} na ${describeZonePosition(zone.position)}`);
  return descriptions.join("; ");
}

function buildPedroInput(
  request: ExecutionTaskHandlerRequest,
  strategy: Record<string, unknown>,
  copy: Record<string, unknown>,
  bianca: Record<string, unknown>,
  referenceImageUrl?: string,
  productAsset?: ProductAssetPipelineResult,
): Record<string, unknown> {
  const imageCount = numberValue(strategy.recommendedSlideCount, 1) ?? 1;
  // Product Asset Pipeline (Rodada 2, Prioridade 2): quando o produto real vai ser colado por cima
  // depois (`heroProduct`, `ad-creative-renderer.ts`), Pedro NUNCA deveria desenhar o produto — nem
  // grounded na referência (o resultado seria dois produtos competindo: o real colado e o
  // "parecido" que o modelo desenhou). Suprime `referenceImageUrl`/`referenceProductFidelity`
  // inteiramente nesse modo (não faz sentido guiar o modelo por uma referência que ele não deveria
  // tentar recriar) e troca pela instrução de "só cenário/fundo".
  const isOriginalAssetMode = productAsset?.mode === "original_asset" && Boolean(productAsset.heroProductAssetUrl);
  const productBackgroundOnlyInstruction = isOriginalAssetMode
    ? "O produto real (recorte já pronto) será colado por cima desta imagem depois — NÃO desenhe o produto em nenhuma versão, cópia, silhueta ou interpretação dele nesta imagem, em nenhuma parte do quadro. Gere APENAS o cenário, fundo, atmosfera, iluminação, superfície e elementos de contexto ao redor de onde o produto vai ficar (mantenha essa área com composição/espaço adequados para receber o produto depois, mas sem desenhar nenhum objeto que pareça o produto nela)."
    : undefined;
  // `imageHeadline` (Maria, requisito de "separar as funções de cada texto") é o texto CURTO
  // pensado especificamente para dentro da imagem — nunca o título do post, nunca a legenda.
  // Fallback pra `title`/`displayTitle` só quando `imageHeadline` não veio (copy ausente —
  // `campaign_creation`, onde copy/visual rodam em paralelo — ou provider de IA não retornou o
  // campo novo).
  // Performance Creative Engine (Fase 7): quando existe `adLayoutSpec` com ao menos uma zona
  // "renderer-owned" com conteúdo real, o headline passa a ser desenhado pelo renderer
  // determinístico (`ad-creative-renderer.ts`), NUNCA mais pelo modelo — repassar `headline` pro
  // Pedro aqui faria os dois desenharem o mesmo texto (ou textos conflitantes). Suprimir aqui é o
  // mesmo raciocínio de `suppressUnauthorizedCta`, um degrau antes na cadeia.
  const adLayoutSpec = bianca.adLayoutSpec as AdLayoutSpec | undefined;
  const rendererOwnsHeadline = Boolean(adLayoutSpec?.zones.some((zone) => zone.type === "headline"));
  const headline = rendererOwnsHeadline ? "" : stringValue(copy.imageHeadline ?? copy.title ?? strategy.displayTitle, "");
  const cleanZoneInstruction = adLayoutSpec ? buildCleanZoneInstruction(adLayoutSpec) : undefined;
  const base = baseInput(request);
  return {
    ...base,
    // `extractVisibleTextContext` (pedro-image-generation.skill.ts) só trata um texto como
    // "autorizado" se estiver aqui — sem isto, `hasAuthorizedVisibleText` fica falso e a peça sai
    // sem nenhum texto (ou, pior, o modelo inventa um CTA sozinho). Só headline, de propósito — sem
    // `cta`, pra não reabrir o problema do botão inventado ("Saiba mais"). `workflowContext.headline`
    // (não `.title`) porque `extractVisibleTextContext` dá prioridade mais alta a `context.title`/
    // `.copyTitle` — usar uma chave diferente evita colidir com essa prioridade. Deliberadamente
    // NUNCA passa `workflowContext.mariaCopy` — essa função lê `mariaCopy?.cta` como último
    // fallback de "CTA autorizado" (`extractVisibleTextContext`), então repassar a copy inteira
    // reabriria o botão inventado que motivou suprimir o CTA da imagem. `referenceImageUrl` vira a
    // entrada visual real de `/v1/images/edits` (ver `openai-icaro-image-provider.ts`) — a foto de
    // verdade, não só uma descrição em texto dela. `referenceIntelligence` (repassado de
    // `strategy.referenceIntelligence`, que João já carrega no próprio output) vira a guarda de
    // fidelidade de produto — ver `pedro-image-generation.skill.ts`/`openai-icaro-image-provider.ts`.
    // `cleanZoneInstruction` diz ao Pedro onde NÃO colocar texto/elementos gráficos pesados —
    // essas áreas vão ser preenchidas depois pelo renderer determinístico. Ambos `referenceImageUrl`/
    // `referenceIntelligence` são SUPRIMIDOS quando `isOriginalAssetMode` (Product Asset Pipeline,
    // Rodada 2, Prioridade 2) — o produto real vai ser colado por cima depois, então não faz sentido
    // guiar o modelo por uma referência que ele não deveria tentar recriar; `productBackgroundOnlyInstruction`
    // assume o lugar, pedindo só cenário/fundo/atmosfera.
    workflowContext: {
      ...normalizeObject(base.workflowContext),
      ...(headline ? { headline } : {}),
      ...(!isOriginalAssetMode && referenceImageUrl ? { referenceImageUrl } : {}),
      ...(!isOriginalAssetMode && strategy.referenceIntelligence ? { referenceIntelligence: strategy.referenceIntelligence } : {}),
      ...(cleanZoneInstruction ? { cleanZoneInstruction } : {}),
      ...(productBackgroundOnlyInstruction ? { productBackgroundOnlyInstruction } : {}),
    },
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

function valueOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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
