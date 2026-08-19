import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  LucasQualityReviewSkill,
  buildBaselineReview,
  buildIcaroReviewPrompt,
  lucasQualityReviewManifest,
} from "../dist/skills/lucas-quality-review/index.js";

const CLIENT_ID = "client-casamento-1";
const TENANT_ID = "tenant-casamento-1";
const REVIEW_THRESHOLDS = { approvalScoreThreshold: 90, warningScoreThreshold: 70, adjustmentScoreThreshold: 40 };

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

function fullKnowledgeBase(brandOverrides = {}) {
  return {
    BrandContext: [
      claraRecord("BrandContext", {
        clientId: CLIENT_ID,
        brandName: "Rumo ao Altar",
        toneOfVoice: "leve divertido persuasivo",
        forbiddenWords: ["garantia absoluta"],
        forbiddenHashtags: ["#promocaofake"],
        mandatoryWords: [],
        ...brandOverrides,
      }),
    ],
    IdentityContext: [
      claraRecord("IdentityContext", { clientId: CLIENT_ID, colors: ["#FFFFFF", "#D4AF37"] }),
    ],
    PublishingContext: [
      claraRecord("PublishingContext", { clientId: CLIENT_ID, approvalFlow: "Aprovação obrigatória do time de marketing." }),
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
      model: { id: "fake-review-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 40, total: request.prompt.length + 40 },
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
    additionalObservations: ["Considerar testar variações de CTA em publicações futuras."],
    additionalSuggestions: ["Adicionar prova social na legenda."],
  });
}

class InMemoryLucasLogger {
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
    objective: "vender o pacote all-inclusive",
    targetAudience: "Noivos e convidados de casamento",
    channel: "instagram",
    toneOfVoice: "leve divertido persuasivo",
    angle: "Ângulo de conversão com benefício direto.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    valueProposition: "Curadoria completa de fornecedores premiados.",
    keyMessages: ["Tudo incluído, do buffet à decoração."],
    recommendedCta: "Conheça o Rumo ao Altar",
    risks: ["Validar identidade visual real antes da produção."],
    ...overrides,
  };
}

function createMariaCopy(overrides = {}) {
  return {
    title: "Presentear ficou mais fácil",
    caption: "Um casamento all-inclusive sem estresse para os noivos, com curadoria completa de fornecedores premiados.",
    cta: "Conheça o Rumo ao Altar",
    hashtags: ["#Casamento", "#Noivos"],
    keywords: ["casamento", "all-inclusive"],
    summary: "Copy sobre o pacote all-inclusive.",
    objective: "vender o pacote all-inclusive",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    qualityScore: 92,
    qualityPassed: true,
    ...overrides,
  };
}

function createSofiaDirection(overrides = {}) {
  return {
    visualConcept: "Ensaio editorial com casal real em cenário ao ar livre.",
    recommendedStyle: "editorial romântico",
    suggestedPalette: ["#FFFFFF", "#D4AF37"],
    recommendedFormat: "carrossel",
    recommendedAspectRatio: "4:5",
    visualConstraints: ["Usar tipografia serifada."],
    visualRisks: ["Validar identidade visual real antes da produção."],
    ...overrides,
  };
}

function createBiancaDesign(overrides = {}) {
  return {
    designConcept: "Layout escaneável com hierarquia clara para o carrossel.",
    gridSystem: "Grid de 12 colunas por slide.",
    slides: [
      { slideIndex: 1, role: "Gancho" },
      { slideIndex: 2, role: "CTA" },
    ],
    designRisks: ["Validar layout final com o time de marca."],
    ...overrides,
  };
}

function createPedroImages(overrides = {}) {
  return {
    imageCount: 3,
    images: [
      { id: "image-1", mimeType: "image/png", extension: "png", width: 1080, height: 1350, aspectRatio: "4:5", altText: "Slide 1" },
      { id: "image-2", mimeType: "image/png", extension: "png", width: 1080, height: 1350, aspectRatio: "4:5", altText: "Slide 2" },
      { id: "image-3", mimeType: "image/png", extension: "png", width: 1080, height: 1350, aspectRatio: "4:5", altText: "Slide 3" },
    ],
    ...overrides,
  };
}

function createBrunoScript(overrides = {}) {
  return {
    hook: "Capturar atenção nos primeiros 3 segundos com a promessa central.",
    totalDurationSeconds: 30,
    scenes: [
      {
        order: 1,
        name: "Gancho",
        durationSeconds: 6,
        spokenText: "Você sabia que dá pra receber presente via Pix sem taxa?",
        onScreenText: "Taxa zero na lista",
        publicVisibleText: "Taxa zero na lista",
        publicSubtitle: "Presente direto para os noivos.",
      },
      {
        order: 2,
        name: "Desenvolvimento 1",
        durationSeconds: 18,
        spokenText: "Convidados presenteiam por Pix direto para os noivos.",
        onScreenText: "Convidados presenteiam por Pix",
        publicVisibleText: "Convidados presenteiam por Pix",
        publicSubtitle: "Sem intermediários.",
      },
      {
        order: 3,
        name: "CTA final",
        durationSeconds: 6,
        spokenText: "Conheça o Rumo ao Altar",
        onScreenText: "Conheça o Rumo ao Altar",
        publicVisibleText: "Conheça o Rumo ao Altar",
        publicSubtitle: "rumoaoaltar.com.br",
      },
    ],
    finalCta: "Conheça o Rumo ao Altar",
    channel: "instagram",
    ...overrides,
  };
}

function createVanessaDirection(overrides = {}) {
  const visualSceneDesign = {
    mainElement: "Casal usando celular com produto integrado.",
    secondaryElement: "Mockup real do site como prova visual.",
    backgroundPlane: "Ambiente de casamento desfocado.",
    foregroundPlane: "Mãos e celular criando profundidade.",
    depth: "Camadas entre foreground, produto e fundo.",
    lighting: "Luz natural suave.",
    atmosphere: "Premium, humana e tranquila.",
    emotion: "tranquilidade",
    visualRhythm: "Entradas escalonadas.",
    eyeFocus: "Do casal para a interface.",
    composition: "Regra dos terços com área segura.",
    productIntegration: "Mockup integrado ao dispositivo.",
    assetPriority: "person_using_product",
  };
  return {
    sceneDirections: [
      { order: 1, name: "Gancho", visualSceneDesign },
      { order: 2, name: "Desenvolvimento 1", visualSceneDesign: { ...visualSceneDesign, assetPriority: "product_mockup" } },
      { order: 3, name: "CTA final", visualSceneDesign: { ...visualSceneDesign, assetPriority: "brand_end_card" } },
    ],
    visualRhythm: "Ritmo acelerado no gancho, moderado no desenvolvimento, retomada no CTA final.",
    captionStyle: "Legendas com fonte arredondada e peso bold.",
    channel: "instagram",
    ...overrides,
  };
}

function createDiegoEditingPlan(overrides = {}) {
  return {
    editingTimeline: [
      {
        order: 1,
        name: "Gancho",
        onScreenText: "Taxa zero na lista",
        publicVisibleText: "Taxa zero na lista",
        publicSubtitle: "Presente direto para os noivos.",
        captionText: "Presente direto para os noivos.",
      },
      {
        order: 2,
        name: "Desenvolvimento 1",
        onScreenText: "Convidados presenteiam por Pix",
        publicVisibleText: "Convidados presenteiam por Pix",
        publicSubtitle: "Sem intermediários.",
        captionText: "Sem intermediários.",
      },
      {
        order: 3,
        name: "CTA final",
        onScreenText: "Conheça Rumo ao Altar",
        publicVisibleText: "Conheça Rumo ao Altar",
        publicSubtitle: "rumoaoaltar.com.br",
        captionText: "rumoaoaltar.com.br",
      },
    ],
    totalDurationSeconds: 30,
    channel: "instagram",
    ...overrides,
  };
}

function createNoraNarration(overrides = {}) {
  return {
    narrationScript: "Seu casamento merece um lugar só dele. Tudo fica organizado em um único site. Conheça o Rumo ao Altar.",
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
        emotion: "curiosidade elegante",
        emphasis: ["casamento", "lugar"],
        pauseAfterMs: 260,
      },
      {
        sceneId: "scene-02",
        sceneOrder: 2,
        startTime: 6,
        endTime: 24,
        estimatedDurationSeconds: 4,
        text: "RSVP, presentes e fotos ficam organizados em um único site.",
        emotion: "clareza",
        emphasis: ["organizados", "site"],
        pauseAfterMs: 220,
      },
      {
        sceneId: "scene-03",
        sceneOrder: 3,
        startTime: 24,
        endTime: 30,
        estimatedDurationSeconds: 2,
        text: "Dê o primeiro passo com leveza.",
        emotion: "convite",
        emphasis: ["Rumo ao Altar"],
        pauseAfterMs: 300,
      },
    ],
    audio: {
      relativePath: "audio/narration.wav",
      absolutePath: "C:/fake/artifacts/exec-lucas/audio/narration.wav",
      durationSeconds: 29,
      validation: { valid: true, clippingRisk: "low" },
    },
    ...overrides,
  };
}

function createRafaVideo(overrides = {}) {
  return {
    fileName: "final-video.mp4",
    mimeType: "video/mp4",
    extension: "mp4",
    specs: { width: 1080, height: 1920, aspectRatio: "9:16", durationSeconds: 30, format: "mp4" },
    sizeBytes: 153600,
    audioApplied: true,
    narrationApplied: true,
    musicDuckingApplied: true,
    narrationDuration: 29,
    motionSummary: {
      scenes: 3,
      totalAnimatedElements: 12,
      totalIndependentAnimations: 12,
      averageAnimatedElementsPerScene: 4,
      transitionTypes: ["cut", "slide_up", "pop", "fade"],
      elementAnimations: ["slide_up", "pop", "fade", "push"],
      maxStaticMockupSeconds: 0.6,
      mockupElements: 3,
      simultaneousEntryWarnings: 0,
      assetRoles: ["main_image", "mockup"],
      layoutPatterns: ["main_image:0:3:8", "mockup:3:4:5", "mockup:3:3:5"],
      repeatedLayoutWarnings: 0,
      averageDepthLayers: 4,
      maxHeadlineWords: 5,
      maxSubtitleWords: 6,
      maxTextElementsPerScene: 2,
      mockupOnlySceneRatio: 0.33,
    },
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um carrossel de lançamento do novo pacote de casamento all-inclusive.",
    joaoStrategy: createJoaoStrategy(),
    mariaCopy: createMariaCopy(),
    sofiaDirection: createSofiaDirection(),
    biancaDesign: createBiancaDesign(),
    pedroImages: createPedroImages(),
    channel: "instagram",
    format: "carrossel",
    ...overrides,
  };
}

