import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  AnaSocialPublishingSkill,
  anaSocialPublishingManifest,
} from "../dist/skills/ana-social-publishing/index.js";

const CLIENT_ID = "client-casamento-1";
const TENANT_ID = "tenant-casamento-1";

function claraRecord(module, payload, overrides = {}) {
  return {
    id: overrides.id ?? `${module}-1`,
    module,
    clientId: payload.clientId,
    title: overrides.title ?? module,
    status: "active",
    currentVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    payload,
    versions: [],
    history: [],
    tags: [],
  };
}

function fullKnowledgeBase(publishingOverrides = {}) {
  return {
    PublishingContext: [
      claraRecord("PublishingContext", {
        clientId: CLIENT_ID,
        connectedSocialNetworks: [
          { network: "instagram", status: "connected" },
          { network: "facebook", status: "connected" },
        ],
        approvalFlow: "Aprovação obrigatória do time de marketing antes de publicar.",
        ...publishingOverrides,
      }),
    ],
  };
}

function createTenant(overrides = {}) {
  return {
    id: TENANT_ID,
    clientId: CLIENT_ID,
    displayName: "Rumo ao Altar",
    status: "active",
    subscriptionStatus: "active",
    plan: "PRO",
    planLimits: {
      monthlyAiTokens: 500000,
      dailyAiTokens: 35000,
      specialists: "all",
      features: "all",
      integrations: ["instagram", "facebook", "meta"],
      monthlyPublications: 120,
      monthlyCampaigns: 10,
      monthlyImages: 120,
      monthlyVideos: 10,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mainObjectives: [],
    connectedSocialNetworks: ["instagram", "facebook"],
    integrations: {
      instagram: { network: "instagram", status: "connected", connectedAt: "2026-01-01T00:00:00.000Z" },
      facebook: { network: "facebook", status: "connected", connectedAt: "2026-01-01T00:00:00.000Z" },
    },
    credits: { addedAiTokens: 0, consumedExtraAiTokens: 0, availableExtraAiTokens: 0 },
    usage: { monthly: [] },
    enabledSpecialists: "all",
    enabledFeatures: "all",
    permissions: { canPublish: true, canCreateCampaigns: true, canUsePaidAds: true, canUseImageGeneration: true, canUseVideoGeneration: true },
    settings: { timezone: "America/Sao_Paulo", language: "pt-BR", country: "BR", environment: "production", preferences: {} },
    currentVersion: 1,
    versions: [],
    history: [],
    ...overrides,
  };
}

class FakeValentina {
  constructor(tenants = [], canUseSpecialistResult = true) {
    this.tenants = tenants;
    this.getTenantCalls = [];
    this.canUseSpecialistCalls = [];
    this.canUseSpecialistResult = canUseSpecialistResult;
  }

  async getTenant(query) {
    this.getTenantCalls.push(query);
    if (query.tenantId) return this.tenants.find((candidate) => candidate.id === query.tenantId);
    return this.tenants.find((candidate) => candidate.clientId === query.clientId);
  }

  async canUseSpecialist(tenantId, capability) {
    this.canUseSpecialistCalls.push({ tenantId, capability });
    return this.canUseSpecialistResult;
  }
}

class FakeClara {
  constructor(recordsByModule = {}) {
    this.recordsByModule = recordsByModule;
    this.requestContextCalls = [];
  }

  async requestContext(request) {
    this.requestContextCalls.push(request);
    const modules = {};
    let records = [];
    for (const moduleName of request.modules ?? Object.keys(this.recordsByModule)) {
      const moduleRecords = this.recordsByModule[moduleName] ?? [];
      if (moduleRecords.length > 0) {
        modules[moduleName] = moduleRecords;
        records = records.concat(moduleRecords);
      }
    }
    return { clientId: request.clientId, deliveredAt: "2026-07-02T12:00:00.000Z", modules, records };
  }
}

class FakeSocialPublisher {
  constructor({ supportsScheduling = true, supportedMediaTypes, responses = {} } = {}) {
    this.capabilities = { supportsScheduling, ...(supportedMediaTypes ? { supportedMediaTypes } : {}) };
    this.publishCalls = [];
    this.scheduleCalls = [];
    this.responses = responses;
  }

  async publish(draft) {
    this.publishCalls.push(draft);
    return this.resolveResult(draft, "published");
  }

  async schedule(draft) {
    this.scheduleCalls.push(draft);
    return this.resolveResult(draft, "scheduled");
  }

  resolveResult(draft, defaultStatus) {
    const override = this.responses[draft.channel];
    if (override instanceof Error) throw override;
    if (override) return override;
    return {
      channel: draft.channel,
      status: defaultStatus,
      externalId: `ext-${draft.channel}`,
      url: `https://social.example/${draft.channel}/post`,
      scheduledAt: defaultStatus === "scheduled" ? draft.scheduledAt : undefined,
    };
  }
}

class FakeArtifactHosting {
  constructor({ fail = false, provider = "fake-hosting" } = {}) {
    this.capabilities = {
      provider,
      supportedMediaTypes: ["image", "carousel", "video", "document", "archive", "other"],
      publicBaseUrl: "https://cdn.example.com/zuno",
    };
    this.fail = fail;
    this.hostCalls = [];
  }

  async host(input) {
    this.hostCalls.push(input);
    if (this.fail) {
      return {
        status: "failed",
        sourceUri: input.sourceUri,
        provider: this.capabilities.provider,
        error: { code: "UPLOAD_FAILED", message: `Falha simulada ao hospedar ${input.sourceUri}.`, retryable: true },
      };
    }
    return {
      status: "hosted",
      sourceUri: input.sourceUri,
      publicUrl: `https://cdn.example.com/zuno/${encodeURIComponent(input.sourceUri.replace(/\\/g, "/"))}`,
      provider: this.capabilities.provider,
      fileName: input.fileName,
      mimeType: input.mimeType,
      extension: input.extension,
      sizeBytes: input.sizeBytes,
      metadata: { fake: true, ...input.metadata },
    };
  }
}

class InMemoryAnaLogger {
  constructor() {
    this.entries = [];
  }

  async record(entry) {
    this.entries.push(entry);
  }

  list() {
    return [...this.entries];
  }
}

function createDeterministicIdGenerator() {
  let nextNumber = 1;
  return {
    create(prefix) {
      const id = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      return id;
    },
  };
}

function createJoaoStrategy(overrides = {}) {
  return { objective: "vender o pacote all-inclusive", channel: "instagram", recommendedCta: "Conheça o Rumo ao Altar", ...overrides };
}

function createSofiaDirection(overrides = {}) {
  return { visualConcept: "Ensaio editorial com casal real ao ar livre.", recommendedFormat: "carrossel", ...overrides };
}

function createMariaCopy(overrides = {}) {
  return {
    title: "Presentear ficou mais fácil",
    caption: "Um casamento all-inclusive sem estresse para os noivos.",
    cta: "Conheça o Rumo ao Altar",
    hashtags: ["#Casamento", "#Noivos"],
    ...overrides,
  };
}

function createPedroImages(overrides = {}) {
  return {
    imageCount: 3,
    images: [
      { uri: "https://cdn.example.com/assets/slide-1.png", mimeType: "image/png" },
      { uri: "https://cdn.example.com/assets/slide-2.png", mimeType: "image/png" },
      { uri: "https://cdn.example.com/assets/slide-3.png", mimeType: "image/png" },
    ],
    ...overrides,
  };
}

function createRafaVideo(overrides = {}) {
  return {
    generationMode: "developer_assisted",
    video: {
      id: "video-1",
      index: 0,
      fileName: "final-video.mp4",
      mimeType: "video/mp4",
      extension: "mp4",
      specs: {
        format: "mp4",
        width: 1080,
        height: 1920,
        resolution: "1080x1920",
        aspectRatio: "9:16",
        durationSeconds: 30,
        fps: 30,
        videoCodec: "H.264 (libx264)",
        audioCodec: "AAC",
      },
      sizeBytes: 150 * 1024,
      majorBrand: "isom",
      uri: "https://cdn.example.com/videos/final-video.mp4",
      relativePath: "videos/final-video.mp4",
      downloadHref: "videos/final-video.mp4",
      localPath: "C:\\tmp\\zuno\\artifacts\\exec-ana\\videos\\final-video.mp4",
      thumbnailUri: "https://cdn.example.com/videos/thumb.jpg",
    },
    ...overrides,
  };
}

function createLucasReview(overrides = {}) {
  return { reviewStatus: "approved", approvalRecommended: true, overallScore: 95, ...overrides };
}

function createHumanApproval(overrides = {}) {
  return { confirmed: true, approvedBy: "gestor@zuno.com", approvedAt: "2026-07-02T10:00:00.000Z", ...overrides };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Publicar o carrossel de lançamento do pacote all-inclusive no Instagram e Facebook.",
    joaoStrategy: createJoaoStrategy(),
    mariaCopy: createMariaCopy(),
    sofiaDirection: createSofiaDirection(),
    pedroImages: createPedroImages(),
    lucasReview: createLucasReview(),
    humanApproval: createHumanApproval(),
    channels: ["instagram", "facebook"],
    publishMode: "publish_now",
    ...overrides,
  };
}

