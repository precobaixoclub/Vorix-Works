import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  RafaVideoRenderingSkill,
  buildFinalVideoPrompt,
  buildVideoSpecs,
  rafaVideoRenderingManifest,
} from "../dist/skills/rafa-video-rendering/index.js";

const CLIENT_ID = "client-casamento-1";
const TENANT_ID = "tenant-casamento-1";
const EXECUTION_ID = "exec-rafa";

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

function fullKnowledgeBase() {
  return {
    BrandContext: [
      claraRecord("BrandContext", {
        clientId: CLIENT_ID,
        brandName: "Rumo ao Altar",
        promise: "Casamentos organizados com leveza e sem burocracia.",
        toneOfVoice: "leve divertido persuasivo",
      }),
    ],
    IdentityContext: [
      claraRecord("IdentityContext", {
        clientId: CLIENT_ID,
        colors: ["#FFFFFF", "#D4AF37"],
        fonts: ["Playfair Display"],
        imageStyle: "editorial romântico",
        visualGuidelines: ["Usar tipografia serifada em peças de destaque."],
      }),
    ],
    PublishingContext: [
      claraRecord("PublishingContext", {
        clientId: CLIENT_ID,
        approvalFlow: "Aprovação obrigatória do time de marketing antes de publicar.",
      }),
    ],
  };
}

class FakeValentina {
  constructor(tenants = []) {
    this.tenants = tenants;
    this.getClientContextCalls = [];
    this.getTenantCalls = [];
  }

  async getClientContext(tenantId) {
    this.getClientContextCalls.push(tenantId);
    const tenant = this.tenants.find((candidate) => candidate.id === tenantId);
    if (!tenant) throw new Error(`Cliente ${tenantId} não encontrado pela Valentina.`);
    return toClientContext(tenant);
  }

  async getTenant(query) {
    this.getTenantCalls.push(query);
    return this.tenants.find((candidate) => candidate.clientId === query.clientId);
  }
}

function toClientContext(tenant) {
  return {
    tenantId: tenant.id,
    clientId: tenant.clientId,
    plan: tenant.plan ?? "PRO",
    status: "active",
    subscriptionStatus: "active",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    country: "BR",
    environment: "production",
    enabledSpecialists: "all",
    enabledFeatures: "all",
    planLimits: {},
  };
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
    return {
      clientId: request.clientId,
      deliveredAt: "2026-07-08T12:00:00.000Z",
      modules,
      records,
    };
  }
}

class FakeArtifactDelivery {
  constructor() {
    this.files = new Map();
    this.writeCalls = [];
    this.readCalls = [];
  }

  key(executionId, relativePath) {
    return `${executionId}:${relativePath}`;
  }

  seed(executionId, relativePath, bytes) {
    this.files.set(this.key(executionId, relativePath), bytes);
  }

  async writeFile(input) {
    this.writeCalls.push(input);
    const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    this.files.set(this.key(input.executionId, input.relativePath), new Uint8Array(bytes));
    return {
      absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
      relativePath: input.relativePath,
      sizeBytes: bytes.byteLength,
      mimeType: input.mimeType,
    };
  }

  async createZip() {
    throw new Error("Rafa não deveria chamar createZip.");
  }

  async readFile(input) {
    this.readCalls.push(input);
    const data = this.files.get(this.key(input.executionId, input.relativePath));
    if (!data) return undefined;
    return {
      absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
      relativePath: input.relativePath,
      sizeBytes: data.byteLength,
      data,
    };
  }
}

function createMinimalMp4(sizeBytes = 150 * 1024) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer.writeUInt32BE(sizeBytes, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return new Uint8Array(buffer);
}

function createTooSmallMp4() {
  const buffer = Buffer.alloc(500, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return new Uint8Array(buffer);
}

function createNonMp4Bytes(sizeBytes = 150 * 1024) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer.write("not-a-real-video-file-header", 0, "ascii");
  return new Uint8Array(buffer);
}

class InMemoryRafaLogger {
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
  return {
    overallStrategy: "Estratégia para instagram com foco em vender o pacote all-inclusive.",
    objective: "vender o pacote all-inclusive",
    targetAudience: "Noivos e convidados de casamento",
    channel: "instagram",
    format: "reels",
    toneOfVoice: "leve divertido persuasivo",
    angle: "Ângulo de conversão com benefício direto e chamada clara para ação.",
    centralPromise: "Receber presentes de casamento via Pix sem pagar taxa nenhuma.",
    valueProposition: "Lista de presentes via Pix sem taxas escondidas.",
    keyMessages: ["Taxa zero na lista de presentes.", "Dinheiro cai direto na conta dos noivos."],
    recommendedCta: "Crie sua lista agora no Rumo ao Altar",
    observations: [],
    risks: [],
    nextSteps: [],
    ...overrides,
  };
}

function createBrunoScript(overrides = {}) {
  return {
    status: "preliminary",
    narrativeStructure: "Gancho → Desenvolvimento → CTA: estrutura padrão de vídeo curto.",
    hook: "Capturar atenção nos primeiros 3 segundos com a promessa central.",
    totalDurationSeconds: 30,
    scenes: [
      {
        order: 1,
        name: "Gancho",
        startSeconds: 0,
        durationSeconds: 6,
        spokenText: "Você sabia que dá pra receber presente de casamento via Pix sem pagar taxa nenhuma?",
        onScreenText: "Taxa zero na lista de presentes",
        brollSuggestions: ["Plano de abertura de forte impacto visual."],
        framing: "Close-up no rosto, direto para a câmera",
        cameraMovement: "Estático ou leve handheld",
        rhythm: "acelerado",
        transitionToNext: "Corte seco para a cena seguinte",
        soundEffectSuggestions: ["Efeito de impacto sonoro."],
      },
      {
        order: 2,
        name: "CTA final",
        startSeconds: 24,
        durationSeconds: 6,
        spokenText: "Crie sua lista agora no Rumo ao Altar",
        onScreenText: "Crie sua lista agora no Rumo ao Altar",
        brollSuggestions: ["Plano de fechamento com marca em destaque."],
        framing: "Close-up, direto para a câmera",
        cameraMovement: "Estático",
        rhythm: "moderado",
        soundEffectSuggestions: ["Música sobe de volume para reforçar o CTA final."],
      },
    ],
    overallRhythm: "Ritmo acelerado no gancho e retomada no CTA final.",
    musicSuggestions: ["Trilha upbeat e descontraída, compatível com o tom leve e divertido da marca."],
    finalCta: "Crie sua lista agora no Rumo ao Altar",
    recordingNotes: ["Gravar em enquadramento vertical 9:16."],
    editingNotes: ["Inserir legendas embutidas em todas as cenas com fala."],
    channel: "instagram",
    notes: ["Este briefing cobre exclusivamente roteiro."],
    ...overrides,
  };
}

function createVanessaDirection(overrides = {}) {
  const humanSceneDesign = {
    mainElement: "Casal usando celular com o produto integrado.",
    secondaryElement: "Interface real como apoio visual.",
    backgroundPlane: "Ambiente de casamento desfocado.",
    foregroundPlane: "Mãos e celular em primeiro plano.",
    depth: "Camadas entre primeiro plano, produto e fundo.",
    lighting: "Luz natural suave.",
    atmosphere: "Premium e humana.",
    emotion: "tranquilidade",
    visualRhythm: "Entrada escalonada.",
    eyeFocus: "Do casal para a interface.",
    composition: "Regra dos terços.",
    productIntegration: "Mockup integrado ao dispositivo.",
    assetPriority: "person_using_product",
  };
  return {
    status: "preliminary",
    sceneDirections: [
      {
        order: 1,
        name: "Gancho",
        framing: "Close-up direto para a câmera, enquadramento centralizado.",
        visualComposition: "Regra dos terços com o rosto no terço superior do quadro.",
        cameraMovement: "Estático ou leve handheld para transmitir proximidade",
        transitionToNext: "Corte seco, sem efeito de transição, para preservar o impacto do gancho.",
        visualEffects: ["Leve punch-in (zoom digital sutil) no início da fala para reforçar o gancho."],
        visualAssetRequirement: {
          whatShouldAppear: "Casal usando celular com o site oficial integrado à cena.",
          emotion: "tranquilidade",
          imageType: "photo",
          framing: "plano médio",
          movement: "push-in",
          lighting: "luz natural",
          narrativeFunction: "gancho humano",
          tags: ["casamento", "casal", "celular", "site", "pessoa-usando-produto"],
          assetPriority: "person_using_product",
        },
        visualSceneDesign: humanSceneDesign,
      },
      {
        order: 2,
        name: "CTA final",
        framing: "Close-up direto para a câmera, retomando o enquadramento do gancho.",
        visualComposition: "Composição centralizada, com destaque de marca ou produto no quadro.",
        cameraMovement: "Estático, sem movimento, para dar peso à chamada final.",
        visualEffects: ["Destaque visual (highlight ou moldura sutil) sobre o texto do CTA."],
        visualAssetRequirement: {
          whatShouldAppear: "End card com logo oficial, URL e mockup do site.",
          emotion: "confiança",
          imageType: "graphic",
          framing: "end card",
          movement: "micro push-in",
          lighting: "gradiente da marca",
          narrativeFunction: "cta",
          tags: ["end-card", "logo-oficial", "mockup-produto", "cta"],
          assetPriority: "brand_end_card",
        },
        visualSceneDesign: { ...humanSceneDesign, assetPriority: "brand_end_card", mainElement: "Logo oficial e URL", productIntegration: "Logo oficial e mockup real, sem reconstruir marca." },
      },
    ],
    visualRhythm: "Ritmo visual acompanha o ritmo narrativo do roteiro.",
    captionStyle: "Legendas com fonte arredondada e peso bold, aparecendo palavra a palavra em sincronia com a fala.",
    soundDesignGuidance: ["Sincronizar efeitos sonoros exatamente nos pontos de corte."],
    musicDirection: "Trilha coerente com o tom de voz da marca, com entrada sutil no gancho.",
    brollGuidance: ["Capturar B-roll em pelo menos 1,5x a duração necessária de cada cena."],
    lightDirection: "Luz natural e suave, evitando sombras duras no rosto.",
    colorDirection: "Grade de cor com leve realce nas cores da marca.",
    recordingGuidance: ["Manter consistência de enquadramento entre todas as cenas."],
    editingGuidance: ["Sincronizar os cortes exatamente com os pontos de transição definidos por cena."],
    channel: "instagram",
    notes: ["Este briefing cobre exclusivamente direção audiovisual."],
    ...overrides,
  };
}

