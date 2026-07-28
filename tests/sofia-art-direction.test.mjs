import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  SofiaArtDirectionSkill,
  buildBaselineDirection,
  buildBiancaBriefing,
  sofiaArtDirectionManifest,
} from "../dist/skills/sofia-art-direction/index.js";

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
      deliveredAt: "2026-07-02T12:00:00.000Z",
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
    visualConcept: "Ensaio editorial com casal real em cenário ao ar livre, luz natural dourada.",
    recommendedStyle: "Editorial romântico com tratamento de cor quente.",
    emotionalTone: "Aconchego e leveza, sem parecer produzido demais.",
    moodboard: ["Luz dourada de fim de tarde", "Casal em cenário ao ar livre"],
    designReferences: ["Editoriais de casamento ao ar livre com luz natural."],
  });
}

class InMemorySofiaLogger {
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
    format: "carrossel",
    toneOfVoice: "leve divertido persuasivo",
    angle: "Ângulo de conversão com benefício direto e chamada clara para ação.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    valueProposition: "Curadoria completa de fornecedores premiados em um único pacote.",
    keyMessages: ["Tudo incluído, do buffet à decoração.", "Curadoria exclusiva de fornecedores premiados."],
    recommendedCta: "Conheça o Rumo ao Altar",
    observations: [],
    risks: [],
    nextSteps: [],
    ...overrides,
  };
}

function createJoaoSofiaBriefing(overrides = {}) {
  return {
    status: "preliminary",
    channel: "instagram",
    format: "carrossel",
    angle: "Ângulo de conversão com benefício direto e chamada clara para ação.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    keyMessages: ["Tudo incluído, do buffet à decoração.", "Curadoria exclusiva de fornecedores premiados."],
    visualDirectionNotes: ["Usar tipografia serifada em peças de destaque."],
    brandIdentityNotes: ["Cores da marca: #FFFFFF, #D4AF37."],
    notes: ["Sofia ainda não existe como Skill; este briefing é preliminar."],
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um carrossel de lançamento do novo pacote de casamento all-inclusive.",
    joaoStrategy: createJoaoStrategy(),
    joaoSofiaBriefing: createJoaoSofiaBriefing(),
    channel: "instagram",
    format: "carrossel",
    visualObjective: "apresentar o pacote all-inclusive de forma aspiracional",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "sofia-art-direction",
    input,
    context: {
      executionId: "exec-sofia",
      taskId: "task-direction",
      correlationId: "corr-sofia",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createSofia(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemorySofiaLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const sofia = new SofiaArtDirectionSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });
  return { sofia, valentina, clara, logger, events };
}

test("Sofia possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(sofiaArtDirectionManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "sofia-art-direction");
  assert.deepEqual(result.manifest.capabilities, ["art_direction"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Sofia consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { sofia, valentina } = createSofia();

  await sofia.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await sofia.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Sofia consulta Clara com os módulos de identidade visual, marca, público, conteúdo e publicação", async () => {
  const { sofia, clara } = createSofia();

  await sofia.execute(createRequest());

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

test("Sofia funciona sem Ícaro configurado e ainda gera direção visual estruturada", async () => {
  const { sofia, logger } = createSofia();

  const response = await sofia.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Sofia usa Ícaro de forma opcional para aprimorar a direção visual quando disponível", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { sofia, logger, events } = createSofia({ icaro });

  const response = await sofia.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "sofia-art-direction");
  assert.equal(response.output.visualConcept, "Ensaio editorial com casal real em cenário ao ar livre, luz natural dourada.");
  assert.deepEqual(response.output.moodboard, ["Luz dourada de fim de tarde", "Casal em cenário ao ar livre"]);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Sofia segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { sofia, logger } = createSofia({ icaro });

  const response = await sofia.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("Sofia gera direção visual estruturada completa a partir da estratégia do João e do contexto da Clara", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest());

  const output = response.output;
  // Sofia não ecoa mais o conceito cru — ele passa pelo estágio de Visual Enrichment e vira cena
  // cinematográfica (ver src/shared/utils/visual-reference-library.ts). O conceito original ainda
  // é rastreável entre aspas dentro da cena (fallback genérico), mas a frase inteira agora traz
  // vocabulário de cena fotográfica (protagonista, iluminação, profundidade), nunca um objeto isolado.
  assert.ok(output.visualConcept.includes("apresentar o pacote all-inclusive"));
  assert.ok(output.visualConcept.includes("cena fotográfica"));
  assert.ok(output.visualConcept.includes("iluminada por"));
  assert.ok(!output.visualConcept.startsWith("Conceito visual alinhado ao ângulo"));
  assert.equal(output.recommendedStyle, "editorial romântico");
  assert.ok(output.emotionalTone.length > 0);
  assert.deepEqual(output.suggestedPalette, ["#FFFFFF", "#D4AF37"]);
  assert.ok(output.typography.length > 0);
  assert.ok(output.moodboard.length > 0);
  assert.ok(output.designReferences.length > 0);
  assert.equal(output.recommendedFormat, "carrossel");
  assert.equal(output.recommendedAspectRatio, "4:5");
  assert.ok(output.visualConstraints.includes("Usar tipografia serifada em peças de destaque."));
  assert.ok(output.visualRisks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("Sofia recomenda proporção vertical 9:16 para formatos de vídeo/reels/stories", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ channel: "tiktok", format: "reels" })));

  assert.equal(response.output.recommendedAspectRatio, "9:16");
});

test("Sofia recomenda 9:16 para Story no Instagram e no Facebook (regressão do BUG-06)", async () => {
  const { sofia } = createSofia();

  const instagramStory = await sofia.execute(createRequest(createInput({ channel: "instagram", format: "story" })));
  assert.equal(instagramStory.output.recommendedAspectRatio, "9:16");

  const facebookStory = await sofia.execute(createRequest(createInput({ channel: "facebook", format: "story" })));
  assert.equal(facebookStory.output.recommendedAspectRatio, "9:16");
});

test("Sofia recomenda 9:16 para Reels independentemente do canal (regressão do BUG-06)", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ channel: "instagram", format: "reels" })));

  assert.equal(response.output.recommendedAspectRatio, "9:16");
});

