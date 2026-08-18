import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  BiancaSocialMediaDesignSkill,
  buildBaselineDesign,
  buildPedroBriefing,
  buildPerformanceCreativePlan,
  buildAdLayoutSpec,
  biancaSocialMediaDesignManifest,
} from "../dist/skills/bianca-social-media-design/index.js";

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
    IdentityContext: [
      claraRecord("IdentityContext", {
        clientId: CLIENT_ID,
        logoUri: "local://brand/logo.png",
        colors: ["#FFFFFF", "#D4AF37"],
        fonts: ["Playfair Display"],
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
      model: { id: "fake-design-model" },
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
    gridSystem: "Grid de 12 colunas, margem lateral de 6%.",
    visualHierarchyStrategy: "Elemento visual, depois headline, depois CTA.",
    colorApplication: "Aplicar #D4AF37 como destaque principal sobre fundo #FFFFFF.",
    componentStyle: ["Cards translúcidos.", "Ícones em traço fino dourado."],
    illustrationStyle: "Fotografia editorial com luz natural.",
    mockupStyle: "Nenhum mockup necessário.",
  });
}

class InMemoryBiancaLogger {
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
    angle: "Ângulo de conversão com benefício direto e chamada clara para ação.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    keyMessages: ["Tudo incluído, do buffet à decoração.", "Curadoria exclusiva de fornecedores premiados."],
    recommendedCta: "Conheça o Rumo ao Altar",
    ...overrides,
  };
}

function createSofiaDirection(overrides = {}) {
  return {
    visualConcept: "Ensaio editorial com casal real em cenário ao ar livre, luz natural dourada.",
    recommendedStyle: "editorial romântico",
    emotionalTone: "Aconchego e leveza, sem parecer produzido demais.",
    suggestedPalette: ["#FFFFFF", "#D4AF37"],
    typography: ["Fonte principal (títulos): Playfair Display."],
    moodboard: ["Luz dourada de fim de tarde."],
    designReferences: ["Editoriais de casamento ao ar livre."],
    recommendedFormat: "carrossel",
    recommendedAspectRatio: "4:5",
    visualConstraints: ["Usar tipografia serifada em peças de destaque."],
    visualRisks: ["Validar identidade visual real antes da produção."],
    observations: [],
    nextSteps: [],
    ...overrides,
  };
}

