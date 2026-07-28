import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  EduardoEditorialPlanningSkill,
  buildBaselineEditorialBrief,
  eduardoEditorialPlanningManifest,
} from "../dist/skills/eduardo-editorial-planning/index.js";

const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";

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
        toneOfVoice: "leve divertido persuasivo",
        preferredCtas: ["Conheça o Rumo ao Altar"],
      }),
    ],
    AudienceContext: [
      claraRecord("AudienceContext", {
        clientId: CLIENT_ID,
        targetAudience: "Noivos e convidados de casamento",
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
      deliveredAt: "2026-07-10T12:00:00.000Z",
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
      model: { id: "fake-editorial-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 60, total: request.prompt.length + 60 },
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
    formatJustification: "Justificativa aprimorada pelo Ícaro para reforçar clareza e retenção.",
    narrativeStructure: ["Problema", "Solução", "Benefícios", "Comparação", "CTA"],
    primaryEmotion: "Confiança",
    recommendationsForJoao: ["Reforçar tom leve e persuasivo em todos os slides."],
  });
}

class InMemoryEduardoLogger {
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
    originalRequest: "Quero falar sobre taxa zero.",
    desiredChannel: "instagram",
    desiredObjective: "Quero falar sobre taxa zero.",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "eduardo-editorial-planning",
    input,
    context: {
      executionId: "exec-eduardo",
      taskId: "task-editorial-planning",
      correlationId: "corr-eduardo",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createEduardo(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryEduardoLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const eduardo = new EduardoEditorialPlanningSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    qualityFeedback: overrides.qualityFeedback,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-10T12:00:00.000Z"),
  });
  return { eduardo, valentina, clara, logger, events };
}

class FakeQualityFeedback {
  constructor(insights) {
    this.insights = insights;
    this.calls = [];
  }

  async getInsightsForClient(clientId, limit) {
    this.calls.push({ clientId, limit });
    if (this.insights instanceof Error) throw this.insights;
    return this.insights;
  }
}

function emptyInsights(clientId) {
  return {
    clientId,
    sampleSize: 0,
    overallAverageScore: undefined,
    lowScoringCategories: [],
    recurringComplaints: [],
    formatPerformance: [],
  };
}

test("Eduardo possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(eduardoEditorialPlanningManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "eduardo-editorial-planning");
  assert.deepEqual(result.manifest.capabilities, ["editorial_planning"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Eduardo consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { eduardo, valentina } = createEduardo();

  await eduardo.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await eduardo.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Eduardo consulta Clara apenas com os módulos relevantes para planejamento editorial", async () => {
  const { eduardo, clara } = createEduardo();

  await eduardo.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["BrandContext", "AudienceContext", "ContentContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Eduardo funciona sem Ícaro configurado e ainda gera um Editorial Brief estruturado", async () => {
  const { eduardo, logger } = createEduardo();

  const response = await eduardo.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Eduardo usa Ícaro de forma opcional para aprimorar apenas justificativa, estrutura narrativa, emoção e recomendações", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { eduardo, logger, events } = createEduardo({ icaro });

  const response = await eduardo.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "eduardo-editorial-planning");
  assert.equal(response.output.primaryEmotion, "Confiança");
  // Formato, quantidade, duração, canal e CTA nunca mudam por causa do Ícaro — só a heurística
  // decide esses campos, deliberadamente fora do que Eduardo permite o Ícaro aprimorar.
  assert.equal(response.output.recommendedFormat, "carrossel");
  assert.equal(response.output.recommendedSlideCount, 5);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
});

test("Eduardo segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { eduardo, logger } = createEduardo({ icaro });

  const response = await eduardo.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test('Exemplo do usuário — "Quero falar sobre taxa zero.": Carrossel, 5 slides, Conversão, Problema → Solução → Benefícios → Comparação → CTA', async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest(createInput({
    originalRequest: "Quero falar sobre taxa zero.",
    desiredObjective: "Quero falar sobre taxa zero.",
  })));

  const output = response.output;
  assert.equal(output.recommendedFormat, "carrossel");
  assert.equal(output.recommendedFormatLabel, "carrossel");
  assert.equal(output.recommendedSlideCount, 5);
  assert.equal(output.campaignObjective, "Conversão");
  assert.deepEqual(output.narrativeStructure, ["Problema", "Solução", "Benefícios", "Comparação", "CTA"]);
});

test('Exemplo do usuário — "Quero apresentar o painel dos noivos.": Reels, 30 segundos, Demonstração, Hook → Demonstração → Benefícios → CTA', async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest(createInput({
    originalRequest: "Quero apresentar o painel dos noivos.",
    desiredObjective: "Quero apresentar o painel dos noivos.",
  })));

  const output = response.output;
  assert.equal(output.recommendedFormat, "reels");
  assert.equal(output.recommendedFormatLabel, "reels");
  assert.equal(output.recommendedVideoDurationSeconds, 30);
  assert.equal(output.campaignObjective, "Demonstração");
  assert.deepEqual(output.narrativeStructure, ["Hook", "Demonstração", "Benefícios", "CTA"]);
});