test("Sofia recomenda 4:5 para feed vertical (imagem única), não mais 1:1 (regressão do BUG-06)", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ channel: "instagram", format: "post único" })));

  assert.equal(response.output.recommendedAspectRatio, "4:5");
});

test("Sofia mantém 4:5 para carrossel de feed (sem regressão do BUG-06)", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ channel: "instagram", format: "carrossel" })));

  assert.equal(response.output.recommendedAspectRatio, "4:5");
});

test("Sofia recomenda 1:1 apenas quando o feed quadrado é solicitado explicitamente", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ channel: "instagram", format: "post quadrado" })));

  assert.equal(response.output.recommendedAspectRatio, "1:1");
});

test("Sofia monta briefing estruturado para Bianca com conceito, identidade visual e emoção da direção", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest());

  const briefing = response.output.biancaBriefing;
  assert.equal(briefing.status, "preliminary");
  assert.equal(briefing.visualConcept, response.output.visualConcept);
  assert.equal(briefing.recommendedStyle, response.output.recommendedStyle);
  assert.equal(briefing.emotionalTone, response.output.emotionalTone);
  assert.deepEqual(briefing.suggestedPalette, response.output.suggestedPalette);
  assert.deepEqual(briefing.typography, response.output.typography);
  assert.equal(briefing.channel, "instagram");
  assert.ok(briefing.notes.some((note) => note.includes("Layout, grid, hierarquia visual")));
});

test("Sofia não gera imagem final; devolve apenas direção visual e briefing estruturados", async () => {
  const { sofia } = createSofia();

  const response = await sofia.execute(createRequest());

  assert.equal(response.output.imageUrl, undefined);
  assert.equal(response.output.imageBase64, undefined);
  assert.equal(response.artifacts[0].type, "plan");
  assert.notEqual(response.artifacts[0].type, "image");
});

test("Sofia trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { sofia, logger, events } = createSofia({ valentina: new FakeValentina([]) });

  const response = await sofia.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "ArtDirectionFailed"));
});

test("Sofia trata contexto visual incompleto na Clara como necessidade de mais contexto", async () => {
  const { sofia, logger, events } = createSofia({ clara: new FakeClara({}) });

  const response = await sofia.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "ArtDirectionFailed"));
});

test("Sofia valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { sofia, valentina, clara, logger, events } = createSofia();

  const response = await sofia.execute(createRequest(createInput({ visualObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "ArtDirectionFailed"));
});

test("Sofia registra os logs esperados em uma execução completa", async () => {
  const { sofia, logger } = createSofia();

  await sofia.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("VisualIdentityConsulted"));
  assert.ok(actions.includes("DirectionStarted"));
  assert.ok(actions.includes("DirectionFinalized"));
  assert.ok(actions.includes("BiancaBriefingCreated"));
});

test("Sofia emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { sofia, events } = createSofia({ icaro });

  await sofia.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "ArtDirectionStarted",
    "VisualContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "ArtDirectionGenerated",
    "BiancaBriefingCreated",
  ]);
});

test("buildBaselineDirection e buildBiancaBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "sofia-art-direction", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const direction = buildBaselineDirection(input, context);
  assert.equal(direction.recommendedStyle, "editorial romântico");

  const briefing = buildBiancaBriefing(direction, input);
  assert.equal(briefing.status, "preliminary");
});

test("Sofia não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/sofia-art-direction/sofia-art-direction.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Sofia não chama Bianca ou Pedro diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/sofia-art-direction/sofia-art-direction.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  // Sofia monta um briefing PARA a Bianca (daí referências a "biancaBriefing"), mas nunca deve
  // importar, instanciar ou executar a Skill concreta da Bianca ou do Pedro.
  assert.equal(lowered.includes("bianca-social-media-design"), false);
  assert.equal(lowered.includes("biancasocialmediadesignskill"), false);
  assert.equal(lowered.includes("createbiancasocialmediadesignskill"), false);
  assert.equal(lowered.includes("pedro-image-generation"), false);
  assert.equal(lowered.includes("pedroimagegenerationskill"), false);
  assert.equal(lowered.includes("createpedroimagegenerationskill"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});