function createVideoInput(overrides = {}) {
  return createInput({
    originalRequest: "Publicar o Reels de lançamento do Rumo ao Altar no Instagram e Facebook.",
    sofiaDirection: undefined,
    pedroImages: undefined,
    rafaVideo: createRafaVideo(),
    ...overrides,
  });
}

function createRequest(input = createInput()) {
  return {
    skillId: "ana-social-publishing",
    input,
    context: {
      executionId: "exec-ana",
      taskId: "task-publish",
      correlationId: "corr-ana",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createAna(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([createTenant()]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const socialPublisher = overrides.socialPublisher ?? new FakeSocialPublisher();
  const logger = overrides.logger ?? new InMemoryAnaLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const ana = new AnaSocialPublishingSkill({
    valentina,
    clara,
    socialPublisher,
    artifactHosting: overrides.artifactHosting,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });
  return { ana, valentina, clara, socialPublisher, logger, events };
}

test("Ana possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(anaSocialPublishingManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "ana-social-publishing");
  assert.deepEqual(result.manifest.capabilities, ["social_publishing"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
  assert.ok(result.manifest.dependencies.some((dependency) => dependency.name === "SocialPublisherPort" && dependency.optional === false));
  assert.ok(result.manifest.dependencies.some((dependency) => dependency.name === "ArtifactHostingPort" && dependency.optional === true));
  assert.ok(result.manifest.dependencies.every((dependency) => dependency.name !== "IcaroBrainPort"));
});

test("Ana consulta Valentina para resolver o cliente e verificar o recurso liberado no plano", async () => {
  const { ana, valentina } = createAna();

  await ana.execute(createRequest());

  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
  assert.ok(valentina.canUseSpecialistCalls.some((call) => call.tenantId === TENANT_ID && call.capability === "social_publishing"));
});

test("Ana consulta Clara apenas pelo módulo de regras de publicação", async () => {
  const { ana, clara } = createAna();

  await ana.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["PublishingContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
});

test("Ana usa SocialPublisherPort para solicitar publicação, um draft por canal", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(socialPublisher.publishCalls.length, 2);
  assert.deepEqual(socialPublisher.publishCalls.map((draft) => draft.channel).sort(), ["facebook", "instagram"]);
});

test("Publicação imediata (publish_now) marca todos os canais como publicados", async () => {
  const { ana } = createAna();

  const response = await ana.execute(createRequest());

  assert.equal(response.output.overallStatus, "published");
  assert.deepEqual(response.output.publishedChannels.sort(), ["facebook", "instagram"]);
  assert.equal(response.output.failedChannels.length, 0);
  assert.equal(response.output.externalIds.instagram, "ext-instagram");
  assert.equal(response.output.externalUrls.facebook, "https://social.example/facebook/post");
});

test("Agendamento (schedule) delega a SocialPublisherPort.schedule e nunca chama publish", async () => {
  const { ana, socialPublisher, logger, events } = createAna();

  const response = await ana.execute(createRequest(createInput({
    publishMode: "schedule",
    scheduledAt: "2026-07-03T15:00:00.000Z",
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "scheduled");
  assert.equal(socialPublisher.scheduleCalls.length, 2);
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.equal(response.output.scheduledAt, "2026-07-03T15:00:00.000Z");
  assert.ok(logger.list().some((entry) => entry.action === "PublicationScheduled"));
  assert.ok(events.list().some((event) => event.name === "SocialPublishingScheduled"));
});

test("Dry run simula a publicação sem chamar SocialPublisherPort", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ publishMode: "dry_run" })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "dry_run");
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.equal(socialPublisher.scheduleCalls.length, 0);
  assert.ok(response.output.results.every((result) => result.status === "dry_run"));
  assert.equal(response.output.payloadSentToPublisher.length, 2);
  assert.ok(response.output.observations.some((note) => note.includes("dry_run")));
});

test("Dry run continua funcionando com arquivo local sem exigir hospedagem pública", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createInput({
    publishMode: "dry_run",
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "dry_run");
  assert.equal(artifactHosting.hostCalls.length, 0);
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.deepEqual(response.output.payloadSentToPublisher[0].assetUris, ["images/local-slide.png"]);
});

test("LOCAL_PRODUCTION deixa o payload pronto localmente sem publicar nem acionar ArtifactHostingPort", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createInput({
    publishMode: "dry_run",
    workflowContext: {
      runtimeMode: "LOCAL_PRODUCTION",
      localProduction: true,
    },
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "local_ready");
  assert.ok(response.output.results.every((result) => result.status === "local_ready"));
  assert.equal(artifactHosting.hostCalls.length, 0);
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.equal(socialPublisher.scheduleCalls.length, 0);
  assert.ok(response.output.observations.some((note) => note.includes("LOCAL_PRODUCTION")));
  assert.deepEqual(response.output.payloadSentToPublisher[0].assetUris, ["images/local-slide.png"]);
});

test("Publicação real bloqueia arquivo local quando ArtifactHostingPort não está configurada", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "ARTIFACT_HOSTING_FAILED");
  assert.ok(response.warnings.some((warning) => warning.includes("ArtifactHostingPort não está configurada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Publicação real hospeda imagem local antes de chamar o publisher", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher, logger, events } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.mediaType, "image");
  assert.equal(artifactHosting.hostCalls.length, 1);
  assert.equal(socialPublisher.publishCalls.length, 2);
  assert.deepEqual(socialPublisher.publishCalls[0].assetUris, ["https://cdn.example.com/zuno/images%2Flocal-slide.png"]);
  assert.ok(socialPublisher.publishCalls[0].assetUris.every((uri) => uri.startsWith("https://")));
  assert.ok(logger.list().some((entry) => entry.action === "ArtifactHostingStarted"));
  assert.ok(logger.list().some((entry) => entry.action === "ArtifactHosted"));
  assert.ok(events.list().some((event) => event.name === "ArtifactHostingStarted"));
  assert.ok(events.list().some((event) => event.name === "ArtifactHostingFinished"));
});

test("Publicação real hospeda todas as imagens de carrossel antes do publisher", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      imageCount: 3,
      images: [
        { uri: "images/slide-1.png", mimeType: "image/png" },
        { uri: "images/slide-2.png", mimeType: "image/png" },
        { uri: "images/slide-3.png", mimeType: "image/png" },
      ],
    }),
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.mediaType, "carousel");
  assert.equal(artifactHosting.hostCalls.length, 3);
  assert.equal(socialPublisher.publishCalls[0].assetUris.length, 3);
  assert.ok(socialPublisher.publishCalls[0].assetUris.every((uri) => uri.startsWith("https://cdn.example.com/zuno/")));
});