test('Exemplo do usuário — "Quero divulgar a confirmação de presença.": Story, 3 telas', async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest(createInput({
    originalRequest: "Quero divulgar a confirmação de presença.",
    desiredObjective: "Quero divulgar a confirmação de presença.",
  })));

  const output = response.output;
  assert.equal(output.recommendedFormat, "story");
  assert.equal(output.recommendedFormatLabel, "story");
  assert.equal(output.recommendedSlideCount, 3);
});

test("Eduardo reconhece formas no gerúndio dos verbos de classificação, não só o infinitivo (regressão do BUG-03)", async () => {
  const { eduardo } = createEduardo();

  const cases = [
    { originalRequest: "Vídeo explicando como cadastrar a lista de presentes.", expectedObjective: "Educação" },
    { originalRequest: "Vídeo ensinando os convidados a usar o Pix.", expectedObjective: "Educação" },
    { originalRequest: "Post mostrando como funciona o painel dos noivos.", expectedObjective: "Demonstração" },
    { originalRequest: "Carrossel vendendo o plano PRO do Rumo ao Altar.", expectedObjective: "Conversão" },
  ];

  for (const testCase of cases) {
    const response = await eduardo.execute(createRequest(createInput({
      originalRequest: testCase.originalRequest,
      desiredObjective: testCase.originalRequest,
    })));

    assert.equal(
      response.output.campaignObjective,
      testCase.expectedObjective,
      `"${testCase.originalRequest}" deveria classificar como ${testCase.expectedObjective}, mas classificou como ${response.output.campaignObjective}`,
    );
  }
});

test("Eduardo reconhece termos comerciais adicionais (anunciando, promoção) como conversão", async () => {
  const { eduardo } = createEduardo();

  const anunciandoResponse = await eduardo.execute(createRequest(createInput({
    originalRequest: "Crie uma imagem para Facebook anunciando o plano PRO do Rumo ao Altar.",
    desiredObjective: "Crie uma imagem para Facebook anunciando o plano PRO do Rumo ao Altar.",
  })));
  assert.equal(anunciandoResponse.output.campaignObjective, "Conversão");

  const promocaoResponse = await eduardo.execute(createRequest(createInput({
    originalRequest: "Crie um carrossel sobre a promoção de fim de ano do Rumo ao Altar.",
    desiredObjective: "Crie um carrossel sobre a promoção de fim de ano do Rumo ao Altar.",
  })));
  assert.equal(promocaoResponse.output.campaignObjective, "Conversão");
});

test("Eduardo respeita quantidade explícita no texto mesmo quando o formato é inferido pelo objetivo", async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest(createInput({
    originalRequest: "Quero falar sobre taxa zero em 7 slides.",
    desiredObjective: "Quero falar sobre taxa zero em 7 slides.",
  })));

  assert.equal(response.output.recommendedFormat, "carrossel");
  assert.equal(response.output.recommendedSlideCount, 7);
});