/** Pacote somente-vídeo (sem componente visual estático), com roteiro, direção, edição e vídeo final todos coerentes por padrão. */
function createVideoInput(overrides = {}) {
  return createInput({
    sofiaDirection: undefined,
    biancaDesign: undefined,
    pedroImages: undefined,
    format: "reels",
    brunoScript: createBrunoScript(),
    vanessaDirection: createVanessaDirection(),
    diegoEditingPlan: createDiegoEditingPlan(),
    noraNarration: createNoraNarration(),
    rafaVideo: createRafaVideo(),
    ...overrides,
  });
}

function createRequest(input = createInput()) {
  return {
    skillId: "lucas-quality-review",
    input,
    context: {
      executionId: "exec-lucas",
      taskId: "task-review",
      correlationId: "corr-lucas",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createLucas(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryLucasLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const lucas = new LucasQualityReviewSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });
  return { lucas, valentina, clara, logger, events };
}

test("Lucas possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(lucasQualityReviewManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "lucas-quality-review");
  assert.deepEqual(result.manifest.capabilities, ["quality_review"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Lucas consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { lucas, valentina } = createLucas();

  await lucas.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await lucas.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Lucas consulta Clara com os módulos de marca, identidade e publicação", async () => {
  const { lucas, clara } = createLucas();

  await lucas.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["BrandContext", "IdentityContext", "PublishingContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Lucas funciona sem Ícaro configurado e ainda gera revisão estruturada", async () => {
  const { lucas, logger } = createLucas();

  const response = await lucas.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Lucas usa o Ícaro de forma opcional para complementar a revisão com taskType review", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { lucas, logger, events } = createLucas({ icaro });

  const response = await lucas.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "review");
  assert.ok(response.output.observations.some((note) => note.includes("variações de CTA")));
  assert.ok(response.output.suggestions.some((suggestion) => suggestion.message.includes("prova social")));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Lucas segue com a checklist heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { lucas, logger } = createLucas({ icaro });

  const response = await lucas.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

function tenisReferenceIntelligence(overrides = {}) {
  return {
    imagesAnalyzed: 2,
    primaryImageIndex: 0,
    multiImageRelationship: "same_product",
    verifiedFacts: { productType: "tênis", productName: "Tênis Casual Unissex Skatista RV", category: "calçados" },
    visualFacts: { colors: ["preto", "branco"], visualCharacteristics: [], relevantText: [], ctaPresent: false, elementsToPreserve: [] },
    commercialFacts: {
      currentPrice: "R$ 39,99",
      previousPrice: "R$ 79,99",
      discountPercent: "50%",
      promotion: "Oferta Relâmpago",
      commercialConditions: ["até 7x de R$6,41"],
    },
    uncertainFacts: [],
    claimSourceMap: {},
    ...overrides,
  };
}

function tenisCreativeBrief(overrides = {}) {
  return {
    productOrService: "Tênis Casual Unissex Skatista RV",
    offer: "R$ 39,99 (de R$ 79,99), 50% de desconto — Oferta Relâmpago",
    commercialFactsSource: "reference_image",
    nonInventableInfo: [],
    ...overrides,
  };
}

function referenceInput(overrides = {}) {
  return createInput({
    referenceIntelligence: tenisReferenceIntelligence(),
    creativeBrief: tenisCreativeBrief(),
    workflowContext: { referenceImageUrl: "https://x/referencia.png" },
    pedroImages: createPedroImages({ images: [{ id: "image-1", mimeType: "image/png", extension: "png", width: 1080, height: 1350, aspectRatio: "4:5", altText: "Slide 1", uri: "https://x/gerada.png" }] }),
    ...overrides,
  });
}

test("evaluateProductFidelity (via buildBaselineReview): veredito de incompatibilidade vira PRODUCT_FIDELITY_MISMATCH bloqueante", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(referenceInput(), context, REVIEW_THRESHOLDS, { mismatch: true, reasoning: "a imagem gerada mostra um tênis amarelo, não preto e branco" });

  const found = review.issues.find((entry) => entry.code === "PRODUCT_FIDELITY_MISMATCH");
  assert.ok(found, `esperava PRODUCT_FIDELITY_MISMATCH, issues: ${JSON.stringify(review.issues.map((i) => i.code))}`);
  assert.equal(found.severity, "high");
  assert.equal(found.category, "fidelity");
  assert.equal(review.reviewStatus, "rejected");
});

test("evaluateProductFidelity: veredito 'não é incompatível' não gera issue nenhuma", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(referenceInput(), context, REVIEW_THRESHOLDS, { mismatch: false });

  assert.equal(review.issues.some((entry) => entry.code === "PRODUCT_FIDELITY_MISMATCH"), false);
});

test("evaluateProductFidelity: veredito indisponível (undefined — não foi possível verificar) nunca reprova por conta disso", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(referenceInput(), context, REVIEW_THRESHOLDS, undefined);

  assert.equal(review.issues.some((entry) => entry.code === "PRODUCT_FIDELITY_MISMATCH"), false);
});

test("evaluateCommercialHallucination (via buildBaselineReview): condição comercial não confirmada na copy vira COMMERCIAL_HALLUCINATION_DETECTED bloqueante", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = referenceInput({ mariaCopy: createMariaCopy({ caption: "Corre, estoque limitado! " + createMariaCopy().caption }) });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  const found = review.issues.find((entry) => entry.code === "COMMERCIAL_HALLUCINATION_DETECTED");
  assert.ok(found, `esperava COMMERCIAL_HALLUCINATION_DETECTED, issues: ${JSON.stringify(review.issues.map((i) => i.code))}`);
  assert.equal(review.reviewStatus, "rejected");
});

test("evaluateCommercialFactUtilization: fato comercial forte disponível mas ignorado pela copy vira COMMERCIAL_FACT_IGNORED", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  // createMariaCopy() padrão não menciona nenhum dos fatos comerciais do tênis.
  const review = buildBaselineReview(referenceInput(), context, REVIEW_THRESHOLDS);

  assert.ok(review.issues.some((entry) => entry.code === "COMMERCIAL_FACT_IGNORED"));
});

test("evaluateCommercialFactUtilization: copy que de fato usa o fato comercial forte NÃO é sinalizada", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = referenceInput({ mariaCopy: createMariaCopy({ title: "R$ 39,99 — Oferta Relâmpago!" }) });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.equal(review.issues.some((entry) => entry.code === "COMMERCIAL_FACT_IGNORED"), false);
});

test("evaluateCopySpecificity: clichê genérico na copy vira GENERIC_CLICHE_IN_COPY (teste da 'logo removida')", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ mariaCopy: createMariaCopy({ title: "Descubra um novo jeito de comprar" }) });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.ok(review.issues.some((entry) => entry.code === "GENERIC_CLICHE_IN_COPY"));
});

test("Sem Reference Intelligence, nenhuma das checagens novas dispara (regressão total)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS, undefined);

  assert.equal(review.issues.some((entry) => entry.code === "PRODUCT_FIDELITY_MISMATCH"), false);
  assert.equal(review.issues.some((entry) => entry.code === "COMMERCIAL_HALLUCINATION_DETECTED"), false);
  assert.equal(review.issues.some((entry) => entry.code === "COMMERCIAL_FACT_IGNORED"), false);
});

test("evaluateSemanticOcclusion: violação SEVERE de headline sobre rosto vira issue bloqueante, força reviewStatus \"rejected\" e limita fortemente o creativeQualityScore", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const verdict = {
    hasViolation: true,
    violations: [{ element: "headline", subject: "face", severity: "severe", reasoning: "headline cobre os olhos e parte do nariz do modelo" }],
  };
  const input = createInput({ typographyGeometry: [typographyEntry()] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS, undefined, undefined, verdict);

  const found = review.issues.find((entry) => entry.code === "SEMANTIC_OCCLUSION_HEADLINE_OVER_FACE_SEVERE");
  assert.ok(found, `esperava SEMANTIC_OCCLUSION_HEADLINE_OVER_FACE_SEVERE, issues: ${JSON.stringify(review.issues.map((i) => i.code))}`);
  assert.equal(found.severity, "high");
  assert.equal(found.category, "composition");
  assert.equal(review.reviewStatus, "rejected");
  assert.ok(review.creativeQualityScore);
  assert.equal(review.creativeQualityScore.verdict, "reject");
  assert.equal(review.creativeQualityScore.blockedByHardFailure, true);
  assert.ok(review.creativeQualityScore.score <= 60, `esperava score <= 60 (nunca mais 86/89 com rosto coberto), veio ${review.creativeQualityScore.score}`);
});

test("evaluateSemanticOcclusion: violação PARTIAL não bloqueia o reviewStatus, mas reduz de verdade o creativeQualityScore (teto aplicado)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const verdict = {
    hasViolation: true,
    violations: [{ element: "logo", subject: "hands", severity: "partial", reasoning: "logo encosta na borda da mão que segura o produto" }],
  };
  const input = createInput({ typographyGeometry: [typographyEntry()] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS, undefined, undefined, verdict);

  const found = review.issues.find((entry) => entry.code === "SEMANTIC_OCCLUSION_LOGO_OVER_SUBJECT");
  assert.ok(found, `esperava SEMANTIC_OCCLUSION_LOGO_OVER_SUBJECT, issues: ${JSON.stringify(review.issues.map((i) => i.code))}`);
  assert.equal(found.severity, "medium");
  assert.notEqual(review.reviewStatus, "rejected");
  assert.ok(review.creativeQualityScore);
  assert.equal(review.creativeQualityScore.blockedByHardFailure, false);
  assert.ok(review.creativeQualityScore.score <= 78, `esperava score <= 78 (teto de violação parcial), veio ${review.creativeQualityScore.score}`);
  assert.notEqual(review.creativeQualityScore.verdict, "excellent");
});

test("evaluateSemanticOcclusion: hasViolation false não gera nenhuma issue (regressão)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const verdict = { hasViolation: false, violations: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS, undefined, undefined, verdict);

  assert.equal(review.issues.some((entry) => entry.code.startsWith("SEMANTIC_OCCLUSION_")), false);
});

test("evaluateSemanticOcclusion: veredito indisponível (undefined — não foi possível verificar) nunca reprova por conta disso", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS, undefined, undefined, undefined);

  assert.equal(review.issues.some((entry) => entry.code.startsWith("SEMANTIC_OCCLUSION_")), false);
});

