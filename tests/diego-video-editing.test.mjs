import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import { planShotsForScene } from "../dist/shared/utils/cinematic-reference-library.js";
import {
  DiegoVideoEditingSkill,
  buildBaselineEditingPlan,
  buildRafaBriefing,
  diegoVideoEditingManifest,
} from "../dist/skills/diego-video-editing/index.js";

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
    AudienceContext: [
      claraRecord("AudienceContext", {
        clientId: CLIENT_ID,
        targetAudience: "Noivos e convidados de casamento",
      }),
    ],
    ContentContext: [
      claraRecord("ContentContext", {
        clientId: CLIENT_ID,
        publicationHistory: [
          { publicationId: "pub-1", channel: "instagram", publishedAt: "2026-06-01T00:00:00.000Z" },
        ],
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

class FakeIcaroBrain {
  constructor(responses) {
    this.responses = [...responses];
    this.calls = [];
  }

  async request(request) {
    this.calls.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return {
      status: "completed",
      provider: { id: "fake-ai-provider", name: "Fake AI Provider" },
      model: { id: "fake-editing-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 80, total: request.prompt.length + 80 },
      cost: { estimated: 0.01, currency: "USD" },
      content: next ?? enhancementJson(),
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: "fake-ai-provider" },
      fallbackUsed: false,
    };
  }
}

function enhancementJson() {
  return JSON.stringify({
    musicTrackPlan: "Trilha eletrônica com fade-in de 2s, mantida em -14dB durante a narração, subindo para -6dB no CTA.",
    requiredAssets: ["Arquivo de trilha em WAV 48kHz.", "Fonte da marca em formato OTF."],
    editingInstructions: ["Exportar em H.264, bitrate mínimo de 10Mbps."],
    technicalChecklist: ["Confirmar loudness normalizado a -14 LUFS."],
  });
}

class InMemoryDiegoLogger {
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

function createBrunoScene(overrides = {}) {
  const scene = {
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
    pauseNotes: "Sem pausas.",
    transitionToNext: "Corte seco para a cena seguinte",
    soundEffectSuggestions: ["Efeito de impacto sonoro."],
    ...overrides,
  };
  const role = scene.name === "Gancho" ? "hook" : scene.name === "CTA final" ? "cta" : "development";
  const plan = planShotsForScene({
    sceneOrder: scene.order,
    sceneName: scene.name,
    sceneRole: role,
    sceneRhythm: scene.rhythm,
    sceneStartSeconds: scene.startSeconds,
    sceneDurationSeconds: scene.durationSeconds,
    sceneAction: scene.spokenText,
    beatIndex: 0,
    featureFocus: scene.featureFocus,
  });
  return { ...scene, shots: plan.shots };
}

function buildShotDirectionsFor(scene) {
  return scene.shots.map((shot) => ({
    shotId: shot.id,
    shotOrder: shot.order,
    purpose: shot.purpose,
    framing: `${shot.cinematography.shotType} — ${shot.assetRequirement.framing}`,
    lighting: shot.cinematography.lighting,
    composition: shot.cinematography.composition,
    cameraMovement: `${shot.cinematography.cameraMovement} — ${shot.motion.action}`,
    eyeFocus: shot.cinematography.gazeDirection,
    visualAssetRequirement: {
      whatShouldAppear: shot.assetRequirement.whatShouldAppear,
      emotion: shot.assetRequirement.emotion,
      imageType: "photo",
      framing: shot.assetRequirement.framing,
      movement: shot.assetRequirement.movement,
      lighting: shot.assetRequirement.lighting,
      narrativeFunction: shot.assetRequirement.narrativeFunction,
      tags: shot.assetRequirement.tags,
      forbiddenTags: shot.assetRequirement.forbiddenTags,
      sequenceRole: shot.assetRequirement.sequenceRole,
      preferredMediaKind: shot.assetRequirement.preferredMediaKind,
    },
    transitionToNextShot: shot.transitionToNext,
    continuityFromPreviousShot: shot.continuityFromPrevious,
  }));
}

function createBrunoScript(overrides = {}) {
  return {
    status: "preliminary",
    narrativeStructure: "Gancho → Desenvolvimento → CTA: estrutura padrão de vídeo curto.",
    hook: "Capturar atenção nos primeiros 3 segundos com a promessa central.",
    totalDurationSeconds: 30,
    scenes: [
      createBrunoScene({ order: 1, name: "Gancho", startSeconds: 0 }),
      createBrunoScene({
        order: 2,
        name: "Desenvolvimento 1",
        startSeconds: 6,
        durationSeconds: 18,
        spokenText: "Convidados presenteiam por Pix direto para os noivos.",
        onScreenText: "Convidados presenteiam por Pix direto",
        framing: "Plano médio, ambiente relacionado ao produto ou serviço",
        cameraMovement: "Movimento suave (pan ou leve zoom)",
        rhythm: "moderado",
        pauseNotes: undefined,
        transitionToNext: "Corte dinâmico acompanhando o ritmo da narração",
        soundEffectSuggestions: [],
      }),
      createBrunoScene({
        order: 3,
        name: "CTA final",
        startSeconds: 24,
        durationSeconds: 6,
        spokenText: "Crie sua lista agora no Rumo ao Altar",
        onScreenText: "Crie sua lista agora no Rumo ao Altar",
        framing: "Close-up, direto para a câmera",
        cameraMovement: "Estático",
        rhythm: "moderado",
        pauseNotes: undefined,
        transitionToNext: undefined,
        soundEffectSuggestions: ["Música sobe de volume para reforçar o CTA final."],
      }),
    ],
    overallRhythm: "Ritmo acelerado no gancho, moderado no desenvolvimento e retomada no CTA final.",
    musicSuggestions: ["Trilha upbeat e descontraída, compatível com o tom leve e divertido da marca."],
    finalCta: "Crie sua lista agora no Rumo ao Altar",
    recordingNotes: ["Gravar em enquadramento vertical 9:16."],
    editingNotes: ["Inserir legendas embutidas em todas as cenas com fala."],
    channel: "instagram",
    notes: ["Este briefing cobre exclusivamente roteiro."],
    ...overrides,
  };
}

function createVanessaSceneDirection(overrides = {}) {
  const base = {
    order: 1,
    name: "Gancho",
    framing: "Close-up direto para a câmera, enquadramento centralizado.",
    visualComposition: "Regra dos terços com o rosto no terço superior do quadro.",
    cameraMovement: "Estático ou leve handheld para transmitir proximidade",
    transitionToNext: "Corte seco, sem efeito de transição, para preservar o impacto do gancho.",
    visualEffects: ["Leve punch-in (zoom digital sutil) no início da fala para reforçar o gancho."],
    visualAssetRequirement: {
      whatShouldAppear: "Casal usando o produto em celular.",
      emotion: "tranquilidade",
      imageType: "photo",
      framing: "plano médio",
      movement: "push-in",
      lighting: "luz natural",
      narrativeFunction: "gancho humano",
      tags: ["casamento", "casal", "celular", "pessoa-usando-produto"],
      assetPriority: "person_using_product",
    },
    visualSceneDesign: {
      mainElement: "Casal usando celular com produto integrado.",
      secondaryElement: "Interface real como apoio.",
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
    },
    ...overrides,
  };
  // AGENCY FILM PIPELINE 2.0 — cada VanessaSceneDirection precisa ter shotDirections mirror do
  // que a Vanessa produziria por Shot. Aqui geramos uma direção default para os Shots do
  // planner determinístico, casando 1:1 com o que Bruno criaria para essa cena.
  const role = base.name === "Gancho" ? "hook" : base.name === "CTA final" ? "cta" : "development";
  const plan = planShotsForScene({
    sceneOrder: base.order,
    sceneName: base.name,
    sceneRole: role,
    sceneRhythm: role === "hook" ? "acelerado" : "moderado",
    sceneStartSeconds: 0,
    sceneDurationSeconds: 6,
    sceneAction: "cena teste",
    beatIndex: 0,
  });
  const shotDirections = plan.shots.map((shot) => ({
    shotId: shot.id,
    shotOrder: shot.order,
    purpose: shot.purpose,
    framing: `${shot.cinematography.shotType} — ${shot.assetRequirement.framing}`,
    lighting: shot.cinematography.lighting,
    composition: shot.cinematography.composition,
    cameraMovement: `${shot.cinematography.cameraMovement} — ${shot.motion.action}`,
    eyeFocus: shot.cinematography.gazeDirection,
    visualAssetRequirement: {
      whatShouldAppear: shot.assetRequirement.whatShouldAppear,
      emotion: shot.assetRequirement.emotion,
      imageType: "photo",
      framing: shot.assetRequirement.framing,
      movement: shot.assetRequirement.movement,
      lighting: shot.assetRequirement.lighting,
      narrativeFunction: shot.assetRequirement.narrativeFunction,
      tags: shot.assetRequirement.tags,
      forbiddenTags: shot.assetRequirement.forbiddenTags,
      sequenceRole: shot.assetRequirement.sequenceRole,
      preferredMediaKind: shot.assetRequirement.preferredMediaKind,
    },
    transitionToNextShot: shot.transitionToNext,
    continuityFromPreviousShot: shot.continuityFromPrevious,
  }));
  return { ...base, shotDirections: overrides.shotDirections ?? shotDirections };
}

function createVanessaDirection(overrides = {}) {
  return {
    status: "preliminary",
    sceneDirections: [
      createVanessaSceneDirection({ order: 1, name: "Gancho" }),
      createVanessaSceneDirection({
        order: 2,
        name: "Desenvolvimento 1",
        framing: "Plano médio, enquadramento estável.",
        visualComposition: "Composição equilibrada com o sujeito levemente descentralizado.",
        cameraMovement: "Movimento suave (pan ou leve zoom) para manter dinamismo sem distrair",
        transitionToNext: "Corte dinâmico sincronizado com o ritmo da narração.",
        visualEffects: ["Inserção de B-roll com corte rápido para ilustrar a mensagem-chave da cena."],
      }),
      createVanessaSceneDirection({
        order: 3,
        name: "CTA final",
        framing: "Close-up direto para a câmera, retomando o enquadramento do gancho.",
        visualComposition: "Composição centralizada, com destaque de marca ou produto no quadro.",
        cameraMovement: "Estático, sem movimento, para dar peso à chamada final.",
        transitionToNext: undefined,
        visualEffects: ["Destaque visual (highlight ou moldura sutil) sobre o texto do CTA."],
      }),
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

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um plano de edição para o reels sobre taxa zero na lista de presentes.",
    joaoStrategy: createJoaoStrategy(),
    brunoScript: createBrunoScript(),
    vanessaDirection: createVanessaDirection(),
    channel: "instagram",
    format: "reels",
    videoObjective: "explicar que a lista de presentes via Pix não cobra taxa",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "diego-video-editing",
    input,
    context: {
      executionId: "exec-diego",
      taskId: "task-editing",
      correlationId: "corr-diego",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createDiego(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryDiegoLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const diego = new DiegoVideoEditingSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-08T12:00:00.000Z"),
  });
  return { diego, valentina, clara, logger, events };
}

test("Diego possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(diegoVideoEditingManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "diego-video-editing");
  assert.deepEqual(result.manifest.capabilities, ["video_editing"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Diego consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { diego, valentina } = createDiego();

  await diego.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await diego.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Diego consulta Clara com os módulos de identidade visual, marca, público, conteúdo e publicação", async () => {
  const { diego, clara } = createDiego();

  await diego.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, [
    "BrandContext",
    "AudienceContext",
    "ContentContext",
    "IdentityContext",
    "PublishingContext",
  ]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Diego funciona sem Ícaro configurado e ainda gera plano de edição estruturado", async () => {
  const { diego, logger } = createDiego();

  const response = await diego.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Diego usa Ícaro de forma opcional para aprimorar o plano de edição quando disponível", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { diego, logger, events } = createDiego({ icaro });

  const response = await diego.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "diego-video-editing");
  assert.match(response.output.musicTrackPlan, /Trilha eletrônica com fade-in de 2s/);
  assert.deepEqual(response.output.requiredAssets, ["Arquivo de trilha em WAV 48kHz.", "Fonte da marca em formato OTF."]);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Diego segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { diego, logger } = createDiego({ icaro });

  const response = await diego.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("Diego nunca deixa o Ícaro redefinir a timeline: editingTimeline permanece o construído por heurística mesmo com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { diego } = createDiego({ icaro });

  const response = await diego.execute(createRequest());

  assert.ok(Array.isArray(response.output.editingTimeline));
  assert.equal(response.output.editingTimeline.length, 3);
  assert.equal(response.output.editingTimeline[0].name, "Gancho");
  assert.equal(response.output.editingTimeline[response.output.editingTimeline.length - 1].name, "CTA final");
});

test("Diego gera uma DiegoTimelineEntry por cena, combinando timing/texto de Bruno com transição/efeitos de Vanessa", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  const timeline = response.output.editingTimeline;
  assert.equal(timeline.length, 3);

  const hookEntry = timeline.find((entry) => entry.name === "Gancho");
  assert.equal(hookEntry.startSeconds, 0);
  assert.equal(hookEntry.durationSeconds, 6);
  assert.equal(hookEntry.endSeconds, 6);
  assert.equal(hookEntry.captionText, "");
  assert.equal(hookEntry.onScreenText, "Taxa zero na lista de presentes");
  assert.equal(hookEntry.transitionToNext, "Corte seco, sem efeito de transição, para preservar o impacto do gancho.");
  assert.deepEqual(hookEntry.visualEffects, ["Leve punch-in (zoom digital sutil) no início da fala para reforçar o gancho."]);
  assert.deepEqual(hookEntry.soundEffectSuggestions, ["Efeito de impacto sonoro."]);
  assert.match(hookEntry.cutType, /Corte seco de entrada/);

  const ctaEntry = timeline.find((entry) => entry.name === "CTA final");
  assert.equal(ctaEntry.startSeconds, 24);
  assert.equal(ctaEntry.endSeconds, 30);
  assert.equal(ctaEntry.transitionToNext, undefined);
  assert.match(ctaEntry.cutType, /Corte seco final/);
});

test("Diego preserva intensidade narrativa, direção visual e limita textos públicos para motion", async () => {
  const { diego } = createDiego();
  const brunoScript = createBrunoScript({
    scenes: [
      createBrunoScene({
        order: 1,
        name: "Gancho",
        publicVisibleText: "Seu casamento merece um site oficial elegante",
        publicSubtitle: "Tudo começa organizado em um lugar simples",
        narrativeIntensity: "impacto",
      }),
      createBrunoScene({
        order: 2,
        name: "CTA final",
        startSeconds: 24,
        durationSeconds: 6,
        publicVisibleText: "Conheça agora o Rumo ao Altar",
        publicSubtitle: "rumoaoaltar.com.br",
        narrativeIntensity: "cta",
      }),
    ],
  });

  const response = await diego.execute(createRequest(createInput({ brunoScript })));

  const firstEntry = response.output.editingTimeline[0];
  assert.equal(firstEntry.narrativeIntensity, "impacto");
  assert.equal(firstEntry.visualAssetRequirement.assetPriority, "person_using_product");
  assert.equal(firstEntry.visualSceneDesign.assetPriority, "person_using_product");
  assert.ok(firstEntry.publicVisibleText.split(/\s+/).filter(Boolean).length <= 7);
  assert.ok(firstEntry.publicSubtitle.split(/\s+/).filter(Boolean).length <= 12);
  assert.equal(firstEntry.editingDecision.textAnimation, "pop");
});

test("Diego usa somente publicVisibleText/publicSubtitle e bloqueia notas internas na timeline", async () => {
  const { diego } = createDiego();
  const response = await diego.execute(
    createRequest(
      createInput({
        brunoScript: createBrunoScript({
          scenes: [
            createBrunoScene({
              order: 1,
              name: "Gancho",
              spokenText: 'Abertura de impacto conectada ao ângulo "estratégico"',
              publicVisibleText: "Seu site oficial.",
              publicSubtitle: "Tudo organizado.",
              onScreenText: "Desenvolver a mensagem-chave: site",
            }),
            createBrunoScene({
              order: 2,
              name: "CTA final",
              startSeconds: 6,
              durationSeconds: 4,
              spokenText: "Conheça o Rumo ao Altar.",
              publicVisibleText: "Conheça o Rumo ao Altar.",
              publicSubtitle: "rumoaoaltar.com.br",
              onScreenText: "Conheça o Rumo ao Altar.",
            }),
          ],
          totalDurationSeconds: 10,
        }),
        vanessaDirection: createVanessaDirection({
          sceneDirections: [
            createVanessaSceneDirection({ order: 1, name: "Gancho" }),
            createVanessaSceneDirection({ order: 2, name: "CTA final" }),
          ],
        }),
      }),
    ),
  );

  const timelineText = response.output.editingTimeline.flatMap((entry) => [
    entry.onScreenText,
    entry.captionText,
    entry.publicVisibleText,
    entry.publicSubtitle,
  ]).filter(Boolean).join(" ");

  assert.match(timelineText, /Seu site oficial/);
  assert.match(timelineText, /rumoaoaltar\.com\.br/);
  assert.doesNotMatch(timelineText, /Abertura de impacto|Desenvolver a mensagem-chave|ângulo/i);
});

test("Diego calcula totalDurationSeconds a partir do roteiro de Bruno", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  assert.equal(response.output.totalDurationSeconds, 30);
});

test("Diego gera plano de edição estruturado completo a partir do roteiro de Bruno, da direção de Vanessa e do contexto da Clara", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  const output = response.output;
  assert.ok(output.musicTrackPlan.length > 0);
  assert.ok(output.requiredAssets.length > 0);
  assert.ok(output.editingInstructions.length > 0);
  assert.ok(output.technicalChecklist.length > 0);
  assert.ok(output.risks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("Diego cita a identidade visual real da Clara nos assets necessários quando disponível", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  assert.ok(response.output.requiredAssets.some((asset) => asset.includes("#FFFFFF") && asset.includes("#D4AF37")));
});

test("Diego monta briefing estruturado para Rafa com plano de edição completo", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  const briefing = response.output.rafaBriefing;
  assert.equal(briefing.status, "preliminary");
  assert.deepEqual(briefing.editingTimeline, response.output.editingTimeline);
  assert.equal(briefing.totalDurationSeconds, response.output.totalDurationSeconds);
  assert.equal(briefing.musicTrackPlan, response.output.musicTrackPlan);
  assert.equal(briefing.channel, "instagram");
  assert.ok(briefing.notes.some((note) => note.includes("Renderização e publicação")));
});

test("Diego não renderiza, publica ou gera vídeo final; devolve apenas plano de edição e briefing estruturados", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest());

  assert.equal(response.output.videoUrl, undefined);
  assert.equal(response.output.renderedVideoBase64, undefined);
  assert.equal(response.artifacts[0].type, "plan");
  assert.notEqual(response.artifacts[0].type, "video");
});

test("Diego trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { diego, logger, events } = createDiego({ valentina: new FakeValentina([]) });

  const response = await diego.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "VideoEditingFailed"));
});