test("Publicação real hospeda vídeo e thumbnail locais antes do publisher", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      video: {
        ...createRafaVideo().video,
        uri: "videos/final-video.mp4",
        thumbnailUri: "videos/thumb.jpg",
      },
    }),
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.mediaType, "video");
  assert.equal(artifactHosting.hostCalls.length, 2);
  assert.equal(socialPublisher.publishCalls[0].videoUri, "https://cdn.example.com/zuno/videos%2Ffinal-video.mp4");
  assert.equal(socialPublisher.publishCalls[0].thumbnailUri, "https://cdn.example.com/zuno/videos%2Fthumb.jpg");
  assert.ok(socialPublisher.publishCalls[0].assetUris.every((uri) => uri.startsWith("https://")));
});

test("Ana bloqueia publicação real quando o upload de artefato falha", async () => {
  const artifactHosting = new FakeArtifactHosting({ fail: true });
  const { ana, socialPublisher, events } = createAna({ artifactHosting });

  const response = await ana.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "ARTIFACT_HOSTING_FAILED");
  assert.ok(response.warnings.some((warning) => warning.includes("Falha simulada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.ok(events.list().some((event) => event.name === "ArtifactHostingFailed"));
});

test("Ana nunca envia file:// nem caminho local para provider real", async () => {
  const artifactHosting = new FakeArtifactHosting();
  const { ana, socialPublisher } = createAna({ artifactHosting });

  await ana.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      imageCount: 1,
      images: [{ uri: "images/local-slide.png", mimeType: "image/png" }],
    }),
  })));

  const sentUris = socialPublisher.publishCalls.flatMap((draft) => [...draft.assetUris, draft.videoUri, draft.thumbnailUri].filter(Boolean));
  assert.ok(sentUris.length > 0);
  assert.ok(sentUris.every((uri) => uri.startsWith("https://")));
  assert.ok(sentUris.every((uri) => !uri.startsWith("file://")));
  assert.ok(sentUris.every((uri) => !uri.includes("C:\\")));
});