test("evaluateSemanticOcclusion: combinação sem tipo de reparo dedicado (ex.: mãos sobre produto) cai em SEMANTIC_OCCLUSION_OTHER, nunca descartada silenciosamente", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const verdict = {
    hasViolation: true,
    violations: [{ element: "rating", subject: "hands", severity: "partial", reasoning: "selo de avaliação encosta na mão do modelo" }],
  };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS, undefined, undefined, verdict);

  const found = review.issues.find((entry) => entry.code === "SEMANTIC_OCCLUSION_OTHER");
  assert.ok(found, `esperava SEMANTIC_OCCLUSION_OTHER, issues: ${JSON.stringify(review.issues.map((i) => i.code))}`);
  assert.equal(found.severity, "medium");
});

test("Lucas.execute: com Ícaro + Reference Intelligence + imagem gerada, roda fidelidade E composição visual (imagens certas em cada uma) antes do apoio de IA de sempre", async () => {
  const icaro = new FakeIcaroBrain([
    JSON.stringify({ mismatch: false }),
    JSON.stringify({ unprofessional: false }),
    JSON.stringify({ hasViolation: false, violations: [] }),
    enhancementJson(),
  ]);
  const { lucas } = createLucas({ icaro });

  const response = await lucas.execute(createRequest(referenceInput()));

  assert.equal(response.status, "completed");
  assert.equal(icaro.calls.length, 4, `esperava 4 chamadas ao Ícaro (fidelidade + composição + oclusão semântica + apoio de IA), veio ${icaro.calls.length}`);
  assert.deepEqual(icaro.calls[0].imageUrls, ["https://x/referencia.png", "https://x/gerada.png"]);
  assert.deepEqual(icaro.calls[1].imageUrls, ["https://x/gerada.png"]);
  assert.deepEqual(icaro.calls[2].imageUrls, ["https://x/gerada.png"]);
  assert.equal(response.output.issues.some((entry) => entry.code === "PRODUCT_FIDELITY_MISMATCH"), false);
  assert.equal(response.output.issues.some((entry) => entry.code === "VISUAL_COMPOSITION_UNPROFESSIONAL"), false);
  assert.equal(response.output.issues.some((entry) => entry.code.startsWith("SEMANTIC_OCCLUSION_")), false);
});

test("Lucas.execute: sem workflowContext.referenceImageUrl e sem uri na imagem gerada, nem fidelidade nem composição chamam o Ícaro (só o apoio de IA de sempre, 1 chamada)", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { lucas } = createLucas({ icaro });

  await lucas.execute(createRequest(createInput({ referenceIntelligence: tenisReferenceIntelligence() })));

  assert.equal(icaro.calls.length, 1);
});

test("Lucas.execute: composição visual reprovada (unprofessional: true) vira VISUAL_COMPOSITION_UNPROFESSIONAL, não bloqueante", async () => {
  const icaro = new FakeIcaroBrain([
    JSON.stringify({ unprofessional: true, reasoning: "sem hierarquia visual clara, elementos amontoados" }),
    enhancementJson(),
  ]);
  const { lucas } = createLucas({ icaro });

  const response = await lucas.execute(createRequest(createInput({ pedroImages: createPedroImages({ images: [{ id: "image-1", uri: "https://x/gerada.png" }] }) })));

  const found = response.output.issues.find((entry) => entry.code === "VISUAL_COMPOSITION_UNPROFESSIONAL");
  assert.ok(found);
  assert.equal(found.severity, "high");
  assert.equal(found.category, "composition");
});

function typographyEntry(overrides = {}) {
  return {
    type: "price",
    text: "R$ 39,99",
    fontSizePx: 48,
    lineCount: 1,
    widthPx: 400,
    heightPx: 120,
    textColor: "#111111",
    backgroundColor: "#FFFFFF",
    ...overrides,
  };
}

test("evaluateTypographyQuality (via buildBaselineReview): sem typographyGeometry, nenhuma checagem nova dispara (regressão)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS);

  assert.equal(review.issues.some((entry) => entry.code.startsWith("TYPOGRAPHY_")), false);
});

test("evaluateTypographyQuality: fonte abaixo do mínimo legível vira TYPOGRAPHY_MIN_SIZE_VIOLATION (não bloqueante)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ fontSizePx: 14 })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  const found = review.issues.find((entry) => entry.code === "TYPOGRAPHY_MIN_SIZE_VIOLATION");
  assert.ok(found);
  assert.equal(found.severity, "medium");
});

test("evaluateTypographyQuality: contraste abaixo de WCAG AA vira TYPOGRAPHY_CONTRAST_LOW bloqueante e reprova automaticamente", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ textColor: "#FACC15", backgroundColor: "#FFFFFF" })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  const found = review.issues.find((entry) => entry.code === "TYPOGRAPHY_CONTRAST_LOW");
  assert.ok(found);
  assert.equal(found.severity, "high");
  assert.equal(review.reviewStatus, "rejected");
});

test("evaluateTypographyQuality: contraste alto o suficiente não dispara nada", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ textColor: "#000000", backgroundColor: "#FFFFFF" })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.equal(review.issues.some((entry) => entry.code === "TYPOGRAPHY_CONTRAST_LOW"), false);
});

test("evaluateTypographyQuality: texto que precisaria de muitas linhas vira TYPOGRAPHY_TEXT_CLIPPED bloqueante (sinal de corte)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ type: "headline", lineCount: 6 })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  const found = review.issues.find((entry) => entry.code === "TYPOGRAPHY_TEXT_CLIPPED");
  assert.ok(found);
  assert.equal(review.reviewStatus, "rejected");
});

test("evaluateTypographyQuality: zona de linha única (price/cta/discount) que quebrou em 2 linhas vira TYPOGRAPHY_LINE_COUNT_EXCEEDED", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ type: "cta", lineCount: 2 })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.ok(review.issues.some((entry) => entry.code === "TYPOGRAPHY_LINE_COUNT_EXCEEDED"));
});

test("evaluateTypographyQuality: texto longo em caixa alta vira TYPOGRAPHY_ALL_CAPS_OVERUSE; CTA curto em caixa alta não dispara", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const shouting = createInput({ typographyGeometry: [typographyEntry({ type: "headline", text: "COMPRE AGORA ANTES QUE ACABE TUDO" })] });
  const shoutingReview = buildBaselineReview(shouting, context, REVIEW_THRESHOLDS);
  assert.ok(shoutingReview.issues.some((entry) => entry.code === "TYPOGRAPHY_ALL_CAPS_OVERUSE"));

  const shortCta = createInput({ typographyGeometry: [typographyEntry({ type: "cta", text: "COMPRE JÁ" })] });
  const shortCtaReview = buildBaselineReview(shortCta, context, REVIEW_THRESHOLDS);
  assert.equal(shortCtaReview.issues.some((entry) => entry.code === "TYPOGRAPHY_ALL_CAPS_OVERUSE"), false);
});

// -------------------------------------------------------------------------------------------
// Unified Final Creative Score (Fatia 2, Prioridade 10)
// -------------------------------------------------------------------------------------------

test("creativeQualityScore: sem typographyGeometry (Performance Creative Engine não rodou), fica undefined (regressão)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS);

  assert.equal(review.creativeQualityScore, undefined);
});

test("creativeQualityScore: peça sem nenhum issue relevante recebe score alto e veredito \"excellent\" ou \"approved\"", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry()] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.ok(review.creativeQualityScore);
  assert.ok(review.creativeQualityScore.score >= 82);
  assert.ok(["excellent", "approved"].includes(review.creativeQualityScore.verdict));
  assert.equal(review.creativeQualityScore.blockedByHardFailure, false);
});

test("creativeQualityScore: TYPOGRAPHY_CONTRAST_LOW (falha dura) força verdict \"reject\" no creativeQualityScore, mesmo com as outras 9 dimensões perfeitas", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry({ textColor: "#FACC15", backgroundColor: "#FFFFFF" })] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  assert.ok(review.creativeQualityScore);
  assert.equal(review.creativeQualityScore.verdict, "reject");
  assert.equal(review.creativeQualityScore.blockedByHardFailure, true);
  assert.equal(review.creativeQualityScore.dimensions.typography, 0);
});

test("creativeQualityScore: PRODUCT_FIDELITY_MISMATCH (falha dura de outra checagem) também bloqueia o creativeQualityScore, não só o reviewStatus geral", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({ typographyGeometry: [typographyEntry()] });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS, { mismatch: true, reasoning: "produto errado na imagem gerada" });

  assert.ok(review.creativeQualityScore);
  assert.equal(review.creativeQualityScore.verdict, "reject");
  assert.equal(review.creativeQualityScore.dimensions.productFidelity, 0);
});

test("creativeQualityScore: GENERIC_CLICHE_IN_COPY reduz a dimensão specificity, mas não é uma falha dura (não bloqueia sozinho)", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({
    typographyGeometry: [typographyEntry()],
    mariaCopy: { title: "O melhor produto do mercado", caption: "Qualidade incomparável, viva a experiência única.", cta: "Compre agora" },
  });
  const review = buildBaselineReview(input, context, REVIEW_THRESHOLDS);

  const hasGenericClicheIssue = review.issues.some((entry) => entry.code === "GENERIC_CLICHE_IN_COPY");
  if (hasGenericClicheIssue) {
    assert.ok(review.creativeQualityScore);
    assert.equal(review.creativeQualityScore.dimensions.specificity, 4);
    assert.notEqual(review.creativeQualityScore.blockedByHardFailure, true);
  }
});

test("Lucas revisa um pacote completo e devolve checklist, issues, riscos e próximos passos", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest());
  const output = response.output;

  // 37 itens universais + 2 itens do perfil "carrossel" (progressão entre slides, CTA final) —
  // vídeo ganhou validações universais de motion, direção visual, narração, decisão de edição
  // duplicada, ritmo monótono, cena longa demais, enquadramento repetitivo, identidade criativa
  // (Creative DNA) e Production Readiness. ver `evaluateFormatProfile`/`resolveContentQualityProfile`.
  // O fixture padrão usa format: "carrossel".
  assert.equal(output.checklist.length, 39);
  assert.equal(output.qualityProfile, "carrossel");
  assert.ok(Array.isArray(output.issues));
  assert.ok(Array.isArray(output.suggestions));
  assert.ok(Array.isArray(output.risks));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(typeof output.overallScore, "number");
  assert.equal(typeof output.approvalRecommended, "boolean");
});

