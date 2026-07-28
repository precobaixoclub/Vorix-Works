import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse } from "../../application/knowledge/clara.types.js";
import type {
  ArtifactHostingInput,
  ArtifactHostingMediaType,
  ArtifactHostingPort,
  ArtifactHostingResult,
} from "../../application/ports/artifact-hosting.port.js";
import type { SocialMediaType, SocialPostDraft, SocialPublisherPort } from "../../application/ports/social-publisher.port.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantRecord } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { latest } from "../../shared/utils/skill-parsing.js";
import { anaSocialPublishingManifest } from "./ana.manifest.js";
import type { AnaLogAction, AnaLoggerPort } from "./ana-log.contract.js";
import type {
  AnaChannelResult,
  AnaPublicationOverallStatus,
  AnaPublishMode,
  AnaSocialPublishingOutput,
  AnaSocialPublishingRequestInput,
  AnaSupportedChannel,
} from "./ana-social-publishing.types.js";

export type AnaIdGenerator = {
  create(prefix: string): string;
};

export type AnaSocialPublishingSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  socialPublisher: SocialPublisherPort;
  artifactHosting?: ArtifactHostingPort;
  logger?: AnaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: AnaIdGenerator;
  now?: () => Date;
};

const ANA_SUPPORTED_CHANNELS = new Set<AnaSupportedChannel>(["instagram", "facebook"]);
const ANA_SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4"]);
const ANA_SUPPORTED_VIDEO_EXTENSIONS = new Set(["mp4"]);
const ANA_MINIMUM_VIDEO_SIZE_BYTES = 100 * 1024;

type AnaMediaPackage = {
  mediaType: SocialMediaType;
  assetUris: string[];
  sourceAssetUris: string[];
  videoUri?: string;
  sourceVideoUri?: string;
  thumbnailUri?: string;
  sourceThumbnailUri?: string;
  duration?: number;
  mimeType?: string;
  videoMetadata?: Record<string, unknown>;
  hostedArtifacts?: ArtifactHostingResult[];
};

type AnaHostingSource = {
  role: "asset" | "video" | "thumbnail";
  uri: string;
  hostingMediaType: ArtifactHostingMediaType;
  fileName?: string;
  mimeType?: string;
  extension?: string;
  sizeBytes?: number;
};

class SequentialAnaIdGenerator implements AnaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopAnaLogger implements AnaLoggerPort {
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
      throw new Error(`${portName} não configurado para Ana.`);
    },
  });
}