test("Ana publica apenas no Instagram quando somente esse canal é solicitado", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ channels: ["instagram"] })));

  assert.equal(socialPublisher.publishCalls.length, 1);
  assert.equal(socialPublisher.publishCalls[0].channel, "instagram");
  assert.deepEqual(response.output.publishedChannels, ["instagram"]);
});

test("Ana publica apenas no Facebook quando somente esse canal é solicitado", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ channels: ["facebook"] })));

  assert.equal(socialPublisher.publishCalls.length, 1);
  assert.equal(socialPublisher.publishCalls[0].channel, "facebook");
  assert.deepEqual(response.output.publishedChannels, ["facebook"]);
});

test("Ana publica simultaneamente no Instagram e no Facebook", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ channels: ["instagram", "facebook"] })));

  assert.equal(socialPublisher.publishCalls.length, 2);
  assert.deepEqual(response.output.requestedChannels, ["instagram", "facebook"]);
  assert.deepEqual(response.output.publishedChannels.sort(), ["facebook", "instagram"]);
});

test("Ana publica imagem única corretamente no payload enviado ao publisher", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ pedroImages: createPedroImages({ imageCount: 1, images: [{ uri: "https://cdn.example.com/assets/unica.png", mimeType: "image/png" }] }) })));

  assert.equal(response.output.mediaType, "image");
  assert.equal(socialPublisher.publishCalls[0].mediaType, "image");
  assert.deepEqual(socialPublisher.publishCalls[0].assetUris, ["https://cdn.example.com/assets/unica.png"]);
});