test("Lucas calcula o score subtraindo penalidades por severidade de problema", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const perfectInput = createInput();

  const perfectReview = buildBaselineReview(perfectInput, context, REVIEW_THRESHOLDS);
  assert.equal(perfectReview.overallScore, 100);
  assert.equal(perfectReview.issues.length, 0);

  const flawedInput = createInput({ mariaCopy: createMariaCopy({ title: "" }) });
  const flawedReview = buildBaselineReview(flawedInput, context, REVIEW_THRESHOLDS);
  assert.equal(flawedReview.overallScore, 80);
  assert.ok(flawedReview.issues.some((issue) => issue.code === "COPY_MISSING_TITLE" && issue.severity === "high"));
});

test("Lucas devolve status approved quando o pacote está totalmente coerente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest());

  assert.equal(response.output.reviewStatus, "approved");
  assert.equal(response.output.overallScore, 100);
  assert.equal(response.output.approvalRecommended, true);
});

test("Lucas devolve status approved_with_warnings quando há um problema alto isolado, sem bloqueio", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({ mariaCopy: createMariaCopy({ title: "" }) })));

  assert.equal(response.output.reviewStatus, "approved_with_warnings");
  assert.equal(response.output.approvalRecommended, true);
  assert.ok(response.output.issues.some((issue) => issue.code === "COPY_MISSING_TITLE"));
});

test("Lucas devolve status needs_adjustments quando há vários problemas médios de coerência", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    channel: "linkedin",
    mariaCopy: createMariaCopy({ toneUsed: "formal corporativo", cta: "Fale com um consultor", qualityScore: 60 }),
  })));

  assert.equal(response.output.reviewStatus, "needs_adjustments");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.overallScore >= 40 && response.output.overallScore < 70);
});

test("Lucas devolve status rejected quando um termo proibido pela marca é encontrado na copy", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    mariaCopy: createMariaCopy({ caption: "Compre agora com garantia absoluta de satisfação." }),
  })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.issues.some((issue) => issue.code === "FORBIDDEN_WORD_FOUND"));
});

test("Lucas devolve status rejected quando nenhuma imagem foi gerada pelo Pedro", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({ pedroImages: createPedroImages({ imageCount: 0, images: [] }) })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.ok(response.output.issues.some((issue) => issue.code === "NO_IMAGES_GENERATED"));
});

test("Lucas não altera a copy da Maria; apenas aponta problemas e sugestões", async () => {
  const { lucas } = createLucas();
  const originalCopy = createMariaCopy({ title: "" });
  const originalCopySnapshot = JSON.parse(JSON.stringify(originalCopy));

  const response = await lucas.execute(createRequest(createInput({ mariaCopy: originalCopy })));

  assert.deepEqual(originalCopy, originalCopySnapshot);
  assert.equal(response.output.revisedCopy, undefined);
  assert.equal(response.output.updatedCopy, undefined);
});

test("Lucas não altera as imagens do Pedro; apenas aponta problemas e sugestões", async () => {
  const { lucas } = createLucas();
  const originalImages = createPedroImages();
  const originalImagesSnapshot = JSON.parse(JSON.stringify(originalImages));

  const response = await lucas.execute(createRequest(createInput({ pedroImages: originalImages })));

  assert.deepEqual(originalImages, originalImagesSnapshot);
  assert.equal(response.output.revisedImages, undefined);
  assert.equal(response.output.updatedImages, undefined);
});

test("Lucas revisa campanha somente texto (sem Sofia, Bianca ou Pedro) com sucesso, sem penalizar itens visuais", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    sofiaDirection: undefined,
    biancaDesign: undefined,
    pedroImages: undefined,
  })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.reviewStatus, "approved");
  assert.equal(response.output.overallScore, 100);
  assert.equal(response.output.issues.length, 0);
  assert.ok(response.output.checklist.every((item) => item.passed));
});

test("Lucas identifica NO_RISKS_DOCUMENTED quando João, Sofia e Bianca não documentaram nenhum risco", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    joaoStrategy: createJoaoStrategy({ risks: [] }),
    sofiaDirection: createSofiaDirection({ visualRisks: [] }),
    biancaDesign: createBiancaDesign({ designRisks: [] }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "NO_RISKS_DOCUMENTED" && issue.severity === "low"));
});

test("Lucas identifica IMAGE_COUNT_MISMATCH quando a quantidade declarada diverge das imagens recebidas", async () => {
  const { lucas } = createLucas();
  const baseImages = createPedroImages();

  const response = await lucas.execute(createRequest(createInput({
    pedroImages: createPedroImages({ images: baseImages.images.slice(0, 2) }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "IMAGE_COUNT_MISMATCH" && issue.severity === "medium"));
});

test("Lucas identifica ASPECT_RATIO_MISMATCH quando a proporção da imagem diverge da recomendação da Sofia", async () => {
  const { lucas } = createLucas();
  const baseImages = createPedroImages();

  const response = await lucas.execute(createRequest(createInput({
    pedroImages: createPedroImages({
      images: [{ ...baseImages.images[0], aspectRatio: "1:1" }, ...baseImages.images.slice(1)],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "ASPECT_RATIO_MISMATCH" && issue.severity === "low"));
});

test("Lucas reconhece 1080:1920 como equivalente a 9:16 e não gera ASPECT_RATIO_MISMATCH (regressão do BUG-06)", async () => {
  const { lucas } = createLucas();
  const baseImages = createPedroImages();

  const response = await lucas.execute(createRequest(createInput({
    sofiaDirection: createSofiaDirection({ recommendedAspectRatio: "9:16" }),
    pedroImages: createPedroImages({
      images: [{ ...baseImages.images[0], aspectRatio: "1080:1920" }, ...baseImages.images.slice(1)],
    }),
  })));

  assert.equal(response.output.issues.some((issue) => issue.code === "ASPECT_RATIO_MISMATCH"), false);
});

test("Lucas reconhece 1080:1350 como equivalente a 4:5 e não gera ASPECT_RATIO_MISMATCH (regressão do BUG-06)", async () => {
  const { lucas } = createLucas();
  const baseImages = createPedroImages();

  const response = await lucas.execute(createRequest(createInput({
    sofiaDirection: createSofiaDirection({ recommendedAspectRatio: "4:5" }),
    pedroImages: createPedroImages({
      images: [{ ...baseImages.images[0], aspectRatio: "1080:1350" }, ...baseImages.images.slice(1)],
    }),
  })));

  assert.equal(response.output.issues.some((issue) => issue.code === "ASPECT_RATIO_MISMATCH"), false);
});

test("Lucas continua identificando ASPECT_RATIO_MISMATCH quando as proporções realmente divergem, mesmo em formatos mistos de texto (nenhum warning falso, mas nenhum falso negativo)", async () => {
  const { lucas } = createLucas();
  const baseImages = createPedroImages();

  const response = await lucas.execute(createRequest(createInput({
    sofiaDirection: createSofiaDirection({ recommendedAspectRatio: "9:16" }),
    pedroImages: createPedroImages({
      images: [{ ...baseImages.images[0], aspectRatio: "1080:1350" }, ...baseImages.images.slice(1)],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "ASPECT_RATIO_MISMATCH" && issue.severity === "low"));
});

test("Lucas identifica FORMAT_MISMATCH quando o formato recomendado pela Sofia diverge do formato solicitado", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    sofiaDirection: createSofiaDirection({ recommendedFormat: "imagem única" }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "FORMAT_MISMATCH" && issue.severity === "low"));
});

test("Lucas identifica CHANNEL_MISMATCH quando o canal da estratégia do João diverge do canal solicitado", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput({
    joaoStrategy: createJoaoStrategy({ channel: "linkedin" }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "CHANNEL_MISMATCH" && issue.severity === "medium"));
});

test("Lucas continua revisando pacote de imagem normalmente, sem regressão (pacote sem nenhum componente de vídeo)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createInput()));

  assert.equal(response.status, "completed");
  assert.equal(response.output.reviewStatus, "approved");
  assert.equal(response.output.overallScore, 100);
  assert.equal(response.output.issues.length, 0);
  assert.equal(response.output.checklist.length, 39);
  assert.ok(response.output.checklist.every((item) => item.passed));
});

test("Lucas revisa pacote de vídeo completo e aprova quando roteiro, direção, edição e vídeo final estão coerentes", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput()));

  assert.equal(response.status, "completed");
  assert.equal(response.output.reviewStatus, "approved");
  assert.equal(response.output.overallScore, 100);
  assert.equal(response.output.issues.length, 0);
  assert.ok(response.output.checklist.every((item) => item.passed));
});

test("Lucas rejeita automaticamente quando duas cenas de desenvolvimento saem com decisão de edição idêntica (prova estrutural de slideshow)", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        hook,
        { ...development, order: 2, name: "Desenvolvimento 1", durationSeconds: 6, editingDecision: { transition: "dissolve", textAnimation: "slide_up", mask: false, glow: false, blur: false } },
        { ...development, order: 3, name: "Desenvolvimento 2", durationSeconds: 6, editingDecision: { transition: "dissolve", textAnimation: "slide_up", mask: false, glow: false, blur: false } },
        { ...cta, order: 4 },
      ],
    }),
  })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.equal(response.output.approvalRecommended, false);
  const issue = response.output.issues.find((current) => current.code === "VIDEO_SCENE_DECISIONS_DUPLICATED");
  assert.ok(issue);
  assert.equal(issue.severity, "high");
  assert.equal(response.output.checklist.find((item) => item.item.includes("sem duplicidade")).passed, false);
});

test("Lucas não reprova por decisão duplicada quando as cenas de desenvolvimento têm decisões de edição distintas", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        hook,
        { ...development, order: 2, name: "Desenvolvimento 1", durationSeconds: 6, editingDecision: { transition: "dissolve", textAnimation: "slide_up", mask: false, glow: false, blur: false } },
        { ...development, order: 3, name: "Desenvolvimento 2", durationSeconds: 6, editingDecision: { transition: "wipe", textAnimation: "fade_in", mask: true, glow: false, blur: false } },
        { ...cta, order: 4 },
      ],
    }),
  })));

  assert.ok(!response.output.issues.some((current) => current.code === "VIDEO_SCENE_DECISIONS_DUPLICATED"));
});

test("Lucas reprova ritmo monótono quando todas as cenas do vídeo têm exatamente a mesma duração", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        { ...hook, durationSeconds: 6 },
        { ...development, durationSeconds: 6 },
        { ...cta, durationSeconds: 6 },
      ],
    }),
  })));

  const issue = response.output.issues.find((current) => current.code === "VIDEO_RHYTHM_MONOTONOUS");
  assert.ok(issue);
  assert.equal(issue.severity, "medium");
  assert.equal(response.output.checklist.find((item) => item.item.includes("progressão de duração")).passed, false);
});

