import type { AICostReport, AITokenUsage } from "../../application/ports/ai-provider.port.js";
import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../../application/ai/icaro.types.js";
import type { ArtifactDeliveryPort, ArtifactWrittenFile, ArtifactZipEntry } from "../../application/ports/artifact-delivery.port.js";
import type { StoragePort } from "../../application/ports/storage.port.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillArtifact, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest } from "../../shared/utils/skill-parsing.js";
import { areAspectRatiosEquivalent, resolutionForAspectRatio, resolutionLabelForAspectRatio } from "../../shared/utils/aspect-ratio.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import {
  ANTI_GENERIC_VISUAL_CONSTRAINTS,
  enrichVisualConcept,
  inferVisualEmotionHint,
  VISUAL_REFERENCE_LIBRARY,
} from "../../shared/utils/visual-reference-library.js";
import { pedroImageGenerationManifest } from "./pedro.manifest.js";
import type { PedroLogAction, PedroLoggerPort } from "./pedro-log.contract.js";
import type {
  PedroAssistedGenerationOutput,
  PedroAssistedImageRequest,
  PedroGeneratedImage,
  PedroDeliveryArtifacts,
  PedroImageGenerationMode,
  PedroImageGenerationOutput,
  PedroImageGenerationRequestInput,
  PedroProductionReadinessReport,
  PedroRawGeneratedImage,
  PedroUpstreamSkillReportEntry,
  PedroVisualEnrichment,
} from "./pedro-image-generation.types.js";

export type PedroSkillOutput = PedroImageGenerationOutput | PedroAssistedGenerationOutput;

export type PedroIdGenerator = {
  create(prefix: string): string;
};

export type PedroImageGenerationSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro: IcaroBrainPort;
  storage?: StoragePort;
  artifactDelivery?: ArtifactDeliveryPort;
  logger?: PedroLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: PedroIdGenerator;
  now?: () => Date;
  /**
   * `ai_provider` (padrão): pede a imagem ao Ícaro. `developer_assisted`: nunca chama o Ícaro
   * para pixels — monta prompt técnico + caminho esperado e aguarda o arquivo aparecer em disco.
   * Ver `PedroImageGenerationMode` para detalhes.
   */
  imageGenerationMode?: PedroImageGenerationMode;
};

type MaterializedPedroImage = {
  image: PedroGeneratedImage;
  bytes?: Uint8Array;
};

class SequentialPedroIdGenerator implements PedroIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopPedroLogger implements PedroLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

function missingPort<TPort extends object>(portName: string): TPort {
  return new Proxy({} as TPort, {
    get(): never {
      throw new Error(`${portName} não configurado para Pedro.`);
    },
  });
}

export class PedroImageGenerationSkill implements Skill<PedroImageGenerationRequestInput, PedroSkillOutput> {
  readonly manifest = pedroImageGenerationManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro: IcaroBrainPort;
  private readonly storage?: StoragePort;
  private readonly artifactDelivery?: ArtifactDeliveryPort;
  private readonly logger: PedroLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: PedroIdGenerator;
  private readonly now: () => Date;
  private readonly imageGenerationMode: PedroImageGenerationMode;

  constructor(dependencies: PedroImageGenerationSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.storage = dependencies.storage;
    this.artifactDelivery = dependencies.artifactDelivery;
    this.logger = dependencies.logger ?? new NoopPedroLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialPedroIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
    this.imageGenerationMode = dependencies.imageGenerationMode ?? "ai_provider";
  }