function createDiegoEditingPlan(overrides = {}) {
  const humanSceneDesign = {
    mainElement: "Casal usando celular com o produto integrado.",
    secondaryElement: "Interface real como apoio visual.",
    backgroundPlane: "Ambiente de casamento desfocado.",
    foregroundPlane: "Mãos e celular em primeiro plano.",
    depth: "Camadas entre primeiro plano, produto e fundo.",
    lighting: "Luz natural suave.",
    atmosphere: "Premium e humana.",
    emotion: "tranquilidade",
    visualRhythm: "Entrada escalonada.",
    eyeFocus: "Do casal para a interface.",
    composition: "Regra dos terços.",
    productIntegration: "Mockup integrado ao dispositivo.",
    assetPriority: "person_using_product",
  };
  return {
    status: "preliminary",
    editingTimeline: [
      {
        order: 1,
        name: "Gancho",
        startSeconds: 0,
        endSeconds: 6,
        durationSeconds: 6,
        captionText: "Você sabia que dá pra receber presente de casamento via Pix sem pagar taxa nenhuma?",
        onScreenText: "Taxa zero na lista de presentes",
        publicVisibleText: "Taxa zero na lista",
        publicSubtitle: "Presente direto aos noivos.",
        narrativeIntensity: "impacto",
        cutType: "Corte seco de entrada (0 frames), sem fade — a cena precisa começar com impacto imediato.",
        transitionToNext: "Corte seco, sem efeito de transição, para preservar o impacto do gancho.",
        visualEffects: ["Leve punch-in (zoom digital sutil) no início da fala para reforçar o gancho."],
        soundEffectSuggestions: ["Efeito de impacto sonoro."],
        visualAssetRequirement: {
          whatShouldAppear: "Casal usando celular com o site oficial integrado à cena.",
          emotion: "tranquilidade",
          imageType: "photo",
          framing: "plano médio",
          movement: "push-in",
          lighting: "luz natural",
          narrativeFunction: "gancho humano",
          tags: ["casamento", "casal", "celular", "site", "pessoa-usando-produto"],
          assetPriority: "person_using_product",
        },
        visualSceneDesign: humanSceneDesign,
      },
      {
        order: 2,
        name: "CTA final",
        startSeconds: 24,
        endSeconds: 30,
        durationSeconds: 6,
        captionText: "Crie sua lista agora no Rumo ao Altar",
        onScreenText: "Crie sua lista agora no Rumo ao Altar",
        publicVisibleText: "Conheça o Rumo ao Altar",
        publicSubtitle: "rumoaoaltar.com.br",
        narrativeIntensity: "cta",
        cutType: "Corte seco final, sem fade de saída — encerramento abrupto para reforçar a urgência do CTA.",
        visualEffects: ["Destaque visual (highlight ou moldura sutil) sobre o texto do CTA."],
        soundEffectSuggestions: ["Música sobe de volume para reforçar o CTA final."],
        visualAssetRequirement: {
          whatShouldAppear: "End card com logo oficial, URL e mockup do site.",
          emotion: "confiança",
          imageType: "graphic",
          framing: "end card",
          movement: "micro push-in",
          lighting: "gradiente da marca",
          narrativeFunction: "cta",
          tags: ["end-card", "logo-oficial", "mockup-produto", "cta"],
          assetPriority: "brand_end_card",
        },
        visualSceneDesign: { ...humanSceneDesign, assetPriority: "brand_end_card", mainElement: "Logo oficial e URL", productIntegration: "Logo oficial e mockup real, sem reconstruir marca." },
      },
    ],
    totalDurationSeconds: 30,
    musicTrackPlan: "Trilha upbeat, entrada sutil no gancho, fade-out nos últimos 2 segundos.",
    requiredAssets: ["Arquivo de trilha sonora.", "Logo da marca."],
    editingInstructions: ["Editar em proporção vertical 9:16.", "Sincronizar cortes com a narração."],
    technicalChecklist: ["Confirmar duração total de 30s.", "Confirmar legendas sincronizadas."],
    channel: "instagram",
    notes: ["Este briefing cobre exclusivamente o plano técnico de edição."],
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero renderizar o vídeo final do reels sobre taxa zero na lista de presentes.",
    joaoStrategy: createJoaoStrategy(),
    brunoScript: createBrunoScript(),
    vanessaDirection: createVanessaDirection(),
    diegoEditingPlan: createDiegoEditingPlan(),
    channel: "instagram",
    format: "reels",
    videoObjective: "gerar o vídeo final pronto para revisão",
    ...overrides,
  };
}

function createNoraNarration(overrides = {}) {
  return {
    narrationScript: "Seu casamento merece um lugar só dele. Tudo organizado em um site oficial.",
    voiceProfile: {
      language: "pt-BR",
      tone: "acolhedor elegante confiante",
      pace: 0.96,
    },
    segments: [
      {
        sceneId: "scene-01",
        sceneOrder: 1,
        startTime: 0,
        endTime: 6,
        estimatedDurationSeconds: 3,
        text: "Seu casamento merece um lugar só dele.",
        emotion: "curiosidade",
        emphasis: ["casamento", "lugar"],
        pauseAfterMs: 300,
      },
      {
        sceneId: "scene-02",
        sceneOrder: 2,
        startTime: 24,
        endTime: 30,
        estimatedDurationSeconds: 2,
        text: "Conheça o Rumo ao Altar.",
        emotion: "convite",
        emphasis: ["Rumo ao Altar"],
        pauseAfterMs: 300,
      },
    ],
    audio: {
      relativePath: "audio/narration.wav",
      absolutePath: "C:/audios/narration.wav",
      durationSeconds: 29,
      validation: { valid: true, clippingRisk: "low" },
    },
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "rafa-video-rendering",
    input,
    context: {
      executionId: EXECUTION_ID,
      taskId: "task-rendering",
      correlationId: "corr-rafa",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

class FakeVideoRendering {
  constructor() {
    this.resolveAssetsCalls = [];
    this.renderCalls = [];
    this.resolveAssetsImpl = async (input) => ({
      resolutions: input.candidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind, resolved: false, reason: "não configurado no fake" })),
    });
    this.renderImpl = async () => {
      throw new Error("renderImpl não configurado neste teste.");
    };
  }

  async resolveAssets(input) {
    this.resolveAssetsCalls.push(input);
    return this.resolveAssetsImpl(input);
  }

  async render(input) {
    this.renderCalls.push(input);
    return this.renderImpl(input);
  }
}

class FakeVisualAssetResolver {
  constructor(resultFactory) {
    this.calls = [];
    this.resultFactory = resultFactory;
  }

  async resolve(input) {
    this.calls.push(input);
    return typeof this.resultFactory === "function" ? this.resultFactory(input) : this.resultFactory;
  }
}