test("Ana publica carrossel corretamente no payload enviado ao publisher", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest());

  assert.equal(response.output.mediaType, "carousel");
  assert.equal(socialPublisher.publishCalls[0].mediaType, "carousel");
  assert.equal(socialPublisher.publishCalls[0].assetUris.length, 3);
});

test("Ana faz dry_run de vídeo sem chamar SocialPublisherPort", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({ publishMode: "dry_run" })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "dry_run");
  assert.equal(response.output.mediaType, "video");
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.equal(socialPublisher.scheduleCalls.length, 0);
  assert.equal(response.output.payloadSentToPublisher.length, 2);
  assert.ok(response.output.payloadSentToPublisher.every((draft) => draft.mediaType === "video"));
  assert.ok(response.output.payloadSentToPublisher.every((draft) => draft.videoUri === "https://cdn.example.com/videos/final-video.mp4"));
});

test("Ana publica vídeo imediatamente quando Rafa, Lucas e aprovação humana estão válidos", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput()));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "published");
  assert.equal(response.output.mediaType, "video");
  assert.equal(socialPublisher.publishCalls.length, 2);
  assert.equal(socialPublisher.publishCalls[0].mediaType, "video");
  assert.equal(socialPublisher.publishCalls[0].videoUri, "https://cdn.example.com/videos/final-video.mp4");
  assert.equal(socialPublisher.publishCalls[0].thumbnailUri, "https://cdn.example.com/videos/thumb.jpg");
  assert.equal(socialPublisher.publishCalls[0].duration, 30);
  assert.equal(socialPublisher.publishCalls[0].mimeType, "video/mp4");
  assert.equal(socialPublisher.publishCalls[0].videoMetadata.fileName, "final-video.mp4");
  assert.equal(response.output.externalIds.instagram, "ext-instagram");
});