  async execute(request: SkillRequest<PedroImageGenerationRequestInput>): Promise<SkillResponse<PedroSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de geração de imagem inválida.", request, { errors: validationErrors });
      await this.emit("ImageGenerationFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: validationErrors,
        error: {
          code: "INVALID_REQUEST",
          message: validationErrors.join("; "),
          recoverable: true,
        },
      };
    }

    try {
      return await this.runGeneration(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a geração de imagem.";
      await this.log("Error", `Erro inesperado em Pedro. ${message}`, request, { error: message });
      await this.emit("ImageGenerationFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "UNEXPECTED_ERROR", message, recoverable: true },
      };
    }
  }

  private async runGeneration(request: SkillRequest<PedroImageGenerationRequestInput>): Promise<SkillResponse<PedroSkillOutput>> {
    const startedAt = this.now().getTime();

    await this.log("RequestReceived", "Solicitação de geração de imagem recebida por Pedro.", request, {
      channel: request.input.channel,
      format: request.input.format,
      imageCount: request.input.imageCount,
    });
    await this.emit("ImageGenerationStarted", request, {
      channel: request.input.channel,
      imageCount: request.input.imageCount,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("ImageGenerationFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: {
          code: "CLIENT_NOT_FOUND",
          message,
          recoverable: true,
        },
      };
    }

    await this.log("ClientResolved", `Cliente ${tenant.clientId} resolvido pela Valentina.`, request, {
      clientId: tenant.clientId,
      tenantId: tenant.tenantId,
      plan: tenant.plan,
    });

    const claraContext = await this.clara.requestContext({
      requester: { id: this.manifest.id, type: "specialist", name: "Pedro" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "IdentityContext", "PublishingContext"],
      reason: "Montagem do prompt final de geração de imagem a partir do briefing de design da Bianca.",
    });

    await this.log("VisualContextConsulted", `Contexto visual consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateVisualContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto visual insuficiente na Clara para gerar a imagem com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("ImageGenerationFailed", request, {
        reason: "INSUFFICIENT_VISUAL_CONTEXT",
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_more_context",
        artifacts: [],
        warnings: [
          `Contexto visual insuficiente na Clara para o cliente ${tenant.clientId}.`,
          ...completeness.missing.map((item) => `Faltando na Clara: ${item}.`),
        ],
      };
    }

    const qualityReport = evaluateProductionReadiness(request.input, claraContext);
    if (qualityReport.status === "needs_more_context") {
      await this.log("ContextIncomplete", "Briefing de produção insuficiente para Pedro gerar peça em padrão profissional.", request, {
        clientId: tenant.clientId,
        blockingIssues: qualityReport.blockingIssues,
        upstreamRecommendations: qualityReport.upstreamRecommendations,
      });
      await this.emit("ImageGenerationFailed", request, {
        reason: "INSUFFICIENT_PRODUCTION_BRIEFING",
        clientId: tenant.clientId,
        blockingIssues: qualityReport.blockingIssues,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_more_context",
        artifacts: [],
        warnings: [
          "Briefing de produção insuficiente para Pedro gerar peça visual em padrão de agência.",
          ...qualityReport.blockingIssues,
          ...qualityReport.upstreamRecommendations.map((item) => `Melhoria upstream: ${item}`),
        ],
      };
    }

    await this.log("ProductionBriefingValidated", "Briefing visual validado por Pedro antes da geração.", request, {
      clientId: tenant.clientId,
      status: qualityReport.status,
      score: qualityReport.score,
      warnings: qualityReport.warnings,
    });

    const finalPrompt = buildFinalImagePrompt(request.input, claraContext, qualityReport);
    const visibleText = extractVisibleTextContext(request.input);
    const visualEnrichments = buildVisualEnrichments(request.input);
    await this.log("PromptBuilt", "Prompt final de imagem criado com critérios de qualidade profissional.", request, { clientId: tenant.clientId });
    await this.emit("ImagePromptBuilt", request, { clientId: tenant.clientId, prompt: finalPrompt, qualityReport });
    await this.log("VisualEnrichmentApplied", "Estágio de Visual Enrichment aplicado: conceitos simples transformados em cenas publicitárias.", request, {
      clientId: tenant.clientId,
      scenes: visualEnrichments.map((scene) => ({ concept: scene.concept, referenceStyle: scene.referenceStyle })),
    });

    await this.log("GenerationStarted", "Geração de imagem iniciada.", request, { clientId: tenant.clientId, mode: this.imageGenerationMode });

    if (this.imageGenerationMode === "developer_assisted") {
      return this.runAssistedGeneration({ request, tenant, claraContext, finalPrompt, visualEnrichments, qualityReport, startedAt });
    }

    let aiResponse;
    try {
      aiResponse = await this.icaro.request({
        taskType: "image_generation",
        prompt: finalPrompt,
        // Geração real de imagem (ex.: gpt-image-1) rotineiramente passa dos 30s padrão do Ícaro
        // (`icaro-brain.ts`, pensado para texto) — sem isto, toda chamada real estoura
        // SKILL_TIMEOUT antes da OpenAI sequer responder.
        timeoutMs: 90_000,
        specialistId: this.manifest.id,
        executionId: request.context.executionId,
        taskId: request.context.taskId,
        correlationId: request.context.correlationId,
        context: {
          skillId: this.manifest.id,
          clientId: tenant.clientId,
          channel: request.input.channel,
          imageCount: request.input.imageCount,
          // Repassa o único texto autorizado (se houver) como dado estruturado, não só embutido no
          // prompt gigante — o adapter da OpenAI (`OpenAiIcaroImageProvider`) usa isto pra montar
          // uma instrução curta e confiável, já que o texto autorizado pode acabar cortado dentro
          // de um prompt de 100k+ caracteres antes de chegar na seção "TEXTOS VISÍVEIS AUTORIZADOS".
          authorizedVisibleTitle: visibleText.title,
        },
        constraints: [
          "Retornar apenas JSON válido.",
          "Não criar estratégia de marketing, copy, direção de arte ou decisões de layout; apenas gerar imagem seguindo o briefing da Bianca.",
          `Gerar exatamente ${request.input.imageCount} imagem(ns).`,
          "Cada imagem deve conter o campo data em base64 para que Pedro salve um arquivo físico local antes de montar a página de entrega.",
          "Aplicar padrão de agência premium: hierarquia visual forte, grid consistente, bom uso de espaço em branco, contraste adequado, alinhamento profissional e retenção slide a slide.",
          "Não inventar textos, CTA, grid, paleta, tipografia ou storytelling que não estejam no briefing ou no workflowContext.",
        ],
        expectedOutput: "json",
        priority: "quality",
        maxTokens: 2000,
      });

      if (aiResponse.status !== "completed") {
        throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Pedro.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido na geração de imagem pelo Ícaro.";
      await this.log("Error", `Ícaro falhou ao gerar imagem. ${message}`, request, { clientId: tenant.clientId, error: message });
      await this.emit("ImageGenerationFailed", request, { reason: "AI_PROVIDER_FAILURE", clientId: tenant.clientId, error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: {
          code: "IMAGE_GENERATION_FAILED",
          message,
          recoverable: true,
        },
      };
    }

    await this.log("GenerationFinished", "Geração de imagem finalizada.", request, {
      clientId: tenant.clientId,
      provider: aiResponse.provider.id,
      model: aiResponse.model.id,
    });
    await this.emit("ImageGenerationFinished", request, {
      clientId: tenant.clientId,
      provider: aiResponse.provider,
      model: aiResponse.model,
    });

    const rawImages = parseGeneratedImages(String(aiResponse.content ?? ""));
    const warnings: string[] = [];
    if (rawImages.length !== request.input.imageCount) {
      warnings.push(`Foram solicitadas ${request.input.imageCount} imagem(ns), mas o Ícaro devolveu ${rawImages.length}.`);
    }

    const materializedImages: MaterializedPedroImage[] = [];
    for (let index = 0; index < rawImages.length; index += 1) {
      materializedImages.push(
        await this.materializeImage(rawImages[index], index, request.context.executionId, request.input, finalPrompt, warnings),
      );
    }

    return this.finalizeGeneration({
      request,
      tenant,
      claraContext,
      finalPrompt,
      visualEnrichments,
      qualityReport,
      startedAt,
      aiResponse,
      materializedImages,
      generationMode: "ai_provider",
      extraWarnings: warnings,
    });
  }

  /**
   * "Developer Assisted Mode": Pedro nunca chama o Ícaro para pixels aqui. Monta o prompt técnico
   * (o mesmo `finalPrompt` já usado no modo ai_provider — nenhuma perda de qualidade de prompt) e
   * o caminho exato onde cada imagem deve ser salva, verifica se os arquivos já existem em disco
   * (via `ArtifactDeliveryPort.readFile`, nunca via `child_process` ou qualquer comando externo),
   * valida cada um como um PNG real e plausível, e só então continua o fluxo normal. Enquanto
   * algum arquivo esperado não existir (ou não for válido), devolve `needs_assisted_generation`
   * para que Caio pause o workflow até a retomada.
   */
  private async runAssistedGeneration(input: {
    request: SkillRequest<PedroImageGenerationRequestInput>;
    tenant: TenantClientContext;
    claraContext: ClaraContextResponse;
    finalPrompt: string;
    visualEnrichments: PedroVisualEnrichment[];
    qualityReport: PedroProductionReadinessReport;
    startedAt: number;
  }): Promise<SkillResponse<PedroSkillOutput>> {
    const { request, tenant, claraContext, finalPrompt, visualEnrichments, qualityReport, startedAt } = input;

    if (!this.artifactDelivery) {
      const message = "Modo developer_assisted exige ArtifactDeliveryPort configurada para verificar arquivos salvos em disco.";
      await this.log("Error", message, request, { clientId: tenant.clientId });
      await this.emit("ImageGenerationFailed", request, { reason: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", clientId: tenant.clientId });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", message, recoverable: false },
      };
    }

    const expectedImages = buildAssistedImageRequests(request.input, finalPrompt);
    const materializedImages: MaterializedPedroImage[] = [];
    const pendingImages: PedroAssistedImageRequest[] = [];
    const validationWarnings: string[] = [];

    for (const expected of expectedImages) {
      const existing = await this.artifactDelivery.readFile({
        executionId: request.context.executionId,
        relativePath: expected.expectedRelativePath,
      });

      if (!existing) {
        pendingImages.push(expected);
        continue;
      }

      const validation = validatePngBytes(existing.data, expected.width, expected.height);
      if (!validation.valid) {
        await this.log("AssistedImageValidationFailed", `Arquivo em ${expected.expectedRelativePath} não é uma imagem válida: ${validation.reason}`, request, {
          clientId: tenant.clientId,
          relativePath: expected.expectedRelativePath,
          reason: validation.reason,
        });
        validationWarnings.push(`${expected.expectedRelativePath}: ${validation.reason}`);
        pendingImages.push(expected);
        continue;
      }

      await this.log("AssistedImageAccepted", `Imagem assistida validada em ${expected.expectedRelativePath}.`, request, {
        clientId: tenant.clientId,
        relativePath: expected.expectedRelativePath,
        width: validation.width,
        height: validation.height,
        sizeBytes: existing.sizeBytes,
      });

      materializedImages.push({
        bytes: existing.data,
        image: {
          id: this.idGenerator.create("image"),
          index: expected.index,
          fileName: expected.fileName,
          altText: `Slide ${expected.index + 1} (gerado por intervenção assistida da IA desenvolvedora)`,
          mimeType: expected.mimeType,
          extension: "png",
          width: validation.width,
          height: validation.height,
          aspectRatio: `${validation.width}:${validation.height}`,
          sizeBytes: existing.sizeBytes,
          uri: existing.relativePath,
          relativePath: existing.relativePath,
          downloadHref: existing.relativePath,
          localPath: existing.absolutePath,
          prompt: expected.prompt,
        },
      });
    }

    if (pendingImages.length > 0) {
      const resumeCommand = buildAssistedResumeCommand(request.context.executionId);
      await this.log("AssistedGenerationRequested", `Pedro aguarda intervenção assistida para ${pendingImages.length} imagem(ns).`, request, {
        clientId: tenant.clientId,
        pendingCount: pendingImages.length,
        paths: pendingImages.map((image) => image.expectedRelativePath),
      });
      await this.emit("ImageGenerationAwaitingAssistedInput", request, {
        clientId: tenant.clientId,
        pendingCount: pendingImages.length,
        paths: pendingImages.map((image) => image.expectedRelativePath),
      });

      const output: PedroAssistedGenerationOutput = {
        mode: "developer_assisted",
        instruction: "Crie a imagem usando este prompt e salve neste caminho.",
        pendingImages,
        resumeCommand,
      };

      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_assisted_generation",
        output,
        artifacts: [],
        warnings: validationWarnings,
      };
    }

    const aiResponse = buildAssistedAiResponse(startedAt, this.now());
    return this.finalizeGeneration({
      request,
      tenant,
      claraContext,
      finalPrompt,
      visualEnrichments,
      qualityReport,
      startedAt,
      aiResponse,
      materializedImages,
      generationMode: "developer_assisted",
      extraWarnings: validationWarnings,
    });
  }

  /**
   * Continuação comum a ambos os modos depois que as imagens já existem como bytes materializados
   * (vindos da resposta do Ícaro no modo ai_provider, ou lidos do disco no modo developer_assisted):
   * cria artefatos, monta a entrega (HTML/ZIP/caption/metadata) e devolve a resposta completa.
   * Nenhum destes passos muda entre os dois modos — só a origem dos bytes muda.
   */
  private async finalizeGeneration(input: {
    request: SkillRequest<PedroImageGenerationRequestInput>;
    tenant: TenantClientContext;
    claraContext: ClaraContextResponse;
    finalPrompt: string;
    visualEnrichments: PedroVisualEnrichment[];
    qualityReport: PedroProductionReadinessReport;
    startedAt: number;
    aiResponse: IcaroAIResponse;
    materializedImages: MaterializedPedroImage[];
    generationMode: PedroImageGenerationMode;
    extraWarnings: string[];
  }): Promise<SkillResponse<PedroSkillOutput>> {
    const { request, tenant, claraContext, finalPrompt, visualEnrichments, qualityReport, startedAt, aiResponse, materializedImages, generationMode } =
      input;
    const warnings = [...input.extraWarnings];
    const images = materializedImages.map((materialized) => materialized.image);

    const imageArtifacts: SkillArtifact[] = images.map((image) => toImageArtifact(image, this.idGenerator, tenant, request.input, aiResponse));
    const artifacts: SkillArtifact[] = imageArtifacts.length > 1
      ? [toCarouselArtifact(imageArtifacts, this.idGenerator, tenant, request.input)]
      : imageArtifacts;

    // Calculado antes da entrega (não depois) para poder aparecer no metadata.json e no HTML —
    // ignora o tempo de escrita dos arquivos em disco, que é irrelevante para "tempo de geração".
    const executionDurationMs = Math.max(0, this.now().getTime() - startedAt);

    const delivery = await this.createDeliveryArtifacts({
      request,
      tenant,
      input: request.input,
      aiResponse,
      materializedImages,
      warnings,
      qualityReport,
      executionDurationMs,
    });

    await this.log("ArtifactCreated", `${imageArtifacts.length} artefato(s) de imagem criado(s).`, request, {
      clientId: tenant.clientId,
      artifactCount: artifacts.length,
      imageCount: imageArtifacts.length,
      generationMode,
      deliveryHtmlPath: delivery?.htmlPath,
      deliveryZipPath: delivery?.zipPath,
    });
    await this.emit("ImageArtifactCreated", request, {
      clientId: tenant.clientId,
      artifactIds: artifacts.map((artifact) => artifact.id),
      imageCount: imageArtifacts.length,
      generationMode,
    });

    const observations = buildObservations(claraContext, this.storage, this.artifactDelivery);
    const nextSteps = buildNextSteps();
    const creativeDna = deriveCampaignCreativeDNA({
      originalRequest: request.input.originalRequest,
      centralPromise: request.input.biancaDesign.emotionalObjective,
      valueProposition: request.input.biancaDesign.desiredFeeling,
    });

    const generationVerb = generationMode === "developer_assisted" ? "confirmada(s) via intervenção assistida" : "gerada(s)";
    const output: PedroImageGenerationOutput = {
      generationSummary: `${imageArtifacts.length} imagem(ns) ${generationVerb} para o canal ${request.input.channel} no formato ${request.input.format}.`,
      finalPrompt,
      qualityReport,
      imageCount: imageArtifacts.length,
      images,
      artifacts,
      delivery,
      generationMode,
      providerUsed: aiResponse.provider.id,
      modelUsed: aiResponse.model.id,
      cost: aiResponse.cost,
      usage: aiResponse.tokens,
      executionDurationMs,
      warnings,
      observations,
      nextSteps,
      visualEnrichments,
      creativeDna,
    };

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts,
      warnings,
    };
  }

  private async materializeImage(
    raw: PedroRawGeneratedImage,
    index: number,
    executionId: string,
    input: PedroImageGenerationRequestInput,
    finalPrompt: string,
    warnings: string[],
  ): Promise<MaterializedPedroImage> {
    const mimeType = raw.mimeType?.trim() || "image/png";
    const extension = extensionForMimeType(mimeType);
    const fileName = `slide-${String(index + 1).padStart(2, "0")}.${extension}`;
    const imageRelativePath = `images/${fileName}`;
    const width = raw.width;
    const height = raw.height;
    const aspectRatio = width && height ? `${width}:${height}` : input.desiredAspectRatio;

    let uri = raw.uri;
    let sizeBytes: number | undefined;
    let artifactFile: ArtifactWrittenFile | undefined;
    const bytes = extractImageBytes(raw);

    if (this.artifactDelivery && bytes) {
      artifactFile = await this.artifactDelivery.writeFile({
        executionId,
        relativePath: imageRelativePath,
        content: bytes,
        mimeType,
      });
      sizeBytes = artifactFile.sizeBytes;
    }

    if (this.storage && bytes) {
      const asset = await this.storage.save({
        name: `${input.channel}-${index + 1}.${extension}`,
        data: bytes,
        mimeType,
      });
      uri = asset.uri;
      sizeBytes = sizeBytes ?? bytes.byteLength;
    }

    if (!bytes) {
      warnings.push(
        `Imagem ${index + 1} não continha base64/data URI. Pedro manteve a referência do provider, mas não conseguiu criar arquivo físico local para download.`,
      );
    }

    return {
      bytes,
      image: {
        id: this.idGenerator.create("image"),
        index,
        fileName,
        altText: raw.altText,
        mimeType,
        extension,
        width,
        height,
        aspectRatio,
        sizeBytes,
        uri: uri ?? artifactFile?.relativePath,
        relativePath: artifactFile?.relativePath,
        downloadHref: artifactFile?.relativePath,
        localPath: artifactFile?.absolutePath,
        prompt: finalPrompt,
      },
    };
  }

  private async createDeliveryArtifacts(input: {
    request: SkillRequest<PedroImageGenerationRequestInput>;
    tenant: TenantClientContext;
    input: PedroImageGenerationRequestInput;
    aiResponse: IcaroAIResponse;
    materializedImages: MaterializedPedroImage[];
    warnings: string[];
    qualityReport: PedroProductionReadinessReport;
    executionDurationMs: number;
  }): Promise<PedroDeliveryArtifacts | undefined> {
    if (!this.artifactDelivery) {
      input.warnings.push("ArtifactDeliveryPort não configurada; Pedro não gerou index.html, caption.txt, metadata.json nem ZIP local.");
      return undefined;
    }

    const localImages = input.materializedImages.filter((item) => item.bytes && item.image.relativePath && item.image.localPath);
    if (localImages.length === 0) {
      input.warnings.push("Nenhuma imagem física foi criada; a página de entrega não foi gerada porque não há arquivos locais para referenciar.");
      return undefined;
    }

    const caption = extractCaption(input.input);
    const hashtags = extractHashtags(input.input);
    const captionText = buildCaptionText(caption, hashtags);

    const captionFile = await this.artifactDelivery.writeFile({
      executionId: input.request.context.executionId,
      relativePath: "caption.txt",
      content: captionText,
      mimeType: "text/plain; charset=utf-8",
    });

    const promptFiles = await Promise.all(localImages.map((item, index) => this.artifactDelivery!.writeFile({
      executionId: input.request.context.executionId,
      relativePath: promptFileNameForImage(index, localImages.length),
      content: item.image.prompt,
      mimeType: "text/plain; charset=utf-8",
    })));

    let zipFile: ArtifactWrittenFile | undefined;
    if (localImages.length > 1) {
      const zipEntries: ArtifactZipEntry[] = localImages.map((item) => ({
        relativePath: item.image.relativePath ?? item.image.fileName ?? `slide-${item.image.index + 1}.${item.image.extension}`,
        data: item.bytes ?? new Uint8Array(),
      }));
      zipEntries.push({ relativePath: "caption.txt", data: encodeUtf8(captionText) });
      promptFiles.forEach((promptFile, index) => {
        zipEntries.push({ relativePath: promptFile.relativePath, data: encodeUtf8(localImages[index]?.image.prompt ?? "") });
      });
      zipFile = await this.artifactDelivery.createZip({
        executionId: input.request.context.executionId,
        relativePath: "carousel.zip",
        entries: zipEntries,
      });
    }

    const metadata = buildDeliveryMetadata({
      executionId: input.request.context.executionId,
      taskId: input.request.context.taskId,
      clientId: input.tenant.clientId,
      tenantId: input.tenant.tenantId,
      channel: input.input.channel,
      format: input.input.format,
      provider: input.aiResponse.provider.id ?? "unknown-provider",
      model: input.aiResponse.model.id ?? "unknown-model",
      generatedAt: this.timestamp(),
      images: localImages.map((item) => item.image),
      captionPath: captionFile.absolutePath,
      promptPaths: promptFiles.map((file) => file.absolutePath),
      promptRelativePaths: promptFiles.map((file) => file.relativePath),
      zipPath: zipFile?.absolutePath,
      warnings: input.warnings,
      qualityReport: input.qualityReport,
      executionDurationMs: input.executionDurationMs,
      cost: input.aiResponse.cost,
      usage: input.aiResponse.tokens,
    });
    const metadataContent = JSON.stringify(metadata, null, 2);
    const metadataFile = await this.artifactDelivery.writeFile({
      executionId: input.request.context.executionId,
      relativePath: "metadata.json",
      content: metadataContent,
      mimeType: "application/json",
    });

    const html = buildDeliveryHtml({
      title: `Entrega Pedro — ${input.tenant.clientId}`,
      generationSummary: `${localImages.length} imagem(ns) pronta(s) para baixar.`,
      images: localImages.map((item) => item.image),
      caption,
      hashtags,
      cta: extractCta(input.input),
      qualityReport: input.qualityReport,
      captionRelativePath: captionFile.relativePath,
      promptRelativePaths: promptFiles.map((file) => file.relativePath),
      metadataRelativePath: metadataFile.relativePath,
      zipRelativePath: zipFile?.relativePath,
      upstreamSkillsReport: extractUpstreamSkillsReport(input.input),
      executionDurationMs: input.executionDurationMs,
      provider: input.aiResponse.provider.id ?? "unknown-provider",
      model: input.aiResponse.model.id ?? "unknown-model",
      cost: input.aiResponse.cost,
      usage: input.aiResponse.tokens,
      regenerateCommand: buildRegenerateCommand(input.input, input.tenant),
      publishCommand: extractPublishingEnabled(input.input) ? buildPublishCommand(input.request.context.executionId) : undefined,
    });
    const htmlFile = await this.artifactDelivery.writeFile({
      executionId: input.request.context.executionId,
      relativePath: "index.html",
      content: html,
      mimeType: "text/html; charset=utf-8",
    });

    return {
      rootPath: dirnameFromPath(htmlFile.absolutePath),
      htmlPath: htmlFile.absolutePath,
      htmlRelativePath: htmlFile.relativePath,
      imagePaths: localImages.map((item) => item.image.localPath).filter((path): path is string => Boolean(path)),
      imageRelativePaths: localImages.map((item) => item.image.relativePath).filter((path): path is string => Boolean(path)),
      promptPaths: promptFiles.map((file) => file.absolutePath),
      promptRelativePaths: promptFiles.map((file) => file.relativePath),
      captionPath: captionFile.absolutePath,
      captionRelativePath: captionFile.relativePath,
      metadataPath: metadataFile.absolutePath,
      metadataRelativePath: metadataFile.relativePath,
      zipPath: zipFile?.absolutePath,
      zipRelativePath: zipFile?.relativePath,
      downloadInstructions:
        "Se o navegador bloquear o download ao abrir por file://, use Abrir em nova aba e depois clique com o botão direito na imagem para Salvar imagem como.",
    };
  }

  private async resolveClient(input: PedroImageGenerationRequestInput): Promise<TenantClientContext> {
    if (input.tenantId?.trim()) {
      return this.valentina.getClientContext(input.tenantId);
    }

    const tenant = await this.valentina.getTenant({ clientId: input.clientId, status: "all" });
    if (!tenant) {
      throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
    }

    return this.valentina.getClientContext(tenant.id);
  }

  private async log(
    action: PedroLogAction,
    message: string,
    request: SkillRequest<PedroImageGenerationRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("pedro-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId: request.context.executionId,
      taskId: request.context.taskId,
      clientId: typeof metadata.clientId === "string" ? metadata.clientId : request.input.clientId,
      tenantId: request.input.tenantId,
      metadata,
    });
  }

  private async emit(
    name: ZunoEventName,
    request: SkillRequest<PedroImageGenerationRequestInput>,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "pedro",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: PedroImageGenerationRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de geração de imagem é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.desiredAspectRatio?.trim()) errors.push("desiredAspectRatio é obrigatório.");
  if (!Number.isInteger(input.imageCount) || input.imageCount < 1) errors.push("imageCount é obrigatório e deve ser um inteiro maior que zero.");
  if (!input.biancaDesign || typeof input.biancaDesign !== "object" || !input.biancaDesign.designConcept?.trim()) {
    errors.push("biancaDesign é obrigatório e precisa conter ao menos designConcept.");
  }
  if (!input.biancaPedroBriefing || typeof input.biancaPedroBriefing !== "object" || !input.biancaPedroBriefing.designConcept?.trim()) {
    errors.push("biancaPedroBriefing é obrigatório e precisa conter ao menos designConcept.");
  }
  return errors;
}

function evaluateVisualContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.IdentityContext?.length) missing.push("IdentityContext");
  if (!context.modules.BrandContext?.length) missing.push("BrandContext");

  return {
    sufficient: !(missing.includes("IdentityContext") && missing.includes("BrandContext")),
    missing,
  };
}

function evaluateProductionReadiness(
  input: PedroImageGenerationRequestInput,
  context: ClaraContextResponse,
): PedroProductionReadinessReport {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const strengths: string[] = [];
  const upstreamRecommendations: string[] = [];
  const design = input.biancaDesign;
  const briefing = input.biancaPedroBriefing;
  const requiredDesignFields: Array<[keyof PedroImageGenerationRequestInput["biancaDesign"], string]> = [
    ["visualConcept", "conceito visual"],
    ["recommendedStyle", "estilo recomendado"],
    ["gridSystem", "sistema de grid"],
    ["visualHierarchyStrategy", "estratégia de hierarquia visual"],
    ["colorApplication", "aplicação de cores"],
    ["spacingSystem", "sistema de espaçamento"],
    ["logoPlacement", "posicionamento de logo"],
    ["ctaPlacement", "posição e destaque do CTA"],
  ];

  for (const [field, label] of requiredDesignFields) {
    if (!valueAsString(design[field])) {
      blockingIssues.push(`Bianca precisa informar ${label} antes da geração.`);
    } else {
      strengths.push(`${label} informado por Bianca.`);
    }
  }

  if (!Array.isArray(design.suggestedPalette) || design.suggestedPalette.length < 2) {
    blockingIssues.push("Bianca precisa informar uma paleta com pelo menos duas cores para controle de contraste.");
  } else {
    strengths.push("Paleta visual disponível para controle de contraste.");
  }

  if (!hasTypographyScale(design.typographyScale)) {
    blockingIssues.push("Bianca precisa informar escala tipográfica completa: headline, subheadline, body e caption.");
  } else {
    strengths.push("Escala tipográfica completa recebida.");
  }

  if (!Array.isArray(design.componentStyle) || design.componentStyle.length === 0) {
    warnings.push("Estilo de componentes não foi detalhado; isso pode reduzir consistência de botões, cards e elementos de apoio.");
    upstreamRecommendations.push("Bianca deve detalhar estilo de componentes para botões, cards, selos e CTAs.");
  }

  if (!Array.isArray(design.designConstraints) || design.designConstraints.length === 0) {
    warnings.push("Não há restrições explícitas de design; Pedro seguirá boas práticas gerais, mas sem regras específicas de marca.");
    upstreamRecommendations.push("Bianca deve enviar restrições de área segura, legibilidade, contraste e aplicação de marca.");
  }

  if (!Array.isArray(design.contrastRules) || design.contrastRules.length === 0) {
    warnings.push("Bianca não enviou regras dedicadas de contraste; Pedro seguirá apenas boas práticas gerais de contraste.");
    upstreamRecommendations.push("Bianca deve informar regras dedicadas de contraste (texto/fundo, CTA/fundo).");
  }

  if (!Array.isArray(design.accessibilityGuidelines) || design.accessibilityGuidelines.length === 0) {
    warnings.push("Bianca não enviou diretrizes de acessibilidade visual; a peça pode não considerar leitura por daltonismo ou tamanho mínimo de fonte.");
    upstreamRecommendations.push("Bianca deve informar diretrizes de acessibilidade visual.");
  }

  if (!Array.isArray(design.visualStandardizationRules) || design.visualStandardizationRules.length === 0) {
    warnings.push("Bianca não enviou regras de padronização visual; consistência entre peças/slides pode ficar sem orientação explícita.");
    upstreamRecommendations.push("Bianca deve informar regras de padronização visual, mesmo para peça única.");
  }

  if (briefing.status !== "structured") {
    blockingIssues.push("O briefing da Bianca para Pedro precisa estar com status structured.");
  }

  if (briefing.channel !== input.channel) {
    blockingIssues.push(`Canal divergente: input pede ${input.channel}, mas briefing da Bianca informa ${briefing.channel}.`);
  }

  if (briefing.recommendedAspectRatio && !areAspectRatiosEquivalent(briefing.recommendedAspectRatio, input.desiredAspectRatio)) {
    warnings.push(`Proporção divergente: input pede ${input.desiredAspectRatio}, mas Bianca recomendou ${briefing.recommendedAspectRatio}.`);
    upstreamRecommendations.push("Bianca ou Arthur devem alinhar a proporção final antes da geração para evitar crop inadequado.");
  }

  const slides = Array.isArray(briefing.slides) ? briefing.slides : [];
  if (input.imageCount > 1 && slides.length < input.imageCount) {
    blockingIssues.push(`Carrossel solicitado com ${input.imageCount} imagens, mas Bianca descreveu apenas ${slides.length} slide(s).`);
  }

  const slidesToValidate = slides.slice(0, Math.max(input.imageCount, 1));
  for (const slide of slidesToValidate) {
    const slideLabel = `Slide ${slide.slideIndex || slidesToValidate.indexOf(slide) + 1}`;
    if (!valueAsString(slide.role)) blockingIssues.push(`${slideLabel}: papel narrativo ausente.`);
    if (!valueAsString(slide.focalPoint)) blockingIssues.push(`${slideLabel}: ponto focal ausente.`);
    if (!Array.isArray(slide.visualWeightOrder) || slide.visualWeightOrder.length === 0) {
      blockingIssues.push(`${slideLabel}: ordem de peso visual ausente.`);
    }
    if (!valueAsString(slide.alignment)) blockingIssues.push(`${slideLabel}: alinhamento ausente.`);
    if (!valueAsString(slide.margins)) blockingIssues.push(`${slideLabel}: margens ausentes.`);
    if (!valueAsString(slide.breathingRoom)) blockingIssues.push(`${slideLabel}: orientação de espaço em branco ausente.`);
    if (!valueAsString(slide.emphasis)) blockingIssues.push(`${slideLabel}: ênfase visual ausente.`);
  }

  const visibleText = extractVisibleTextContext(input);
  if (!visibleText.hasAuthorizedVisibleText) {
    warnings.push("Não há textos visíveis autorizados no workflowContext; Pedro não deve inventar headline, CTA ou texto de slide.");
    upstreamRecommendations.push("Maria/Bianca devem enviar textos visíveis por slide ou CTA autorizado quando a peça exigir copy dentro da imagem.");
  } else {
    strengths.push("Textos visíveis autorizados foram recebidos no workflowContext.");
  }

  if (input.imageCount > 1 && !briefing.carouselFlow) {
    warnings.push("Carrossel sem carouselFlow detalhado; o storytelling pode ficar menos forte.");
    upstreamRecommendations.push("Bianca deve informar carouselFlow com readingFlow, sequenceNotes e consistencyRules para retenção no Instagram.");
  }

  if (!context.modules.IdentityContext?.length) {
    warnings.push("IdentityContext ausente; a peça pode ficar menos fiel à identidade visual da marca.");
  }

  const agencyChecklist = {
    premiumLayoutPotential: hasAllStrings([design.designConcept, design.visualConcept, design.recommendedStyle]),
    hierarchyReady: Boolean(valueAsString(design.visualHierarchyStrategy) && slides.every((slide) => slide.visualWeightOrder?.length)),
    whitespaceGuided: Boolean(valueAsString(design.spacingSystem) && slides.every((slide) => valueAsString(slide.breathingRoom))),
    gridReady: Boolean(valueAsString(design.gridSystem) && slides.every((slide) => valueAsString(slide.margins))),
    alignmentReady: slides.length > 0 && slides.every((slide) => valueAsString(slide.alignment)),
    contrastGuided: Array.isArray(design.suggestedPalette) && design.suggestedPalette.length >= 2 && Boolean(valueAsString(design.colorApplication)) && Boolean(design.contrastRules?.length),
    typographyGuided: hasTypographyScale(design.typographyScale),
    ctaGuided: visibleText.hasAuthorizedCta && Boolean(valueAsString(design.ctaPlacement)),
    carouselStorytellingReady: input.imageCount <= 1 || Boolean(briefing.carouselFlow?.readingFlow && briefing.carouselFlow.sequenceNotes?.length),
    premiumBrandFitReady: Boolean(valueAsString(design.recommendedStyle) && context.modules.BrandContext?.length),
    accessibilityGuided: Boolean(design.accessibilityGuidelines?.length),
    visualStandardizationGuided: Boolean(design.visualStandardizationRules?.length),
  };
  const score = clampScore(
    100
    - blockingIssues.length * 14
    - warnings.length * 5
    - Object.values(agencyChecklist).filter((value) => !value).length * 3,
  );

  return {
    status: blockingIssues.length > 0 ? "needs_more_context" : warnings.length > 0 ? "ready_with_warnings" : "ready",
    score,
    blockingIssues,
    warnings,
    strengths: [...new Set(strengths)],
    upstreamRecommendations: [...new Set(upstreamRecommendations)],
    agencyChecklist,
  };
}

/**
 * Estágio interno "Visual Enrichment" de Pedro: roda antes da montagem do prompt final e
 * transforma o conceito visual de cada imagem (o `focalPoint`/`emphasis` do slide da Bianca, ou
 * `visualConcept` da Bianca para peça única) em uma cena publicitária completa — nunca um objeto
 * isolado. Não é uma etapa nova do `ExecutionPlan` nem uma Skill: é uma função pura chamada pelo
 * próprio Pedro, sempre determinística (mesmo conceito -> mesma cena), para que o enriquecimento
 * nunca dependa de IA nem falhe. Uma entrada por imagem, na mesma ordem de `input.imageCount`.
 */
export function buildVisualEnrichments(input: PedroImageGenerationRequestInput): PedroVisualEnrichment[] {
  const emotionHint = inferVisualEmotionHint(
    input.originalRequest,
    input.biancaDesign.emotionalObjective,
    input.biancaDesign.desiredFeeling,
    input.biancaDesign.visualConcept,
  );

  const slides = input.biancaPedroBriefing.slides ?? [];
  if (slides.length > 0) {
    return Array.from({ length: input.imageCount }, (_, index) => {
      const slide = slides[index] ?? slides[slides.length - 1];
      const concept = slide?.focalPoint || slide?.emphasis || input.biancaDesign.visualConcept;
      return enrichVisualConcept(concept, emotionHint);
    });
  }

  const singleConcept = input.biancaPedroBriefing.visualConcept || input.biancaDesign.visualConcept;
  return Array.from({ length: Math.max(1, input.imageCount) }, () => enrichVisualConcept(singleConcept, emotionHint));
}

export function buildFinalImagePrompt(
  input: PedroImageGenerationRequestInput,
  context: ClaraContextResponse,
  qualityReport: PedroProductionReadinessReport = evaluateProductionReadiness(input, context),
): string {
  const brand = latest(context.modules.BrandContext);
  const identity = latest(context.modules.IdentityContext);
  const publishing = latest(context.modules.PublishingContext);
  const visibleText = extractVisibleTextContext(input);
  const visualEnrichments = buildVisualEnrichments(input);
  const slideSpecs = buildSlideProductionSpecs(input, visualEnrichments);
  const operationalBrief = buildBiancaOperationalPromptBrief(input);
  const negativePrompt = buildNegativePrompt(input);
  const qualityChecklist = buildQualityChecklist(input);
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    centralPromise: input.biancaDesign.emotionalObjective,
    valueProposition: input.biancaDesign.desiredFeeling,
  });

  return [
    "Você é o gerador de imagens do Zuno, operado por Pedro, Especialista em Geração de Imagens.",
    "Atue como um especialista sênior em Prompt Engineering para geração de imagens comerciais premium.",
    "Gerar somente imagens finais. Não criar estratégia de marketing, copy, direção de arte ou decisões de layout — siga exatamente o briefing de design da Bianca.",
    "Sua função é traduzir um briefing já aprovado em uma peça visual pronta para revisão humana, com padrão de agência premium e o mínimo possível de ambiguidade.",
    `Gerar exatamente ${input.imageCount} imagem(ns).`,
    "Retornar apenas JSON válido, sem markdown.",
    "Se algum texto visível não estiver autorizado em TEXTOS VISÍVEIS AUTORIZADOS, não invente texto novo; use composição visual sem texto legível ou áreas reservadas abstratas.",
    "Nunca simplifique este prompt: cada regra abaixo é intencional e deve ser usada na geração.",
    "",
    "DIREÇÃO EXECUTIVA DO PEDRO:",
    [
      "- usar praticamente 100% do Design Brief da Bianca como instrução operacional;",
      "- eliminar ambiguidades de composição, hierarquia, contraste, safe area, mídia, CTA e acabamento;",
      "- preservar rigorosamente identidade visual, paleta, tipografia, sensação e estilo visual definidos a montante;",
      "- produzir arte com aparência de designer profissional, não template genérico nem imagem automática.",
    ].join("\n"),
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- layout premium, moderno e não genérico;",
      "- hierarquia visual inequívoca em até 2 segundos;",
      "- grid consistente e alinhamentos precisos;",
      "- uso intencional de espaço em branco, sem poluição visual;",
      "- contraste suficiente entre texto, CTA, fundo e elementos de apoio, seguindo exatamente contrastRules do briefing da Bianca;",
      "- tipografia distribuída com escala clara entre headline, apoio, detalhes e CTA (incluindo o tamanho de CTA definido em typographyScale.cta);",
      "- CTA no tamanho e posição exatos definidos em ctaPlacement, com o destaque máximo indicado ali;",
      "- acessibilidade visual real: seguir accessibilityGuidelines do briefing (legibilidade, leitura por daltonismo, tamanho mínimo de fonte);",
      "- quando reelsCoverComposition estiver presente no briefing, seguir exatamente essa composição para a capa de Reels;",
      "- carrossel com continuidade visual, ritmo e retenção slide a slide, seguindo visualStandardizationRules do briefing;",
      "- estética compatível com marcas premium, sem aparência de template barato;",
      "- respeitar áreas seguras para Instagram e evitar elementos importantes nas bordas.",
    ].join("\n"),
    "",
    "VISUAL ENRICHMENT — CENA PUBLICITÁRIA POR IMAGEM (estágio interno do Pedro, roda antes deste prompt):",
    "Nenhuma imagem representa um objeto isolado. Cada conceito recebido de Bianca (ex.: \"caixa de presente\") já foi transformado abaixo em uma cena publicitária completa — protagonista, elemento secundário, plano de fundo, iluminação, profundidade de campo, lente simulada, enquadramento, composição, movimento implícito, emoção visual, textura, materiais e qualidade fotográfica. Usar `sceneDescription` como a descrição mestra da cena; os demais campos são a decomposição técnica dela.",
    JSON.stringify(visualEnrichments, null, 2),
    "",
    "CREATIVE DNA DA CAMPANHA (identidade criativa compartilhada, orienta sem substituir o briefing da Bianca):",
    `Hero Frame de referência: ${creativeDna.heroFrame}`,
    `Metáfora visual a preservar: ${creativeDna.visualMetaphor}`,
    `Palavras-chave visuais: ${creativeDna.visualKeywords.join(", ")}`,
    "",
    "REFERÊNCIA DE ESTILO FOTOGRÁFICO (biblioteca interna de referências visuais):",
    JSON.stringify(VISUAL_REFERENCE_LIBRARY, null, 2),
    "",
    "BRIEF OPERACIONAL ENRIQUECIDO DA BIANCA:",
    JSON.stringify(operationalBrief, null, 2),
    "",
    "NEGATIVE PROMPT:",
    negativePrompt.map((item) => `- ${item}`).join("\n"),
    "",
    "QUALITY CHECKLIST:",
    qualityChecklist.map((item) => `✓ ${item}`).join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "ESPECIFICAÇÃO DE DESIGN DA BIANCA:",
    JSON.stringify(input.biancaDesign, null, 2),
    "",
    "BRIEFING DA BIANCA PARA O PEDRO:",
    JSON.stringify(input.biancaPedroBriefing, null, 2),
    "",
    "ESPECIFICAÇÃO OPERACIONAL POR SLIDE:",
    JSON.stringify(slideSpecs, null, 2),
    "",
    "TEXTOS VISÍVEIS AUTORIZADOS:",
    JSON.stringify(visibleText, null, 2),
    "",
    "RELATÓRIO DE PRONTIDÃO DO BRIEFING:",
    JSON.stringify(qualityReport, null, 2),
    "",
    "IDENTIDADE VISUAL DA MARCA (CLARA):",
    JSON.stringify(
      {
        colors: identity?.payload.colors,
        fonts: identity?.payload.fonts,
        imageStyle: identity?.payload.imageStyle,
        visualGuidelines: identity?.payload.visualGuidelines,
        brandPromise: brand?.payload.promise,
        toneOfVoice: brand?.payload.toneOfVoice,
        mandatoryWords: brand?.payload.mandatoryWords,
        forbiddenWords: brand?.payload.forbiddenWords,
        preferredCtas: brand?.payload.preferredCtas,
      },
      null,
      2,
    ),
    "",
    publishing?.payload.approvalFlow ? `FLUXO DE APROVAÇÃO: ${publishing.payload.approvalFlow}` : "",
    `CANAL: ${input.channel}`,
    `FORMATO: ${input.format}`,
    `PROPORÇÃO DESEJADA: ${input.desiredAspectRatio}`,
    `RESOLUÇÃO SUGERIDA: ${resolutionLabelForAspectRatio(input.desiredAspectRatio)}`,
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        images: [
          {
            altText: "Descrição objetiva da imagem",
            mimeType: "image/png",
            width: 1080,
            height: 1080,
            data: "<conteúdo em base64 obrigatório para Pedro salvar o arquivo físico>",
            uri: "<referência do provider, opcional>",
          },
        ],
      },
      null,
      2,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildSlideProductionSpecs(
  input: PedroImageGenerationRequestInput,
  visualEnrichments: PedroVisualEnrichment[],
): Array<Record<string, unknown>> {
  const slides = input.biancaPedroBriefing.slides.slice(0, input.imageCount);
  return slides.map((slide, index) => ({
    slide: slide.slideIndex || index + 1,
    role: slide.role,
    focalPoint: slide.focalPoint,
    visualWeightOrder: slide.visualWeightOrder,
    artDirection: slide.artDirection,
    visualEnrichment: visualEnrichments[index],
    typography: {
      headline: slide.headlineSize,
      subheadline: slide.subheadlineSize,
      body: slide.bodyTextSize,
    },
    composition: {
      alignment: slide.alignment,
      margins: slide.margins,
      breathingRoom: slide.breathingRoom,
      emphasis: slide.emphasis,
      secondaryElements: slide.secondaryElements,
      supportingElements: slide.supportingElements,
      logoPlacement: slide.logoPlacement,
      ctaPlacement: slide.ctaPlacement,
    },
    globalArtDirection: {
      safeArea: input.biancaPedroBriefing.instagramSafeArea ?? input.biancaDesign.instagramSafeArea,
      grid: input.biancaPedroBriefing.gridSystem ?? input.biancaDesign.gridSystem,
      visualHierarchy: input.biancaPedroBriefing.visualHierarchyStrategy ?? input.biancaDesign.visualHierarchyStrategy,
      minimalismLevel: input.biancaPedroBriefing.minimalismLevel ?? input.biancaDesign.minimalismLevel,
      contrast: input.biancaPedroBriefing.contrastStrategy ?? input.biancaDesign.contrastStrategy,
      lighting: input.biancaPedroBriefing.lightingStrategy ?? input.biancaDesign.lightingStrategy,
      depth: input.biancaPedroBriefing.depthStrategy ?? input.biancaDesign.depthStrategy,
      photoTreatment: input.biancaPedroBriefing.photoTreatment ?? input.biancaDesign.photoTreatment,
    },
    slideRules: rulesForSlide(input, index, slides.length),
    retentionGoal: retentionGoalForSlide(slide.role, index, input.imageCount),
  }));
}

function buildBiancaOperationalPromptBrief(input: PedroImageGenerationRequestInput): Record<string, unknown> {
  const design = input.biancaDesign;
  const briefing = input.biancaPedroBriefing;
  return {
    visualConcept: briefing.visualConcept ?? design.visualConcept,
    emotionalObjective: briefing.emotionalObjective ?? design.emotionalObjective,
    desiredFeeling: briefing.desiredFeeling ?? design.desiredFeeling,
    visualStyle: briefing.visualStyle ?? design.visualStyle ?? briefing.recommendedStyle ?? design.recommendedStyle,
    minimalismLevel: briefing.minimalismLevel ?? design.minimalismLevel,
    format: briefing.recommendedFormat ?? design.recommendedFormat,
    aspectRatio: briefing.recommendedAspectRatio ?? design.recommendedAspectRatio,
    composition: {
      strategy: briefing.compositionStrategy ?? design.compositionStrategy,
      hierarchy: briefing.visualHierarchyStrategy ?? design.visualHierarchyStrategy,
      grid: briefing.gridSystem ?? design.gridSystem,
      safeArea: briefing.instagramSafeArea ?? design.instagramSafeArea,
      spacing: briefing.spacingSystem ?? design.spacingSystem,
      elementSpacingRules: briefing.elementSpacingRules ?? design.elementSpacingRules,
      alignmentRules: briefing.alignmentRules ?? design.alignmentRules,
      shadowRules: briefing.shadowRules ?? design.shadowRules,
    },
    visualSystem: {
      palette: briefing.suggestedPalette ?? design.suggestedPalette,
      colorApplication: briefing.colorApplication ?? design.colorApplication,
      typography: briefing.typographyScale ?? design.typographyScale,
      logoPlacement: briefing.logoPlacement ?? design.logoPlacement,
      logoSizing: briefing.logoSizing ?? design.logoSizing,
      titleSizing: briefing.titleSizing ?? design.titleSizing,
      subtitleSizing: briefing.subtitleSizing ?? design.subtitleSizing,
      supportTextSizing: briefing.supportTextSizing ?? design.supportTextSizing,
      buttonSizing: briefing.buttonSizing ?? design.buttonSizing,
      ctaPlacement: briefing.ctaPlacement ?? design.ctaPlacement,
    },
    renderingDirection: {
      contrastStrategy: briefing.contrastStrategy ?? design.contrastStrategy,
      contrastRules: briefing.contrastRules ?? design.contrastRules,
      lightingStrategy: briefing.lightingStrategy ?? design.lightingStrategy,
      depthStrategy: briefing.depthStrategy ?? design.depthStrategy,
      photoTreatment: briefing.photoTreatment ?? design.photoTreatment,
      accessibilityGuidelines: briefing.accessibilityGuidelines ?? design.accessibilityGuidelines,
      visualStandardizationRules: briefing.visualStandardizationRules ?? design.visualStandardizationRules,
    },
    mediaUsage: {
      mockupStyle: briefing.mockupStyle ?? design.mockupStyle,
      mockupUsage: briefing.mockupUsage ?? design.mockupUsage,
      photographyUsage: briefing.photographyUsage ?? design.photographyUsage,
      illustrationStyle: briefing.illustrationStyle ?? design.illustrationStyle,
      illustrationUsage: briefing.illustrationUsage ?? design.illustrationUsage,
      iconographyUsage: briefing.iconographyUsage ?? design.iconographyUsage,
      cardUsage: briefing.cardUsage ?? design.cardUsage,
      colorBlockUsage: briefing.colorBlockUsage ?? design.colorBlockUsage,
      componentStyle: briefing.componentStyle ?? design.componentStyle,
      decorativeElements: briefing.decorativeElements ?? design.decorativeElements,
    },
    slideRules: {
      coverRules: briefing.coverRules ?? design.coverRules,
      internalSlideRules: briefing.internalSlideRules ?? design.internalSlideRules,
      finalCtaRules: briefing.finalCtaRules ?? design.finalCtaRules,
      reelsCoverComposition: briefing.reelsCoverComposition ?? design.reelsCoverComposition,
      reelsCoverRules: briefing.reelsCoverRules ?? design.reelsCoverRules,
      carouselFlow: briefing.carouselFlow ?? design.carouselFlow,
    },
    auditOnly: {
      technicalJustification: briefing.technicalJustification ?? design.technicalJustification,
      instruction: "Usar como contexto técnico para fidelidade visual; não inserir este texto na imagem final.",
    },
  };
}

function rulesForSlide(input: PedroImageGenerationRequestInput, index: number, totalSlides: number): string[] {
  if (index === 0) return input.biancaPedroBriefing.coverRules ?? input.biancaDesign.coverRules ?? [];
  if (index === totalSlides - 1) return input.biancaPedroBriefing.finalCtaRules ?? input.biancaDesign.finalCtaRules ?? [];
  return input.biancaPedroBriefing.internalSlideRules ?? input.biancaDesign.internalSlideRules ?? [];
}

function buildNegativePrompt(input: PedroImageGenerationRequestInput): string[] {
  const brandColors = input.biancaPedroBriefing.suggestedPalette ?? input.biancaDesign.suggestedPalette ?? [];
  return [
    ...ANTI_GENERIC_VISUAL_CONSTRAINTS,
    "evitar excesso de texto, parágrafos longos e qualquer texto não autorizado",
    "evitar aparência de template genérico, banco de imagem barato ou arte feita automaticamente por IA",
    "evitar elementos desalinhados, grid inconsistente, margens irregulares ou elementos fora da safe area",
    "evitar elementos fora da safe area",
    "evitar baixa legibilidade em celular, texto pequeno demais, texto distorcido ou contraste insuficiente",
    "evitar poluição visual, excesso de ícones, ornamentos sem função ou múltiplos focos concorrentes",
    brandColors.length > 0
      ? `evitar cores fora da identidade; usar somente variações compatíveis com ${brandColors.join(", ")}`
      : "evitar cores fora da identidade visual definida pela marca",
    "evitar tipografia infantil, aleatória ou incompatível com a escala tipográfica definida pela Bianca",
    "evitar sombras exageradas, efeitos 3D artificiais, brilhos excessivos e profundidade sem função",
    "evitar baixa resolução, pixelização, compressão visível, serrilhado ou arte final borrada",
    "evitar distorções de rostos, mãos, objetos, mockups, logos, ícones ou elementos de marca",
    "evitar objetos cortados de forma acidental, enquadramento apertado e crop que prejudique a mensagem",
    "não alterar paleta, grid, hierarquia, estilo, posicionamento ou posição/tamanho de CTA decididos pela Bianca",
    "evitar CTA fraco, escondido, pequeno demais ou competindo com elementos secundários",
    "evitar fotografias com tratamento incoerente entre slides ou filtros pesados demais",
    "evitar composição que ignore regras de capa, slides internos, slide final ou Reels Cover quando aplicáveis",
  ];
}

function buildQualityChecklist(input: PedroImageGenerationRequestInput): string[] {
  const checklist = [
    "leitura mobile clara em até 2 segundos",
    "CTA destacado, clicável visualmente e fiel ao ctaPlacement da Bianca",
    "contraste adequado entre texto, fundo, CTA e elementos de apoio",
    "alinhamento preciso com grid, margens e eixos definidos pela Bianca",
    "identidade visual preservada: paleta, tipografia, estilo e sensação desejada",
    "área segura respeitada, sem elementos essenciais nas bordas",
    "hierarquia visual inequívoca: foco principal, texto de apoio e CTA em ordem clara",
    "impacto visual premium no primeiro slide/capa",
    "logo corretamente posicionada e discreta, sem competir com a mensagem",
    "resolução correta para a proporção desejada",
    "texto visível limitado aos textos autorizados",
    "uso de mockups, fotografias, ilustrações, ícones, cards e blocos conforme briefing",
    "espaço em branco intencional, sem poluição visual",
  ];
  if (input.imageCount > 1) {
    checklist.push("carrossel com storytelling, consistência visual e retenção slide a slide");
    checklist.push("slide final com CTA dominante e fechamento memorável");
  }
  if (input.biancaPedroBriefing.reelsCoverComposition ?? input.biancaDesign.reelsCoverComposition) {
    checklist.push("composição de Reels Cover respeitada, com título e protagonista fora das áreas de interface");
  }
  return checklist;
}

function retentionGoalForSlide(role: string, index: number, total: number): string {
  const normalized = normalize(role);
  if (index === 0 || normalized.includes("gancho")) return "Parar o scroll imediatamente com uma promessa visual clara.";
  if (index === total - 1 || normalized.includes("cta")) return "Fechar com ação visual clara e memorável.";
  if (normalized.includes("prova") || normalized.includes("benef")) return "Manter interesse com uma ideia central por slide.";
  return "Conduzir a narrativa com continuidade visual e um foco dominante.";
}

function extractVisibleTextContext(input: PedroImageGenerationRequestInput): Record<string, unknown> & {
  hasAuthorizedVisibleText: boolean;
  hasAuthorizedCta: boolean;
} {
  const context = input.workflowContext ?? {};
  const mariaCopy = valueAsRecord(context.mariaCopy);
  const slideTexts = valueAsStringArray(context.slideTexts) ?? valueAsStringArray(context.visibleTexts) ?? [];
  const title = valueAsString(context.title)
    ?? valueAsString(context.copyTitle)
    ?? valueAsString(context.headline)
    ?? valueAsString(mariaCopy?.title);
  const cta = valueAsString(context.cta)
    ?? valueAsString(context.copyCta)
    ?? valueAsString(context.recommendedCta)
    ?? valueAsString(mariaCopy?.cta);
  const caption = extractCaption(input);

  return {
    title,
    cta,
    caption,
    hashtags: extractHashtags(input),
    slideTexts,
    hasAuthorizedVisibleText: Boolean(title || cta || slideTexts.length > 0),
    hasAuthorizedCta: Boolean(cta),
    instruction: "Pedro pode usar somente estes textos como texto legível na imagem; qualquer texto ausente não deve ser inventado.",
  };
}

/**
 * Monta a lista de imagens esperadas para o modo developer_assisted: um prompt técnico (o mesmo
 * `finalPrompt` já usado no modo ai_provider, sem perda de qualidade) e o caminho exato onde a IA
 * desenvolvedora deve salvar cada arquivo, seguindo a mesma convenção de nomes que o modo
 * ai_provider já usa (`images/slide-01.png`, `images/slide-02.png`, ...).
 */
function buildAssistedImageRequests(input: PedroImageGenerationRequestInput, finalPrompt: string): PedroAssistedImageRequest[] {
  const { width, height } = resolutionForAspectRatio(input.desiredAspectRatio);
  return Array.from({ length: input.imageCount }, (_value, index) => {
    const fileName = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const prompt = input.imageCount > 1
      ? `${finalPrompt}\n\nEsta é a imagem ${index + 1} de ${input.imageCount} do carrossel. Salve exatamente neste arquivo, sem combinar slides em uma única imagem.`
      : finalPrompt;

    return {
      index,
      fileName,
      expectedRelativePath: `images/${fileName}`,
      mimeType: "image/png",
      width,
      height,
      prompt,
    };
  });
}

function buildAssistedResumeCommand(executionId: string): string {
  return `npm run zuno -- --continue ${executionId}`;
}

/**
 * Monta um `IcaroAIResponse` sintético para o modo developer_assisted, só para que o restante do
 * pipeline (criação de artefatos, HTML, metadata) permaneça idêntico entre os dois modos sem
 * precisar de dois caminhos de código separados. Não representa uma chamada de IA real — por isso
 * `provider`/`model` usam ids explícitos que identificam a origem como intervenção assistida, e
 * custo/tokens ficam zerados (nenhuma IA foi consultada para gerar pixels).
 */
function buildAssistedAiResponse(startedAt: number, now: Date): IcaroAIResponse {
  return {
    status: "completed",
    provider: { id: "developer-assisted", name: "Developer Assisted Mode (Claude Code)" },
    model: { id: "claude-code-developer-assisted" },
    durationMs: Math.max(0, now.getTime() - startedAt),
    tokens: { input: 0, output: 0, total: 0 },
    cost: { estimated: 0, actual: 0, currency: "USD" },
    content: undefined,
    warnings: [],
    attempt: { total: 1, providerAttempt: 1, providerId: "developer-assisted" },
    fallbackUsed: false,
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MIN_PLAUSIBLE_DIMENSION = 64;

type PngValidationResult =
  | { valid: true; width: number; height: number }
  | { valid: false; reason: string };

/**
 * Valida que os bytes recebidos são um PNG real e plausível — não apenas qualquer arquivo salvo
 * com extensão .png. Lê largura/altura diretamente do chunk IHDR (bytes 16-23 do arquivo, sem
 * nenhuma dependência externa) e rejeita placeholders triviais (ex.: um PNG 1x1 transparente, ou
 * qualquer imagem muito menor que o esperado) para que o modo assistido nunca aceite um substituto
 * fake como se fosse a imagem real pedida.
 */
function validatePngBytes(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): PngValidationResult {
  if (bytes.byteLength < 33) {
    return { valid: false, reason: "arquivo vazio ou pequeno demais para ser um PNG válido." };
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return { valid: false, reason: "assinatura de arquivo não corresponde a um PNG válido." };
    }
  }

  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") {
    return { valid: false, reason: "PNG sem chunk IHDR no início do arquivo." };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  if (width < MIN_PLAUSIBLE_DIMENSION || height < MIN_PLAUSIBLE_DIMENSION) {
    return {
      valid: false,
      reason: `resolução ${width}x${height} é implausível para uma peça real (mínimo ${MIN_PLAUSIBLE_DIMENSION}x${MIN_PLAUSIBLE_DIMENSION}) — parece um placeholder, não uma imagem gerada de verdade.`,
    };
  }

  if (width !== expectedWidth || height !== expectedHeight) {
    return {
      valid: false,
      reason: `resolução ${width}x${height} não corresponde à resolução esperada ${expectedWidth}x${expectedHeight}.`,
    };
  }

  return { valid: true, width, height };
}

function hasTypographyScale(value: unknown): boolean {
  const typography = valueAsRecord(value);
  return Boolean(
    valueAsString(typography?.headline)
    && valueAsString(typography?.subheadline)
    && valueAsString(typography?.body)
    && valueAsString(typography?.caption)
    && valueAsString(typography?.cta),
  );
}

function hasAllStrings(values: unknown[]): boolean {
  return values.every((value) => Boolean(valueAsString(value)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseGeneratedImages(content: string): PedroRawGeneratedImage[] {
  const parsed = JSON.parse(extractJson(content, "Pedro")) as { images?: unknown };
  const rawImages = Array.isArray(parsed.images) ? parsed.images : [];

  return rawImages
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      altText: typeof item.altText === "string" ? item.altText : undefined,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
      width: typeof item.width === "number" ? item.width : undefined,
      height: typeof item.height === "number" ? item.height : undefined,
      data: typeof item.data === "string" ? item.data : undefined,
      uri: typeof item.uri === "string" ? item.uri : undefined,
    }));
}

function toImageArtifact(
  image: PedroGeneratedImage,
  idGenerator: PedroIdGenerator,
  tenant: TenantClientContext,
  input: PedroImageGenerationRequestInput,
  aiResponse: IcaroAIResponse,
): SkillArtifact {
  return {
    id: idGenerator.create("artifact"),
    type: "image",
    name: `Imagem ${image.index + 1} gerada por Pedro`,
    status: "ready",
    uri: image.uri,
    file: {
      mimeType: image.mimeType,
      extension: image.extension,
      sizeBytes: image.sizeBytes,
      localPath: image.localPath,
    },
    dimensions: {
      width: image.width,
      height: image.height,
      aspectRatio: image.aspectRatio,
    },
    generation: {
      prompt: image.prompt,
      provider: aiResponse.provider.id,
      model: aiResponse.model.id,
      cost: {
        estimated: aiResponse.cost.estimated,
        actual: aiResponse.cost.actual,
        currency: aiResponse.cost.currency,
      },
      usage: {
        inputTokens: aiResponse.tokens.input,
        outputTokens: aiResponse.tokens.output,
        totalTokens: aiResponse.tokens.total,
      },
      durationMs: aiResponse.durationMs,
    },
    metadata: {
      clientId: tenant.clientId,
      channel: input.channel,
      altText: image.altText,
    },
  };
}

function toCarouselArtifact(
  imageArtifacts: SkillArtifact[],
  idGenerator: PedroIdGenerator,
  tenant: TenantClientContext,
  input: PedroImageGenerationRequestInput,
): SkillArtifact {
  return {
    id: idGenerator.create("artifact"),
    type: "carousel",
    name: "Carrossel de imagens gerado por Pedro",
    status: "ready",
    items: imageArtifacts,
    metadata: {
      clientId: tenant.clientId,
      channel: input.channel,
      format: input.format,
      slideCount: imageArtifacts.length,
    },
  };
}

function buildObservations(context: ClaraContextResponse, storage?: StoragePort, artifactDelivery?: ArtifactDeliveryPort): string[] {
  const observations: string[] = [];
  if (!storage) {
    observations.push("Nenhuma StoragePort configurada; imagens geradas não foram enviadas para storage externo.");
  }
  if (!artifactDelivery) {
    observations.push("Nenhuma ArtifactDeliveryPort configurada; página local de entrega não foi criada.");
  }
  if (!context.modules.IdentityContext?.length) {
    observations.push("Nenhuma identidade visual registrada na Clara; imagens geradas com base apenas no briefing de design da Bianca.");
  }
  return observations;
}

function buildNextSteps(): string[] {
  return [
    "Validar as imagens geradas com o time de marca antes de qualquer uso.",
    "Encaminhar para revisão de qualidade antes de qualquer publicação.",
    "Nenhuma publicação deve ocorrer sem aprovação humana.",
  ];
}


function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return "png";
}

function decodeBase64(data: string): Uint8Array {
  const normalized = data.includes(",") && data.trim().startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

function extractImageBytes(raw: PedroRawGeneratedImage): Uint8Array | undefined {
  if (raw.data?.trim()) return decodeBase64(raw.data);
  if (raw.uri?.trim().startsWith("data:image/")) return decodeBase64(raw.uri);
  return undefined;
}

function extractCaption(input: PedroImageGenerationRequestInput): string {
  const context = input.workflowContext ?? {};
  const directCaption = valueAsString(context.caption)
    ?? valueAsString(context.copyCaption)
    ?? valueAsString(context.mariaCaption)
    ?? valueAsString(context.finalCaption);
  if (directCaption) return directCaption;

  const mariaCopy = valueAsRecord(context.mariaCopy);
  return valueAsString(mariaCopy?.caption) ?? "";
}

function extractHashtags(input: PedroImageGenerationRequestInput): string[] {
  const context = input.workflowContext ?? {};
  const directHashtags = valueAsStringArray(context.hashtags)
    ?? valueAsStringArray(context.copyHashtags)
    ?? valueAsStringArray(context.mariaHashtags);
  if (directHashtags) return directHashtags;

  const mariaCopy = valueAsRecord(context.mariaCopy);
  return valueAsStringArray(mariaCopy?.hashtags) ?? [];
}

function extractCta(input: PedroImageGenerationRequestInput): string {
  const context = input.workflowContext ?? {};
  const directCta = valueAsString(context.cta) ?? valueAsString(context.copyCta) ?? valueAsString(context.recommendedCta);
  if (directCta) return directCta;

  const mariaCopy = valueAsRecord(context.mariaCopy);
  return valueAsString(mariaCopy?.cta) ?? "";
}

/**
 * Lê o resumo genérico de Skills já concluídas que o Caio injeta em `workflowContext.upstreamSkillsReport`
 * (ver `resolveStepInput`/`withUpstreamSkillsReport` em `caio.executor.ts`). Pedro nunca conhece o formato
 * de saída de nenhuma outra Skill — apenas renderiza esta lista genérica quando ela está presente.
 */
function extractUpstreamSkillsReport(input: PedroImageGenerationRequestInput): PedroUpstreamSkillReportEntry[] | undefined {
  const context = input.workflowContext ?? {};
  const raw = context.upstreamSkillsReport;
  if (!Array.isArray(raw)) return undefined;

  const entries = raw
    .map((item) => valueAsRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      skillId: valueAsString(item.skillId),
      name: valueAsString(item.name) ?? "Skill",
      state: valueAsString(item.state) ?? "COMPLETED",
    }));

  return entries.length > 0 ? entries : undefined;
}

function buildCaptionText(caption: string, hashtags: string[]): string {
  const sections = [caption.trim()];
  if (hashtags.length > 0) {
    sections.push(hashtags.join(" "));
  }
  return sections.filter(Boolean).join("\n\n");
}

function promptFileNameForImage(index: number, totalImages: number): string {
  if (totalImages <= 1) return "image-prompt.txt";
  return `image-prompt-slide-${String(index + 1).padStart(2, "0")}.txt`;
}

function buildDeliveryMetadata(input: {
  executionId: string;
  taskId: string;
  clientId: string;
  tenantId?: string;
  channel: string;
  format: string;
  provider: string;
  model: string;
  generatedAt: string;
  images: PedroGeneratedImage[];
  captionPath?: string;
  promptPaths: string[];
  promptRelativePaths: string[];
  zipPath?: string;
  warnings: string[];
  qualityReport: PedroProductionReadinessReport;
  executionDurationMs: number;
  cost: AICostReport;
  usage: AITokenUsage;
}): Record<string, unknown> {
  return {
    executionId: input.executionId,
    taskId: input.taskId,
    clientId: input.clientId,
    tenantId: input.tenantId,
    channel: input.channel,
    format: input.format,
    provider: input.provider,
    model: input.model,
    generatedAt: input.generatedAt,
    executionDurationMs: input.executionDurationMs,
    cost: input.cost,
    usage: input.usage,
    imageCount: input.images.length,
    images: input.images.map((image) => ({
      id: image.id,
      index: image.index,
      fileName: image.fileName,
      localPath: image.localPath,
      relativePath: image.relativePath,
      mimeType: image.mimeType,
      extension: image.extension,
      width: image.width,
      height: image.height,
      aspectRatio: image.aspectRatio,
      sizeBytes: image.sizeBytes,
      altText: image.altText,
    })),
    captionPath: input.captionPath,
    promptPaths: input.promptPaths,
    promptRelativePaths: input.promptRelativePaths,
    zipPath: input.zipPath,
    warnings: input.warnings,
    qualityReport: input.qualityReport,
  };
}

function buildDeliveryHtml(input: {
  title: string;
  generationSummary: string;
  images: PedroGeneratedImage[];
  caption: string;
  hashtags: string[];
  cta: string;
  qualityReport: PedroProductionReadinessReport;
  captionRelativePath: string;
  promptRelativePaths: string[];
  metadataRelativePath: string;
  zipRelativePath?: string;
  upstreamSkillsReport?: PedroUpstreamSkillReportEntry[];
  executionDurationMs: number;
  provider: string;
  model: string;
  cost: AICostReport;
  usage: AITokenUsage;
  regenerateCommand: string;
  publishCommand?: string;
}): string {
  const imageHrefs = input.images.map((image) => image.downloadHref ?? image.relativePath ?? "");
  const promptLinks = input.promptRelativePaths
    .map((promptPath) => `<a href="${escapeAttribute(promptPath)}" download="${escapeAttribute(promptPath)}">${escapeHtml(promptPath)}</a>`)
    .join(" · ");
  const imageCards = input.images.map((image, index) => {
    const href = imageHrefs[index];
    return [
      "<article class=\"image-card\">",
      `  <img src="${escapeAttribute(href)}" alt="${escapeAttribute(image.altText ?? `Imagem ${image.index + 1}`)}" class="zoomable" data-index="${index}" onclick="openLightbox(${index})">`,
      "  <div class=\"image-body\">",
      `    <h2>${escapeHtml(image.fileName ?? `slide-${image.index + 1}.${image.extension}`)}</h2>`,
      "    <dl>",
      `      <div><dt>Formato</dt><dd>${escapeHtml(image.mimeType)}</dd></div>`,
      `      <div><dt>Tamanho</dt><dd>${escapeHtml(formatBytes(image.sizeBytes))}</dd></div>`,
      `      <div><dt>Dimensões</dt><dd>${escapeHtml(formatDimensions(image))}</dd></div>`,
      `      <div><dt>Arquivo</dt><dd><code>${escapeHtml(image.relativePath ?? "")}</code></dd></div>`,
      "    </dl>",
      "    <div class=\"actions\">",
      `      <a class=\"button primary\" href="${escapeAttribute(href)}" download="${escapeAttribute(image.fileName ?? "imagem.png")}">Baixar imagem</a>`,
      `      <a class=\"button\" href="${escapeAttribute(href)}" target="_blank" rel="noopener">Abrir em nova aba</a>`,
      `      <button type=\"button\" class=\"button\" onclick=\"openLightbox(${index})\">Ampliar</button>`,
      "    </div>",
      "  </div>",
      "</article>",
    ].join("\n");
  }).join("\n");

  const lightbox = [
    "<div id=\"lightbox\" class=\"lightbox\" hidden role=\"dialog\" aria-modal=\"true\" aria-label=\"Visualização ampliada da imagem\">",
    "  <button type=\"button\" class=\"lightbox-close\" onclick=\"closeLightbox()\" aria-label=\"Fechar\">×</button>",
    input.images.length > 1 ? "  <button type=\"button\" class=\"lightbox-nav lightbox-prev\" onclick=\"lightboxStep(-1)\" aria-label=\"Imagem anterior\">‹</button>" : "",
    input.images.length > 1 ? "  <button type=\"button\" class=\"lightbox-nav lightbox-next\" onclick=\"lightboxStep(1)\" aria-label=\"Próxima imagem\">›</button>" : "",
    "  <img id=\"lightbox-img\" src=\"\" alt=\"\" onclick=\"toggleLightboxZoom(event)\">",
    "  <p class=\"lightbox-counter\" id=\"lightbox-counter\"></p>",
    "</div>",
  ].filter((line) => line !== "").join("\n");

  const executionSummaryStats = [
    { label: "Tempo de execução", value: formatDuration(input.executionDurationMs) },
    { label: "Provider / modelo", value: `${input.provider} / ${input.model}` },
    { label: "Tokens consumidos", value: formatTokens(input.usage) },
    { label: "Custo estimado", value: formatCost(input.cost) },
  ];
  const executionSummaryBlock = [
    "<ul class=\"stat-grid\">",
    executionSummaryStats.map((stat) => `  <li><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}</dd></li>`).join("\n"),
    "</ul>",
  ].join("\n");

  const regenerateBlock = [
    "<section class=\"copy-box\">",
    "  <div>",
    "    <span class=\"eyebrow\">Gerar novamente</span>",
    `    <pre id=\"regenerate-text\">${escapeHtml(input.regenerateCommand)}</pre>`,
    "  </div>",
    "  <button type=\"button\" onclick=\"copyTextFromElement('regenerate-text', this)\">Copiar comando</button>",
    "</section>",
  ].join("\n");

  const publishBlock = input.publishCommand
    ? [
        "<section class=\"copy-box\">",
        "  <div>",
        "    <span class=\"eyebrow\">Publicar</span>",
        `    <pre id=\"publish-text\">${escapeHtml(input.publishCommand)}</pre>`,
        "  </div>",
        "  <button type=\"button\" onclick=\"copyTextFromElement('publish-text', this)\">Copiar comando</button>",
        "</section>",
      ].join("\n")
    : "";

  const hashtagsBlock = input.hashtags.length > 0
    ? [
        "<section class=\"copy-box\">",
        "  <div>",
        "    <span class=\"eyebrow\">Hashtags</span>",
        `    <pre id=\"hashtags-text\">${escapeHtml(input.hashtags.join(" "))}</pre>`,
        "  </div>",
        "  <button type=\"button\" onclick=\"copyTextFromElement('hashtags-text', this)\">Copiar hashtags</button>",
        "</section>",
      ].join("\n")
    : "";
  const ctaBlock = input.cta
    ? [
        "<section class=\"copy-box\">",
        "  <div>",
        "    <span class=\"eyebrow\">CTA</span>",
        `    <pre id=\"cta-text\">${escapeHtml(input.cta)}</pre>`,
        "  </div>",
        "  <button type=\"button\" onclick=\"copyTextFromElement('cta-text', this)\">Copiar CTA</button>",
        "</section>",
      ].join("\n")
    : "";
  const qualityItems = Object.entries(input.qualityReport.agencyChecklist)
    .map(([key, value]) => `<li class="${value ? "ok" : "warn"}">${escapeHtml(labelForQualityKey(key))}: ${value ? "ok" : "atenção"}</li>`)
    .join("");
  const warningsBlock = input.qualityReport.warnings.length > 0
    ? `<p><strong>Atenções:</strong> ${escapeHtml(input.qualityReport.warnings.join(" "))}</p>`
    : "";
  const skillsReportBlock = input.upstreamSkillsReport?.length
    ? [
        "<section class=\"skills-report\">",
        "  <span class=\"eyebrow\">Relatório das Skills utilizadas</span>",
        "  <ul class=\"skills-list\">",
        input.upstreamSkillsReport
          .map((entry) => `    <li><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.state)}</span></li>`)
          .join("\n"),
        "  </ul>",
        "</section>",
      ].join("\n")
    : "";

  return [
    "<!doctype html>",
    "<html lang=\"pt-BR\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>${escapeHtml(input.title)}</title>`,
    "  <style>",
    "    :root { color-scheme: light; --brand:#c77f91; --brand-dark:#3a1721; --ink:#171217; --muted:#6f6470; --line:#eadde1; --bg:#fff8fa; --card:#ffffff; --ok:#0a8f61; --warn:#a96700; }",
    "    * { box-sizing: border-box; }",
    "    body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--ink); }",
    "    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 56px; }",
    "    header { background: linear-gradient(135deg, #2b1119, #c77f91); color: white; border-radius: 28px; padding: 34px; box-shadow: 0 18px 50px rgba(43,17,25,.18); }",
    "    h1 { margin: 0 0 10px; font-size: clamp(2rem, 5vw, 4rem); line-height: .95; font-family: Georgia, 'Times New Roman', serif; }",
    "    p { line-height: 1.6; }",
    "    .notice { margin-top: 18px; padding: 14px 16px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.24); border-radius: 16px; }",
    "    .toolbar, .copy-box { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin: 18px 0; padding: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 18px; }",
    "    .quality-panel, .skills-report { margin: 18px 0; padding: 20px; background: var(--card); border: 1px solid var(--line); border-radius: 22px; }",
    "    .skills-list { display: grid; gap: 8px; padding: 0; margin: 14px 0 0; list-style: none; }",
    "    .skills-list li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 12px; background: #faf4f6; font-weight: 650; }",
    "    .skills-list li span { color: var(--ok); text-transform: uppercase; font-size: .78rem; letter-spacing: .06em; }",
    "    .quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; padding: 0; margin: 14px 0 0; list-style: none; }",
    "    .quality-grid li { padding: 10px 12px; border-radius: 12px; background: #faf4f6; font-weight: 700; }",
    "    .quality-grid li.ok { color: var(--ok); }",
    "    .quality-grid li.warn { color: var(--warn); }",
    "    .score { display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: var(--brand-dark); color: white; font-size: 1.35rem; font-weight: 900; margin-right: 14px; }",
    "    .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 22px; }",
    "    .image-card { overflow: hidden; border: 1px solid var(--line); background: var(--card); border-radius: 22px; box-shadow: 0 12px 30px rgba(43,17,25,.08); }",
    "    .image-card img { display: block; width: 100%; aspect-ratio: 4/5; object-fit: contain; background: #f2edf0; }",
    "    .image-body { padding: 18px; }",
    "    .image-body h2 { margin: 0 0 12px; font-size: 1.15rem; }",
    "    dl { display: grid; gap: 8px; margin: 0 0 16px; }",
    "    dl div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px dashed var(--line); padding-bottom: 7px; }",
    "    dt { color: var(--muted); }",
    "    dd { margin: 0; text-align: right; font-weight: 650; }",
    "    code, pre { white-space: pre-wrap; word-break: break-word; }",
    "    pre { margin: 8px 0 0; font: inherit; color: var(--ink); }",
    "    .actions { display: flex; gap: 10px; flex-wrap: wrap; }",
    "    .button, button { appearance: none; border: 1px solid var(--line); background: white; color: var(--ink); text-decoration: none; border-radius: 12px; padding: 11px 14px; font-weight: 750; cursor: pointer; }",
    "    .button.primary, button { background: var(--brand); border-color: var(--brand); color: white; }",
    "    .eyebrow { display: block; color: var(--brand); font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .16em; }",
    "    .zoomable { cursor: zoom-in; }",
    "    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; padding: 0; margin: 0 0 16px; list-style: none; }",
    "    .stat-grid li { padding: 10px 12px; border-radius: 12px; background: #faf4f6; }",
    "    .stat-grid dt { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; margin: 0; }",
    "    .stat-grid dd { margin: 4px 0 0; text-align: left; font-weight: 700; }",
    "    .lightbox { position: fixed; inset: 0; background: rgba(15,8,10,.92); display: flex; align-items: center; justify-content: center; z-index: 100; }",
    "    .lightbox[hidden] { display: none; }",
    "    .lightbox img { max-width: 90vw; max-height: 86vh; object-fit: contain; cursor: zoom-in; transition: max-width .2s ease, max-height .2s ease; }",
    "    .lightbox img.zoomed { max-width: none; max-height: none; width: auto; height: 180vh; cursor: zoom-out; }",
    "    .lightbox-close, .lightbox-nav { position: absolute; appearance: none; border: none; background: rgba(255,255,255,.14); color: white; border-radius: 999px; width: 44px; height: 44px; font-size: 1.4rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }",
    "    .lightbox-close { top: 20px; right: 20px; }",
    "    .lightbox-prev { left: 20px; top: 50%; transform: translateY(-50%); }",
    "    .lightbox-next { right: 20px; top: 50%; transform: translateY(-50%); }",
    "    .lightbox-counter { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: white; font-weight: 650; }",
    "    @media (max-width: 640px) { main { width: min(100% - 20px, 1120px); padding-top: 20px; } header { padding: 24px; border-radius: 22px; } dl div { display: block; } dd { text-align: left; margin-top: 2px; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <header>",
    "      <span class=\"eyebrow\">Entrega de artefatos</span>",
    `      <h1>${escapeHtml(input.title)}</h1>`,
    `      <p>${escapeHtml(input.generationSummary)}</p>`,
    "      <p class=\"notice\">Os botões de baixar usam arquivos físicos salvos na pasta desta execução. Se o navegador bloquear downloads ao abrir por <strong>file://</strong>, clique em <strong>Abrir em nova aba</strong> e use <strong>Salvar imagem como</strong>. Clique em uma imagem para ampliar e navegar entre os slides.</p>",
    "    </header>",
    "    <section class=\"gallery\">",
    imageCards,
    "    </section>",
    lightbox,
    "    <section class=\"toolbar\">",
    "      <div>",
    "        <span class=\"eyebrow\">Arquivos auxiliares</span>",
    `        <p><a href=\"${escapeAttribute(input.captionRelativePath)}\" download=\"caption.txt\">Baixar caption.txt</a> · <a href=\"${escapeAttribute(input.metadataRelativePath)}\" download=\"metadata.json\">Baixar metadata.json</a>${promptLinks ? ` · ${promptLinks}` : ""}</p>`,
    "      </div>",
    input.zipRelativePath ? `      <a class=\"button primary\" href=\"${escapeAttribute(input.zipRelativePath)}\" download=\"carousel.zip\">Baixar todas em ZIP</a>` : "",
    "    </section>",
    "    <section class=\"copy-box\">",
    "      <div>",
    "        <span class=\"eyebrow\">Legenda</span>",
    `        <pre id=\"caption-text\">${escapeHtml(input.caption || "Legenda não informada para esta execução.")}</pre>`,
    "      </div>",
    "      <button type=\"button\" onclick=\"copyTextFromElement('caption-text', this)\">Copiar legenda</button>",
    "    </section>",
    hashtagsBlock,
    ctaBlock,
    "    <section class=\"quality-panel\">",
    "      <div>",
    `        <span class=\"score\">${escapeHtml(String(input.qualityReport.score))}</span>`,
    `        <span><span class=\"eyebrow\">Resumo técnico da execução</span><strong>${escapeHtml(input.qualityReport.status)}</strong></span>`,
    "      </div>",
    executionSummaryBlock,
    warningsBlock,
    `      <ul class=\"quality-grid\">${qualityItems}</ul>`,
    "    </section>",
    skillsReportBlock,
    regenerateBlock,
    publishBlock,
    "  </main>",
    "  <script>",
    `    var LIGHTBOX_IMAGES = ${JSON.stringify(imageHrefs)};`,
    "    var lightboxIndex = 0;",
    "    function openLightbox(index) {",
    "      lightboxIndex = index;",
    "      renderLightbox();",
    "      var box = document.getElementById('lightbox');",
    "      box.hidden = false;",
    "    }",
    "    function closeLightbox() {",
    "      document.getElementById('lightbox').hidden = true;",
    "      var img = document.getElementById('lightbox-img');",
    "      img.classList.remove('zoomed');",
    "    }",
    "    function lightboxStep(delta) {",
    "      lightboxIndex = (lightboxIndex + delta + LIGHTBOX_IMAGES.length) % LIGHTBOX_IMAGES.length;",
    "      renderLightbox();",
    "    }",
    "    function renderLightbox() {",
    "      var img = document.getElementById('lightbox-img');",
    "      img.src = LIGHTBOX_IMAGES[lightboxIndex];",
    "      img.classList.remove('zoomed');",
    "      var counter = document.getElementById('lightbox-counter');",
    "      if (counter) counter.innerText = (lightboxIndex + 1) + ' / ' + LIGHTBOX_IMAGES.length;",
    "    }",
    "    function toggleLightboxZoom(event) {",
    "      event.stopPropagation();",
    "      document.getElementById('lightbox-img').classList.toggle('zoomed');",
    "    }",
    "    document.addEventListener('keydown', function (event) {",
    "      var box = document.getElementById('lightbox');",
    "      if (!box || box.hidden) return;",
    "      if (event.key === 'Escape') closeLightbox();",
    "      if (event.key === 'ArrowRight') lightboxStep(1);",
    "      if (event.key === 'ArrowLeft') lightboxStep(-1);",
    "    });",
    "    var lightboxBackdrop = document.getElementById('lightbox');",
    "    if (lightboxBackdrop) {",
    "      lightboxBackdrop.addEventListener('click', function (event) {",
    "        if (event.target === lightboxBackdrop) closeLightbox();",
    "      });",
    "    }",
    "    async function copyTextFromElement(id, button) {",
    "      var element = document.getElementById(id);",
    "      var text = element ? element.innerText : '';",
    "      var original = button ? button.innerText : '';",
    "      try {",
    "        if (navigator.clipboard && window.isSecureContext) {",
    "          await navigator.clipboard.writeText(text);",
    "        } else {",
    "          var textarea = document.createElement('textarea');",
    "          textarea.value = text;",
    "          textarea.setAttribute('readonly', '');",
    "          textarea.style.position = 'fixed';",
    "          textarea.style.opacity = '0';",
    "          document.body.appendChild(textarea);",
    "          textarea.select();",
    "          document.execCommand('copy');",
    "          document.body.removeChild(textarea);",
    "        }",
    "        if (button) button.innerText = 'Copiado!';",
    "      } catch (error) {",
    "        window.prompt('Copie manualmente:', text);",
    "        if (button) button.innerText = 'Copie manualmente';",
    "      } finally {",
    "        if (button) window.setTimeout(function () { button.innerText = original; }, 1800);",
    "      }",
    "    }",
    "  </script>",
    "</body>",
    "</html>",
  ].filter((line) => line !== "").join("\n");
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function valueAsRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function valueAsStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/\s+/).filter((item) => item.startsWith("#"));
  }
  return undefined;
}