test("Diego trata contexto visual incompleto na Clara como necessidade de mais contexto", async () => {
  const { diego, logger, events } = createDiego({ clara: new FakeClara({}) });

  const response = await diego.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "VideoEditingFailed"));
});

test("Diego valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { diego, valentina, clara, logger, events } = createDiego();

  const response = await diego.execute(createRequest(createInput({ videoObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "VideoEditingFailed"));
});

test("Diego rejeita brunoScript sem cenas", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest(createInput({ brunoScript: createBrunoScript({ scenes: [] }) })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("Diego rejeita vanessaDirection sem direções de cena", async () => {
  const { diego } = createDiego();

  const response = await diego.execute(createRequest(createInput({ vanessaDirection: createVanessaDirection({ sceneDirections: [] }) })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("Diego registra os logs esperados em uma execução completa", async () => {
  const { diego, logger } = createDiego();

  await diego.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("EditingPlanStarted"));
  assert.ok(actions.includes("EditingPlanFinalized"));
  assert.ok(actions.includes("RafaBriefingCreated"));
});

test("Diego emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { diego, events } = createDiego({ icaro });

  await diego.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "VideoEditingStarted",
    "VideoEditingContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "VideoEditingGenerated",
    "RafaBriefingCreated",
  ]);
});

test("buildBaselineEditingPlan e buildRafaBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "diego-video-editing", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const plan = buildBaselineEditingPlan(input, context);
  assert.equal(plan.editingTimeline.length, 3);

  const briefing = buildRafaBriefing(plan, input);
  assert.equal(briefing.status, "preliminary");
});

test("Diego deriva o Creative DNA da campanha e o usa nas instruções de edição", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "diego-video-editing", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const plan = buildBaselineEditingPlan(input, context);

  assert.ok(plan.creativeDna);
  assert.ok(plan.creativeDna.narrativePace.length > 0);
  assert.ok(plan.editingInstructions.some((instruction) => instruction.includes(plan.creativeDna.narrativePace)));
});

test("Diego não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/diego-video-editing/diego-video-editing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Diego não chama Bruno, Vanessa, Rafa (ou qualquer outra Skill) diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/diego-video-editing/diego-video-editing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("bruno-video-script"), false);
  assert.equal(lowered.includes("brunovideoscriptskill"), false);
  assert.equal(lowered.includes("createbruno"), false);
  assert.equal(lowered.includes("vanessa-video-direction"), false);
  assert.equal(lowered.includes("vanessavideodirectionskill"), false);
  assert.equal(lowered.includes("createvanessa"), false);
  assert.equal(lowered.includes("rafa-video-rendering"), false);
  assert.equal(lowered.includes("rafavideorenderingskill"), false);
  assert.equal(lowered.includes("creatrafa"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Diego não renderiza ou publica vídeo em código: nenhum uso de child_process, ffmpeg ou providers de vídeo", async () => {
  const source = await readFile("src/skills/diego-video-editing/diego-video-editing.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("child_process"), false);
  assert.equal(lowered.includes("ffmpeg"), false);
  assert.equal(lowered.includes("spawn("), false);
  assert.equal(lowered.includes("execsync("), false);
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Diego costura Shots
// ---------------------------------------------------------------------------------------------

test("AGENCY FILM PIPELINE 2.0: Diego gera uma DiegoShotTimelineEntry por Shot da cena, com continuidade e transições explícitas", async () => {
  const { diego } = createDiego();
  const response = await diego.execute(createRequest());
  const timeline = response.output.editingTimeline;
  assert.ok(timeline.length > 0);
  for (const entry of timeline) {
    assert.ok(Array.isArray(entry.shotTimeline), `entrada ${entry.name} sem shotTimeline`);
    assert.ok(entry.shotTimeline.length >= 2, `entrada ${entry.name} com ${entry.shotTimeline.length} shots`);
    let expectedStart = entry.startSeconds;
    for (const shotEntry of entry.shotTimeline) {
      assert.equal(shotEntry.sceneOrder, entry.order);
      assert.ok(shotEntry.shotId.startsWith(`s${entry.order}-shot-`));
      assert.ok(shotEntry.entranceTransition);
      assert.ok(shotEntry.exitTransition);
      assert.ok(shotEntry.continuityFromPreviousShot.length > 0);
      assert.ok(shotEntry.syncNotes.includes("Shot"));
      assert.ok(shotEntry.photographyBrief.length > 0);
      assert.ok(shotEntry.visualAssetRequirement);
      // A soma dos shots é contígua com a cena.
      assert.ok(Math.abs(shotEntry.startSeconds - expectedStart) < 0.05, `shot ${shotEntry.shotId} startSeconds ${shotEntry.startSeconds} não bate com esperado ${expectedStart}`);
      expectedStart = shotEntry.endSeconds;
    }
  }
});