test("Ana agenda vídeo quando o provider suporta schedule", async () => {
  const { ana, socialPublisher, events } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({
    publishMode: "schedule",
    scheduledAt: "2026-07-03T15:00:00.000Z",
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.overallStatus, "scheduled");
  assert.equal(response.output.mediaType, "video");
  assert.equal(socialPublisher.scheduleCalls.length, 2);
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.ok(socialPublisher.scheduleCalls.every((draft) => draft.mediaType === "video"));
  assert.ok(events.list().some((event) => event.name === "SocialPublishingScheduled"));
});

test("Ana bloqueia vídeo quando o artefato do Rafa não informa arquivo utilizável", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ video: { ...createRafaVideo().video, uri: "", relativePath: "", downloadHref: "", localPath: "" } }),
  })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Nenhum vídeo válido do Rafa")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia vídeo com formato ou tamanho técnico inválido", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      video: {
        ...createRafaVideo().video,
        fileName: "final-video.mov",
        mimeType: "video/quicktime",
        extension: "mov",
        sizeBytes: 20 * 1024,
      },
    }),
  })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("mimeType")));
  assert.ok(response.warnings.some((reason) => reason.includes("extensão")));
  assert.ok(response.warnings.some((reason) => reason.includes("tamanho mínimo")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia vídeo quando Lucas não aprovou o pacote", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({
    lucasReview: createLucasReview({ approvalRecommended: false, reviewStatus: "needs_adjustments" }),
  })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Lucas não recomendou aprovação")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia vídeo quando aprovação humana não existe", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createVideoInput({ humanApproval: createHumanApproval({ confirmed: false }) })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Aprovação humana não foi confirmada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia vídeo quando o canal não permite vídeo pelas regras da Clara", async () => {
  const clara = new FakeClara(fullKnowledgeBase({
    connectedSocialNetworks: [
      { network: "instagram", status: "connected", supportedMediaTypes: ["image", "carousel"] },
      { network: "facebook", status: "connected", supportedMediaTypes: ["image", "carousel", "video"] },
    ],
  }));
  const { ana, socialPublisher } = createAna({ clara });

  const response = await ana.execute(createRequest(createVideoInput()));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Canal instagram não permite video")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia vídeo quando a integração do canal não está conectada", async () => {
  const tenant = createTenant({ integrations: { instagram: { network: "instagram", status: "connected" } } });
  const { ana, socialPublisher } = createAna({ valentina: new FakeValentina([tenant]) });

  const response = await ana.execute(createRequest(createVideoInput()));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Integração facebook não está conectada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana devolve erro quando o provider não suporta publicação de vídeo", async () => {
  const socialPublisher = new FakeSocialPublisher({
    supportedMediaTypes: {
      instagram: ["image", "carousel"],
      facebook: ["image", "carousel"],
    },
  });
  const { ana } = createAna({ socialPublisher });

  const response = await ana.execute(createRequest(createVideoInput()));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Provider de publicação não suporta video no canal instagram")));
  assert.ok(response.warnings.some((reason) => reason.includes("Provider de publicação não suporta video no canal facebook")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana monta payload correto de vídeo para Instagram", async () => {
  const { ana, socialPublisher } = createAna();

  await ana.execute(createRequest(createVideoInput({ channels: ["instagram"] })));

  assert.equal(socialPublisher.publishCalls.length, 1);
  assert.equal(socialPublisher.publishCalls[0].channel, "instagram");
  assert.equal(socialPublisher.publishCalls[0].mediaType, "video");
  assert.equal(socialPublisher.publishCalls[0].videoUri, "https://cdn.example.com/videos/final-video.mp4");
  assert.equal(socialPublisher.publishCalls[0].metadata.mediaType, "video");
});

test("Ana monta payload correto de vídeo para Facebook", async () => {
  const { ana, socialPublisher } = createAna();

  await ana.execute(createRequest(createVideoInput({ channels: ["facebook"] })));

  assert.equal(socialPublisher.publishCalls.length, 1);
  assert.equal(socialPublisher.publishCalls[0].channel, "facebook");
  assert.equal(socialPublisher.publishCalls[0].mediaType, "video");
  assert.equal(socialPublisher.publishCalls[0].videoUri, "https://cdn.example.com/videos/final-video.mp4");
  assert.equal(socialPublisher.publishCalls[0].metadata.mediaType, "video");
});

test("Ana bloqueia a publicação quando o cliente não existe, sem chamar SocialPublisherPort", async () => {
  const { ana, socialPublisher, events } = createAna({ valentina: new FakeValentina([]) });

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(response.warnings.some((reason) => reason.includes("Cliente não encontrado")));
  assert.equal(socialPublisher.publishCalls.length, 0);
  assert.ok(events.list().some((event) => event.name === "SocialPublishingValidationFailed"));
});

test("Ana bloqueia a publicação quando a integração do canal não está conectada", async () => {
  const tenant = createTenant({ integrations: { instagram: { network: "instagram", status: "connected" } } });
  const { ana, socialPublisher } = createAna({ valentina: new FakeValentina([tenant]) });

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Integração facebook não está conectada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando Lucas não recomendou aprovação", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ lucasReview: createLucasReview({ approvalRecommended: false, reviewStatus: "needs_adjustments" }) })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Lucas não recomendou aprovação")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando a aprovação humana não foi confirmada", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ humanApproval: createHumanApproval({ confirmed: false }) })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Aprovação humana não foi confirmada")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando o canal não está liberado no plano do cliente", async () => {
  const tenant = createTenant({ planLimits: { ...createTenant().planLimits, integrations: ["instagram"] } });
  const { ana, socialPublisher } = createAna({ valentina: new FakeValentina([tenant]) });

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Canal facebook não está liberado no plano")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando o recurso de publicação social não está liberado no plano", async () => {
  const { ana, socialPublisher } = createAna({ valentina: new FakeValentina([createTenant()], false) });

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Especialista de publicação social não está liberado")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando não há imagem válida", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ pedroImages: createPedroImages({ imageCount: 0, images: [] }) })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Nenhuma imagem válida")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação quando não há copy válida", async () => {
  const { ana, socialPublisher } = createAna();

  const response = await ana.execute(createRequest(createInput({ mariaCopy: createMariaCopy({ caption: "" }) })));

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Copy inválida")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana bloqueia a publicação por regra de publicação da Clara", async () => {
  const clara = new FakeClara(fullKnowledgeBase({
    connectedSocialNetworks: [
      { network: "instagram", status: "connected" },
      { network: "facebook", status: "disabled" },
    ],
  }));
  const { ana, socialPublisher } = createAna({ clara });

  const response = await ana.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.ok(response.warnings.some((reason) => reason.includes("Regra de publicação da Clara bloqueia o canal facebook")));
  assert.equal(socialPublisher.publishCalls.length, 0);
});

