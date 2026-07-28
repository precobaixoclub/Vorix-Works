import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import { planShotsForScene } from "../dist/shared/utils/cinematic-reference-library.js";
import {
  VanessaVideoDirectionSkill,
  buildBaselineDirection,
  buildDiegoBriefing,
  vanessaVideoDirectionManifest,
} from "../dist/skills/vanessa-video-direction/index.js";

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
      model: { id: "fake-direction-model" },
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
    visualRhythm: "Cortes curtos e constantes do início ao fim, sem respiros longos entre cenas.",
    captionStyle: "Legendas grandes em caixa alta, com destaque amarelo nas palavras de impacto.",
    musicDirection: "Trilha eletrônica com batida constante, subindo de intensidade no CTA final.",
    lightDirection: "Luz dourada de fim de tarde, com contraluz suave.",
    colorDirection: "Grade de cor quente, realçando tons dourados e pele natural.",
  });
}

class InMemoryVanessaLogger {
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
  // AGENCY FILM PIPELINE 2.0 — toda BrunoVideoScene entregue à Vanessa precisa vir com shots
  // planejados (mínimo 2). O planner determinístico da shared library gera isso a partir do
  // papel narrativo derivado do nome da cena.
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

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero uma direção audiovisual para o reels sobre taxa zero na lista de presentes.",
    joaoStrategy: createJoaoStrategy(),
    brunoScript: createBrunoScript(),
    channel: "instagram",
    format: "reels",
    videoObjective: "explicar que a lista de presentes via Pix não cobra taxa",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "vanessa-video-direction",
    input,
    context: {
      executionId: "exec-vanessa",
      taskId: "task-direction",
      correlationId: "corr-vanessa",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createVanessa(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryVanessaLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const vanessa = new VanessaVideoDirectionSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-08T12:00:00.000Z"),
  });
  return { vanessa, valentina, clara, logger, events };
}

test("Vanessa possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(vanessaVideoDirectionManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "vanessa-video-direction");
  assert.deepEqual(result.manifest.capabilities, ["video_direction"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Vanessa consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { vanessa, valentina } = createVanessa();

  await vanessa.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await vanessa.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Vanessa consulta Clara com os módulos de identidade visual, marca, público, conteúdo e publicação", async () => {
  const { vanessa, clara } = createVanessa();

  await vanessa.execute(createRequest());

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

test("Vanessa funciona sem Ícaro configurado e ainda gera direção audiovisual estruturada", async () => {
  const { vanessa, logger } = createVanessa();

  const response = await vanessa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Vanessa usa Ícaro de forma opcional para aprimorar a direção audiovisual quando disponível", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { vanessa, logger, events } = createVanessa({ icaro });

  const response = await vanessa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "vanessa-video-direction");
  assert.equal(response.output.visualRhythm, "Cortes curtos e constantes do início ao fim, sem respiros longos entre cenas.");
  assert.equal(response.output.colorDirection, "Grade de cor quente, realçando tons dourados e pele natural.");
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Vanessa segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { vanessa, logger } = createVanessa({ icaro });

  const response = await vanessa.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("Vanessa nunca deixa o Ícaro redefinir o mapa de cenas: sceneDirections permanece o construído por heurística mesmo com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { vanessa } = createVanessa({ icaro });

  const response = await vanessa.execute(createRequest());

  assert.ok(Array.isArray(response.output.sceneDirections));
  assert.equal(response.output.sceneDirections.length, 3);
  assert.equal(response.output.sceneDirections[0].name, "Gancho");
  assert.equal(response.output.sceneDirections[response.output.sceneDirections.length - 1].name, "CTA final");
});

test("Vanessa gera uma VanessaSceneDirection por cena do roteiro de Bruno, com a mesma order/name", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  const scenes = createBrunoScript().scenes;
  const directions = response.output.sceneDirections;
  assert.equal(directions.length, scenes.length);
  directions.forEach((direction, index) => {
    assert.equal(direction.order, scenes[index].order);
    assert.equal(direction.name, scenes[index].name);
    assert.ok(direction.framing.length > 0);
    assert.ok(direction.visualComposition.length > 0);
    assert.ok(direction.cameraMovement.length > 0);
    assert.ok(Array.isArray(direction.visualEffects));
  });
});

test("Vanessa entrega direção de arte completa e prioridade de asset para cada cena", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  const directions = response.output.sceneDirections;
  assert.ok(directions.every((direction) => direction.visualSceneDesign));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.mainElement.length > 0));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.backgroundPlane.length > 0));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.foregroundPlane.length > 0));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.depth.length > 0));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.composition.length > 0));
  assert.ok(directions.every((direction) => direction.visualSceneDesign.productIntegration.length > 0));
  assert.ok(directions.every((direction) => direction.visualAssetRequirement.assetPriority));
  assert.ok(new Set(directions.map((direction) => direction.visualAssetRequirement.assetPriority)).size >= 2);
});