export class AnaSocialPublishingSkill implements Skill<AnaSocialPublishingRequestInput, AnaSocialPublishingOutput> {
  readonly manifest = anaSocialPublishingManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly socialPublisher: SocialPublisherPort;
  private readonly artifactHosting?: ArtifactHostingPort;
  private readonly logger: AnaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: AnaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: AnaSocialPublishingSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.socialPublisher = dependencies.socialPublisher;
    this.artifactHosting = dependencies.artifactHosting;
    this.logger = dependencies.logger ?? new NoopAnaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialAnaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<AnaSocialPublishingRequestInput>): Promise<SkillResponse<AnaSocialPublishingOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de publicação social inválida.", request, { errors: validationErrors });
      await this.emit("SocialPublishingValidationFailed", request, { reason: "INVALID_REQUEST", reasons: validationErrors });
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
      return await this.runPublish(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a publicação social.";
      await this.log("Error", `Erro inesperado em Ana. ${message}`, request, { error: message });
      await this.emit("SocialPublishingFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runPublish(request: SkillRequest<AnaSocialPublishingRequestInput>): Promise<SkillResponse<AnaSocialPublishingOutput>> {
    const mediaPackage = resolveMediaPackage(request.input);
    await this.log("RequestReceived", "Solicitação de publicação social recebida por Ana.", request, {
      channels: request.input.channels,
      publishMode: request.input.publishMode,
      mediaType: mediaPackage.mediaType,
    });
    await this.emit("SocialPublishingStarted", request, {
      channels: request.input.channels,
      publishMode: request.input.publishMode,
      mediaType: mediaPackage.mediaType,
    });

    let tenant: TenantRecord | undefined;
    const reasons: string[] = [];

    try {
      tenant = await this.resolveTenant(request.input);
      await this.log("ClientResolved", `Cliente ${tenant.clientId} resolvido pela Valentina.`, request, {
        clientId: tenant.clientId,
        tenantId: tenant.id,
        plan: tenant.plan,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      reasons.push(`Cliente não encontrado pela Valentina: ${message}`);
      await this.log("ClientNotFound", message, request, { error: message });
    }

    let claraContext: ClaraContextResponse | undefined;
    if (tenant) {
      claraContext = await this.clara.requestContext({
        requester: { id: this.manifest.id, type: "specialist", name: "Ana" },
        clientId: tenant.clientId,
        modules: ["PublishingContext"],
        reason: "Validação das regras de publicação antes de solicitar publicação social.",
      });
      await this.log("PublishingRulesConsulted", `Regras de publicação consultadas na Clara para o cliente ${tenant.clientId}.`, request, {
        clientId: tenant.clientId,
        totalRecords: claraContext.records.length,
      });
      await this.emit("SocialPublishingContextLoaded", request, {
        clientId: tenant.clientId,
        totalRecords: claraContext.records.length,
      });
    }

    await this.log("ValidationStarted", "Validação das regras obrigatórias de publicação iniciada.", request, {
      clientId: tenant?.clientId,
    });

    if (tenant) {
      await this.validateBusinessRules(request.input, tenant, claraContext, mediaPackage, reasons);
    }

    if (reasons.length > 0) {
      await this.log("ValidationFailed", "Validação de publicação falhou; SocialPublisherPort não foi chamada.", request, {
        clientId: tenant?.clientId,
        reasons,
      });
      await this.emit("SocialPublishingValidationFailed", request, {
        reason: "PUBLISHING_RULES_VIOLATED",
        clientId: tenant?.clientId,
        reasons,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: reasons,
        error: {
          // Sem tenant, a única razão possível é "cliente não encontrado" (validateBusinessRules
          // nunca roda sem tenant resolvido) — código dedicado, igual às outras Skills, em vez do
          // PUBLISHING_BLOCKED genérico que só faz sentido quando o cliente foi resolvido.
          code: tenant ? "PUBLISHING_BLOCKED" : "CLIENT_NOT_FOUND",
          message: reasons.join("; "),
          recoverable: true,
        },
      };
    }

    await this.log("MediaValidated", `Artefato ${mediaPackage.mediaType} validado para publicação.`, request, {
      clientId: tenant?.clientId,
      mediaType: mediaPackage.mediaType,
      assetCount: mediaPackage.assetUris.length,
      videoUri: mediaPackage.videoUri,
      mimeType: mediaPackage.mimeType,
      duration: mediaPackage.duration,
    });

    if (request.input.publishMode === "schedule" && !this.socialPublisher.capabilities.supportsScheduling) {
      const message = "O provider de publicação configurado não suporta agendamento.";
      await this.log("PublicationFailed", message, request, { clientId: tenant?.clientId });
      await this.emit("SocialPublishingFailed", request, { reason: "SCHEDULING_NOT_SUPPORTED", clientId: tenant?.clientId });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: {
          code: "SCHEDULING_NOT_SUPPORTED",
          message,
          recoverable: false,
        },
      };
    }

    const hostingResult = await this.prepareMediaForPublisher(request, mediaPackage, tenant);
    if (!hostingResult.ok) {
      await this.log("ArtifactHostingFailed", hostingResult.message, request, {
        clientId: tenant?.clientId,
        mediaType: mediaPackage.mediaType,
        reason: hostingResult.message,
      });
      await this.emit("ArtifactHostingFailed", request, {
        clientId: tenant?.clientId,
        mediaType: mediaPackage.mediaType,
        reason: hostingResult.message,
      });
      await this.emit("SocialPublishingValidationFailed", request, {
        reason: "ARTIFACT_HOSTING_FAILED",
        clientId: tenant?.clientId,
        reasons: [hostingResult.message],
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [hostingResult.message],
        error: {
          code: "ARTIFACT_HOSTING_FAILED",
          message: hostingResult.message,
          recoverable: true,
        },
      };
    }

    const publishableMediaPackage = hostingResult.mediaPackage;

    await this.log("PublicationStarted", "Publicação iniciada.", request, {
      clientId: tenant?.clientId,
      publishMode: request.input.publishMode,
      channels: request.input.channels,
      mediaType: publishableMediaPackage.mediaType,
    });

    const drafts = buildDrafts(request.input, tenant, publishableMediaPackage);
    const results = await this.executePublication(request, request.input.publishMode, drafts);
    const overallStatus = determineOverallStatus(request.input.publishMode, results);

    if (request.input.publishMode === "schedule" && overallStatus === "scheduled") {
      await this.log("PublicationScheduled", "Publicação agendada com sucesso em todos os canais.", request, {
        clientId: tenant?.clientId,
        scheduledAt: request.input.scheduledAt,
      });
      await this.emit("SocialPublishingScheduled", request, {
        clientId: tenant?.clientId,
        scheduledAt: request.input.scheduledAt,
        channels: request.input.channels,
        mediaType: publishableMediaPackage.mediaType,
      });
    } else {
      await this.log("PublicationCompleted", `Publicação concluída com status ${overallStatus}.`, request, {
        clientId: tenant?.clientId,
        overallStatus,
      });
    }

    if (overallStatus === "failed") {
      await this.log("PublicationFailed", "Publicação falhou em todos os canais solicitados.", request, { clientId: tenant?.clientId });
      await this.emit("SocialPublishingFailed", request, { reason: "ALL_CHANNELS_FAILED", clientId: tenant?.clientId });
    }

    await this.emit("SocialPublishingFinished", request, {
      clientId: tenant?.clientId,
      overallStatus,
      publishMode: request.input.publishMode,
      mediaType: publishableMediaPackage.mediaType,
    });

    const output = buildOutput(request.input, overallStatus, results, drafts, claraContext, publishableMediaPackage);

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [],
      warnings: output.warnings,
    };
  }

  private async resolveTenant(input: AnaSocialPublishingRequestInput): Promise<TenantRecord> {
    const tenant = input.tenantId?.trim()
      ? await this.valentina.getTenant({ tenantId: input.tenantId, status: "all" })
      : await this.valentina.getTenant({ clientId: input.clientId, status: "all" });

    if (!tenant) {
      throw new Error(`Valentina não encontrou o cliente ${input.tenantId ?? input.clientId}.`);
    }

    return tenant;
  }

  private async validateBusinessRules(
    input: AnaSocialPublishingRequestInput,
    tenant: TenantRecord,
    claraContext: ClaraContextResponse | undefined,
    mediaPackage: AnaMediaPackage,
    reasons: string[],
  ): Promise<void> {
    for (const channel of input.channels) {
      if (tenant.integrations[channel]?.status !== "connected") {
        reasons.push(`Integração ${channel} não está conectada.`);
      }
    }

    if (!input.mariaCopy.title?.trim() || !input.mariaCopy.caption?.trim()) {
      reasons.push("Copy inválida: título ou legenda ausente.");
    }

    validateMediaPackage(input, mediaPackage, reasons);

    if (!input.lucasReview.approvalRecommended) {
      reasons.push(`Lucas não recomendou aprovação para este pacote (status: ${input.lucasReview.reviewStatus}).`);
    }

    if (!input.humanApproval.confirmed) {
      reasons.push("Aprovação humana não foi confirmada.");
    }

    for (const channel of input.channels) {
      const allowedIntegrations = tenant.planLimits.integrations;
      if (allowedIntegrations !== "all" && !allowedIntegrations.includes(channel)) {
        reasons.push(`Canal ${channel} não está liberado no plano ${tenant.plan}.`);
      }
      if (!providerSupportsMediaType(this.socialPublisher, channel, mediaPackage.mediaType)) {
        reasons.push(`Provider de publicação não suporta ${mediaPackage.mediaType} no canal ${channel}.`);
      }
    }

    const canUseSpecialist = await this.valentina.canUseSpecialist(tenant.id, "social_publishing");
    if (!canUseSpecialist) {
      reasons.push(`Especialista de publicação social não está liberado no plano ${tenant.plan}.`);
    }

    if (claraContext) {
      const publishing = latest(claraContext.modules.PublishingContext);
      for (const channel of input.channels) {
        const entry = publishing?.payload.connectedSocialNetworks?.find((candidate) => candidate.network === channel);
        if (entry && entry.status !== "connected") {
          reasons.push(`Regra de publicação da Clara bloqueia o canal ${channel} (status: ${entry.status}).`);
        }
        if (entry && !claraEntrySupportsMediaType(entry, mediaPackage.mediaType)) {
          reasons.push(`Canal ${channel} não permite ${mediaPackage.mediaType} nas regras de publicação da Clara.`);
        }
      }
    }

    if (input.publishMode === "schedule") {
      const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
      if (!scheduledDate || Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= this.now().getTime()) {
        reasons.push("Data e hora de agendamento inválidas ou ausentes.");
      }
    }
  }

  private async executePublication(
    request: SkillRequest<AnaSocialPublishingRequestInput>,
    mode: AnaPublishMode,
    drafts: SocialPostDraft[],
  ): Promise<AnaChannelResult[]> {
    if (mode === "dry_run") {
      const status = isLocalProduction(request.input) ? "local_ready" as const : "dry_run" as const;
      return drafts.map((draft) => ({ channel: draft.channel as AnaSupportedChannel, status }));
    }

    return Promise.all(
      drafts.map(async (draft): Promise<AnaChannelResult> => {
        const channel = draft.channel as AnaSupportedChannel;
        try {
          const result = mode === "schedule" ? await this.socialPublisher.schedule(draft) : await this.socialPublisher.publish(draft);
          if (result.status === "failed") {
            await this.log("PublicationFailed", `Falha ao publicar no canal ${channel}.`, request, {
              channel,
              error: result.error?.message,
            });
            return {
              channel,
              status: "failed",
              error: result.error ?? { code: "PUBLISH_FAILED", message: `Falha ao publicar no canal ${channel}.`, retryable: true },
            };
          }
          return {
            channel,
            status: result.status,
            externalId: result.externalId,
            url: result.url,
            scheduledAt: result.scheduledAt,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : `Falha desconhecida ao publicar no canal ${channel}.`;
          await this.log("PublicationFailed", `Exceção ao publicar no canal ${channel}. ${message}`, request, { channel, error: message });
          return { channel, status: "failed", error: { code: "PUBLISH_EXCEPTION", message, retryable: true } };
        }
      }),
    );
  }

  private async prepareMediaForPublisher(
    request: SkillRequest<AnaSocialPublishingRequestInput>,
    mediaPackage: AnaMediaPackage,
    tenant: TenantRecord | undefined,
  ): Promise<{ ok: true; mediaPackage: AnaMediaPackage } | { ok: false; message: string }> {
    if (request.input.publishMode === "dry_run") {
      return { ok: true, mediaPackage };
    }

    const sources = collectPublishingSources(mediaPackage);
    const fileUri = sources.find((source) => source.uri.startsWith("file://"));
    if (fileUri) {
      return { ok: false, message: `Artefato ${fileUri.uri} usa file://, que não pode ser enviado para publicação real.` };
    }

    const needsHosting = sources.some((source) => !isPublicHttpUrl(source.uri));
    if (!needsHosting) {
      return { ok: true, mediaPackage };
    }

    if (!this.artifactHosting) {
      return {
        ok: false,
        message:
          "ArtifactHostingPort não está configurada. Publicação real exige URLs públicas para todos os artefatos; nenhum caminho local será enviado ao provider.",
      };
    }

    await this.log("ArtifactHostingStarted", "Hospedagem de artefatos iniciada antes da publicação real.", request, {
      clientId: tenant?.clientId,
      provider: this.artifactHosting.capabilities.provider,
      mediaType: mediaPackage.mediaType,
      sourceCount: sources.length,
    });
    await this.emit("ArtifactHostingStarted", request, {
      clientId: tenant?.clientId,
      provider: this.artifactHosting.capabilities.provider,
      mediaType: mediaPackage.mediaType,
      sourceCount: sources.length,
    });

    const hostedArtifacts: ArtifactHostingResult[] = [];
    const publicBySource = new Map<string, string>();

    for (const source of sources) {
      if (isPublicHttpUrl(source.uri)) {
        publicBySource.set(source.uri, source.uri);
        continue;
      }

      const hostingInput: ArtifactHostingInput = {
        executionId: request.context.executionId,
        sourceUri: source.uri,
        mediaType: source.hostingMediaType,
        fileName: source.fileName,
        mimeType: source.mimeType,
        extension: source.extension,
        sizeBytes: source.sizeBytes,
        metadata: {
          clientId: tenant?.clientId,
          socialMediaType: mediaPackage.mediaType,
          sourceRole: source.role,
        },
      };
      const hosted = await this.artifactHosting.host(hostingInput);
      hostedArtifacts.push(hosted);
      if (hosted.status === "failed" || !hosted.publicUrl) {
        return {
          ok: false,
          message: hosted.error?.message ?? `Falha ao hospedar artefato ${source.uri}.`,
        };
      }
      if (!isPublicHttpUrl(hosted.publicUrl)) {
        return {
          ok: false,
          message: `ArtifactHostingPort retornou URL não pública para ${source.uri}.`,
        };
      }
      publicBySource.set(source.uri, hosted.publicUrl);
      await this.log("ArtifactHosted", `Artefato hospedado por ${hosted.provider}.`, request, {
        clientId: tenant?.clientId,
        provider: hosted.provider,
        sourceUri: hosted.sourceUri,
        publicUrl: hosted.publicUrl,
        mediaType: source.hostingMediaType,
      });
    }

    const hostedMediaPackage = replaceMediaSourcesWithPublicUrls(mediaPackage, publicBySource, hostedArtifacts);
    if (!mediaPackageHasOnlyPublicUrls(hostedMediaPackage)) {
      return { ok: false, message: "Hospedagem incompleta: ainda existem artefatos sem URL pública após o upload." };
    }

    await this.emit("ArtifactHostingFinished", request, {
      clientId: tenant?.clientId,
      provider: this.artifactHosting.capabilities.provider,
      mediaType: hostedMediaPackage.mediaType,
      hostedCount: hostedArtifacts.filter((artifact) => artifact.status === "hosted").length,
    });

    return { ok: true, mediaPackage: hostedMediaPackage };
  }

  private async log(
    action: AnaLogAction,
    message: string,
    request: SkillRequest<AnaSocialPublishingRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("ana-log"),
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
    request: SkillRequest<AnaSocialPublishingRequestInput>,
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
        source: "ana",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: AnaSocialPublishingRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de publicação é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!Array.isArray(input.channels) || input.channels.length === 0) {
    errors.push("channels é obrigatório e precisa conter ao menos um canal.");
  } else if (input.channels.some((channel) => !ANA_SUPPORTED_CHANNELS.has(channel))) {
    errors.push("channels só suporta instagram e facebook nesta fase.");
  }
  if (!input.publishMode || !["publish_now", "schedule", "dry_run"].includes(input.publishMode)) {
    errors.push("publishMode é obrigatório e deve ser publish_now, schedule ou dry_run.");
  }
  if (input.publishMode === "schedule" && !input.scheduledAt?.trim()) {
    errors.push("scheduledAt é obrigatório quando publishMode é schedule.");
  }
  if (!input.mariaCopy || typeof input.mariaCopy !== "object") errors.push("mariaCopy é obrigatório.");
  const hasPedroImages = input.pedroImages && typeof input.pedroImages === "object" && Array.isArray(input.pedroImages.images);
  const hasRafaVideo = input.rafaVideo && typeof input.rafaVideo === "object" && typeof input.rafaVideo.video === "object";
  if (!hasPedroImages && !hasRafaVideo) {
    errors.push("pedroImages ou rafaVideo é obrigatório para publicação social.");
  }
  if (!input.lucasReview || typeof input.lucasReview !== "object") errors.push("lucasReview é obrigatório.");
  if (!input.humanApproval || typeof input.humanApproval !== "object") errors.push("humanApproval é obrigatório.");
  return errors;
}

function resolveMediaPackage(input: AnaSocialPublishingRequestInput): AnaMediaPackage {
  const video = input.rafaVideo?.video;
  if (video) {
    const videoUri = firstNonEmpty(video.uri, video.downloadHref, video.relativePath, video.localPath);
    const mimeType = video.mimeType?.trim();
    const duration = video.specs?.durationSeconds;
    return {
      mediaType: "video",
      assetUris: videoUri ? [videoUri] : [],
      sourceAssetUris: videoUri ? [videoUri] : [],
      videoUri,
      sourceVideoUri: videoUri,
      thumbnailUri: video.thumbnailUri,
      sourceThumbnailUri: video.thumbnailUri,
      duration,
      mimeType,
      videoMetadata: {
        id: video.id,
        index: video.index,
        fileName: video.fileName,
        extension: video.extension,
        sizeBytes: video.sizeBytes,
        majorBrand: video.majorBrand,
        localPath: video.localPath,
        relativePath: video.relativePath,
        specs: video.specs,
        generationMode: input.rafaVideo?.generationMode,
        metadata: video.metadata,
      },
    };
  }

  const assetUris =
    input.pedroImages?.images.map((image) => firstNonEmpty(image.uri, image.downloadHref, image.relativePath, image.localPath)).filter((uri): uri is string => Boolean(uri?.trim())) ?? [];

  return {
    mediaType: assetUris.length > 1 ? "carousel" : "image",
    assetUris,
    sourceAssetUris: assetUris,
  };
}

function validateMediaPackage(
  input: AnaSocialPublishingRequestInput,
  mediaPackage: AnaMediaPackage,
  reasons: string[],
): void {
  if (mediaPackage.mediaType !== "video") {
    if (!input.pedroImages || input.pedroImages.imageCount <= 0 || mediaPackage.assetUris.length === 0) {
      reasons.push("Nenhuma imagem válida disponível para publicação.");
    }
    return;
  }

  const video = input.rafaVideo?.video;
  if (!video || !mediaPackage.videoUri?.trim()) {
    reasons.push("Nenhum vídeo válido do Rafa disponível para publicação.");
    return;
  }

  const extension = normalizeExtension(video.extension ?? extensionFromName(video.fileName ?? mediaPackage.videoUri));
  if (!mediaPackage.mimeType || !ANA_SUPPORTED_VIDEO_MIME_TYPES.has(mediaPackage.mimeType.toLowerCase())) {
    reasons.push(`Formato de vídeo não suportado: mimeType "${mediaPackage.mimeType ?? "ausente"}".`);
  }
  if (!extension || !ANA_SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    reasons.push(`Formato de vídeo não suportado: extensão "${extension ?? "ausente"}".`);
  }
  if (typeof video.sizeBytes !== "number" || video.sizeBytes < ANA_MINIMUM_VIDEO_SIZE_BYTES) {
    reasons.push(`Vídeo do Rafa é pequeno demais ou não informa tamanho mínimo de ${ANA_MINIMUM_VIDEO_SIZE_BYTES} bytes.`);
  }
  if (typeof mediaPackage.duration !== "number" || mediaPackage.duration <= 0) {
    reasons.push("Vídeo do Rafa não informa duração válida.");
  }
}

function collectPublishingSources(mediaPackage: AnaMediaPackage): AnaHostingSource[] {
  if (mediaPackage.mediaType === "video") {
    const sources: AnaHostingSource[] = [];
    if (mediaPackage.sourceVideoUri) {
      sources.push({
        role: "video",
        uri: mediaPackage.sourceVideoUri,
        hostingMediaType: "video",
        mimeType: mediaPackage.mimeType,
        extension: extensionFromName(mediaPackage.sourceVideoUri),
        sizeBytes: typeof mediaPackage.videoMetadata?.sizeBytes === "number" ? mediaPackage.videoMetadata.sizeBytes : undefined,
      });
    }
    if (mediaPackage.sourceThumbnailUri) {
      sources.push({
        role: "thumbnail",
        uri: mediaPackage.sourceThumbnailUri,
        hostingMediaType: "image",
        extension: extensionFromName(mediaPackage.sourceThumbnailUri),
      });
    }
    return sources;
  }

  return mediaPackage.sourceAssetUris.map((uri) => ({
    role: "asset" as const,
    uri,
    hostingMediaType: "image" as const,
    extension: extensionFromName(uri),
  }));
}

function replaceMediaSourcesWithPublicUrls(
  mediaPackage: AnaMediaPackage,
  publicBySource: Map<string, string>,
  hostedArtifacts: ArtifactHostingResult[],
): AnaMediaPackage {
  const replace = (uri: string | undefined): string | undefined => (uri ? publicBySource.get(uri) ?? uri : undefined);
  const assetUris = mediaPackage.sourceAssetUris.map((uri) => replace(uri)).filter((uri): uri is string => Boolean(uri));

  if (mediaPackage.mediaType === "video") {
    const videoUri = replace(mediaPackage.sourceVideoUri);
    const thumbnailUri = replace(mediaPackage.sourceThumbnailUri);
    return {
      ...mediaPackage,
      assetUris: videoUri ? [videoUri] : [],
      videoUri,
      thumbnailUri,
      hostedArtifacts,
      videoMetadata: {
        ...(mediaPackage.videoMetadata ?? {}),
        hostedArtifacts,
        sourceVideoUri: mediaPackage.sourceVideoUri,
        publicVideoUrl: videoUri,
        sourceThumbnailUri: mediaPackage.sourceThumbnailUri,
        publicThumbnailUrl: thumbnailUri,
      },
    };
  }

  return {
    ...mediaPackage,
    assetUris,
    hostedArtifacts,
  };
}

function mediaPackageHasOnlyPublicUrls(mediaPackage: AnaMediaPackage): boolean {
  if (mediaPackage.mediaType === "video") {
    return Boolean(mediaPackage.videoUri && isPublicHttpUrl(mediaPackage.videoUri)) &&
      (!mediaPackage.thumbnailUri || isPublicHttpUrl(mediaPackage.thumbnailUri));
  }
  return mediaPackage.assetUris.length > 0 && mediaPackage.assetUris.every(isPublicHttpUrl);
}

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function providerSupportsMediaType(
  publisher: SocialPublisherPort,
  channel: AnaSupportedChannel,
  mediaType: SocialMediaType,
): boolean {
  const supported = publisher.capabilities.supportedMediaTypes?.[channel];
  return !supported || supported.includes(mediaType);
}

function claraEntrySupportsMediaType(entry: unknown, mediaType: SocialMediaType): boolean {
  const supportedMediaTypes = typeof entry === "object" && entry !== null ? (entry as { supportedMediaTypes?: unknown }).supportedMediaTypes : undefined;
  if (!Array.isArray(supportedMediaTypes)) return true;
  return supportedMediaTypes.includes(mediaType);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function normalizeExtension(extension: string | undefined): string | undefined {
  return extension?.trim().replace(/^\./, "").toLowerCase() || undefined;
}

function extensionFromName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  if (!normalized || !normalized.includes(".")) return undefined;
  return normalized.split(".").pop();
}

function buildDrafts(
  input: AnaSocialPublishingRequestInput,
  tenant: TenantRecord | undefined,
  mediaPackage: AnaMediaPackage,
): SocialPostDraft[] {
  const assetUris = mediaPackage.assetUris;

  return input.channels.map((channel) => ({
    channel,
    mediaType: mediaPackage.mediaType,
    caption: input.mariaCopy.caption,
    cta: input.mariaCopy.cta,
    hashtags: input.mariaCopy.hashtags,
    assetUris,
    videoUri: mediaPackage.videoUri,
    thumbnailUri: mediaPackage.thumbnailUri,
    duration: mediaPackage.duration,
    mimeType: mediaPackage.mimeType,
    scheduledAt: input.publishMode === "schedule" ? input.scheduledAt : undefined,
    videoMetadata: mediaPackage.videoMetadata,
    metadata: {
      clientId: tenant?.clientId,
      objective: input.joaoStrategy.objective,
      visualConcept: input.sofiaDirection?.visualConcept,
      lucasReviewStatus: input.lucasReview.reviewStatus,
      timezone: tenant?.settings.timezone,
      dryRun: input.publishMode === "dry_run",
      mediaType: mediaPackage.mediaType,
      sourceAssetUris: mediaPackage.sourceAssetUris,
      hostedArtifacts: mediaPackage.hostedArtifacts,
    },
  }));
}

function determineOverallStatus(mode: AnaPublishMode, results: AnaChannelResult[]): AnaPublicationOverallStatus {
  if (mode === "dry_run") return results.every((result) => result.status === "local_ready") ? "local_ready" : "dry_run";

  const successStatus: AnaChannelResultStatusFor = mode === "schedule" ? "scheduled" : "published";
  const allSucceeded = results.every((result) => result.status === successStatus);
  const noneSucceeded = results.every((result) => result.status === "failed");

  if (allSucceeded) return successStatus;
  if (noneSucceeded) return "failed";
  return "partially_published";
}

type AnaChannelResultStatusFor = "published" | "scheduled";

function buildOutput(
  input: AnaSocialPublishingRequestInput,
  overallStatus: AnaPublicationOverallStatus,
  results: AnaChannelResult[],
  drafts: SocialPostDraft[],
  claraContext: ClaraContextResponse | undefined,
  mediaPackage: AnaMediaPackage,
): AnaSocialPublishingOutput {
  const publishedChannels = results.filter((result) => result.status !== "failed").map((result) => result.channel);
  const failedChannels = results.filter((result) => result.status === "failed").map((result) => result.channel);

  const externalIds: Record<string, string> = {};
  const externalUrls: Record<string, string> = {};
  for (const result of results) {
    if (result.externalId) externalIds[result.channel] = result.externalId;
    if (result.url) externalUrls[result.channel] = result.url;
  }

  return {
    overallStatus,
    mediaType: mediaPackage.mediaType,
    requestedChannels: input.channels,
    publishedChannels,
    failedChannels,
    publishMode: input.publishMode,
    scheduledAt: input.publishMode === "schedule" ? input.scheduledAt : undefined,
    results,
    externalIds,
    externalUrls,
    payloadSentToPublisher: drafts,
    warnings: results.filter((result) => result.status === "failed").map((result) => result.error?.message ?? `Falha ao publicar no canal ${result.channel}.`),
    observations: buildObservations(input, claraContext),
    nextSteps: buildNextSteps(overallStatus),
  };
}

function buildObservations(input: AnaSocialPublishingRequestInput, claraContext: ClaraContextResponse | undefined): string[] {
  const observations: string[] = [];
  if (!claraContext?.modules.PublishingContext?.length) {
    observations.push("Nenhuma regra de publicação específica registrada na Clara para este cliente.");
  }
  if (input.publishMode === "dry_run") {
    observations.push("Execução em dry_run/local: nenhuma chamada real foi feita a SocialPublisherPort.");
  }
  if (isLocalProduction(input)) {
    observations.push("Modo LOCAL_PRODUCTION: Ana apenas preparou o payload local e não publicou, não agendou, não fez upload e não criou URL pública.");
  }
  return observations;
}

function buildNextSteps(status: AnaPublicationOverallStatus): string[] {
  if (status === "published") return ["Nenhuma ação adicional necessária.", "Monitorar performance quando a Skill de métricas existir."];
  if (status === "scheduled") return ["Aguardar o horário agendado.", "Confirmar a publicação após o horário programado."];
  if (status === "local_ready") return ["Arquivos e payload estão prontos localmente.", "Publicar manualmente nas redes sociais escolhidas.", "Guardar o execution-report.json para auditoria."];
  if (status === "dry_run") return ["Nenhuma publicação real foi realizada.", "Revisar o payload simulado antes de publicar de verdade."];
  if (status === "partially_published") return ["Investigar os canais com erro antes de tentar novamente.", "Repetir a solicitação apenas para os canais que falharam."];
  return ["Investigar a causa da falha em todos os canais antes de tentar novamente.", "Nenhum conteúdo foi publicado."];
}

function isLocalProduction(input: AnaSocialPublishingRequestInput): boolean {
  return input.workflowContext?.runtimeMode === "LOCAL_PRODUCTION" || input.workflowContext?.localProduction === true;
}

export function createAnaSocialPublishingSkill(
  dependencies: Partial<AnaSocialPublishingSkillDependencies> = {},
): AnaSocialPublishingSkill {
  return new AnaSocialPublishingSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    socialPublisher: dependencies.socialPublisher ?? missingPort<SocialPublisherPort>("SocialPublisherPort"),
    artifactHosting: dependencies.artifactHosting,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