test("Lucas não reprova por ritmo monótono quando as cenas têm durações diferentes", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        { ...hook, durationSeconds: 6 },
        { ...development, durationSeconds: 12 },
        { ...cta, durationSeconds: 4 },
      ],
    }),
  })));

  assert.ok(!response.output.issues.some((current) => current.code === "VIDEO_RHYTHM_MONOTONOUS"));
});

test("Lucas reprova quando uma cena isolada domina o vídeo (mais de 40% da duração total)", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        { ...hook, durationSeconds: 4 },
        { ...development, durationSeconds: 22 },
        { ...cta, durationSeconds: 4 },
      ],
      totalDurationSeconds: 30,
    }),
  })));

  const issue = response.output.issues.find((current) => current.code === "VIDEO_SCENE_TOO_LONG");
  assert.ok(issue);
  assert.equal(issue.severity, "medium");
  assert.equal(response.output.checklist.find((item) => item.item.includes("Nenhuma cena isolada domina")).passed, false);
});

test("Lucas não reprova por cena longa quando a cena de payoff é deliberadamente a mais longa, mas dentro do limite de 40%", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();
  const [hook, development, cta] = fullPlan.editingTimeline;

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        { ...hook, durationSeconds: 6 },
        { ...development, durationSeconds: 9 },
        { ...cta, durationSeconds: 5 },
      ],
      totalDurationSeconds: 20,
    }),
  })));

  assert.ok(!response.output.issues.some((current) => current.code === "VIDEO_SCENE_TOO_LONG"));
});

test("Lucas reprova enquadramento repetitivo quando duas cenas de desenvolvimento compartilham a mesma composição cinematográfica", async () => {
  const { lucas } = createLucas();
  const sameComposition = { shotType: "medio", composition: "Sujeito descentralizado à direita, espaço negativo à esquerda." };

  const response = await lucas.execute(createRequest(createVideoInput({
    vanessaDirection: createVanessaDirection({
      sceneDirections: [
        { order: 1, name: "Gancho", cinematography: { shotType: "close", composition: "Centralizada, sem espaço negativo." } },
        { order: 2, name: "Desenvolvimento 1", cinematography: sameComposition },
        { order: 3, name: "Desenvolvimento 2", cinematography: sameComposition },
        { order: 4, name: "CTA final", cinematography: { shotType: "close", composition: "Centralizada, marca ancorada na base." } },
      ],
    }),
  })));

  const issue = response.output.issues.find((current) => current.code === "VIDEO_FRAMING_REPETITIVE");
  assert.ok(issue);
  assert.equal(issue.severity, "medium");
  assert.equal(response.output.checklist.find((item) => item.item.includes("Enquadramento/composição não se repete")).passed, false);
});

test("Lucas não reprova por enquadramento repetitivo quando as cenas de desenvolvimento têm composições distintas", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    vanessaDirection: createVanessaDirection({
      sceneDirections: [
        { order: 1, name: "Gancho", cinematography: { shotType: "close", composition: "Centralizada, sem espaço negativo." } },
        { order: 2, name: "Desenvolvimento 1", cinematography: { shotType: "medio", composition: "Sujeito à direita, espaço à esquerda." } },
        { order: 3, name: "Desenvolvimento 2", cinematography: { shotType: "detalhe", composition: "Elemento ancorado no terço inferior." } },
        { order: 4, name: "CTA final", cinematography: { shotType: "close", composition: "Centralizada, marca ancorada na base." } },
      ],
    }),
  })));

  assert.ok(!response.output.issues.some((current) => current.code === "VIDEO_FRAMING_REPETITIVE"));
});

test("Lucas aponta texto na tela longo demais com o limite apertado de palavras (headline > 4, complemento > 6)", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        {
          ...fullPlan.editingTimeline[0],
          publicVisibleText: "Seu casamento merece um site oficial completo",
        },
        ...fullPlan.editingTimeline.slice(1),
      ],
    }),
  })));

  const issue = response.output.issues.find((current) => current.code === "VIDEO_ON_SCREEN_TEXT_TOO_LONG");
  assert.ok(issue);
});

test("Lucas reprova vídeo quando texto interno aparece em campos públicos/renderizáveis", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        {
          ...fullPlan.editingTimeline[0],
          publicVisibleText: "Desenvolver a mensagem-chave conectada ao ângulo estratégico",
          captionText: "technicalJustification interna da cena",
        },
        ...fullPlan.editingTimeline.slice(1),
      ],
    }),
  })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_INTERNAL_TEXT_VISIBLE" && issue.severity === "high"));
});

test("Lucas identifica quando o tema site oficial é dominado por funcionalidade secundária", async () => {
  const { lucas } = createLucas();
  const brunoScript = createBrunoScript({
    scenes: [
      {
        order: 1,
        name: "Gancho",
        durationSeconds: 8,
        spokenText: "Fotos do casamento no QR Code.",
        publicVisibleText: "Fotos por QR Code",
        publicSubtitle: "Álbum colaborativo.",
      },
      {
        order: 2,
        name: "Álbum",
        durationSeconds: 14,
        spokenText: "Todos enviam fotos sem instalar aplicativo.",
        publicVisibleText: "Convidados enviam fotos",
        publicSubtitle: "Tudo cai no Google Drive.",
      },
      {
        order: 3,
        name: "CTA final",
        durationSeconds: 8,
        spokenText: "Conheça o Rumo ao Altar.",
        publicVisibleText: "Conheça o Rumo ao Altar",
        publicSubtitle: "rumoaoaltar.com.br",
      },
    ],
  });
  const diegoEditingPlan = createDiegoEditingPlan({
    editingTimeline: [
      { order: 1, name: "Gancho", publicVisibleText: "Fotos por QR Code", captionText: "Álbum colaborativo." },
      { order: 2, name: "Álbum", publicVisibleText: "Convidados enviam fotos", captionText: "Tudo cai no Google Drive." },
      { order: 3, name: "CTA final", publicVisibleText: "Conheça o Rumo ao Altar", captionText: "rumoaoaltar.com.br" },
    ],
  });

  const response = await lucas.execute(createRequest(createVideoInput({
    originalRequest: "Seu casamento merece um site oficial.",
    joaoStrategy: createJoaoStrategy({
      objective: "Mostrar que o casamento merece um site oficial.",
      keyMessages: ["site oficial", "RSVP", "presentes", "álbum", "cronograma"],
      centralPromise: "Seu casamento merece um site oficial.",
    }),
    brunoScript,
    diegoEditingPlan,
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_THEME_DRIFT" && issue.severity === "high"));
});

test("Lucas não aponta problema de identidade criativa (Creative DNA) quando a cena, o frame, a metáfora e a emoção do DNA aparecem no conteúdo produzido", async () => {
  const { lucas } = createLucas();
  const baseScript = createBrunoScript();

  const response = await lucas.execute(createRequest(createVideoInput({
    originalRequest: "Vocês cuidam do amor. Nós cuidamos da organização do casamento.",
    joaoStrategy: createJoaoStrategy({
      objective: "Mostrar que cuidamos da organização do casamento.",
    }),
    brunoScript: createBrunoScript({
      hook: "O casal se abraça em meio à cerimônia enquanto o RSVP é confirmado em silêncio, ao fundo, com leveza.",
      scenes: [
        { ...baseScript.scenes[0], spokenText: "O casal ri durante a cerimônia sem perceber a organização acontecendo ao fundo." },
        baseScript.scenes[1],
        baseScript.scenes[2],
      ],
    }),
  })));

  assert.ok(!response.output.issues.some((issue) => issue.code.startsWith("CREATIVE_DNA_")));
});

test("Lucas identifica perda de identidade criativa (Creative DNA) quando o conteúdo produzido não reflete a cena, o frame, a metáfora e a emoção definidos", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    originalRequest: "Vocês cuidam do amor. Nós cuidamos da organização do casamento.",
    joaoStrategy: createJoaoStrategy({
      objective: "Mostrar que cuidamos da organização do casamento.",
    }),
    brunoScript: createBrunoScript({
      hook: "Compre agora com desconto especial de lançamento.",
      scenes: [
        { order: 1, name: "Gancho", durationSeconds: 6, spokenText: "Desconto exclusivo por tempo limitado.", onScreenText: "50% OFF", publicVisibleText: "50% OFF", publicSubtitle: "Aproveite agora." },
        { order: 2, name: "Desenvolvimento 1", durationSeconds: 18, spokenText: "Parcele em até 12 vezes sem juros.", onScreenText: "Parcele sem juros", publicVisibleText: "Parcele sem juros", publicSubtitle: "Compre já." },
        { order: 3, name: "CTA final", durationSeconds: 6, spokenText: "Garanta o seu agora.", onScreenText: "Garanta o seu", publicVisibleText: "Garanta o seu", publicSubtitle: "loja.com.br" },
      ],
    }),
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        { order: 1, name: "Gancho", onScreenText: "50% OFF", publicVisibleText: "50% OFF", publicSubtitle: "Aproveite agora.", captionText: "Aproveite agora." },
        { order: 2, name: "Desenvolvimento 1", onScreenText: "Parcele sem juros", publicVisibleText: "Parcele sem juros", publicSubtitle: "Compre já.", captionText: "Compre já." },
        { order: 3, name: "CTA final", onScreenText: "Garanta o seu", publicVisibleText: "Garanta o seu", publicSubtitle: "loja.com.br", captionText: "loja.com.br" },
      ],
    }),
    vanessaDirection: createVanessaDirection({
      sceneDirections: [
        { order: 1, name: "Gancho" },
        { order: 2, name: "Desenvolvimento 1" },
        { order: 3, name: "CTA final" },
      ],
    }),
    noraNarration: createNoraNarration({
      narrationScript: "Desconto exclusivo por tempo limitado. Parcele em até 12 vezes sem juros. Garanta o seu agora.",
      segments: [],
    }),
    mariaCopy: { ...createMariaCopy(), caption: "Desconto exclusivo por tempo limitado.", summary: "Promoção de desconto." },
  })));

  const dnaIssues = response.output.issues.filter((issue) => issue.code.startsWith("CREATIVE_DNA_"));
  assert.ok(dnaIssues.some((issue) => issue.code === "CREATIVE_DNA_HERO_SCENE_MISSING"));
  assert.ok(dnaIssues.some((issue) => issue.code === "CREATIVE_DNA_HERO_FRAME_MISSING"));
  assert.ok(dnaIssues.some((issue) => issue.code === "CREATIVE_DNA_VISUAL_METAPHOR_MISSING"));
  assert.ok(dnaIssues.some((issue) => issue.code === "CREATIVE_DNA_EMOTION_NOT_PERCEIVED"));
  assert.ok(dnaIssues.some((issue) => issue.code === "CREATIVE_DNA_IDENTITY_DRIFT"));
});

