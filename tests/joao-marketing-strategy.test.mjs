import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  JoaoMarketingStrategySkill,
  buildBaselineStrategy,
  buildCreativeBrief,
  buildMariaBriefing,
  buildSofiaBriefing,
  mergeStrategyEnhancement,
  joaoMarketingStrategyManifest,
} from "../dist/skills/joao-marketing-strategy/index.js";

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
        preferredCtas: ["Conheça o Rumo ao Altar"],
        preferredHashtags: ["#casamento", "#noivos"],
        mandatoryWords: ["Rumo ao Altar"],
        forbiddenWords: ["garantia absoluta"],
        keywords: ["casamento", "noivos"],
      }),
    ],
    AudienceContext: [
      claraRecord("AudienceContext", {
        clientId: CLIENT_ID,
        targetAudience: "Noivos e convidados de casamento",
      }),
    ],
    ProductContext: [
      claraRecord("ProductContext", {
        clientId: CLIENT_ID,
        productName: "Pacote All-Inclusive",
        description: "Pacote completo de casamento all-inclusive com fornecedores selecionados.",
        benefits: ["Organização completa sem esforço para os noivos"],
        differentiators: ["Curadoria exclusiva de fornecedores premiados"],
      }),
    ],
    CampaignContext: [
      claraRecord("CampaignContext", {
        clientId: CLIENT_ID,
        campaignName: "Lançamento All-Inclusive 2026",
        status: "active",
        objective: "Gerar vendas do novo pacote",
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
      model: { id: "fake-strategy-model" },
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
    angle: "Ângulo de exclusividade com prova social de casamentos reais.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    valueProposition: "Curadoria completa de fornecedores premiados em um único pacote.",
    keyMessages: ["Tudo incluído, do buffet à decoração.", "Curadoria exclusiva de fornecedores premiados."],
    risks: ["Evitar prometer resultado idêntico para todos os casamentos."],
  });
}

class InMemoryJoaoLogger {
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

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero divulgar o lançamento do novo pacote de casamento all-inclusive.",
    desiredChannel: "instagram",
    desiredFormat: "carrossel",
    desiredObjective: "vender o pacote all-inclusive",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "joao-marketing-strategy",
    input,
    context: {
      executionId: "exec-joao",
      taskId: "task-strategy",
      correlationId: "corr-joao",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createJoao(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryJoaoLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const joao = new JoaoMarketingStrategySkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });
  return { joao, valentina, clara, logger, events };
}