function createSofiaBriefing(overrides = {}) {
  return {
    status: "preliminary",
    visualConcept: "Ensaio editorial com casal real em cenário ao ar livre, luz natural dourada.",
    recommendedStyle: "editorial romântico",
    emotionalTone: "Aconchego e leveza, sem parecer produzido demais.",
    suggestedPalette: ["#FFFFFF", "#D4AF37"],
    typography: ["Fonte principal (títulos): Playfair Display."],
    moodboard: ["Luz dourada de fim de tarde."],
    designReferences: ["Editoriais de casamento ao ar livre."],
    recommendedFormat: "carrossel",
    recommendedAspectRatio: "4:5",
    visualConstraints: ["Usar tipografia serifada em peças de destaque."],
    channel: "instagram",
    notes: ["Layout, grid, hierarquia visual detalhada... são responsabilidade da Bianca."],
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um carrossel de lançamento do novo pacote de casamento all-inclusive.",
    joaoStrategy: createJoaoStrategy(),
    sofiaDirection: createSofiaDirection(),
    sofiaBriefing: createSofiaBriefing(),
    channel: "instagram",
    format: "carrossel",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "bianca-social-media-design",
    input,
    context: {
      executionId: "exec-bianca",
      taskId: "task-design",
      correlationId: "corr-bianca",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createBianca(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryBiancaLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const bianca = new BiancaSocialMediaDesignSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });
  return { bianca, valentina, clara, logger, events };
}

test("Bianca possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(biancaSocialMediaDesignManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "bianca-social-media-design");
  assert.deepEqual(result.manifest.capabilities, ["social_media_design"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Bianca consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { bianca, valentina } = createBianca();

  await bianca.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await bianca.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Bianca consulta Clara apenas com os módulos de identidade visual e publicação", async () => {
  const { bianca, clara } = createBianca();

  await bianca.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["IdentityContext", "PublishingContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Bianca funciona sem Ícaro configurado e ainda gera uma especificação de design estruturada", async () => {
  const { bianca, logger } = createBianca();

  const response = await bianca.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Bianca usa Ícaro de forma opcional para aprimorar apenas grid, hierarquia, cor e estilo de componentes", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { bianca, logger, events } = createBianca({ icaro });

  const response = await bianca.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "bianca-social-media-design");
  assert.equal(response.output.gridSystem, "Grid de 12 colunas, margem lateral de 6%.");
  assert.deepEqual(response.output.componentStyle, ["Cards translúcidos.", "Ícones em traço fino dourado."]);
  // Conceito, paleta e tipografia continuam vindo da Sofia, nunca reinterpretados por este apoio de IA.
  assert.equal(response.output.visualConcept, createSofiaDirection().visualConcept);
  assert.deepEqual(response.output.suggestedPalette, createSofiaDirection().suggestedPalette);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Bianca segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { bianca, logger } = createBianca({ icaro });

  const response = await bianca.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("Bianca gera layout detalhado completo a partir da direção da Sofia e do contexto da Clara", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(output.designConcept.includes(output.visualConcept));
  assert.ok(output.gridSystem.length > 0);
  assert.ok(output.visualHierarchyStrategy.length > 0);
  assert.equal(typeof output.typographyScale.headline, "string");
  assert.equal(typeof output.typographyScale.subheadline, "string");
  assert.equal(typeof output.typographyScale.body, "string");
  assert.equal(typeof output.typographyScale.caption, "string");
  assert.ok(output.colorApplication.length > 0);
  assert.ok(output.componentStyle.length >= 5);
  assert.ok(output.illustrationStyle.length > 0);
  assert.ok(output.mockupStyle.length > 0);
  assert.ok(output.logoPlacement.length > 0);
  assert.ok(output.designConstraints.length > 0);
  assert.ok(output.designRisks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("Bianca enriquece o Design Brief com direção de arte profissional sem assumir responsabilidades da Sofia", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(output.emotionalObjective.includes(createJoaoStrategy().centralPromise));
  assert.ok(output.desiredFeeling.includes(createSofiaDirection().emotionalTone));
  assert.ok(output.minimalismLevel.toLowerCase().includes("mensagem principal"));
  assert.ok(output.visualStyle.includes(createSofiaDirection().recommendedStyle));
  assert.equal(output.visualConcept, createSofiaDirection().visualConcept);
  assert.deepEqual(output.suggestedPalette, createSofiaDirection().suggestedPalette);
  assert.equal(output.recommendedStyle, createSofiaDirection().recommendedStyle);
});

test("Bianca detalha composição visual, hierarquia, áreas seguras e escala de elementos para leitura mobile", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.match(output.compositionStrategy, /capa|slides internos|CTA/i);
  assert.match(output.lightingStrategy, /iluminação|luz/i);
  assert.match(output.depthStrategy, /profundidade|primeiro plano/i);
  assert.match(output.contrastStrategy, /contraste|CTA/i);
  assert.match(output.instagramSafeArea, /8%|área segura/i);
  assert.match(output.logoSizing, /%/);
  assert.match(output.titleSizing, /%|linhas/i);
  assert.match(output.subtitleSizing, /%|frase/i);
  assert.match(output.supportTextSizing, /linhas|%/i);
  assert.match(output.buttonSizing, /botão|card|%/i);
  assert.ok(output.elementSpacingRules.length >= 3);
  assert.ok(output.alignmentRules.length >= 3);
  assert.ok(output.shadowRules.length >= 3);
});

test("Bianca define regras claras para capa, slides internos e CTA final", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(output.coverRules.some((rule) => /capa|primeiro slide/i.test(rule)));
  assert.ok(output.coverRules.some((rule) => rule.includes(createJoaoStrategy().centralPromise)));
  assert.ok(output.internalSlideRules.some((rule) => /uma mensagem principal/i.test(rule)));
  assert.ok(output.finalCtaRules.some((rule) => rule.includes(createJoaoStrategy().recommendedCta)));
  assert.ok(output.finalCtaRules.some((rule) => /maior contraste|respiro/i.test(rule)));
});

test("Bianca orienta uso de ícones, mockups, fotografias, ilustrações, cards e blocos coloridos", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(output.iconographyUsage.some((rule) => /ícones/i.test(rule)));
  assert.ok(output.mockupUsage.length > 0);
  assert.ok(output.photographyUsage.some((rule) => /fotografia|foto/i.test(rule)));
  assert.ok(output.illustrationUsage.some((rule) => /ilustração/i.test(rule)));
  assert.ok(output.cardUsage.some((rule) => /cards/i.test(rule)));
  assert.ok(output.colorBlockUsage.some((rule) => /blocos coloridos/i.test(rule)));
  assert.match(output.photoTreatment, /Tratamento fotográfico/i);
  assert.ok(output.decorativeElements.length >= 3);
});

test("Bianca gera justificativa técnica para auditoria do Lucas e a mantém fora do texto final da arte", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.match(output.technicalJustification, /auditoria do Lucas/i);
  assert.match(output.technicalJustification, /Pedro/i);
  assert.match(output.technicalJustification, /Sofia/i);
  assert.ok(output.pedroBriefing.notes.some((note) => note.includes("auditoria para Lucas")));
  assert.ok(output.pedroBriefing.notes.some((note) => note.includes("não deve aparecer na arte final")));
});

test("Bianca define tamanho e posição/destaque de CTA, geral e nos slides que têm CTA", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.equal(typeof output.typographyScale.cta, "string");
  assert.ok(output.typographyScale.cta.length > 0);
  assert.ok(output.ctaPlacement.length > 0);

  const hookSlide = output.slides[0];
  const ctaSlide = output.slides.at(-1);
  assert.equal(hookSlide.ctaPlacement, undefined);
  assert.ok(ctaSlide.ctaPlacement.length > 0);
});

test("Bianca define ctaPlacement no único slide de uma peça avulsa (não carrossel)", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest(createInput({ format: "post único" })));

  assert.equal(response.output.slides.length, 1);
  assert.ok(response.output.slides[0].ctaPlacement.length > 0);
});