test("Lucas não avalia identidade criativa (Creative DNA) para campanhas sem arquétipo criativo específico reconhecido (compatibilidade com campanhas antigas/genéricas)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput()));

  assert.ok(!response.output.issues.some((issue) => issue.code.startsWith("CREATIVE_DNA_")));
});

test("Lucas exige end card profissional com marca e URL em vídeos do Rumo ao Altar", async () => {
  const { lucas } = createLucas();
  const baseScript = createBrunoScript();
  const basePlan = createDiegoEditingPlan();

  const response = await lucas.execute(createRequest(createVideoInput({
    brunoScript: createBrunoScript({
      scenes: [
        ...baseScript.scenes.slice(0, 2),
        {
          ...baseScript.scenes[2],
          publicVisibleText: "Conheça agora",
          publicSubtitle: "Organize seu casamento",
        },
      ],
    }),
    diegoEditingPlan: createDiegoEditingPlan({
      editingTimeline: [
        ...basePlan.editingTimeline.slice(0, 2),
        {
          ...basePlan.editingTimeline[2],
          publicVisibleText: "Conheça agora",
          publicSubtitle: "Organize seu casamento",
          captionText: "Organize seu casamento",
        },
      ],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_END_CARD_INCOMPLETE" && issue.severity === "high"));
});

test("Lucas revisa vídeo sem arquivo (Rafa) e identifica NO_VIDEO_FILE", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({ rafaVideo: undefined })));

  assert.ok(response.output.issues.some((issue) => issue.code === "NO_VIDEO_FILE" && issue.severity === "high"));
});

test("Lucas revisa vídeo com proporção inválida e identifica VIDEO_ASPECT_RATIO_INVALID", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ specs: { width: 1080, height: 1350, aspectRatio: "4:5", durationSeconds: 30, format: "mp4" } }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_ASPECT_RATIO_INVALID" && issue.severity === "medium"));
});

test("Lucas revisa vídeo sem CTA final e identifica VIDEO_CTA_MISSING", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    brunoScript: createBrunoScript({ finalCta: "" }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_CTA_MISSING" && issue.severity === "high"));
});

test("Lucas revisa vídeo com duração incompatível e identifica VIDEO_DURATION_MISMATCH", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ specs: { width: 1080, height: 1920, aspectRatio: "9:16", durationSeconds: 45, format: "mp4" } }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_DURATION_MISMATCH" && issue.severity === "medium"));
});

test("Lucas revisa vídeo com problema de coerência entre roteiro, direção e edição e identifica VIDEO_COHERENCE_MISMATCH", async () => {
  const { lucas } = createLucas();
  const fullPlan = createDiegoEditingPlan();

  const response = await lucas.execute(createRequest(createVideoInput({
    diegoEditingPlan: createDiegoEditingPlan({ editingTimeline: fullPlan.editingTimeline.slice(0, 2) }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_COHERENCE_MISMATCH" && issue.severity === "high"));
});

test("Lucas reduz nota quando Rafa entrega vídeo com motion fraco, mockup estático e animação repetitiva", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      motionSummary: {
        scenes: 3,
        totalAnimatedElements: 3,
        totalIndependentAnimations: 3,
        averageAnimatedElementsPerScene: 1,
        transitionTypes: ["fade"],
        elementAnimations: ["fade"],
        maxStaticMockupSeconds: 4,
        mockupElements: 2,
        simultaneousEntryWarnings: 1,
      },
    }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(codes.includes("VIDEO_MOTION_COMPOSITION_WEAK"));
  assert.ok(codes.includes("VIDEO_MOCKUP_STATIC"));
  assert.ok(codes.includes("VIDEO_ELEMENTS_SIMULTANEOUS"));
  assert.ok(codes.includes("VIDEO_ANIMATION_REPETITIVE"));
});

test("Lucas reprova aparência de apresentação quando há só mockups, layout repetido e baixa profundidade", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      motionSummary: {
        scenes: 4,
        totalAnimatedElements: 14,
        totalIndependentAnimations: 14,
        averageAnimatedElementsPerScene: 3.5,
        transitionTypes: ["cut", "slide", "fade"],
        elementAnimations: ["slide_up", "fade", "pop"],
        maxStaticMockupSeconds: 0.6,
        mockupElements: 4,
        simultaneousEntryWarnings: 0,
        assetRoles: ["mockup"],
        layoutPatterns: ["mockup:2:3:6", "mockup:3:4:5"],
        repeatedLayoutWarnings: 2,
        averageDepthLayers: 3,
        maxHeadlineWords: 7,
        maxSubtitleWords: 12,
        maxTextElementsPerScene: 2,
        mockupOnlySceneRatio: 1,
      },
    }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(codes.includes("VIDEO_MOCKUP_PRESENTATION"));
  assert.ok(codes.includes("VIDEO_LAYOUT_REPETITIVE"));
  assert.ok(codes.includes("VIDEO_VISUAL_DEPTH_WEAK"));
});

test("Lucas devolve status approved para pacote de vídeo totalmente coerente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput()));

  assert.equal(response.output.reviewStatus, "approved");
  assert.equal(response.output.approvalRecommended, true);
  assert.ok(response.output.checklist.some((item) => item.item === "Narração sincronizada com as cenas" && item.passed));
  assert.ok(response.output.checklist.some((item) => item.item === "Voz validada e mixada em primeiro plano" && item.passed));
});

test("Lucas rejeita vídeo sem Nora no novo fluxo de narração", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({ noraNarration: undefined })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_NARRATION_MISSING" && issue.severity === "high"));
});

test("Lucas valida sincronização, áudio e ducking da narração", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    noraNarration: createNoraNarration({
      segments: [
        ...createNoraNarration().segments.slice(0, 2),
        { ...createNoraNarration().segments[2], startTime: 29, endTime: 28, estimatedDurationSeconds: 8 },
      ],
      audio: {
        relativePath: "audio/narration.wav",
        durationSeconds: 29,
        validation: { valid: false, clippingRisk: "high" },
      },
    }),
    rafaVideo: createRafaVideo({ narrationApplied: false, musicDuckingApplied: false }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(codes.includes("VIDEO_NARRATION_TIMING_INVALID"));
  assert.ok(codes.includes("VIDEO_NARRATION_AUDIO_INVALID"));
  assert.ok(codes.includes("VIDEO_NARRATION_CLIPPING"));
});

test("Lucas reduz nota quando texto da tela repete a fala da Nora", async () => {
  const { lucas } = createLucas();
  const baseNarration = createNoraNarration();

  const response = await lucas.execute(createRequest(createVideoInput({
    noraNarration: createNoraNarration({
      segments: [
        { ...baseNarration.segments[0], text: "Taxa zero na lista" },
        ...baseNarration.segments.slice(1),
      ],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "VIDEO_VOICE_TEXT_REDUNDANT" && issue.severity === "low"));
});

test("Lucas devolve status approved_with_warnings para vídeo com um problema alto isolado (CTA final ausente)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    brunoScript: createBrunoScript({ finalCta: "" }),
  })));

  assert.equal(response.output.reviewStatus, "approved_with_warnings");
  assert.equal(response.output.approvalRecommended, true);
});

test("Lucas devolve status needs_adjustments para vídeo com vários problemas médios (proporção, duração, gancho e CTA divergentes)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ specs: { width: 1080, height: 1350, aspectRatio: "4:5", durationSeconds: 25, format: "mp4" } }),
    brunoScript: createBrunoScript({ hook: "", finalCta: "Saiba mais" }),
  })));

  assert.equal(response.output.reviewStatus, "needs_adjustments");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.overallScore >= 40 && response.output.overallScore < 70);
});

test("Lucas devolve status rejected para vídeo sem arquivo final registrado pelo Rafa", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({ rafaVideo: undefined })));

  assert.equal(response.output.reviewStatus, "rejected");
  assert.equal(response.output.approvalRecommended, false);
  assert.ok(response.output.issues.some((issue) => issue.code === "NO_VIDEO_FILE"));
});

test("Lucas valida brunoScript/vanessaDirection/diegoEditingPlan como obrigatórios em conjunto quando há componente de vídeo", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({ vanessaDirection: undefined })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("Lucas identifica regras de marca (palavra proibida) também no texto do vídeo, não só na copy", async () => {
  const { lucas } = createLucas();
  const baseScript = createBrunoScript();

  const response = await lucas.execute(createRequest(createVideoInput({
    brunoScript: createBrunoScript({
      scenes: [
        { ...baseScript.scenes[0], spokenText: "Garantia absoluta de satisfação para todos os convidados." },
        ...baseScript.scenes.slice(1),
      ],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "FORBIDDEN_WORD_FOUND"));
});

test("Lucas monta prompt de IA com padrão de qualidade obrigatório e restrições negativas", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const review = buildBaselineReview(createInput(), context, REVIEW_THRESHOLDS);
  const prompt = buildIcaroReviewPrompt(createInput(), review);

  assert.ok(prompt.includes("PADRÃO DE QUALIDADE OBRIGATÓRIO"));
  assert.ok(prompt.includes("RESTRIÇÕES NEGATIVAS"));
});

test("Lucas trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { lucas, logger, events } = createLucas({ valentina: new FakeValentina([]) });

  const response = await lucas.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "QualityReviewFailed"));
});

test("Lucas trata contexto de marca incompleto na Clara como necessidade de mais contexto", async () => {
  const { lucas, logger, events } = createLucas({ clara: new FakeClara({}) });

  const response = await lucas.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "QualityReviewFailed"));
});

test("Lucas registra os logs esperados em uma execução completa", async () => {
  const { lucas, logger } = createLucas();

  await lucas.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("ReviewStarted"));
  assert.ok(actions.includes("ChecklistValidated"));
  assert.ok(actions.includes("ReviewFinished"));
});

test("Lucas emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { lucas, events } = createLucas({ icaro });

  await lucas.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "QualityReviewStarted",
    "QualityContextLoaded",
    "QualityChecklistValidated",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "QualityReviewFinished",
  ]);
});