function encodeUtf8(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

function dirnameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : ".";
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "não informado";
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(image: PedroGeneratedImage): string {
  if (image.width && image.height) return `${image.width} × ${image.height}px`;
  return image.aspectRatio ?? "não informado";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatTokens(usage: AITokenUsage): string {
  if (!usage.total) return "não informado";
  return `${usage.total.toLocaleString("pt-BR")} (entrada ${usage.input?.toLocaleString("pt-BR") ?? 0} / saída ${usage.output?.toLocaleString("pt-BR") ?? 0})`;
}

function formatCost(cost: AICostReport): string {
  const value = cost.actual ?? cost.estimated;
  if (value === undefined) return "não informado";
  const currency = cost.currency ?? "USD";
  return `${currency} ${value.toFixed(4)}${cost.actual === undefined ? " (estimado)" : ""}`;
}

function buildRegenerateCommand(input: PedroImageGenerationRequestInput, tenant: TenantClientContext): string {
  return `npm run zuno -- "${input.originalRequest.replace(/"/g, '\\"')}" --client-id ${tenant.clientId}`;
}

function buildPublishCommand(executionId: string): string {
  return `npm run zuno -- --approve ${executionId}`;
}

function extractPublishingEnabled(input: PedroImageGenerationRequestInput): boolean {
  const context = input.workflowContext ?? {};
  return context.publishingEnabled === true;
}

function labelForQualityKey(key: string): string {
  const labels: Record<string, string> = {
    premiumLayoutPotential: "Layout premium",
    hierarchyReady: "Hierarquia",
    whitespaceGuided: "Espaço em branco",
    gridReady: "Grid",
    alignmentReady: "Alinhamento",
    contrastGuided: "Contraste",
    typographyGuided: "Tipografia",
    ctaGuided: "CTA",
    carouselStorytellingReady: "Storytelling",
    premiumBrandFitReady: "Marca premium",
  };
  return labels[key] ?? key;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function createPedroImageGenerationSkill(
  dependencies: Partial<PedroImageGenerationSkillDependencies> = {},
): PedroImageGenerationSkill {
  return new PedroImageGenerationSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro ?? missingPort<IcaroBrainPort>("IcaroBrainPort"),
    storage: dependencies.storage,
    artifactDelivery: dependencies.artifactDelivery,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
    imageGenerationMode: dependencies.imageGenerationMode,
  });
}