test("Ana devolve erro estruturado quando o provider não suporta agendamento, sem chamar schedule", async () => {
  const socialPublisher = new FakeSocialPublisher({ supportsScheduling: false });
  const { ana } = createAna({ socialPublisher });

  const response = await ana.execute(createRequest(createInput({ publishMode: "schedule", scheduledAt: "2026-07-03T15:00:00.000Z" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "SCHEDULING_NOT_SUPPORTED");
  assert.equal(socialPublisher.scheduleCalls.length, 0);
});

test("Ana marca overallStatus partially_published quando apenas parte dos canais publica com sucesso", async () => {
  const socialPublisher = new FakeSocialPublisher({
    responses: {
      facebook: { channel: "facebook", status: "failed", error: { code: "PUBLISH_FAILED", message: "Falha ao publicar no Facebook.", retryable: true } },
    },
  });
  const { ana } = createAna({ socialPublisher });

  const response = await ana.execute(createRequest());

  assert.equal(response.output.overallStatus, "partially_published");
  assert.deepEqual(response.output.publishedChannels, ["instagram"]);
  assert.deepEqual(response.output.failedChannels, ["facebook"]);
  assert.ok(response.output.nextSteps.some((step) => step.toLowerCase().includes("canais com erro")));
});

test("Ana registra log PublicationFailed quando o SocialPublisherPort lança exceção para um canal", async () => {
  const socialPublisher = new FakeSocialPublisher({
    responses: { facebook: new Error("Timeout ao conectar com o provider.") },
  });
  const { ana, logger } = createAna({ socialPublisher });

  const response = await ana.execute(createRequest());

  const failedResult = response.output.results.find((result) => result.channel === "facebook");
  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.error.code, "PUBLISH_EXCEPTION");
  assert.ok(logger.list().some((entry) => entry.action === "PublicationFailed" && entry.metadata.channel === "facebook"));
});

test("Ana marca overallStatus failed quando todos os canais falham na publicação", async () => {
  const socialPublisher = new FakeSocialPublisher({
    responses: {
      instagram: { channel: "instagram", status: "failed", error: { code: "PUBLISH_FAILED", message: "Falha no Instagram.", retryable: true } },
      facebook: { channel: "facebook", status: "failed", error: { code: "PUBLISH_FAILED", message: "Falha no Facebook.", retryable: true } },
    },
  });
  const { ana, logger, events } = createAna({ socialPublisher });

  const response = await ana.execute(createRequest());

  assert.equal(response.output.overallStatus, "failed");
  assert.deepEqual(response.output.publishedChannels, []);
  assert.ok(logger.list().some((entry) => entry.action === "PublicationFailed" && !entry.metadata.channel));
  assert.ok(events.list().some((event) => event.name === "SocialPublishingFailed" && event.payload.reason === "ALL_CHANNELS_FAILED"));
});

test("Ana registra os logs esperados em uma execução completa", async () => {
  const { ana, logger } = createAna();

  await ana.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("PublishingRulesConsulted"));
  assert.ok(actions.includes("ValidationStarted"));
  assert.ok(actions.includes("MediaValidated"));
  assert.ok(actions.includes("PublicationStarted"));
  assert.ok(actions.includes("PublicationCompleted"));
});

test("Ana emite os eventos esperados em uma publicação bem-sucedida", async () => {
  const { ana, events } = createAna();

  await ana.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), ["SocialPublishingStarted", "SocialPublishingContextLoaded", "SocialPublishingFinished"]);
  assert.equal(events.list()[0].payload.mediaType, "carousel");
});