test("Lucas não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/lucas-quality-review/lucas-quality-review.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Lucas não acessa storage diretamente", async () => {
  const source = await readFile("src/skills/lucas-quality-review/lucas-quality-review.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Lucas não chama outra Skill diretamente: todo import relativo aponta apenas para application/domain ou para o próprio arquivo", async () => {
  const source = await readFile("src/skills/lucas-quality-review/lucas-quality-review.skill.ts", "utf8");
  const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    const isSameFolder = specifier.startsWith("./");
    const isApplicationOrDomain = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
    assert.ok(isSameFolder || isApplicationOrDomain, `Import inesperado que pode apontar para outra Skill: ${specifier}`);
  }
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Lucas reprova slideshow, poucos Shots, repetições, excesso mockup/texto
// ---------------------------------------------------------------------------------------------

function shotStatic({ id, sceneOrder, order, purpose, startSeconds, durationSeconds, shotType = "close" }) {
  return {
    id,
    order,
    sceneOrder,
    purpose,
    startSeconds,
    durationSeconds,
    cinematography: { shotType, cameraMovement: "estático" },
    motion: { entrance: "cut_in", action: "static_hold", exit: "cut_out" },
    transitionToNext: "cut",
    assetRequirement: { preferredMediaKind: "photo", sequenceRole: purpose },
  };
}

test("AGENCY FILM PIPELINE 2.0: Lucas reprova cena com um único Shot (VIDEO_SCENE_SINGLE_SHOT)", async () => {
  const { lucas } = createLucas();
  const brunoScript = createBrunoScript();
  brunoScript.scenes[1].shots = [shotStatic({ id: "s2-shot-1", sceneOrder: 2, order: 1, purpose: "detail", startSeconds: 6, durationSeconds: 18 })];
  const response = await lucas.execute(createRequest(createVideoInput({ brunoScript })));
  assert.ok(response.output.issues.some((i) => i.code === "VIDEO_SCENE_SINGLE_SHOT"), "esperava VIDEO_SCENE_SINGLE_SHOT");
});

test("AGENCY FILM PIPELINE 2.0: Lucas reprova vídeo com poucos Shots (VIDEO_FEW_SHOTS)", async () => {
  const { lucas } = createLucas();
  const brunoScript = createBrunoScript();
  brunoScript.scenes[0].shots = [
    shotStatic({ id: "s1-shot-1", sceneOrder: 1, order: 1, purpose: "detail", startSeconds: 0, durationSeconds: 3 }),
    shotStatic({ id: "s1-shot-2", sceneOrder: 1, order: 2, purpose: "reaction", startSeconds: 3, durationSeconds: 3 }),
  ];
  brunoScript.scenes[1].shots = [
    shotStatic({ id: "s2-shot-1", sceneOrder: 2, order: 1, purpose: "detail", startSeconds: 6, durationSeconds: 9 }),
    shotStatic({ id: "s2-shot-2", sceneOrder: 2, order: 2, purpose: "reaction", startSeconds: 15, durationSeconds: 9 }),
  ];
  brunoScript.scenes[2].shots = [
    shotStatic({ id: "s3-shot-1", sceneOrder: 3, order: 1, purpose: "product", startSeconds: 24, durationSeconds: 6 }),
  ];
  // 2+2+1 = 5 Shots total (menor que 6)
  const response = await lucas.execute(createRequest(createVideoInput({ brunoScript })));
  assert.ok(response.output.issues.some((i) => i.code === "VIDEO_FEW_SHOTS"), "esperava VIDEO_FEW_SHOTS");
});

test("AGENCY FILM PIPELINE 2.0: Lucas reprova vídeo com aparência de slideshow (VIDEO_SLIDESHOW_LIKE)", async () => {
  const { lucas } = createLucas();
  const brunoScript = createBrunoScript();
  // Todos os shots são estáticos (static_hold + cut_in + cut_out + >=1.5s)
  brunoScript.scenes[0].shots = [
    shotStatic({ id: "s1-shot-1", sceneOrder: 1, order: 1, purpose: "detail", startSeconds: 0, durationSeconds: 3 }),
    shotStatic({ id: "s1-shot-2", sceneOrder: 1, order: 2, purpose: "reaction", startSeconds: 3, durationSeconds: 3 }),
  ];
  brunoScript.scenes[1].shots = [
    shotStatic({ id: "s2-shot-1", sceneOrder: 2, order: 1, purpose: "establishing", startSeconds: 6, durationSeconds: 6 }),
    shotStatic({ id: "s2-shot-2", sceneOrder: 2, order: 2, purpose: "detail", startSeconds: 12, durationSeconds: 6 }),
    shotStatic({ id: "s2-shot-3", sceneOrder: 2, order: 3, purpose: "human_interaction", startSeconds: 18, durationSeconds: 6 }),
  ];
  brunoScript.scenes[2].shots = [
    shotStatic({ id: "s3-shot-1", sceneOrder: 3, order: 1, purpose: "product", startSeconds: 24, durationSeconds: 3 }),
    shotStatic({ id: "s3-shot-2", sceneOrder: 3, order: 2, purpose: "closing", startSeconds: 27, durationSeconds: 3 }),
  ];
  const response = await lucas.execute(createRequest(createVideoInput({ brunoScript })));
  assert.ok(response.output.issues.some((i) => i.code === "VIDEO_SLIDESHOW_LIKE"), "esperava VIDEO_SLIDESHOW_LIKE");
});

test("AGENCY FILM PIPELINE 2.0: Lucas reprova excesso de mockup entre Shots (VIDEO_EXCESS_MOCKUP_SHOTS)", async () => {
  const { lucas } = createLucas();
  const brunoScript = createBrunoScript();
  const mockupShot = (id, sceneOrder, order, purpose, startSeconds, durationSeconds) => ({
    ...shotStatic({ id, sceneOrder, order, purpose, startSeconds, durationSeconds }),
    motion: { entrance: "fade_in", action: "drift", exit: "fade_out" }, // não slideshow
    assetRequirement: { preferredMediaKind: "mockup", sequenceRole: purpose },
  });
  brunoScript.scenes[0].shots = [
    mockupShot("s1-shot-1", 1, 1, "detail", 0, 3),
    mockupShot("s1-shot-2", 1, 2, "product", 3, 3),
  ];
  brunoScript.scenes[1].shots = [
    mockupShot("s2-shot-1", 2, 1, "establishing", 6, 6),
    mockupShot("s2-shot-2", 2, 2, "detail", 12, 6),
    mockupShot("s2-shot-3", 2, 3, "human_interaction", 18, 6),
  ];
  brunoScript.scenes[2].shots = [
    mockupShot("s3-shot-1", 3, 1, "product", 24, 3),
    mockupShot("s3-shot-2", 3, 2, "closing", 27, 3),
  ];
  const response = await lucas.execute(createRequest(createVideoInput({ brunoScript })));
  assert.ok(response.output.issues.some((i) => i.code === "VIDEO_EXCESS_MOCKUP_SHOTS"), "esperava VIDEO_EXCESS_MOCKUP_SHOTS");
});


// ---------------------------------------------------------------------------------------------
// PRODUCTION READINESS GATE — Lucas valida Production Readiness, Asset Diversity, Human Presence,
// Scene Variety e Shot Variety; qualquer índice abaixo do mínimo reprova automaticamente.
// ---------------------------------------------------------------------------------------------

function createProductionPlan(overrides = {}) {
  return {
    scenesCount: 5,
    shotsCount: 14,
    assetsNeeded: 14,
    assetsFound: 14,
    assetsMissing: 0,
    videoCount: 6,
    photoCount: 5,
    mockupCount: 2,
    productScreenCount: 1,
    humanAssetCount: 6,
    repeatedAssetCount: 0,
    varietySufficient: true,
    diversitySufficient: true,
    qualitySufficient: true,
    ...overrides,
  };
}

function createProductionReadinessScore(overrides = {}) {
  return {
    overall: 0.85,
    minimumAcceptable: 0.70,
    meetsMinimum: true,
    visualCoverage: 1,
    humanCoverage: 1,
    productCoverage: 1,
    emotionalCoverage: 1,
    videoCoverage: 0.43,
    sceneDiversity: 1,
    assetVariety: 1,
    ...overrides,
  };
}

test("Lucas não sinaliza nenhum problema de Production Readiness quando o Rafa não traz productionPlan/productionReadiness (renderização developer_assisted)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ productionPlan: undefined, productionReadiness: undefined }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("PRODUCTION_")));
});

test("Lucas aprova normalmente quando Production Readiness está totalmente saudável", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore(),
    }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("PRODUCTION_")));
  assert.equal(response.output.reviewStatus, "approved");
  assert.ok(response.output.checklist.some((item) => item.item.includes("Production Readiness") && item.passed));
});

test("Lucas reprova automaticamente quando Production Readiness fica abaixo do mínimo aceitável, mesmo com o resto do pacote coerente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore({ overall: 0.5, meetsMinimum: false }),
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "PRODUCTION_READINESS_LOW" && issue.severity === "high"));
  assert.equal(response.output.reviewStatus, "rejected", "PRODUCTION_READINESS_LOW está em BLOCKING_ISSUE_CODES — reprova independente da nota agregada");
  assert.equal(response.output.approvalRecommended, false);
});

test("Lucas sinaliza PRODUCTION_ASSET_DIVERSITY_LOW quando o Production Plan reporta variedade insuficiente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan({ varietySufficient: false, repeatedAssetCount: 8 }),
      productionReadiness: createProductionReadinessScore(),
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "PRODUCTION_ASSET_DIVERSITY_LOW"));
  assert.equal(response.output.reviewStatus, "rejected");
});

test("Lucas sinaliza PRODUCTION_HUMAN_PRESENCE_LOW quando a cobertura humana fica abaixo de 50%", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan({ humanAssetCount: 1 }),
      productionReadiness: createProductionReadinessScore({ humanCoverage: 0.2 }),
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "PRODUCTION_HUMAN_PRESENCE_LOW"));
  assert.equal(response.output.reviewStatus, "rejected");
});

test("Lucas sinaliza PRODUCTION_SCENE_VARIETY_LOW quando o Production Plan reporta violação de diversidade de cena/Shot", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan({ diversitySufficient: false }),
      productionReadiness: createProductionReadinessScore({ sceneDiversity: 0.3 }),
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "PRODUCTION_SCENE_VARIETY_LOW"));
  assert.equal(response.output.reviewStatus, "rejected");
});

test("Lucas sinaliza PRODUCTION_SHOT_VARIETY_LOW quando a variedade bruta de asset fica abaixo de 50%", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan({ repeatedAssetCount: 9 }),
      productionReadiness: createProductionReadinessScore({ assetVariety: 0.3 }),
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "PRODUCTION_SHOT_VARIETY_LOW"));
  assert.equal(response.output.reviewStatus, "rejected");
});