function createResolvedVisualAsset(sceneOrder, sceneName, absolutePath = `C:/assets/scene-${sceneOrder}.png`) {
  const query = {
    executionId: EXECUTION_ID,
    sceneOrder,
    sceneName,
    theme: sceneName,
    emotion: "confiança",
    narrativeFunction: "reforçar a mensagem",
    desiredKind: "photo",
    requiredTags: ["casamento", "rumo-ao-altar"],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
  };
  return {
    sceneOrder,
    sceneName,
    query,
    asset: {
      id: `asset-scene-${sceneOrder}`,
      provider: "local-visual-library",
      origin: "local_library",
      absolutePath,
      relativePath: `library/scene-${sceneOrder}.png`,
      author: "Equipe Zuno",
      sourceUrl: "local://assets/visual/library",
      license: {
        name: "Arquivo local do usuário",
        allowsCommercialUse: true,
        requiresAttribution: false,
      },
      downloadedAt: "2026-07-13T00:00:00.000Z",
      tags: ["casamento", "rumo-ao-altar", sceneOrder === 1 ? "presentes" : "cta"],
      theme: sceneName,
      emotion: "confiança",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      kind: "photo",
    },
    score: 95,
    scoreBreakdown: {
      theme: 95,
      sceneCompatibility: 95,
      emotion: 90,
      aspectRatio: 100,
      quality: 100,
      brandFit: 92,
      cropPotential: 100,
      consistency: 90,
    },
    selectedFrom: 2,
  };
}

function createPendingVisualAsset(sceneOrder = 1, sceneName = "Gancho") {
  return {
    sceneOrder,
    sceneName,
    expectedRelativePath: `visual-assets/scene-${String(sceneOrder).padStart(2, "0")}.png`,
    expectedAbsolutePath: `C:/fake/artifacts/${EXECUTION_ID}/visual-assets/scene-${String(sceneOrder).padStart(2, "0")}.png`,
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    prompt: `Crie uma imagem realista para ${sceneName}.`,
    tags: ["casamento", "rumo-ao-altar"],
    emotion: "confiança",
    narrativeFunction: "reforçar a mensagem",
    license: {
      name: "Gerado localmente pela IA desenvolvedora para uso do cliente",
      allowsCommercialUse: true,
      requiresAttribution: false,
    },
  };
}

function createRafa(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const artifactDelivery = "artifactDelivery" in overrides ? overrides.artifactDelivery : new FakeArtifactDelivery();
  const videoRendering = overrides.videoRendering;
  const visualAssetResolver = overrides.visualAssetResolver;
  const logger = overrides.logger ?? new InMemoryRafaLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const rafa = new RafaVideoRenderingSkill({
    valentina,
    clara,
    artifactDelivery,
    videoRendering,
    visualAssetResolver,
    assetQualityProfile: overrides.assetQualityProfile,
    artifactsRootDir: overrides.artifactsRootDir,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-09T12:00:00.000Z"),
  });
  return { rafa, valentina, clara, artifactDelivery, videoRendering, visualAssetResolver, logger, events };
}

test("Rafa possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(rafaVideoRenderingManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "rafa-video-rendering");
  assert.deepEqual(result.manifest.capabilities, ["video_rendering"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Rafa consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { rafa, valentina } = createRafa();

  await rafa.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await rafa.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Rafa consulta Clara com os módulos de marca, identidade visual e publicação", async () => {
  const { rafa, clara } = createRafa();

  await rafa.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["BrandContext", "IdentityContext", "PublishingContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Rafa pausa aguardando geração assistida quando o vídeo esperado ainda não existe", async () => {
  const { rafa, logger, events, artifactDelivery } = createRafa();

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(response.output.mode, "developer_assisted");
  assert.equal(response.output.pendingVideos.length, 1);
  assert.equal(response.output.pendingVideos[0].expectedRelativePath, "videos/final-video.mp4");
  assert.equal(response.output.pendingVideos[0].mimeType, "video/mp4");
  assert.equal(response.output.resumeCommand, `npm run zuno -- --continue ${EXECUTION_ID}`);
  assert.deepEqual(response.artifacts, []);
  assert.ok(logger.list().some((entry) => entry.action === "AssistedGenerationRequested"));
  assert.ok(events.list().some((event) => event.name === "VideoRenderingAwaitingAssistedInput"));
  assert.ok(artifactDelivery.readCalls.some((call) => call.relativePath === "videos/final-video.mp4" && call.executionId === EXECUTION_ID));
});

test("Rafa rejeita e mantém pendente um arquivo que não é um MP4 válido (assinatura incorreta)", async () => {
  const { rafa, artifactDelivery, logger } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createNonMp4Bytes());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(response.output.pendingVideos.length, 1);
  assert.ok(response.warnings.some((warning) => warning.includes("assinatura de arquivo")));
  assert.ok(logger.list().some((entry) => entry.action === "AssistedVideoValidationFailed"));
});

test("Rafa rejeita e mantém pendente um arquivo MP4 pequeno demais (placeholder)", async () => {
  const { rafa, artifactDelivery } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createTooSmallMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.ok(response.warnings.some((warning) => warning.includes("pequeno demais")));
});

test("Rafa aceita e registra o artefato de vídeo quando o arquivo real e válido existe", async () => {
  const { rafa, artifactDelivery, logger, events } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.artifacts.length, 1);
  assert.equal(response.artifacts[0].type, "video");
  assert.equal(response.artifacts[0].status, "ready");
  assert.equal(response.artifacts[0].file.extension, "mp4");
  assert.equal(response.artifacts[0].file.mimeType, "video/mp4");
  assert.equal(response.artifacts[0].dimensions.width, 1080);
  assert.equal(response.artifacts[0].dimensions.height, 1920);
  assert.equal(response.artifacts[0].dimensions.aspectRatio, "9:16");
  assert.equal(response.artifacts[0].generation.provider, "developer-assisted");
  assert.equal(response.artifacts[0].generation.model, "claude-code-developer-assisted");

  const output = response.output;
  assert.equal(output.generationMode, "developer_assisted");
  assert.equal(output.expectedRelativePath, "videos/final-video.mp4");
  assert.equal(output.specs.durationSeconds, 30);
  assert.equal(output.video.majorBrand, "isom");
  assert.ok(output.finalPrompt.length > 0);
  assert.ok(output.renderingInstructions.length > 0);
  assert.deepEqual(output.requiredAssets, createDiegoEditingPlan().requiredAssets);
  assert.ok(output.creativeDna);
  assert.ok(output.creativeDna.heroColorMood.length > 0);
  assert.ok(output.renderingInstructions.some((instruction) => instruction.includes(output.creativeDna.heroColorMood)));

  assert.ok(logger.list().some((entry) => entry.action === "AssistedVideoAccepted"));
  assert.ok(logger.list().some((entry) => entry.action === "ArtifactCreated"));
  assert.ok(events.list().some((event) => event.name === "VideoArtifactCreated"));
});

test("Rafa usa especificações técnicas fixas de vídeo vertical 9:16 (Reels/TikTok/Shorts)", async () => {
  const { rafa, artifactDelivery } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.output.specs.format, "mp4");
  assert.equal(response.output.specs.width, 1080);
  assert.equal(response.output.specs.height, 1920);
  assert.equal(response.output.specs.resolution, "1080x1920");
  assert.equal(response.output.specs.aspectRatio, "9:16");
  assert.equal(response.output.specs.fps, 30);
  assert.match(response.output.specs.videoCodec, /H\.264/);
  assert.match(response.output.specs.audioCodec, /AAC/);
});

test("Rafa monta o prompt final citando o plano de edição de Diego, a direção de Vanessa e o roteiro de Bruno", async () => {
  const { rafa } = createRafa();
  const specs = buildVideoSpecs(30);
  const prompt = buildFinalVideoPrompt(createInput(), specs, EXECUTION_ID);

  assert.ok(prompt.includes("artifacts/exec-rafa/videos/final-video.mp4"));
  assert.ok(prompt.includes("Diego"));
  assert.ok(prompt.includes("Vanessa"));
  assert.ok(prompt.includes("Corte seco de entrada"));
  assert.equal(rafa.manifest.capabilities[0], "video_rendering");
});

test("Rafa trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { rafa, logger, events } = createRafa({ valentina: new FakeValentina([]) });

  const response = await rafa.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "VideoRenderingFailed"));
});

test("Rafa trata contexto insuficiente na Clara como necessidade de mais contexto", async () => {
  const { rafa, logger, events } = createRafa({ clara: new FakeClara({}) });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "VideoRenderingFailed"));
});