test("João possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(joaoMarketingStrategyManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "joao-marketing-strategy");
  assert.deepEqual(result.manifest.capabilities, ["marketing_strategy", "strategy"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("João consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { joao, valentina } = createJoao();

  await joao.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await joao.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("João consulta Clara com os módulos de conhecimento esperados", async () => {
  const { joao, clara } = createJoao();

  await joao.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, [
    "BrandContext",
    "AudienceContext",
    "ProductContext",
    "CampaignContext",
    "ContentContext",
    "IdentityContext",
    "PublishingContext",
  ]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("João funciona sem Ícaro configurado e ainda gera estratégia estruturada", async () => {
  const { joao, logger } = createJoao();

  const response = await joao.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("João usa Ícaro de forma opcional para aprimorar a estratégia quando disponível", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { joao, logger, events } = createJoao({ icaro });

  const response = await joao.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "joao-marketing-strategy");
  assert.equal(response.output.angle, "Ângulo de exclusividade com prova social de casamentos reais.");
  assert.deepEqual(response.output.keyMessages, [
    "Tudo incluído, do buffet à decoração.",
    "Curadoria exclusiva de fornecedores premiados.",
  ]);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("João segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { joao, logger } = createJoao({ icaro });

  const response = await joao.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("João gera estratégia estruturada completa a partir do contexto da Clara", async () => {
  const { joao } = createJoao();

  const response = await joao.execute(createRequest());

  const output = response.output;
  assert.equal(output.objective, "vender o pacote all-inclusive");
  assert.equal(output.targetAudience, "Noivos e convidados de casamento");
  assert.equal(output.channel, "instagram");
  assert.equal(output.format, "carrossel");
  assert.equal(output.toneOfVoice, "leve divertido persuasivo");
  assert.ok(output.angle.length > 0);
  assert.ok(output.centralPromise.length > 0);
  assert.ok(output.valueProposition.length > 0);
  assert.ok(output.keyMessages.length > 0);
  assert.equal(output.recommendedCta, "Conheça o Rumo ao Altar");
  assert.ok(output.risks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("João monta briefing estruturado para Maria compatível com o canal de entrada da Maria", async () => {
  const { joao } = createJoao();

  const response = await joao.execute(createRequest({
    clientId: CLIENT_ID,
    originalRequest: "Quero anunciar o pacote all-inclusive em campanha paga no Meta.",
    desiredChannel: "meta_ads",
    desiredFormat: "post único",
    desiredObjective: "vender o pacote all-inclusive",
  }));

  const briefing = response.output.mariaBriefing;
  assert.equal(briefing.channel, "instagram");
  assert.equal(briefing.objective, "vender o pacote all-inclusive");
  assert.equal(briefing.targetAudience, "Noivos e convidados de casamento");
  assert.equal(briefing.toneOfVoice, "leve divertido persuasivo");
  assert.ok(briefing.cta.length > 0);
  assert.ok(briefing.keyMessage.length > 0);
  assert.equal(briefing.language, "pt-BR");
  assert.deepEqual(briefing.forbiddenTerms, ["garantia absoluta"]);
  assert.deepEqual(briefing.mandatoryWords, ["Rumo ao Altar"]);
  assert.deepEqual(briefing.preferredHashtags, ["#casamento", "#noivos"]);
});

test("João deixa de decidir formato e CTA sozinho quando recebe o Editorial Brief do Eduardo", async () => {
  const { joao } = createJoao();

  const editorialBrief = {
    campaignObjective: "Conversão",
    recommendedFormat: "carrossel",
    recommendedFormatLabel: "carrossel",
    formatJustification: "Narrativa em múltiplos slides favorece conversão.",
    recommendedSlideCount: 5,
    recommendedChannel: "instagram",
    primaryEmotion: "Confiança",
    narrativeStructure: ["Problema", "Solução", "Benefícios", "Comparação", "CTA"],
    recommendedCta: "Conheça o Rumo ao Altar agora",
    depthLevel: "alto",
    contentComplexity: "media",
    conversionPriority: "alta",
    recommendationsForJoao: ["Seguir estrutura narrativa sugerida: Problema → Solução → Benefícios → Comparação → CTA."],
  };

  const response = await joao.execute(createRequest(createInput({ desiredFormat: "post único", editorialBrief })));

  assert.equal(response.output.format, "carrossel");
  assert.equal(response.output.recommendedCta, "Conheça o Rumo ao Altar agora");
  assert.ok(response.output.observations.some((observation) => observation.includes("Plano editorial do Eduardo")));
  assert.ok(response.output.sofiaBriefing.notes.some((note) => note.includes("Problema → Solução → Benefícios → Comparação → CTA")));
});

test("João monta briefing preliminar para a futura Sofia com base na identidade visual da Clara", async () => {
  const { joao } = createJoao();

  const response = await joao.execute(createRequest());

  const sofiaBriefing = response.output.sofiaBriefing;
  assert.equal(sofiaBriefing.status, "preliminary");
  assert.ok(sofiaBriefing.visualDirectionNotes.includes("Usar tipografia serifada em peças de destaque."));
  assert.ok(sofiaBriefing.brandIdentityNotes.some((note) => note.includes("#D4AF37")));
});

test("João não cria copy final; devolve apenas estratégia e briefings estruturados", async () => {
  const { joao } = createJoao();

  const response = await joao.execute(createRequest());

  assert.equal(response.output.caption, undefined);
  assert.equal(response.output.title, undefined);
  assert.equal(response.output.hashtags, undefined);
});

test("João trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { joao, logger, events } = createJoao({ valentina: new FakeValentina([]) });

  const response = await joao.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "MarketingStrategyFailed"));
});

test("João trata contexto incompleto na Clara como necessidade de mais contexto", async () => {
  const { joao, logger, events } = createJoao({ clara: new FakeClara({}) });

  const response = await joao.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "MarketingStrategyFailed"));
});

test("João valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { joao, valentina, clara, logger, events } = createJoao();

  const response = await joao.execute(createRequest(createInput({ desiredObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "MarketingStrategyFailed"));
});

test("João registra os logs esperados em uma execução completa", async () => {
  const { joao, logger } = createJoao();

  await joao.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("StrategyStarted"));
  assert.ok(actions.includes("StrategyFinalized"));
  assert.ok(actions.includes("MariaBriefingCreated"));
});

test("João emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { joao, events } = createJoao({ icaro });

  await joao.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "MarketingStrategyStarted",
    "MarketingContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "MarketingStrategyGenerated",
    "MariaBriefingCreated",
  ]);
});

test("buildBaselineStrategy, buildMariaBriefing e buildSofiaBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "joao-marketing-strategy", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const strategy = buildBaselineStrategy(input, context);
  assert.equal(strategy.targetAudience, "Noivos e convidados de casamento");

  const briefing = buildMariaBriefing(strategy, { language: "pt-BR" }, context);
  assert.equal(briefing.channel, "instagram");
  assert.deepEqual(briefing.forbiddenTerms, ["garantia absoluta"]);
  assert.deepEqual(briefing.mandatoryWords, ["Rumo ao Altar"]);
  assert.deepEqual(briefing.preferredHashtags, ["#casamento", "#noivos"]);
  assert.deepEqual(briefing.keywords, ["casamento", "noivos"]);

  const sofiaBriefing = buildSofiaBriefing(strategy, input, context);
  assert.equal(sofiaBriefing.status, "preliminary");
});

test("João deriva o Creative DNA da campanha e o usa para enriquecer as observações", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "joao-marketing-strategy", type: "specialist" },
    clientId: CLIENT_ID,
  });

  const strategy = buildBaselineStrategy(createInput(), context);

  assert.ok(strategy.creativeDna);
  assert.ok(strategy.creativeDna.bigIdea.length > 0);
  assert.ok(strategy.creativeDna.heroScene.length > 0);
  assert.ok(strategy.observations.some((observation) => observation.includes("Creative DNA — Big Idea")));
  assert.ok(strategy.observations.some((observation) => observation.includes("Creative DNA — Hero Scene")));
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
      commercialConditions: ["até 7x de R$6,41", "frete grátis com cupom"],
      shippingInfo: "grátis com cupom",
    },
    uncertainFacts: [],
    claimSourceMap: {},
    ...overrides,
  };
}