// -------------------------------------------------------------------------------------------
// PRODUCT COMPOSITING ENGINE — Composited Footage Quality Gate (evaluateCompositedProductFootageGate)
// -------------------------------------------------------------------------------------------

function createCompositedFootageCheck(overrides = {}) {
  return {
    shotId: "s1-shot-1",
    assetId: "composited-abc123",
    functionality: "rsvp",
    requiredFunctionality: "rsvp",
    legible: true,
    perspectiveCoherent: true,
    hasLeakageOutsideDevice: false,
    isStableAcrossFrames: true,
    coversFaceOrKeyElement: false,
    usesRealInterface: true,
    originLicenseRegistered: true,
    ...overrides,
  };
}

test("Lucas não sinaliza nenhum problema de composição de produto quando compositedProductFootage está ausente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ compositedProductFootage: undefined }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("COMPOSITED_SCREEN_")));
});

test("Lucas aprova normalmente quando todas as checagens de composição de produto passam", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore(),
      compositedProductFootage: [createCompositedFootageCheck()],
    }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("COMPOSITED_SCREEN_")));
  assert.equal(response.output.reviewStatus, "approved");
});

test("Lucas sinaliza COMPOSITED_SCREEN_ILLEGIBLE quando a tela composta não está legível", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ legible: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_ILLEGIBLE" && issue.severity === "high"));
});

test("Lucas reprova automaticamente quando a perspectiva da tela composta é incoerente (parece colada)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ perspectiveCoherent: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_PERSPECTIVE_INCOHERENT"));
  assert.equal(response.output.reviewStatus, "rejected", "COMPOSITED_SCREEN_PERSPECTIVE_INCOHERENT está em BLOCKING_ISSUE_CODES");
  assert.equal(response.output.approvalRecommended, false);
});

test("Lucas sinaliza COMPOSITED_SCREEN_LEAKAGE quando a composição vaza para fora do aparelho", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ hasLeakageOutsideDevice: true })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_LEAKAGE" && issue.severity === "high"));
});

test("Lucas sinaliza COMPOSITED_SCREEN_UNSTABLE quando a tela composta treme entre frames", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ isStableAcrossFrames: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_UNSTABLE" && issue.severity === "medium"));
});

test("Lucas sinaliza COMPOSITED_SCREEN_COVERS_KEY_ELEMENT quando a composição encobre o rosto/elemento-chave", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ coversFaceOrKeyElement: true })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_COVERS_KEY_ELEMENT" && issue.severity === "high"));
});

test("Lucas reprova automaticamente quando a funcionalidade da tela composta não corresponde à narrativa do Shot", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ functionality: "gift_list", requiredFunctionality: "rsvp" })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_FUNCTIONALITY_MISMATCH"));
  assert.equal(response.output.reviewStatus, "rejected");
});

test("Lucas sinaliza COMPOSITED_SCREEN_NOT_REAL_INTERFACE quando a tela composta não é reconhecida como interface real do produto", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ usesRealInterface: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_NOT_REAL_INTERFACE" && issue.category === "brand"));
});

test("Lucas reprova automaticamente quando a filmagem original da composição não tem origem/licença registrada", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [createCompositedFootageCheck({ originLicenseRegistered: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "COMPOSITED_SCREEN_ORIGIN_UNLICENSED" && issue.category === "risk"));
  assert.equal(response.output.reviewStatus, "rejected", "COMPOSITED_SCREEN_ORIGIN_UNLICENSED está em BLOCKING_ISSUE_CODES");
});

test("Lucas sinaliza múltiplos Shots compostos independentemente (um issue por Shot com problema)", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      compositedProductFootage: [
        createCompositedFootageCheck({ shotId: "s1-shot-1", legible: false }),
        createCompositedFootageCheck({ shotId: "s4-shot-3", hasLeakageOutsideDevice: true }),
      ],
    }),
  })));

  const illegible = response.output.issues.filter((issue) => issue.code === "COMPOSITED_SCREEN_ILLEGIBLE");
  const leaked = response.output.issues.filter((issue) => issue.code === "COMPOSITED_SCREEN_LEAKAGE");
  assert.equal(illegible.length, 1);
  assert.equal(leaked.length, 1);
  assert.ok(illegible[0].message.includes("s1-shot-1"));
  assert.ok(leaked[0].message.includes("s4-shot-3"));
});

// -------------------------------------------------------------------------------------------
// INTENT-BASED FOOTAGE ACQUISITION — Shot Intent Gate (evaluateShotIntentGate)
// -------------------------------------------------------------------------------------------

function createShotIntentCheck(overrides = {}) {
  return {
    shotId: "s1-shot-1",
    intentSatisfied: true,
    productIntegrationPossible: true,
    screenVisible: true,
    deviceOrientation: "front",
    narrativePreserved: true,
    ...overrides,
  };
}

test("Lucas não sinaliza nenhum problema de Shot Intent quando shotIntentChecks está ausente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ shotIntentChecks: undefined }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("SHOT_INTENT_")));
});

test("Lucas aprova normalmente quando todas as checagens de Shot Intent passam", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore(),
      shotIntentChecks: [createShotIntentCheck()],
    }),
  })));

  const codes = response.output.issues.map((issue) => issue.code);
  assert.ok(!codes.some((code) => code.startsWith("SHOT_INTENT_")));
  assert.equal(response.output.reviewStatus, "approved");
});

test("Lucas reprova automaticamente quando a intenção real do Shot não foi atendida", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      shotIntentChecks: [createShotIntentCheck({ intentSatisfied: false, detail: "mostra o verso do aparelho" })],
    }),
  })));

  const found = response.output.issues.find((issue) => issue.code === "SHOT_INTENT_NOT_SATISFIED");
  assert.ok(found);
  assert.equal(found.severity, "high");
  assert.match(found.message, /verso do aparelho/);
  assert.equal(response.output.reviewStatus, "rejected", "SHOT_INTENT_NOT_SATISFIED está em BLOCKING_ISSUE_CODES");
  assert.equal(response.output.approvalRecommended, false);
});

test("Lucas sinaliza SHOT_INTENT_PRODUCT_INTEGRATION_IMPOSSIBLE sem bloquear automaticamente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore(),
      shotIntentChecks: [createShotIntentCheck({ productIntegrationPossible: false, screenVisible: false, deviceOrientation: "unknown" })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "SHOT_INTENT_PRODUCT_INTEGRATION_IMPOSSIBLE" && issue.severity === "medium"));
});

test("Lucas sinaliza SHOT_INTENT_NARRATIVE_DRIFT quando o asset diverge da narrativa pretendida", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      productionPlan: createProductionPlan(),
      productionReadiness: createProductionReadinessScore(),
      shotIntentChecks: [createShotIntentCheck({ narrativePreserved: false })],
    }),
  })));

  assert.ok(response.output.issues.some((issue) => issue.code === "SHOT_INTENT_NARRATIVE_DRIFT" && issue.severity === "medium"));
});

test("Lucas avalia múltiplos Shots de Shot Intent independentemente", async () => {
  const { lucas } = createLucas();

  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({
      shotIntentChecks: [
        createShotIntentCheck({ shotId: "s1-shot-1", intentSatisfied: false }),
        createShotIntentCheck({ shotId: "s3-shot-3", narrativePreserved: false }),
      ],
    }),
  })));

  const notSatisfied = response.output.issues.filter((issue) => issue.code === "SHOT_INTENT_NOT_SATISFIED");
  const drift = response.output.issues.filter((issue) => issue.code === "SHOT_INTENT_NARRATIVE_DRIFT");
  assert.equal(notSatisfied.length, 1);
  assert.equal(drift.length, 1);
  assert.ok(notSatisfied[0].message.includes("s1-shot-1"));
  assert.ok(drift[0].message.includes("s3-shot-3"));
});

// -------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — evaluateCompositingVerificationGate: sinal de
// governança, não bloqueante — nenhum candidato compositing_ready pode ser tratado como aprovado
// sem revisão humana explícita.
// -------------------------------------------------------------------------------------------

function createCompositingReadiness(overrides = {}) {
  return {
    deviceCoverage: 1, visibleScreenCoverage: 1, interactionCoverage: 1, compositingGeometryCoverage: 1,
    temporalStabilityCoverage: 1, occlusionSafetyCoverage: 1, verifiedCompositingCoverage: 1,
    ...overrides,
  };
}

test("Lucas não sinaliza nada de compositingReadiness quando o campo está ausente (Rafa não populou — comportamento honesto, nunca finge ter dado)", async () => {
  const { lucas } = createLucas();
  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ compositingReadiness: undefined }),
  })));
  assert.ok(!response.output.issues.some((issue) => issue.code === "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM"));
});

test("Lucas não sinaliza nada quando compositingGeometryCoverage é 0 (nenhum candidato chegou perto de compositing_ready — nada para verificar)", async () => {
  const { lucas } = createLucas();
  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ compositingReadiness: createCompositingReadiness({ compositingGeometryCoverage: 0, verifiedCompositingCoverage: 0 }) }),
  })));
  assert.ok(!response.output.issues.some((issue) => issue.code === "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM"));
});

test("Lucas sinaliza PRODUCT_COMPOSITING_UNVERIFIED_CLAIM (não bloqueante) quando o pipeline automático acha candidatos prontos mas nenhum foi humanamente aprovado", async () => {
  const { lucas } = createLucas();
  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ compositingReadiness: createCompositingReadiness({ compositingGeometryCoverage: 0.8, verifiedCompositingCoverage: 0 }) }),
  })));
  const issue = response.output.issues.find((entry) => entry.code === "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM");
  assert.ok(issue);
  assert.equal(issue.severity, "medium");
  assert.notEqual(response.output.reviewStatus, "rejected", "sinal de governança não bloqueante — nunca reprova sozinho o vídeo");
});

test("Lucas NUNCA sinaliza PRODUCT_COMPOSITING_UNVERIFIED_CLAIM quando já existe verificação humana real (verifiedCompositingCoverage > 0)", async () => {
  const { lucas } = createLucas();
  const response = await lucas.execute(createRequest(createVideoInput({
    rafaVideo: createRafaVideo({ compositingReadiness: createCompositingReadiness({ compositingGeometryCoverage: 0.8, verifiedCompositingCoverage: 0.8 }) }),
  })));
  assert.ok(!response.output.issues.some((issue) => issue.code === "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM"));
});