test("Ana registra logs e eventos com mediaType video", async () => {
  const { ana, logger, events } = createAna();

  await ana.execute(createRequest(createVideoInput()));

  assert.ok(logger.list().some((entry) => entry.action === "MediaValidated" && entry.metadata.mediaType === "video"));
  assert.ok(logger.list().some((entry) => entry.action === "PublicationStarted" && entry.metadata.mediaType === "video"));
  assert.equal(events.list()[0].payload.mediaType, "video");
  assert.equal(events.list().at(-1).payload.overallStatus, "published");
});

test("Ana emite SocialPublishingValidationFailed quando uma regra obrigatória bloqueia a publicação", async () => {
  const { ana, events } = createAna();

  await ana.execute(createRequest(createInput({ humanApproval: createHumanApproval({ confirmed: false }) })));

  assert.deepEqual(events.list().map((event) => event.name), ["SocialPublishingStarted", "SocialPublishingContextLoaded", "SocialPublishingValidationFailed"]);
});

test("Ana não usa Inteligência Artificial", async () => {
  const source = await readFile("src/skills/ana-social-publishing/ana-social-publishing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("icaro"), false);
  assert.equal(lowered.includes("aitasktype"), false);
});

test("Ana não conversa com o Ícaro", async () => {
  const source = await readFile("src/skills/ana-social-publishing/ana-social-publishing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("icarobrainport"), false);
});

test("Ana não acessa storage diretamente", async () => {
  const source = await readFile("src/skills/ana-social-publishing/ana-social-publishing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Ana não importa a API da Meta diretamente; usa exclusivamente SocialPublisherPort", async () => {
  const source = await readFile("src/skills/ana-social-publishing/ana-social-publishing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("socialpublisherport"));
  assert.equal(lowered.includes("graph.facebook.com"), false);
  assert.equal(lowered.includes("facebook-business"), false);
  assert.equal(lowered.includes("instagram-graph"), false);
  assert.equal(lowered.includes("from \"meta"), false);
});

test("Ana não chama outra Skill diretamente: todo import relativo aponta apenas para application/domain ou para o próprio arquivo", async () => {
  const source = await readFile("src/skills/ana-social-publishing/ana-social-publishing.skill.ts", "utf8");
  const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    const isSameFolder = specifier.startsWith("./");
    const isApplicationOrDomain = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
    assert.ok(isSameFolder || isApplicationOrDomain, `Import inesperado que pode apontar para outra Skill: ${specifier}`);
  }
});