test("Bianca só define composição de capa de Reels quando o formato pede, e omite nos demais formatos", async () => {
  const { bianca } = createBianca();

  const reelsResponse = await bianca.execute(createRequest(createInput({ format: "reels cover" })));
  assert.equal(typeof reelsResponse.output.reelsCoverComposition, "string");
  assert.ok(reelsResponse.output.reelsCoverComposition.length > 0);
  assert.ok(reelsResponse.output.reelsCoverRules.some((rule) => /metade superior|Instagram|thumbnail/i.test(rule)));

  const feedResponse = await bianca.execute(createRequest(createInput({ format: "post único" })));
  assert.equal(feedResponse.output.reelsCoverComposition, undefined);
  assert.ok(feedResponse.output.reelsCoverRules.some((rule) => /não aplicáveis/i.test(rule)));
});

test("Bianca define regras dedicadas de contraste e diretrizes de acessibilidade visual", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(Array.isArray(output.contrastRules) && output.contrastRules.length > 0);
  assert.ok(Array.isArray(output.accessibilityGuidelines) && output.accessibilityGuidelines.length > 0);
});

test("Bianca define regras de padronização visual sempre presentes, com regras adicionais quando há mais de um slide", async () => {
  const { bianca } = createBianca();

  const singleResponse = await bianca.execute(createRequest(createInput({ format: "post único" })));
  assert.ok(Array.isArray(singleResponse.output.visualStandardizationRules) && singleResponse.output.visualStandardizationRules.length > 0);

  const carouselResponse = await bianca.execute(createRequest());
  assert.ok(carouselResponse.output.visualStandardizationRules.length > singleResponse.output.visualStandardizationRules.length);
});

test("Bianca usa Ícaro para aprimorar também contraste, acessibilidade e composição de capa de Reels", async () => {
  const icaro = new FakeIcaroBrain([
    JSON.stringify({
      contrastRules: ["Contraste mínimo de 7:1 aprovado pela marca."],
      accessibilityGuidelines: ["Testar com simulador de daltonismo antes da aprovação final."],
      reelsCoverComposition: "Manter o título inteiro acima da linha de 40% do quadro.",
    }),
  ]);
  const { bianca } = createBianca({ icaro });

  const response = await bianca.execute(createRequest(createInput({ format: "reels cover" })));

  assert.deepEqual(response.output.contrastRules, ["Contraste mínimo de 7:1 aprovado pela marca."]);
  assert.deepEqual(response.output.accessibilityGuidelines, ["Testar com simulador de daltonismo antes da aprovação final."]);
  assert.equal(response.output.reelsCoverComposition, "Manter o título inteiro acima da linha de 40% do quadro.");
  assert.equal(response.output.aiSupportUsed, true);
});