test("Rafa valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { rafa, valentina, clara, logger, events } = createRafa();

  const response = await rafa.execute(createRequest(createInput({ videoObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "VideoRenderingFailed"));
});

test("Rafa rejeita diegoEditingPlan sem timeline", async () => {
  const { rafa } = createRafa();

  const response = await rafa.execute(createRequest(createInput({ diegoEditingPlan: createDiegoEditingPlan({ editingTimeline: [] }) })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("Rafa falha de forma estruturada quando ArtifactDeliveryPort não está configurada", async () => {
  const { rafa } = createRafa({ artifactDelivery: undefined });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY");
});

test("Rafa registra os logs esperados em uma execução completa", async () => {
  const { rafa, artifactDelivery, logger } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  await rafa.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("PromptBuilt"));
  assert.ok(actions.includes("RenderingStarted"));
  assert.ok(actions.includes("AssistedVideoAccepted"));
  assert.ok(actions.includes("ArtifactCreated"));
});

test("Rafa emite os eventos esperados em uma execução completa", async () => {
  const { rafa, artifactDelivery, events } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  await rafa.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "VideoRenderingStarted",
    "VideoRenderingContextLoaded",
    "VideoPromptBuilt",
    "VideoArtifactCreated",
  ]);
});

test("Rafa não usa Ícaro nesta primeira versão: não há provider real de vídeo nem chamada de IA para pixels/frames", async () => {
  const source = await readFile("src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("icarobrainport"), false);
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Rafa não chama Diego, Lucas, Ana (ou qualquer outra Skill) diretamente nem acessa o sistema de arquivos diretamente", async () => {
  const source = await readFile("src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("diego-video-editing"), false);
  assert.equal(lowered.includes("diegovideoeditingskill"), false);
  assert.equal(lowered.includes("creatediego"), false);
  assert.equal(lowered.includes("lucas-quality-review"), false);
  assert.equal(lowered.includes("ana-social-publishing"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
});

test("Rafa não publica vídeo nem chama API externa: nenhum uso de child_process, ffmpeg, fetch ou SDK de publicação", async () => {
  const source = await readFile("src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  // Checa padrões específicos de uso (não a substring "child_process" pura), porque comentários
  // explicativos legitimamente mencionam esses nomes ao dizer que NÃO são usados.
  assert.equal(lowered.includes('from "node:child_process"'), false);
  assert.equal(lowered.includes("from \"child_process\""), false);
  assert.equal(lowered.includes('require("child_process")'), false);
  assert.equal(lowered.includes("ffmpeg"), false);
  assert.equal(lowered.includes("spawn("), false);
  assert.equal(lowered.includes("execsync("), false);
  assert.equal(lowered.includes("fetch("), false);
  assert.equal(lowered.includes("socialpublisherport"), false);
});

test("Rafa não importa nenhum arquivo de src/infrastructure/, incluindo o novo adaptador de renderização local", async () => {
  const source = await readFile("src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("infrastructure/video-rendering"), false);
  assert.equal(lowered.includes("ffmpegvideorenderingadapter"), false);
  assert.equal(lowered.includes("ffmpeg-static"), false);
});

test("Rafa prefere renderização local automática quando o VideoRenderingPort está configurado, sem pausar em modo assistido", async () => {
  const videoRendering = new FakeVideoRendering();
  const { rafa, artifactDelivery, logger, events } = createRafa({ videoRendering });
  videoRendering.renderImpl = async (request) => {
    artifactDelivery.seed(EXECUTION_ID, request.outputRelativePath, createMinimalMp4());
    return {
      absolutePath: `/fake/artifacts/${EXECUTION_ID}/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      audioCodec: undefined,
      hasAudio: false,
      renderTimeMs: 1234,
      logsSummary: ["frame=100 fps=30"],
      warnings: [],
    };
  };

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.generationMode, "local_render");
  assert.equal(response.output.renderTimeMs, 1234);
  assert.deepEqual(response.output.renderLogsSummary, ["frame=100 fps=30"]);
  assert.equal(response.artifacts[0].generation.provider, "local-render");
  // Sem localAssets nem logoUri configurados nesta fixture, não há candidato algum a resolver.
  assert.equal(videoRendering.resolveAssetsCalls.length, 0);
  assert.equal(videoRendering.renderCalls.length, 1);
  assert.ok(logger.list().some((entry) => entry.action === "LocalRenderingCompleted"));
  assert.ok(events.list().some((event) => event.name === "VideoArtifactCreated"));
  assert.equal(logger.list().some((entry) => entry.action === "AssistedGenerationRequested"), false);
  assert.ok(response.output.warnings.some((warning) => warning.includes("Nenhuma logo registrada")));
});

test("Rafa traduz onScreenText/captionText da timeline de Diego em overlays headline/caption/cta no VideoRenderRequest", async () => {
  const videoRendering = new FakeVideoRendering();
  const { rafa, artifactDelivery } = createRafa({ videoRendering });
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    artifactDelivery.seed(EXECUTION_ID, request.outputRelativePath, createMinimalMp4());
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };

  await rafa.execute(createRequest());

  assert.ok(capturedRequest, "videoRendering.render deveria ter sido chamado");
  assert.equal(capturedRequest.scenes.length, 2);
  const [firstScene, lastScene] = capturedRequest.scenes;
  assert.ok(firstScene.overlays.some((overlay) => overlay.role === "headline" && overlay.text === "Taxa zero na lista"));
  assert.ok(lastScene.overlays.some((overlay) => overlay.role === "cta" && overlay.text === "Conheça o Rumo ao Altar"));
});

test("Rafa não renderiza campos internos mesmo quando chegam contaminando onScreenText/captionText", async () => {
  const videoRendering = new FakeVideoRendering();
  const { rafa, artifactDelivery } = createRafa({ videoRendering });
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    artifactDelivery.seed(EXECUTION_ID, request.outputRelativePath, createMinimalMp4());
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };

  const response = await rafa.execute(
    createRequest(
      createInput({
        diegoEditingPlan: createDiegoEditingPlan({
          editingTimeline: [
            {
              order: 1,
              name: "Gancho",
              startSeconds: 0,
              endSeconds: 6,
              durationSeconds: 6,
              captionText: "Desenvolver a mensagem-chave: site oficial",
              onScreenText: "Abertura de impacto conectada ao ângulo estratégico",
              publicVisibleText: "Seu site oficial.",
              publicSubtitle: "Tudo organizado.",
              cutType: "Corte seco",
              visualEffects: [],
              soundEffectSuggestions: [],
            },
            {
              order: 2,
              name: "CTA final",
              startSeconds: 6,
              endSeconds: 10,
              durationSeconds: 4,
              captionText: "technicalJustification interna",
              onScreenText: "Conheça o Rumo ao Altar",
              publicVisibleText: "Conheça o Rumo ao Altar.",
              publicSubtitle: "rumoaoaltar.com.br",
              cutType: "Corte seco",
              visualEffects: [],
              soundEffectSuggestions: [],
            },
          ],
          totalDurationSeconds: 10,
        }),
      }),
    ),
  );

  const renderedText = capturedRequest.scenes.flatMap((scene) => scene.overlays.map((overlay) => overlay.text)).join(" ");
  assert.equal(response.status, "completed");
  assert.match(renderedText, /Seu site oficial/);
  assert.match(renderedText, /rumoaoaltar\.com\.br/);
  assert.doesNotMatch(renderedText, /Desenvolver a mensagem-chave|Abertura de impacto|technicalJustification|ângulo/i);
});

test("Rafa cai para Developer Assisted Mode quando um asset local explicitamente pedido (localAssets) não existe", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.resolveAssetsImpl = async (input) => ({
    resolutions: input.candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      resolved: false,
      reason: `Arquivo não encontrado em "${candidate.path}".`,
    })),
  });
  const { rafa, logger } = createRafa({ videoRendering });

  const response = await rafa.execute(
    createRequest(createInput({ localAssets: { musicTrackPath: "C:/nao-existe/musica.mp3" } })),
  );

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(videoRendering.renderCalls.length, 0, "não deveria tentar renderizar quando falta um asset obrigatório");
  assert.ok(response.warnings.some((warning) => warning.includes("Asset obrigatório ausente") && warning.includes("localAssets.musicTrackPath")));
  assert.ok(logger.list().some((entry) => entry.action === "LocalRenderingSkipped"));
});

test("Rafa cai para Developer Assisted Mode quando a renderização local falha inesperadamente", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.renderImpl = async () => {
    throw new Error("FFmpeg terminou com código de saída 1.");
  };
  const { rafa, logger } = createRafa({ videoRendering });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.ok(response.warnings.some((warning) => warning.includes("Renderização local falhou")));
  assert.ok(logger.list().some((entry) => entry.action === "LocalRenderingFailed"));
});

test("Rafa usa a logo da Clara (IdentityContext.logoUri) quando resolvida pelo VideoRenderingPort", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.resolveAssetsImpl = async (input) => ({
    resolutions: input.candidates.map((candidate) =>
      candidate.id === "logo"
        ? { id: "logo", kind: "image", resolved: true, absolutePath: "C:/marca/logo.png", sizeBytes: 2048 }
        : { id: candidate.id, kind: candidate.kind, resolved: false, reason: "não usado neste teste" },
    ),
  });
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const clara = new FakeClara({
    ...fullKnowledgeBase(),
    IdentityContext: [
      claraRecord("IdentityContext", {
        clientId: CLIENT_ID,
        colors: ["#FFFFFF", "#D4AF37"],
        logoUri: "C:/marca/logo.png",
      }),
    ],
  });
  const { rafa, artifactDelivery } = createRafa({ videoRendering, clara });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(videoRendering.resolveAssetsCalls.length, 1);
  assert.ok(videoRendering.resolveAssetsCalls[0].candidates.some((candidate) => candidate.id === "logo" && candidate.path === "C:/marca/logo.png"));
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "logo" && asset.absolutePath === "C:/marca/logo.png"));
  assert.ok(
    capturedRequest.scenes[capturedRequest.scenes.length - 1].motion.elements.some(
      (element) => element.role === "logo" && element.assetId === "logo",
    ),
    "a última cena deveria compor a logo pelo Motion Composer",
  );
  assert.equal(response.output.warnings.some((warning) => warning.includes("Nenhuma logo registrada")), false);
});

test("Rafa aplica música local resolvida (localAssets.musicTrackPath) e preenche audioApplied/musicSource/musicFilename/audioCodec/audioDuration", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.resolveAssetsImpl = async (input) => ({
    resolutions: input.candidates.map((candidate) =>
      candidate.id === "music"
        ? { id: "music", kind: "audio", resolved: true, absolutePath: "C:/musicas/minha-musica.mp3", sizeBytes: 4096 }
        : { id: candidate.id, kind: candidate.kind, resolved: false, reason: "não usado neste teste" },
    ),
  });
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      audioCodec: "AAC",
      hasAudio: true,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(
    createRequest(createInput({ localAssets: { musicTrackPath: "C:/musicas/minha-musica.mp3" } })),
  );

  assert.equal(response.status, "completed");
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "music" && asset.absolutePath === "C:/musicas/minha-musica.mp3"));
  assert.ok(capturedRequest.audioTracks.some((track) => track.assetId === "music" && track.role === "music"));
  assert.equal(response.output.audioApplied, true);
  assert.equal(response.output.musicSource, "C:/musicas/minha-musica.mp3");
  assert.equal(response.output.musicFilename, "minha-musica.mp3");
  assert.equal(response.output.audioCodec, "AAC");
  assert.equal(response.output.audioDuration, response.output.specs.durationSeconds);
  assert.equal(response.output.warnings.some((warning) => warning.includes("Nenhuma música local informada")), false);
});

test("Rafa recebe narração da Nora e música separadamente, aplicando ducking da trilha durante a fala", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.resolveAssetsImpl = async (input) => ({
    resolutions: input.candidates.map((candidate) => {
      if (candidate.id === "music") return { id: "music", kind: "audio", resolved: true, absolutePath: "C:/musicas/trilha.mp3", sizeBytes: 4096 };
      if (candidate.id === "narration") return { id: "narration", kind: "audio", resolved: true, absolutePath: "C:/audios/narration.wav", sizeBytes: 48000 };
      return { id: candidate.id, kind: candidate.kind, resolved: false, reason: "não usado neste teste" };
    }),
  });
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      audioCodec: "AAC",
      hasAudio: true,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(
    createRequest(createInput({
      localAssets: { musicTrackPath: "C:/musicas/trilha.mp3" },
      noraNarration: createNoraNarration(),
    })),
  );

  assert.equal(response.status, "completed");
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "narration" && asset.absolutePath === "C:/audios/narration.wav"));
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "music" && asset.absolutePath === "C:/musicas/trilha.mp3"));
  assert.ok(capturedRequest.audioTracks.some((track) => track.assetId === "narration" && track.role === "narration" && track.volume === 1));
  const musicTrack = capturedRequest.audioTracks.find((track) => track.assetId === "music");
  assert.equal(musicTrack.role, "music");
  assert.ok(Array.isArray(musicTrack.duckWindows));
  assert.equal(musicTrack.duckWindows.length, 2);
  assert.equal(response.output.audioApplied, true);
  assert.equal(response.output.narrationApplied, true);
  assert.equal(response.output.musicDuckingApplied, true);
  assert.equal(response.output.video.narrationApplied, true);
  assert.equal(response.output.video.musicDuckingApplied, true);
});

test("Rafa registra aviso claro e audioApplied=false quando nenhuma música local é informada", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.renderImpl = async (request) => ({
    absolutePath: `/fake/${request.outputRelativePath}`,
    relativePath: request.outputRelativePath,
    sizeBytes: 150 * 1024,
    durationSeconds: request.totalDurationSeconds,
    width: request.width,
    height: request.height,
    aspectRatio: "9:16",
    fps: request.fps,
    videoCodec: "H.264 (libx264)",
    audioCodec: undefined,
    hasAudio: false,
    renderTimeMs: 10,
    logsSummary: [],
    warnings: [],
  });
  const { rafa, artifactDelivery } = createRafa({ videoRendering });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.audioApplied, false);
  assert.equal(response.output.musicSource, undefined);
  assert.equal(response.output.musicFilename, undefined);
  assert.equal(response.output.audioDuration, undefined);
  assert.ok(response.output.warnings.some((warning) => warning.includes("Nenhuma música local informada")));
});

test("Rafa resolve assets visuais por cena e usa imagens reais no VideoRenderRequest", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: ["assets visuais resolvidos no teste"],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(visualAssetResolver.calls.length, 1);
  assert.equal(visualAssetResolver.calls[0].scenes.length, 2);
  assert.ok(visualAssetResolver.calls[0].scenes[0].requiredTags.includes("casamento"));
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "visual-scene-1" && asset.absolutePath === "C:/assets/scene-1.png"));
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "visual-scene-2" && asset.absolutePath === "C:/assets/scene-2.png"));
  assert.deepEqual(capturedRequest.scenes.map((scene) => scene.background.type), ["gradient", "solid"]);
  assert.equal(capturedRequest.scenes[0].motion.elements.find((element) => element.role === "main_image").assetId, "visual-scene-1");
  assert.equal(capturedRequest.scenes[1].motion.elements.find((element) => element.role === "mockup").assetId, "visual-scene-2");
  assert.equal(response.output.visualAssets.length, 2);
  assert.equal(response.output.visualAssetReportPath, "visual-assets/asset-report.json");
  assert.equal(response.output.warnings.some((warning) => warning.includes("usou apenas texto/cores/logo")), false);
});

test("Rafa registra um asset de vídeo/b-roll/cinemagraph resolvido pelo VisualAssetResolver como kind: video no VideoRenderRequest, com a duração real da fonte, nunca como imagem estática", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => {
      const base = createResolvedVisualAsset(scene.sceneOrder, scene.sceneName);
      if (scene.sceneOrder !== 1) return base;
      return { ...base, asset: { ...base.asset, kind: "video", durationSeconds: 5.4, absolutePath: "C:/assets/scene-1.mp4" } };
    }),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  const videoAsset = capturedRequest.assets.find((asset) => asset.id === "visual-scene-1");
  assert.equal(videoAsset.kind, "video");
  assert.equal(videoAsset.sourceDurationSeconds, 5.4);
  assert.equal(videoAsset.absolutePath, "C:/assets/scene-1.mp4");
});

test("Rafa monta Motion Composer com elementos independentes, entradas escalonadas e métricas para Lucas", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed");
  const firstSceneElements = capturedRequest.scenes[0].motion.elements;
  const lastSceneElements = capturedRequest.scenes[capturedRequest.scenes.length - 1].motion.elements;
  assert.ok(firstSceneElements.some((element) => element.role === "main_image" && element.assetId === "visual-scene-1"));
  assert.ok(firstSceneElements.some((element) => element.role === "headline" && element.text.includes("Taxa zero")));
  assert.ok(lastSceneElements.some((element) => element.role === "cta" && element.text.includes("rumoaoaltar.com.br")));
  assert.ok(new Set(firstSceneElements.map((element) => element.startSeconds.toFixed(2))).size > 1, "elementos não deveriam entrar todos juntos");
  assert.ok(response.output.motionSummary.totalIndependentAnimations >= capturedRequest.scenes.length * 3);
  assert.ok(response.output.motionSummary.elementAnimations.length >= 3);
  assert.equal(response.output.motionSummary.maxStaticMockupSeconds, 0.6);
  assert.ok(response.output.motionSummary.assetRoles.includes("main_image"));
  assert.ok(response.output.motionSummary.assetRoles.includes("mockup"));
  assert.ok(response.output.motionSummary.averageDepthLayers >= 4);
  assert.equal(response.output.motionSummary.mockupOnlySceneRatio, 0.5);
  assert.deepEqual(response.output.video.motionSummary, response.output.motionSummary);
});

test("Rafa pede uma sequência visual com papéis narrativos (sequenceRoles) para cenas de desenvolvimento com duração suficiente, e um encerramento único para Gancho/CTA", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const withDevelopment = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        editingTimeline[0],
        {
          ...editingTimeline[0],
          order: 2,
          name: "Desenvolvimento 1",
          startSeconds: 6,
          endSeconds: 12,
          durationSeconds: 6,
        },
        { ...editingTimeline[1], order: 3 },
      ],
    }),
  }));

  const response = await rafa.execute(withDevelopment);

  assert.equal(response.status, "completed");
  const queriesByOrder = new Map(visualAssetResolver.calls[0].scenes.map((query) => [query.sceneOrder, query]));
  assert.deepEqual(queriesByOrder.get(1).sequenceRoles, ["establishing", "human_interaction"]);
  assert.equal(queriesByOrder.get(2).sequenceRoles.length, 2);
  assert.deepEqual(queriesByOrder.get(3).sequenceRoles, ["closing"]);
});

test("Rafa monta um elemento detail_image discreto a partir do segundo asset de uma sequência visual, sem competir em tamanho com a imagem principal", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.flatMap((scene) => {
      const primary = createResolvedVisualAsset(scene.sceneOrder, scene.sceneName);
      if (scene.sceneOrder !== 2) return [{ ...primary, sequenceIndex: 0 }];
      const secondary = createResolvedVisualAsset(scene.sceneOrder, `${scene.sceneName} detalhe`, "C:/assets/scene-2-detail.png");
      return [{ ...primary, sequenceIndex: 0 }, { ...secondary, asset: { ...secondary.asset, id: "asset-scene-2-detail" }, sequenceIndex: 1 }];
    }),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const withDevelopment = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        editingTimeline[0],
        {
          ...editingTimeline[0],
          order: 2,
          name: "Desenvolvimento 1",
          startSeconds: 6,
          endSeconds: 12,
          durationSeconds: 6,
        },
        { ...editingTimeline[1], order: 3 },
      ],
    }),
  }));

  const response = await rafa.execute(withDevelopment);

  assert.equal(response.status, "completed");
  assert.ok(capturedRequest.assets.some((asset) => asset.id === "visual-scene-2-detail-1" && asset.absolutePath === "C:/assets/scene-2-detail.png"));
  const developmentScene = capturedRequest.scenes.find((scene) => scene.order === 2);
  const detailElement = developmentScene.motion.elements.find((element) => element.role === "detail_image");
  assert.ok(detailElement, "cena de desenvolvimento com sequência de 2 assets deveria ter um elemento detail_image");
  assert.equal(detailElement.assetId, "visual-scene-2-detail-1");
  assert.ok(["mask_reveal", "blur_reveal"].includes(detailElement.entrance));
  // Nunca deve ocupar largura/altura explícitas maiores que a imagem principal (fica com o padrão
  // discreto do compilador quando x/y/width/height não são definidos aqui).
  assert.equal(detailElement.width, undefined);
  assert.equal(detailElement.height, undefined);

  // Cenas sem segundo asset da sequência (Gancho/CTA) nunca ganham detail_image.
  const hookScene = capturedRequest.scenes.find((scene) => scene.order === 1);
  assert.ok(!hookScene.motion.elements.some((element) => element.role === "detail_image"));
});

test("Rafa traduz mask/glow/blur da decisão de edição de Diego em entradas reais (mask_reveal/glow_pulse/blur_reveal), tanto para o visual quanto para o texto", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const developmentBase = {
    ...editingTimeline[0],
    startSeconds: 6,
    endSeconds: 12,
    durationSeconds: 6,
    visualAssetRequirement: { ...editingTimeline[0].visualAssetRequirement, assetPriority: undefined },
    visualSceneDesign: { ...editingTimeline[0].visualSceneDesign, assetPriority: undefined },
  };
  const withDevelopment = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        editingTimeline[0],
        { ...developmentBase, order: 2, name: "Desenvolvimento 1 (glow)", editingDecision: { glow: true, mask: false, blur: false, motionBlur: false } },
        { ...developmentBase, order: 3, name: "Desenvolvimento 2 (mask)", editingDecision: { glow: false, mask: true, blur: false, motionBlur: false } },
        { ...developmentBase, order: 4, name: "Desenvolvimento 3 (blur)", editingDecision: { glow: false, mask: false, blur: true, motionBlur: false } },
        { ...editingTimeline[1], order: 5 },
      ],
    }),
  }));

  const response = await rafa.execute(withDevelopment);
  assert.equal(response.status, "completed");

  const sceneByOrder = new Map(capturedRequest.scenes.map((scene) => [scene.order, scene]));
  const mockupEntranceFor = (order) => sceneByOrder.get(order).motion.elements.find((element) => element.role === "mockup").entrance;
  const headlineEntranceFor = (order) => sceneByOrder.get(order).motion.elements.find((element) => element.role === "headline").entrance;

  assert.equal(mockupEntranceFor(2), "glow_pulse");
  assert.equal(headlineEntranceFor(2), "glow_pulse");
  assert.equal(mockupEntranceFor(3), "mask_reveal");
  assert.equal(headlineEntranceFor(3), "mask_reveal");
  assert.equal(mockupEntranceFor(4), "blur_reveal");
  assert.equal(headlineEntranceFor(4), "blur_reveal");
});

test("Rafa traduz editingDecision.whip de Diego em uma entrada visual 'whip' real (snap-pan), não apenas na transição entre cenas", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const developmentBase = {
    ...editingTimeline[0],
    startSeconds: 6,
    endSeconds: 12,
    durationSeconds: 6,
    visualAssetRequirement: { ...editingTimeline[0].visualAssetRequirement, assetPriority: undefined },
    visualSceneDesign: { ...editingTimeline[0].visualSceneDesign, assetPriority: undefined },
  };
  const withDevelopment = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        editingTimeline[0],
        { ...developmentBase, order: 2, name: "Desenvolvimento 1 (whip)", editingDecision: { whip: true, glow: false, mask: false, blur: false, motionBlur: false } },
        { ...editingTimeline[1], order: 3 },
      ],
    }),
  }));

  const response = await rafa.execute(withDevelopment);
  assert.equal(response.status, "completed");

  const developmentScene = capturedRequest.scenes.find((scene) => scene.order === 2);
  const mockup = developmentScene.motion.elements.find((element) => element.role === "mockup");
  assert.equal(mockup.entrance, "whip");
});

test("Rafa nunca repete a mesma entrada visual em duas cenas de desenvolvimento consecutivas, mesmo quando a rotação por índice coincidiria", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const developmentBase = {
    ...editingTimeline[0],
    durationSeconds: 6,
    visualAssetRequirement: { ...editingTimeline[0].visualAssetRequirement, assetPriority: undefined },
    visualSceneDesign: { ...editingTimeline[0].visualSceneDesign, assetPriority: undefined },
  };
  // Dev1 (índice de timeline 1) força blur_reveal explicitamente via editingDecision.blur.
  // Dev2 (índice de timeline 2) não tem nenhuma decisão "rara" ativa — a rotação por índice
  // (index % 3) para o índice 2 naturalmente também cairia em "blur_reveal", que é exatamente a
  // colisão que a rede de segurança contra repetição precisa evitar.
  const withDevelopment = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        editingTimeline[0],
        { ...developmentBase, order: 2, name: "Desenvolvimento 1", startSeconds: 6, endSeconds: 12, editingDecision: { blur: true, glow: false, mask: false, motionBlur: false } },
        { ...developmentBase, order: 3, name: "Desenvolvimento 2", startSeconds: 12, endSeconds: 18, editingDecision: {} },
        { ...editingTimeline[1], order: 4 },
      ],
    }),
  }));

  const response = await rafa.execute(withDevelopment);
  assert.equal(response.status, "completed");

  const mockupEntranceFor = (order) => capturedRequest.scenes.find((scene) => scene.order === order).motion.elements.find((element) => element.role === "mockup").entrance;
  assert.equal(mockupEntranceFor(2), "blur_reveal");
  assert.notEqual(mockupEntranceFor(3), mockupEntranceFor(2), "Desenvolvimento 2 não deveria repetir a entrada visual de Desenvolvimento 1");
});

test("Rafa monta o end card mínimo e premium: logo, mockup centralizado com margem simétrica, uma linha memorável e CTA/URL, sem elemento de texto redundante", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene) => createResolvedVisualAsset(scene.sceneOrder, scene.sceneName)),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));
  let capturedRequest;
  videoRendering.renderImpl = async (request) => {
    capturedRequest = request;
    return {
      absolutePath: `/fake/${request.outputRelativePath}`,
      relativePath: request.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: request.totalDurationSeconds,
      width: request.width,
      height: request.height,
      aspectRatio: "9:16",
      fps: request.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  };
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());
  assert.equal(response.status, "completed");

  const lastScene = capturedRequest.scenes[capturedRequest.scenes.length - 1];
  const elements = lastScene.motion.elements;
  const mockup = elements.find((element) => element.role === "mockup");
  const headline = elements.find((element) => element.role === "headline");
  const subtitle = elements.find((element) => element.role === "caption" || element.role === "subtitle");
  const cta = elements.find((element) => element.role === "cta");

  assert.ok(mockup && headline && cta);
  // End card mínimo: nunca um elemento de texto extra repetindo o que o CTA já carrega (logo,
  // mockup, uma linha memorável, CTA/URL — nada mais).
  assert.equal(subtitle, undefined);
  // Mockup centralizado com margem simétrica (espaço negativo real dos dois lados).
  const canvasWidth = capturedRequest.width;
  const leftMargin = mockup.x;
  const rightMargin = canvasWidth - (mockup.x + mockup.width);
  assert.equal(leftMargin, rightMargin);
  // Ordem vertical sem sobreposição: mockup → headline → CTA.
  assert.ok(mockup.y + mockup.height <= headline.y);
  assert.ok(headline.y < cta.y);
  // Espaço negativo real ao final (CTA termina bem antes do fim do quadro 1920px).
  assert.ok(cta.y < capturedRequest.height - 250);
});

test("Rafa pausa quando o Asset Resolver não encontra imagem real adequada para uma cena", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver({
    resolved: [],
    pending: [createPendingVisualAsset(1, "Gancho")],
    warnings: ["Cena 1: nenhum asset adequado encontrado; criação assistida pendente."],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  const { rafa, logger, events } = createRafa({ videoRendering, visualAssetResolver });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(response.output.pendingVideos.length, 0);
  assert.equal(response.output.pendingVisualAssets.length, 1);
  assert.equal(response.output.pendingVisualAssets[0].expectedRelativePath, "visual-assets/scene-01.png");
  assert.equal(response.output.resumeCommand, `npm run zuno -- --continue ${EXECUTION_ID}`);
  assert.equal(videoRendering.renderCalls.length, 0, "não deve renderizar vídeo usando placeholder quando falta imagem real");
  assert.ok(response.warnings.some((warning) => warning.includes("nenhum asset adequado")));
  assert.ok(logger.list().some((entry) => entry.action === "AssistedGenerationRequested"));
  assert.ok(events.list().some((event) => event.name === "VideoRenderingAwaitingAssistedInput"));
});

// ---------------------------------------------------------------------------------------------
// ASSET DIVERSITY GATE
// ---------------------------------------------------------------------------------------------

function shotTimelineEntry(overrides = {}) {
  return {
    shotId: overrides.shotId ?? "s1-shot-1",
    shotOrder: overrides.shotOrder ?? 1,
    sceneOrder: overrides.sceneOrder ?? 1,
    purpose: overrides.purpose ?? "establishing",
    startSeconds: 0,
    endSeconds: 3,
    durationSeconds: 3,
    action: "casal se abraça",
    entranceTransition: "cut",
    exitTransition: "cut",
    continuityFromPreviousShot: "",
    syncNotes: "",
    photographyBrief: "",
    visualAssetRequirement: {
      whatShouldAppear: "casal recém-noivos",
      emotion: "tranquilidade",
      imageType: "photo",
      framing: "plano médio",
      movement: "push-in",
      lighting: "luz natural",
      narrativeFunction: "gancho humano",
      tags: ["casamento", "casal", "celular", "site"],
      forbiddenTags: [],
      sequenceRole: overrides.purpose ?? "establishing",
      preferredMediaKind: "photo",
    },
    ...overrides,
  };
}

test("Rafa ativa strict:true automaticamente para Shots humanos e de produto em qualquer perfil que não seja draft, e strict:false em draft", async () => {
  const visualAssetResolver = new FakeVisualAssetResolver((input) => ({
    resolved: input.scenes.map((scene, index) => ({
      sceneOrder: scene.sceneOrder,
      sceneName: scene.sceneName,
      query: scene,
      asset: {
        id: `asset-${index}`,
        provider: "local-test",
        origin: "local_library",
        absolutePath: `C:/lib/asset-${index}.png`,
        license: { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
        tags: ["casamento", "casal", "produto-real", "interface"],
        theme: scene.theme,
        emotion: "tranquilidade",
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        kind: "photo",
      },
      score: 90,
      scoreBreakdown: { theme: 90, sceneCompatibility: 90, emotion: 90, aspectRatio: 90, quality: 90, brandFit: 90, cropPotential: 90, consistency: 90, mediaPriority: 90 },
      selectedFrom: 1,
      shotId: scene.shotId,
      shotOrder: scene.shotOrder,
      shotPurpose: scene.shotPurpose,
    })),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  }));

  const editingTimeline = createDiegoEditingPlan().editingTimeline;
  const withShots = createRequest(createInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        {
          ...editingTimeline[0],
          shotTimeline: [
            shotTimelineEntry({ shotId: "s1-shot-1", shotOrder: 1, sceneOrder: 1, purpose: "human_interaction" }),
            shotTimelineEntry({ shotId: "s1-shot-2", shotOrder: 2, sceneOrder: 1, purpose: "product" }),
          ],
        },
        editingTimeline[1],
      ],
    }),
  }));

  // `videoRendering` só precisa existir (mesmo sem `renderImpl` funcional) — `attemptLocalRendering`
  // sai ANTES de chamar o resolver quando não há VideoRenderingPort configurada, e este teste só
  // precisa inspecionar as queries que chegaram ao resolver, não o resultado final da renderização.
  const { rafa: rafaPremium } = createRafa({ videoRendering: new FakeVideoRendering(), visualAssetResolver, assetQualityProfile: "premium" });
  await rafaPremium.execute(withShots);
  const premiumCall = visualAssetResolver.calls.at(-1);
  const humanShotPremium = premiumCall.scenes.find((scene) => scene.shotId === "s1-shot-1");
  const productShotPremium = premiumCall.scenes.find((scene) => scene.shotId === "s1-shot-2");
  assert.equal(humanShotPremium.humanRequirement?.strict, true);
  assert.equal(productShotPremium.productRequirement?.strict, true);

  const { rafa: rafaDraft } = createRafa({ videoRendering: new FakeVideoRendering(), visualAssetResolver, assetQualityProfile: "draft" });
  await rafaDraft.execute(withShots);
  const draftCall = visualAssetResolver.calls.at(-1);
  const humanShotDraft = draftCall.scenes.find((scene) => scene.shotId === "s1-shot-1");
  const productShotDraft = draftCall.scenes.find((scene) => scene.shotId === "s1-shot-2");
  assert.equal(humanShotDraft.humanRequirement?.strict, false);
  assert.equal(productShotDraft.productRequirement?.strict, false);
});

function syntheticDiversityResolved(count, { distinctFiles = 1, kind = "photo" } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const fileIndex = index % distinctFiles;
    return {
      sceneOrder: 1,
      sceneName: "Gancho",
      query: { executionId: EXECUTION_ID, sceneOrder: 1, sceneName: "Gancho", theme: "t", emotion: "e", narrativeFunction: "n", desiredKind: "photo", requiredTags: [], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16", shotId: `s1-shot-${index + 1}`, shotOrder: index + 1 },
      asset: {
        id: `asset-${fileIndex}`,
        provider: "local-test",
        origin: "local_library",
        absolutePath: `C:/lib/asset-${fileIndex}.png`,
        license: { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
        tags: ["casamento"],
        theme: "t",
        emotion: "e",
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        kind,
      },
      score: 90,
      scoreBreakdown: { theme: 90, sceneCompatibility: 90, emotion: 90, aspectRatio: 90, quality: 90, brandFit: 90, cropPotential: 90, consistency: 90, mediaPriority: 90 },
      selectedFrom: 1,
      shotId: `s1-shot-${index + 1}`,
      shotOrder: index + 1,
    };
  });
}

test("Rafa bloqueia a renderização em perfil premium quando o Asset Diversity Gate falha, mesmo com todo Shot resolvido pelo resolver (nenhum pending do resolver em si)", async () => {
  const videoRendering = new FakeVideoRendering();
  const visualAssetResolver = new FakeVisualAssetResolver({
    resolved: syntheticDiversityResolved(20, { distinctFiles: 5 }),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  const { rafa, events } = createRafa({ videoRendering, visualAssetResolver, assetQualityProfile: "premium" });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(videoRendering.renderCalls.length, 0, "premium nunca renderiza quando o Diversity Gate falha");
  assert.ok(response.output.pendingVisualAssets.length > 0);
  assert.ok(response.output.diversitySummary);
  assert.equal(response.output.diversitySummary.qualityProfile, "premium");
  assert.equal(response.output.diversitySummary.passed, false);
  assert.ok(response.output.diversitySummary.failures.length > 0);
  assert.ok(events.list().some((event) => event.name === "VideoRenderingAwaitingAssistedInput"));
});

function fakeSuccessfulRenderImpl() {
  return async (request) => ({
    absolutePath: `/fake/${request.outputRelativePath}`,
    relativePath: request.outputRelativePath,
    sizeBytes: 150 * 1024,
    durationSeconds: request.totalDurationSeconds,
    width: request.width,
    height: request.height,
    aspectRatio: "9:16",
    fps: request.fps,
    videoCodec: "H.264 (libx264)",
    hasAudio: false,
    renderTimeMs: 10,
    logsSummary: [],
    warnings: [],
  });
}

test("Rafa NÃO bloqueia em perfil standard quando o Asset Diversity Gate falha — apenas registra warning e segue para a renderização", async () => {
  const videoRendering = new FakeVideoRendering();
  videoRendering.renderImpl = fakeSuccessfulRenderImpl();
  const visualAssetResolver = new FakeVisualAssetResolver({
    resolved: syntheticDiversityResolved(15, { distinctFiles: 3 }),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  const { rafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver, assetQualityProfile: "standard" });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "completed", "standard nunca bloqueia por diversidade insuficiente");
  assert.equal(videoRendering.renderCalls.length, 1);
  assert.ok(response.warnings.some((warning) => warning.includes("Diversidade visual abaixo do ideal")));
});

test("Rafa retoma e renderiza normalmente (--continue) quando uma nova chamada ao Asset Resolver já reflete diversidade suficiente para o perfil premium", async () => {
  const videoRendering = new FakeVideoRendering();
  const blockedResolver = new FakeVisualAssetResolver({
    resolved: syntheticDiversityResolved(20, { distinctFiles: 5 }),
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  const { rafa: firstAttemptRafa } = createRafa({ videoRendering, visualAssetResolver: blockedResolver, assetQualityProfile: "premium" });
  const firstResponse = await firstAttemptRafa.execute(createRequest());
  assert.equal(firstResponse.status, "needs_assisted_generation");
  assert.equal(videoRendering.renderCalls.length, 0);

  // Simula o --continue: a IA desenvolvedora criou os assets pedidos, e uma nova resolução (novo
  // processo da CLI, mesmo executionId) já devolve diversidade suficiente para o perfil premium.
  const humanTags = ["casamento", "casal", "pessoa", "contexto-humano"];
  const productTags = ["casamento", "produto-real", "interface", "mockup"];
  const resolvedAfterFix = [
    ...Array.from({ length: 4 }, (_, i) => ({ ...syntheticDiversityResolved(1, { kind: "video" })[0], asset: { ...syntheticDiversityResolved(1, { kind: "video" })[0].asset, id: `video-${i}`, absolutePath: `C:/lib/video-${i}.mp4`, tags: humanTags }, shotId: `s1-shot-${i + 1}`, shotOrder: i + 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...syntheticDiversityResolved(1, { kind: "b_roll" })[0], asset: { ...syntheticDiversityResolved(1, { kind: "b_roll" })[0].asset, id: `broll-${i}`, absolutePath: `C:/lib/broll-${i}.mp4`, tags: productTags }, shotId: `s1-shot-${i + 5}`, shotOrder: i + 5 })),
    ...Array.from({ length: 12 }, (_, i) => ({ ...syntheticDiversityResolved(1, { kind: "photo" })[0], asset: { ...syntheticDiversityResolved(1, { kind: "photo" })[0].asset, id: `photo-${i}`, absolutePath: `C:/lib/photo-${i}.png`, tags: i < 3 ? humanTags : i < 6 ? productTags : i === 11 ? ["casamento", "cta", "logo", "marca", "url"] : ["casamento", "foto-contexto", "contexto-humano"] }, shotId: `s1-shot-${i + 9}`, shotOrder: i + 9, shotPurpose: i === 11 ? "closing" : undefined })),
  ];
  const fixedResolver = new FakeVisualAssetResolver({
    resolved: resolvedAfterFix,
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  videoRendering.renderImpl = fakeSuccessfulRenderImpl();
  const { rafa: resumedRafa, artifactDelivery } = createRafa({ videoRendering, visualAssetResolver: fixedResolver, assetQualityProfile: "premium" });
  artifactDelivery.seed(EXECUTION_ID, "videos/final-video.mp4", createMinimalMp4());

  const resumedResponse = await resumedRafa.execute(createRequest());

  assert.equal(resumedResponse.status, "completed");
  assert.equal(videoRendering.renderCalls.length, 1, "depois da correção, a renderização acontece normalmente");
});

test("Rafa bloqueia em perfil premium por Production Readiness insuficiente MESMO quando o Asset Diversity Gate antigo passa (enquadramento repetido em todo Shot consecutivo)", async () => {
  const videoRendering = new FakeVideoRendering();
  const humanTags = ["casamento", "casal", "pessoa", "contexto-humano"];
  const productTags = ["casamento", "produto-real", "interface", "mockup"];
  // 20 Shots, TODOS com arquivo físico distinto (o Asset Diversity Gate antigo passaria: 20
  // arquivos > mínimo de 12, uso 5% << 20%, 40% vídeo, contagens humano/produto/contexto/end-card
  // satisfeitas) — mas TODOS compartilham o mesmo enquadramento "close" dentro da mesma cena, o
  // que só o Production Readiness Gate (Scene Diversity) enxerga.
  const resolvedRepeatingFraming = [
    ...Array.from({ length: 4 }, (_, i) => ({ ...syntheticDiversityResolved(1, { kind: "video" })[0], asset: { ...syntheticDiversityResolved(1, { kind: "video" })[0].asset, id: `video-${i}`, absolutePath: `C:/lib/video-${i}.mp4`, tags: humanTags }, query: { ...syntheticDiversityResolved(1, { kind: "video" })[0].query, framing: "close", shotId: `s1-shot-${i + 1}`, shotOrder: i + 1 }, shotId: `s1-shot-${i + 1}`, shotOrder: i + 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...syntheticDiversityResolved(1, { kind: "b_roll" })[0], asset: { ...syntheticDiversityResolved(1, { kind: "b_roll" })[0].asset, id: `broll-${i}`, absolutePath: `C:/lib/broll-${i}.mp4`, tags: productTags }, query: { ...syntheticDiversityResolved(1, { kind: "b_roll" })[0].query, framing: "close", shotId: `s1-shot-${i + 5}`, shotOrder: i + 5 }, shotId: `s1-shot-${i + 5}`, shotOrder: i + 5 })),
    ...Array.from({ length: 12 }, (_, i) => ({
      ...syntheticDiversityResolved(1, { kind: "photo" })[0],
      asset: { ...syntheticDiversityResolved(1, { kind: "photo" })[0].asset, id: `photo-${i}`, absolutePath: `C:/lib/photo-${i}.png`, tags: i < 3 ? humanTags : i < 6 ? productTags : i === 11 ? ["casamento", "cta", "logo", "marca", "url"] : ["casamento", "foto-contexto", "contexto-humano"] },
      query: { ...syntheticDiversityResolved(1, { kind: "photo" })[0].query, framing: "close", shotId: `s1-shot-${i + 9}`, shotOrder: i + 9 },
      shotId: `s1-shot-${i + 9}`,
      shotOrder: i + 9,
      shotPurpose: i === 11 ? "closing" : undefined,
    })),
  ];
  const visualAssetResolver = new FakeVisualAssetResolver({
    resolved: resolvedRepeatingFraming,
    pending: [],
    warnings: [],
    reportRelativePath: "visual-assets/asset-report.json",
  });
  const { rafa } = createRafa({ videoRendering, visualAssetResolver, assetQualityProfile: "premium" });

  const response = await rafa.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(videoRendering.renderCalls.length, 0, "premium nunca renderiza quando o Production Readiness Gate bloqueia");
  assert.ok(response.output.productionReadinessScore, "saída bloqueada deve incluir a nota de Production Readiness");
  assert.equal(response.output.productionReadinessScore.meetsMinimum, false);
  assert.ok(response.output.productionPlan, "saída bloqueada deve incluir o Production Plan");
  assert.equal(response.output.productionPlan.shotsCount, 20);
  assert.ok(response.output.instruction.includes("Campanha exige"), "instrução deve incluir a explicação de bloqueio no formato de produtor executivo");
});

test("buildVideoSpecs resolve 4:5 (feed) e 1:1 (quadrado) além do padrão 9:16, via a autoridade única de aspect ratio", () => {
  const feedSpecs = buildVideoSpecs(15, "instagram", "post unico");
  assert.equal(feedSpecs.aspectRatio, "4:5");
  assert.equal(feedSpecs.width, 1080);
  assert.equal(feedSpecs.height, 1350);

  const squareSpecs = buildVideoSpecs(15, "instagram", "feed quadrado");
  assert.equal(squareSpecs.aspectRatio, "1:1");
  assert.equal(squareSpecs.width, 1080);
  assert.equal(squareSpecs.height, 1080);

  const reelsSpecs = buildVideoSpecs(15, "instagram", "reels");
  assert.equal(reelsSpecs.aspectRatio, "9:16");
  assert.equal(reelsSpecs.width, 1080);
  assert.equal(reelsSpecs.height, 1920);
});