test("Eduardo monta recomendações estruturadas para o João, incluindo profundidade, complexidade e prioridade de conversão", async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest());

  const output = response.output;
  assert.ok(Array.isArray(output.recommendationsForJoao) && output.recommendationsForJoao.length > 0);
  assert.ok(["baixo", "medio", "alto"].includes(output.depthLevel));
  assert.ok(["baixa", "media", "alta"].includes(output.contentComplexity));
  assert.ok(["baixa", "media", "alta"].includes(output.conversionPriority));
  assert.equal(output.recommendedChannel, "instagram");
  assert.equal(response.artifacts[0].type, "plan");
});

test("Eduardo não cria copy, imagem ou vídeo; devolve apenas o Editorial Brief estruturado", async () => {
  const { eduardo } = createEduardo();

  const response = await eduardo.execute(createRequest());

  assert.equal(response.output.caption, undefined);
  assert.equal(response.output.images, undefined);
  assert.equal(response.output.video, undefined);
});

test("Eduardo trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { eduardo, logger, events } = createEduardo({ valentina: new FakeValentina([]) });

  const response = await eduardo.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "EditorialPlanningFailed"));
});

test("Eduardo valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { eduardo, valentina, clara, logger, events } = createEduardo();

  const response = await eduardo.execute(createRequest(createInput({ desiredObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "EditorialPlanningFailed"));
});

test("Eduardo registra os logs esperados em uma execução completa", async () => {
  const { eduardo, logger } = createEduardo();

  await eduardo.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("PlanningStarted"));
  assert.ok(actions.includes("PlanningFinalized"));
  assert.ok(actions.includes("JoaoBriefingCreated"));
});

test("Eduardo emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { eduardo, events } = createEduardo({ icaro });

  await eduardo.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "EditorialPlanningStarted",
    "EditorialPlanningContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "EditorialPlanningGenerated",
    "EduardoBriefingCreated",
  ]);
});

test("buildBaselineEditorialBrief é puro e reutilizável", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "eduardo-editorial-planning", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "AudienceContext", "ContentContext"],
  });

  const brief = buildBaselineEditorialBrief(createInput(), context);
  assert.equal(brief.recommendedFormat, "carrossel");
  assert.equal(brief.recommendedCta, "Conheça o Rumo ao Altar");
});

test("Eduardo deriva o Creative DNA da campanha e o usa para enriquecer as recomendações para o João", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "eduardo-editorial-planning", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "AudienceContext", "ContentContext"],
  });

  const brief = buildBaselineEditorialBrief(createInput(), context);

  assert.ok(brief.creativeDna);
  assert.ok(brief.creativeDna.bigIdea.length > 0);
  assert.ok(brief.creativeDna.heroScene.length > 0);
  assert.ok(brief.creativeDna.visualMetaphor.length > 0);
  assert.ok(brief.recommendationsForJoao.some((recommendation) => recommendation.includes("Big Idea da campanha")));
  assert.ok(brief.recommendationsForJoao.some((recommendation) => recommendation.includes(brief.creativeDna.visualMetaphor)));
});