test("buildCreativeBrief: prioriza a oferta REAL da imagem de referência sobre a faixa de preço cadastrada na Clara", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({ requester: { id: "joao-marketing-strategy", type: "specialist" }, clientId: CLIENT_ID });
  const input = createInput({ referenceIntelligence: tenisReferenceIntelligence() });
  const strategy = buildBaselineStrategy(input, context);

  const brief = buildCreativeBrief(strategy, input, context);

  assert.match(brief.offer, /R\$ 39,99/);
  assert.match(brief.offer, /R\$ 79,99/);
  assert.match(brief.offer, /50%/);
  assert.equal(brief.commercialFactsSource, "reference_image");
});

test("buildCreativeBrief: NÃO trata 'prazo ou condição de oferta' como não-confirmado quando a referência traz uma promoção/condição real", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({ requester: { id: "joao-marketing-strategy", type: "specialist" }, clientId: CLIENT_ID });
  const input = createInput({ referenceIntelligence: tenisReferenceIntelligence() });
  const strategy = buildBaselineStrategy(input, context);

  const brief = buildCreativeBrief(strategy, input, context);

  assert.ok(!brief.nonInventableInfo.includes("prazo ou condição de oferta"), `nonInventableInfo não deveria conter "prazo ou condição de oferta": ${JSON.stringify(brief.nonInventableInfo)}`);
});

test("buildCreativeBrief: sem Reference Intelligence, comportamento idêntico a antes (regressão) — oferta cadastrada na Clara e prazo/condição sempre não-confirmados", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({ requester: { id: "joao-marketing-strategy", type: "specialist" }, clientId: CLIENT_ID });
  const input = createInput();
  const strategy = buildBaselineStrategy(input, context);

  const brief = buildCreativeBrief(strategy, input, context);

  assert.equal(brief.commercialFactsSource, "none");
  assert.equal(brief.offer, undefined);
  assert.ok(brief.nonInventableInfo.includes("prazo ou condição de oferta"));
  assert.ok(brief.nonInventableInfo.includes("preço"));
});

test("buildCreativeBrief: produto identificado na referência visual vira productOrService/mandatoryInfo, para o produto certo permanecer protagonista", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({ requester: { id: "joao-marketing-strategy", type: "specialist" }, clientId: CLIENT_ID });
  const input = createInput({ referenceIntelligence: tenisReferenceIntelligence() });
  const strategy = buildBaselineStrategy(input, context);

  const brief = buildCreativeBrief(strategy, input, context);

  assert.equal(brief.productOrService, "Tênis Casual Unissex Skatista RV");
  assert.ok(brief.mandatoryInfo.includes("Tênis Casual Unissex Skatista RV"));
});

test("mergeStrategyEnhancement recalcula o Creative DNA quando o apoio de IA reescreve a promessa central, para não ficar com um DNA desatualizado", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "joao-marketing-strategy", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const strategy = buildBaselineStrategy(createInput(), context);
  const originalDna = strategy.creativeDna;

  const merged = mergeStrategyEnhancement(strategy, {
    centralPromise: "Uma nova promessa completamente diferente sobre viagens internacionais.",
  });

  assert.notEqual(merged.creativeDna, originalDna);
  assert.ok(merged.creativeDna.bigIdea.length > 0);

  const unchanged = mergeStrategyEnhancement(strategy, { angle: "Novo ângulo, mesma promessa." });
  assert.equal(unchanged.creativeDna, originalDna);
});

test("João não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("João não chama Maria diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  // João monta um briefing PARA a Maria (daí referências a "mariaBriefing"), mas nunca deve
  // importar, instanciar ou executar a Skill concreta da Maria.
  assert.equal(lowered.includes("maria-copywriting"), false);
  assert.equal(lowered.includes("mariacopywritingskill"), false);
  assert.equal(lowered.includes("createmariacopywritingskill"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});