test("Bianca permite que Ícaro refine composição, uso de mídia, regras de capa, CTA final e justificativa técnica", async () => {
  const icaro = new FakeIcaroBrain([
    JSON.stringify({
      compositionStrategy: "Composição assimétrica premium com hero visual à esquerda e copy curta à direita.",
      photographyUsage: ["Foto como protagonista com área negativa reservada para título."],
      iconographyUsage: ["Ícones apenas como apoio de escaneabilidade."],
      coverRules: ["Capa com uma promessa e um único protagonista visual."],
      finalCtaRules: ["Último slide com CTA em card grande e alto contraste."],
      technicalJustification: "Justificativa técnica para auditoria do Lucas: composição assimétrica aumenta retenção sem alterar Sofia.",
    }),
  ]);
  const { bianca } = createBianca({ icaro });

  const response = await bianca.execute(createRequest());

  assert.equal(response.output.compositionStrategy, "Composição assimétrica premium com hero visual à esquerda e copy curta à direita.");
  assert.deepEqual(response.output.photographyUsage, ["Foto como protagonista com área negativa reservada para título."]);
  assert.deepEqual(response.output.iconographyUsage, ["Ícones apenas como apoio de escaneabilidade."]);
  assert.deepEqual(response.output.coverRules, ["Capa com uma promessa e um único protagonista visual."]);
  assert.deepEqual(response.output.finalCtaRules, ["Último slide com CTA em card grande e alto contraste."]);
  assert.match(response.output.technicalJustification, /auditoria do Lucas/i);
});

test("Bianca planeja múltiplos slides para carrossel com gancho, mensagens e CTA", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());
  const output = response.output;

  assert.ok(output.slides.length >= 3);
  assert.equal(output.slides[0].role.toLowerCase().includes("gancho"), true);
  assert.equal(output.slides.at(-1).role.toLowerCase().includes("fechamento"), true);
  assert.ok(output.carouselFlow);
  assert.equal(output.carouselFlow.totalSlides, output.slides.length);
  assert.equal(output.carouselFlow.sequenceNotes.length, output.slides.length);
});

test("Bianca planeja um único slide para peças que não são carrossel", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest(createInput({ format: "post único" })));

  assert.equal(response.output.slides.length, 1);
  assert.equal(response.output.carouselFlow, undefined);
});

test("Bianca reconhece Story como formato multi-slide (regressão do BUG-01)", async () => {
  const { bianca } = createBianca();

  // Antes da correção, `isCarouselFormat` não reconhecia "story", então Bianca sempre montava 1
  // slide único para Story — divergindo do imageCount que o Eduardo mandava para o Pedro (3 por
  // padrão) e fazendo a geração de imagem falhar sempre que um Story pedisse mais de uma tela.
  const response = await bianca.execute(
    createRequest(createInput({ format: "story", recommendedSlideCount: 3 })),
  );
  const output = response.output;

  assert.equal(output.slides.length, 3);
  assert.ok(output.carouselFlow);
  assert.equal(output.carouselFlow.totalSlides, 3);
  assert.equal(output.slides[0].role.toLowerCase().includes("gancho"), true);
  assert.equal(output.slides.at(-1).role.toLowerCase().includes("fechamento"), true);
});

test("Bianca respeita recommendedSlideCount do Eduardo em vez da heurística própria baseada em keyMessages (regressão do BUG-02)", async () => {
  const { bianca } = createBianca();

  // keyMessages tem 2 itens: a heurística antiga (messageCount + 2, mínimo 3) montaria 4 slides
  // aqui, divergindo de um imageCount menor vindo do Eduardo — e era exatamente essa divergência
  // que fazia o Pedro cortar (slice) o slide de Fechamento/CTA em silêncio.
  const input = createInput({
    format: "carrossel",
    joaoStrategy: createJoaoStrategy({ keyMessages: ["Mensagem A.", "Mensagem B."] }),
    recommendedSlideCount: 2,
  });

  const response = await bianca.execute(createRequest(input));
  const output = response.output;

  assert.equal(output.slides.length, 2);
  assert.equal(output.carouselFlow.totalSlides, 2);
  assert.equal(output.slides[0].role.toLowerCase().includes("gancho"), true);
  assert.equal(output.slides.at(-1).role.toLowerCase().includes("fechamento"), true);
});