test("Eduardo não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Eduardo não chama João diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("joao-marketing-strategy"), false);
  assert.equal(lowered.includes("joaomarketingstrategyskill"), false);
  assert.equal(lowered.includes("createjoaomarketingstrategyskill"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

// --- Consulta ao histórico de Quality Feedback (não é uma Skill, não decide sozinho) -------------

test("Eduardo funciona normalmente sem Quality Feedback configurado (comportamento idêntico ao anterior)", async () => {
  const { eduardo, logger } = createEduardo();

  const response = await eduardo.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.feedbackInformed, false);
  assert.ok(logger.list().some((entry) => entry.action === "FeedbackHistorySkipped"));
});

test("Eduardo consulta o histórico de Quality Feedback pelo clientId resolvido pela Valentina", async () => {
  const qualityFeedback = new FakeQualityFeedback(emptyInsights(CLIENT_ID));
  const { eduardo } = createEduardo({ qualityFeedback });

  await eduardo.execute(createRequest());

  assert.equal(qualityFeedback.calls.length, 1);
  assert.equal(qualityFeedback.calls[0].clientId, CLIENT_ID);
});

test("Eduardo recomenda CTA mais forte quando o histórico mostra nota baixa em CTA, sem mudar o formato recomendado", async () => {
  const withoutFeedback = await createEduardo().eduardo.execute(createRequest());

  const qualityFeedback = new FakeQualityFeedback({
    ...emptyInsights(CLIENT_ID),
    sampleSize: 5,
    lowScoringCategories: ["cta"],
  });
  const { eduardo, logger } = createEduardo({ qualityFeedback });
  const response = await eduardo.execute(createRequest());

  assert.equal(response.output.feedbackInformed, true);
  assert.ok(response.output.recommendationsForJoao.some((recommendation) => recommendation.includes("CTA mais forte")));
  // A decisão determinística de formato/quantidade nunca muda por causa do feedback.
  assert.equal(response.output.recommendedFormat, withoutFeedback.output.recommendedFormat);
  assert.equal(response.output.recommendedSlideCount, withoutFeedback.output.recommendedSlideCount);
  assert.equal(response.output.recommendedCta, withoutFeedback.output.recommendedCta);
  assert.ok(logger.list().some((entry) => entry.action === "FeedbackHistoryConsulted"));
});

test("Eduardo sugere maior variedade de hashtags quando o histórico mostra nota baixa em hashtags", async () => {
  const qualityFeedback = new FakeQualityFeedback({
    ...emptyInsights(CLIENT_ID),
    sampleSize: 4,
    lowScoringCategories: ["hashtags"],
  });
  const { eduardo } = createEduardo({ qualityFeedback });

  const response = await eduardo.execute(createRequest());

  assert.ok(response.output.recommendationsForJoao.some((recommendation) => recommendation.includes("maior variedade de hashtags")));
});

test("Eduardo considera recomendar vídeo quando o histórico mostra desempenho melhor em vídeo do que em carrossel, sem trocar o formato automaticamente", async () => {
  const qualityFeedback = new FakeQualityFeedback({
    ...emptyInsights(CLIENT_ID),
    sampleSize: 6,
    formatPerformance: [
      { format: "reels", averageScore: 9, count: 3 },
      { format: "carrossel", averageScore: 6, count: 3 },
    ],
  });
  const { eduardo } = createEduardo({ qualityFeedback });

  // "Quero falar sobre taxa zero." recomenda carrossel por heurística (ver teste dedicado acima).
  const response = await eduardo.execute(createRequest(createInput({
    originalRequest: "Quero falar sobre taxa zero.",
    desiredObjective: "Quero falar sobre taxa zero.",
  })));

  assert.equal(response.output.recommendedFormat, "carrossel");
  assert.ok(response.output.recommendationsForJoao.some((recommendation) => recommendation.includes("considerar recomendar vídeo")));
});

test("Eduardo segue com o planejamento heurístico quando a consulta ao Quality Feedback falha, sem interromper a execução", async () => {
  const qualityFeedback = new FakeQualityFeedback(new Error("Repositório de feedback indisponível"));
  const { eduardo, logger } = createEduardo({ qualityFeedback });

  const response = await eduardo.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.feedbackInformed, false);
  assert.ok(logger.list().some((entry) => entry.action === "FeedbackHistoryFailed"));
});

test("Eduardo não fica \"informado por feedback\" quando a amostra do cliente está vazia", async () => {
  const qualityFeedback = new FakeQualityFeedback(emptyInsights(CLIENT_ID));
  const { eduardo } = createEduardo({ qualityFeedback });

  const response = await eduardo.execute(createRequest());

  assert.equal(response.output.feedbackInformed, false);
});