test("Vanessa aplica enquadramento fechado no Gancho e end card profissional no CTA final", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  const hookDirection = response.output.sceneDirections.find((direction) => direction.name === "Gancho");
  const ctaDirection = response.output.sceneDirections.find((direction) => direction.name === "CTA final");

  assert.match(hookDirection.framing, /Close-up/);
  assert.equal(hookDirection.transitionToNext, "Corte seco, sem efeito de transição, para preservar o impacto do gancho.");

  assert.match(ctaDirection.framing, /End card vertical/);
  assert.match(ctaDirection.visualComposition, /logo oficial/);
  assert.match(ctaDirection.visualComposition, /URL/);
  assert.equal(ctaDirection.cameraMovement, "Micro push-in no mockup, sem deformar a marca.");
  assert.equal(ctaDirection.transitionToNext, undefined);
});

test("Vanessa gera direção audiovisual estruturada completa a partir do roteiro de Bruno e do contexto da Clara", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  const output = response.output;
  assert.ok(output.visualRhythm.length > 0);
  assert.ok(output.captionStyle.length > 0);
  assert.ok(output.soundDesignGuidance.length > 0);
  assert.ok(output.musicDirection.length > 0);
  assert.ok(output.brollGuidance.length > 0);
  assert.ok(output.lightDirection.startsWith('Luz natural e suave, evitando sombras duras no rosto, coerente com o estilo visual "editorial romântico" da marca.'));
  assert.ok(output.lightDirection.includes("Hero Lighting do Creative DNA"));
  assert.ok(output.colorDirection.includes("#FFFFFF"));
  assert.ok(output.colorDirection.includes("Hero Color Mood do Creative DNA"));
  assert.ok(output.recordingGuidance.length > 0);
  assert.ok(output.editingGuidance.length > 0);
  assert.ok(output.risks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("Vanessa usa direção de luz e cor genéricas quando não há IdentityContext cadastrado", async () => {
  const clara = new FakeClara({ BrandContext: fullKnowledgeBase().BrandContext, AudienceContext: fullKnowledgeBase().AudienceContext });
  const { vanessa } = createVanessa({ clara });

  const response = await vanessa.execute(createRequest());

  assert.match(response.output.lightDirection, /até a identidade visual real ser cadastrada/);
  assert.match(response.output.colorDirection, /até a identidade visual real ser cadastrada/);
});

test("Vanessa monta briefing estruturado para Diego com direção audiovisual completa", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  const briefing = response.output.diegoBriefing;
  assert.equal(briefing.status, "preliminary");
  assert.deepEqual(briefing.sceneDirections, response.output.sceneDirections);
  assert.equal(briefing.visualRhythm, response.output.visualRhythm);
  assert.equal(briefing.captionStyle, response.output.captionStyle);
  assert.equal(briefing.musicDirection, response.output.musicDirection);
  assert.equal(briefing.channel, "instagram");
  assert.ok(briefing.notes.some((note) => note.includes("Gravação, edição, renderização e publicação")));
});

test("Vanessa não gera, edita, renderiza ou publica vídeo; devolve apenas direção audiovisual e briefing estruturados", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest());

  assert.equal(response.output.videoUrl, undefined);
  assert.equal(response.output.videoBase64, undefined);
  assert.equal(response.artifacts[0].type, "plan");
  assert.notEqual(response.artifacts[0].type, "video");
});

test("Vanessa trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { vanessa, logger, events } = createVanessa({ valentina: new FakeValentina([]) });

  const response = await vanessa.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "VideoDirectionFailed"));
});

test("Vanessa trata contexto visual incompleto na Clara como necessidade de mais contexto", async () => {
  const { vanessa, logger, events } = createVanessa({ clara: new FakeClara({}) });

  const response = await vanessa.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "VideoDirectionFailed"));
});