test("Bianca degrada com segurança para um único slide quando recommendedSlideCount é 1, mesmo em formato carrossel/story", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(
    createRequest(createInput({ format: "story", recommendedSlideCount: 1 })),
  );
  const output = response.output;

  // Garante que não há colisão de índice entre o slide de gancho e o de fechamento quando a
  // contagem recomendada é baixa demais para os dois coexistirem.
  assert.equal(output.slides.length, 1);
  assert.equal(new Set(output.slides.map((slide) => slide.slideIndex)).size, output.slides.length);
});

test("Bianca ignora recommendedSlideCount ausente/inválido e mantém a heurística baseada em keyMessages", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(
    createRequest(createInput({ recommendedSlideCount: undefined })),
  );

  assert.equal(response.output.slides.length, 4);
});

test("Bianca monta briefing estruturado para o Pedro com o layout completo", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());

  const briefing = response.output.pedroBriefing;
  assert.equal(briefing.status, "structured");
  assert.equal(briefing.channel, "instagram");
  assert.equal(briefing.gridSystem, response.output.gridSystem);
  assert.equal(briefing.compositionStrategy, response.output.compositionStrategy);
  assert.equal(briefing.instagramSafeArea, response.output.instagramSafeArea);
  assert.deepEqual(briefing.coverRules, response.output.coverRules);
  assert.deepEqual(briefing.finalCtaRules, response.output.finalCtaRules);
  assert.equal(briefing.technicalJustification, response.output.technicalJustification);
  assert.deepEqual(briefing.slides, response.output.slides);
  assert.ok(briefing.notes.some((note) => note.includes("Conceito criativo")));
});

test("Bianca não gera imagem final; devolve apenas especificação de design e briefing estruturados", async () => {
  const { bianca } = createBianca();

  const response = await bianca.execute(createRequest());

  assert.equal(response.output.imageUrl, undefined);
  assert.equal(response.output.imageBase64, undefined);
  assert.equal(response.artifacts[0].type, "plan");
  assert.notEqual(response.artifacts[0].type, "image");
});

test("Bianca trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { bianca, logger, events } = createBianca({ valentina: new FakeValentina([]) });

  const response = await bianca.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "DesignFailed"));
});

test("Bianca trata identidade visual ausente na Clara como necessidade de mais contexto", async () => {
  const { bianca, logger, events } = createBianca({ clara: new FakeClara({}) });

  const response = await bianca.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "DesignFailed"));
});

test("Bianca valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { bianca, valentina, clara, logger, events } = createBianca();

  const response = await bianca.execute(createRequest(createInput({ format: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "DesignFailed"));
});

test("Bianca registra os logs esperados em uma execução completa", async () => {
  const { bianca, logger } = createBianca();

  await bianca.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("DesignContextConsulted"));
  assert.ok(actions.includes("DesignFinalized"));
  assert.ok(actions.includes("PedroBriefingCreated"));
});

test("Bianca emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { bianca, events } = createBianca({ icaro });

  await bianca.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "DesignStarted",
    "DesignContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "DesignSpecGenerated",
    "PedroBriefingCreated",
  ]);
});

test("buildBaselineDesign e buildPedroBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "bianca-social-media-design", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const design = buildBaselineDesign(input, context);
  assert.ok(design.gridSystem.length > 0);

  const briefing = buildPedroBriefing(design, input);
  assert.equal(briefing.status, "structured");
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
      shippingInfo: "grátis com cupom",
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
    marketingObjective: "promocao_oferta",
    ...overrides,
  };
}

test("buildPerformanceCreativePlan: sem nenhum sinal comercial/copy, devolve undefined (regressão — campaign_creation)", () => {
  const plan = buildPerformanceCreativePlan(createInput());
  assert.equal(plan, undefined);
});

test("buildPerformanceCreativePlan: com creativeBrief + referenceIntelligence + copy real, monta o plano com os fatos REAIS (caso do tênis RV)", () => {
  const input = createInput({
    joaoStrategy: createJoaoStrategy({ creativeBrief: tenisCreativeBrief(), referenceIntelligence: tenisReferenceIntelligence() }),
    mariaCopy: { title: "Tênis Casual Unissex por R$39,99!", cta: "Aproveite agora", imageHeadline: "50% OFF - R$39,99", claims: [] },
  });

  const plan = buildPerformanceCreativePlan(input);

  assert.ok(plan);
  assert.equal(plan.price, "R$ 39,99");
  assert.equal(plan.oldPrice, "R$ 79,99");
  assert.equal(plan.discount, "50%");
  assert.equal(plan.heroProduct, "Tênis Casual Unissex Skatista RV");
  assert.equal(plan.primaryHook, "50% OFF - R$39,99");
  assert.equal(plan.layoutFamily, "flash_sale");
  assert.ok(plan.informationPriority.includes("price"));
  assert.ok(plan.informationPriority.includes("discount"));
});

test("buildPerformanceCreativePlan: nunca inventa um fato — sem preço/desconto na referência, o plano não tem price/discount", () => {
  const input = createInput({
    joaoStrategy: createJoaoStrategy({ creativeBrief: { productOrService: "Buquê de flores", commercialFactsSource: "none", nonInventableInfo: ["preço"] } }),
    mariaCopy: { title: "Buquês para todas as ocasiões", cta: "Conheça a coleção" },
  });

  const plan = buildPerformanceCreativePlan(input);

  assert.ok(plan);
  assert.equal(plan.price, undefined);
  assert.equal(plan.discount, undefined);
  assert.equal(plan.offer, undefined);
});

test("buildAdLayoutSpec: sem plano criativo, devolve undefined", () => {
  assert.equal(buildAdLayoutSpec(undefined, createInput()), undefined);
});

test("buildAdLayoutSpec: monta zonas price/discount/cta/headline pro caso flash_sale, todas dentro da área segura do formato", () => {
  const input = createInput({
    joaoStrategy: createJoaoStrategy({ creativeBrief: tenisCreativeBrief(), referenceIntelligence: tenisReferenceIntelligence() }),
    mariaCopy: { title: "Tênis Casual Unissex por R$39,99!", cta: "Aproveite agora", imageHeadline: "50% OFF - R$39,99", claims: [] },
  });
  const plan = buildPerformanceCreativePlan(input);

  const spec = buildAdLayoutSpec(plan, input);

  assert.ok(spec);
  assert.equal(spec.layoutFamily, "flash_sale");
  assert.equal(spec.aspectRatio, "4:5");
  const zoneTypes = spec.zones.map((zone) => zone.type);
  assert.ok(zoneTypes.includes("price"));
  assert.ok(zoneTypes.includes("discount"));
  assert.ok(zoneTypes.includes("cta"));
  for (const zone of spec.zones) {
    assert.ok(zone.position.xPct >= 0 && zone.position.xPct + zone.position.widthPct <= 100, `zona ${zone.type} sai da largura da peça`);
    assert.ok(zone.position.yPct >= 0 && zone.position.yPct + zone.position.heightPct <= 100, `zona ${zone.type} sai da altura da peça`);
  }
});

test("buildAdLayoutSpec: respeita o orçamento de informação — número de zonas nunca excede o limite do formato/densidade", () => {
  const input = createInput({
    joaoStrategy: createJoaoStrategy({
      creativeBrief: tenisCreativeBrief({ differentiator: "Solado antiderrapante", mainBenefit: "Conforto o dia todo" }),
      referenceIntelligence: tenisReferenceIntelligence(),
    }),
    mariaCopy: { title: "Tênis Casual Unissex por R$39,99!", cta: "Aproveite agora", imageHeadline: "50% OFF - R$39,99", claims: [] },
  });
  const plan = buildPerformanceCreativePlan(input);

  const spec = buildAdLayoutSpec(plan, input);

  assert.ok(spec.zones.length <= 8, "max_performance nunca deveria passar do teto superior de zonas");
});

test("Bianca não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Bianca não chama Pedro diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("pedro-image-generation"), false);
  assert.equal(lowered.includes("pedroimagegenerationskill"), false);
  assert.equal(lowered.includes("createpedroimagegenerationskill"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Bianca não chama outra Skill diretamente: todo import relativo de nível único aponta apenas para application/domain, nunca para uma pasta irmã em src/skills", async () => {
  const source = await readFile("src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts", "utf8");
  const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    const isSameFolder = specifier.startsWith("./");
    const isApplicationOrDomain = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
    assert.ok(isSameFolder || isApplicationOrDomain, `Import inesperado que pode apontar para outra Skill: ${specifier}`);
  }
});