test("Vanessa valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { vanessa, valentina, clara, logger, events } = createVanessa();

  const response = await vanessa.execute(createRequest(createInput({ videoObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "VideoDirectionFailed"));
});

test("Vanessa rejeita brunoScript sem cenas", async () => {
  const { vanessa } = createVanessa();

  const response = await vanessa.execute(createRequest(createInput({ brunoScript: createBrunoScript({ scenes: [] }) })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("Vanessa registra os logs esperados em uma execução completa", async () => {
  const { vanessa, logger } = createVanessa();

  await vanessa.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("DirectionStarted"));
  assert.ok(actions.includes("DirectionFinalized"));
  assert.ok(actions.includes("DiegoBriefingCreated"));
});

test("Vanessa emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { vanessa, events } = createVanessa({ icaro });

  await vanessa.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "VideoDirectionStarted",
    "VideoDirectionContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "VideoDirectionGenerated",
    "DiegoBriefingCreated",
  ]);
});

test("buildBaselineDirection e buildDiegoBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "vanessa-video-direction", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const direction = buildBaselineDirection(input, context);
  assert.equal(direction.sceneDirections.length, 3);

  const briefing = buildDiegoBriefing(direction, input);
  assert.equal(briefing.status, "preliminary");
});

test("Vanessa deriva o Creative DNA da campanha e o usa na direção de luz e cor", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "vanessa-video-direction", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const direction = buildBaselineDirection(input, context);

  assert.ok(direction.creativeDna);
  assert.ok(direction.creativeDna.heroLighting.length > 0);
  assert.ok(direction.creativeDna.heroColorMood.length > 0);
  assert.ok(direction.lightDirection.includes(direction.creativeDna.heroLighting));
  assert.ok(direction.colorDirection.includes(direction.creativeDna.heroColorMood));
});

test("Vanessa não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Vanessa não chama Bruno, Diego (ou qualquer outra Skill) diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  // Vanessa consome o briefing PRODUZIDO por Bruno e monta um briefing PARA o futuro Diego (daí
  // referências a "brunoScript"/"diegoBriefing"), mas nunca deve importar, instanciar ou
  // executar nenhuma outra Skill concreta.
  assert.equal(lowered.includes("bruno-video-script"), false);
  assert.equal(lowered.includes("brunovideoscriptskill"), false);
  assert.equal(lowered.includes("createbruno"), false);
  assert.equal(lowered.includes("diego-video-production"), false);
  assert.equal(lowered.includes("diegovideoproductionskill"), false);
  assert.equal(lowered.includes("creatediego"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Vanessa não gera, edita, renderiza ou publica vídeo em código: nenhum uso de child_process, ffmpeg ou providers de vídeo", async () => {
  const source = await readFile("src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("child_process"), false);
  assert.equal(lowered.includes("ffmpeg"), false);
  assert.equal(lowered.includes("spawn("), false);
  assert.equal(lowered.includes("execsync("), false);
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Vanessa dirige por Shot
// ---------------------------------------------------------------------------------------------

test("AGENCY FILM PIPELINE 2.0: Vanessa produz uma shotDirection para cada Shot de Bruno, na mesma ordem e com mesmo id", async () => {
  const { vanessa } = createVanessa();
  const response = await vanessa.execute(createRequest());
  for (const sceneDirection of response.output.sceneDirections) {
    assert.ok(Array.isArray(sceneDirection.shotDirections), `cena ${sceneDirection.name} sem shotDirections`);
    assert.ok(sceneDirection.shotDirections.length >= 2, `cena ${sceneDirection.name} com ${sceneDirection.shotDirections.length} shotDirections`);
    sceneDirection.shotDirections.forEach((shotDir, index) => {
      assert.equal(shotDir.shotOrder, index + 1);
      assert.ok(shotDir.shotId.startsWith(`s${sceneDirection.order}-shot-`), `shotId ${shotDir.shotId} não segue convenção`);
      assert.ok(shotDir.purpose, `shotDirection ${shotDir.shotId} sem purpose`);
      assert.ok(shotDir.framing.length > 0);
      assert.ok(shotDir.lighting.length > 0);
      assert.ok(shotDir.composition.length > 0);
      assert.ok(shotDir.cameraMovement.length > 0);
      assert.ok(shotDir.eyeFocus.length > 0);
      assert.ok(shotDir.transitionToNextShot);
      assert.ok(shotDir.continuityFromPreviousShot.length > 0);
    });
  }
});

test("AGENCY FILM PIPELINE 2.0: cada shotDirection carrega assetRequirement por Shot com sequenceRole e preferredMediaKind", async () => {
  const { vanessa } = createVanessa();
  const response = await vanessa.execute(createRequest());
  for (const sceneDirection of response.output.sceneDirections) {
    for (const shotDir of sceneDirection.shotDirections) {
      const req = shotDir.visualAssetRequirement;
      assert.ok(req, `shotDirection ${shotDir.shotId} sem visualAssetRequirement`);
      assert.ok(req.sequenceRole);
      assert.ok(req.preferredMediaKind);
      assert.ok(Array.isArray(req.tags) && req.tags.length > 0);
      assert.ok(Array.isArray(req.forbiddenTags));
      assert.ok(req.narrativeFunction.includes(`Shot ${shotDir.shotOrder}`));
    }
  }
});

