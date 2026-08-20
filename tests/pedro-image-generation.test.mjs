import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile as writeFileBytes, mkdir as mkdirRecursive } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { LocalArtifactDelivery } from "../dist/infrastructure/artifacts/index.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  PedroImageGenerationSkill,
  buildFinalImagePrompt,
  pedroImageGenerationManifest,
} from "../dist/skills/pedro-image-generation/index.js";

const CLIENT_ID = "client-casamento-1";
const TENANT_ID = "tenant-casamento-1";

const PNG_CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Gera um PNG real e válido (RGB 8-bit, sem interlace) só com node:zlib — sem nenhuma dependência externa. */
function createMinimalPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = pngChunk("IHDR", ihdrData);

  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * rowSize] = 0; // filter type: none
  }
  const idat = pngChunk("IDAT", deflateSync(raw));

  const iend = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

async function writeAssistedImage(rootDir, executionId, relativePath, width, height) {
  const absolutePath = join(rootDir, executionId, relativePath);
  await mkdirRecursive(join(absolutePath, ".."), { recursive: true });
  await writeFileBytes(absolutePath, createMinimalPng(width, height));
  return absolutePath;
}

async function withTempArtifacts(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-pedro-artifacts-"));
  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

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
    if (next?.status) return next;
    return {
      status: "completed",
      provider: { id: "fake-image-provider", name: "Fake Image Provider" },
      model: { id: "fake-image-model" },
      durationMs: 5,
      tokens: { input: request.prompt.length, output: 50, total: request.prompt.length + 50 },
      cost: { estimated: 0.05, actual: 0.048, currency: "USD" },
      content: next ?? singleImageJson(),
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: "fake-image-provider" },
      fallbackUsed: false,
    };
  }
}

class FakeStorage {
  constructor() {
    this.saved = [];
    this.nextId = 1;
  }

  async save(input) {
    const asset = {
      id: `asset-${this.nextId}`,
      uri: `local://assets/${input.name}`,
      mimeType: input.mimeType,
      metadata: { sizeBytes: input.data.byteLength },
    };
    this.nextId += 1;
    this.saved.push({ input, asset });
    return asset;
  }

  async read() {
    throw new Error("não deveria ser chamado neste teste");
  }
}

function singleImageJson() {
  return JSON.stringify({
    images: [
      { altText: "Casal em cenário ao ar livre", mimeType: "image/png", width: 1080, height: 1080 },
    ],
  });
}

function carouselImagesJson(count) {
  return JSON.stringify({
    images: Array.from({ length: count }, (_value, index) => ({
      altText: `Slide ${index + 1}`,
      mimeType: "image/png",
      width: 1080,
      height: 1350,
      data: Buffer.from(`fake-carousel-image-${index + 1}`).toString("base64"),
    })),
  });
}

function imageWithDataJson() {
  return JSON.stringify({
    images: [
      { altText: "Casal em cenário ao ar livre", mimeType: "image/jpeg", width: 1080, height: 1080, data: Buffer.from("fake-image-bytes").toString("base64") },
    ],
  });
}

class InMemoryPedroLogger {
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

function createBiancaDesign(overrides = {}) {
  return {
    designConcept: "Layout que traduz o conceito editorial em uma peça extremamente escaneável para instagram.",
    visualConcept: "Ensaio editorial com casal real em cenário ao ar livre, luz natural dourada.",
    emotionalObjective: "Gerar confiança imediata e desejo de organizar o casamento com leveza.",
    desiredFeeling: "Premium, humano, acolhedor e simples de entender em poucos segundos.",
    minimalismLevel: "Minimalismo médio-alto: uma mensagem principal por slide com respiro generoso.",
    visualStyle: "Editorial romântico premium com composição moderna para leitura mobile.",
    recommendedStyle: "editorial romântico",
    suggestedPalette: ["#FFFFFF", "#D4AF37"],
    recommendedFormat: "carrossel",
    recommendedAspectRatio: "4:5",
    gridSystem: "Grid de 12 colunas por slide, margem lateral fixa de 8%.",
    visualHierarchyStrategy: "Elemento visual principal, depois headline, depois texto de apoio, depois CTA.",
    typographyScale: {
      headline: "Maior tamanho da peça, peso forte.",
      subheadline: "Aproximadamente 60% do tamanho da headline.",
      body: "Aproximadamente 35% do tamanho da headline.",
      caption: "Menor tamanho da peça.",
      cta: "Aproximadamente 50% do tamanho da headline, peso forte.",
    },
    compositionStrategy: "Capa com impacto, slides internos com uma ideia por tela e fechamento com CTA dominante.",
    lightingStrategy: "Iluminação suave e editorial com luz dourada natural.",
    depthStrategy: "Profundidade moderada com cards levemente elevados e fundo discreto.",
    contrastStrategy: "Usar branco e dourado para contraste funcional, mantendo CTA como ponto mais forte.",
    colorApplication: "Aplicar #FFFFFF como fundo e #D4AF37 como destaque.",
    spacingSystem: "Espaçamento em múltiplos de 8px.",
    componentStyle: ["Cards com cantos levemente arredondados.", "Ícones de traço fino."],
    illustrationStyle: "Fotos com tratamento de cor quente e enquadramento consistente.",
    mockupStyle: "Nenhum mockup obrigatório para este formato.",
    iconographyUsage: ["Ícones apenas como apoio de escaneabilidade.", "Manter traço fino e consistente."],
    mockupUsage: ["Mockup não obrigatório; usar apenas se tangibilizar o produto."],
    photographyUsage: ["Fotografia como protagonista com espaço negativo para texto.", "Evitar foto poluída atrás da copy."],
    illustrationUsage: ["Ilustrações apenas se simplificarem uma ideia complexa."],
    cardUsage: ["Cards para organizar texto curto e CTA sobre fundo fotográfico."],
    colorBlockUsage: ["Blocos coloridos para separar planos e destacar palavra-chave."],
    photoTreatment: "Tratamento fotográfico editorial romântico com luz limpa e contraste equilibrado.",
    decorativeElements: ["Linhas finas sutis.", "Textura suave.", "Brilho discreto longe do CTA."],
    logoPlacement: "Canto inferior, pequeno e discreto.",
    instagramSafeArea: "Área segura de feed/carrossel: manter textos, logo e CTA a pelo menos 8% das laterais.",
    logoSizing: "Logo entre 4% e 6% da largura do slide.",
    titleSizing: "Título da capa entre 12% e 18% da altura do slide.",
    subtitleSizing: "Subtítulo até 55% do tamanho do título.",
    supportTextSizing: "Texto auxiliar entre 28% e 38% do título, limitado a 1-2 linhas.",
    buttonSizing: "Botão de CTA com altura entre 8% e 12% do slide.",
    elementSpacingRules: ["Separar título, subtítulo e CTA com respiro.", "Nunca encostar texto em foto ou borda."],
    alignmentRules: ["Usar no máximo dois eixos de alinhamento.", "Alinhar CTA ao mesmo eixo do bloco de texto."],
    shadowRules: ["Sombras suaves apenas em cards e botões.", "Evitar sombra dura em texto pequeno."],
    ctaPlacement: "Metade inferior do slide de fechamento, centralizado, alto contraste.",
    coverRules: ["Capa com uma única mensagem principal.", "Usar promessa central como foco de impacto visual."],
    internalSlideRules: ["Cada slide interno deve defender apenas uma mensagem principal.", "Usar indicador discreto de progresso."],
    finalCtaRules: ["CTA final deve ser a ação visual principal.", "Botão final com maior contraste e respiro exclusivo."],
    reelsCoverRules: ["Regras de Reels Cover não aplicáveis ao formato solicitado."],
    contrastRules: ["Contraste mínimo de 4.5:1 entre texto e fundo.", "CTA sempre com o maior contraste da peça."],
    accessibilityGuidelines: ["Não depender apenas de cor para transmitir significado.", "Tamanho mínimo de fonte legível em miniatura de feed."],
    visualStandardizationRules: ["Mesma paleta, tipografia e posição de logo em todos os slides.", "Mesmo grid e margens em todos os slides."],
    slides: [
      { slideIndex: 1, role: "Gancho", focalPoint: "Casal em destaque", visualWeightOrder: ["1. Headline"], headlineSize: "Grande", subheadlineSize: "Pequeno", bodyTextSize: "Ausente", alignment: "Centralizado", margins: "Generosa", breathingRoom: "Alta", supportingElements: ["Seta de arraste"], emphasis: "Headline", secondaryElements: "Logo", logoPlacement: "Canto inferior" },
      { slideIndex: 2, role: "Benefício", focalPoint: "Lista de vantagens", visualWeightOrder: ["1. Benefício principal", "2. Apoio visual"], headlineSize: "Grande", subheadlineSize: "Médio", bodyTextSize: "Pequeno", alignment: "À esquerda", margins: "Generosa", breathingRoom: "Alta", supportingElements: ["Card de benefício"], emphasis: "Benefício principal", secondaryElements: "Ícones sutis", logoPlacement: "Canto inferior" },
      { slideIndex: 3, role: "CTA", focalPoint: "Botão de CTA", visualWeightOrder: ["1. CTA"], headlineSize: "Grande", subheadlineSize: "Médio", bodyTextSize: "Pequeno", alignment: "Centralizado", margins: "Generosa", breathingRoom: "Alta", supportingElements: ["Botão"], emphasis: "CTA", secondaryElements: "Logo", logoPlacement: "Canto inferior", ctaPlacement: "Metade inferior, centralizado." },
    ],
    carouselFlow: { totalSlides: 3, readingFlow: "Gancho -> Benefício -> CTA", sequenceNotes: ["Slide 1: gancho", "Slide 2: benefício", "Slide 3: CTA"], consistencyRules: ["Manter paleta idêntica."] },
    designConstraints: ["Manter área segura livre de elementos essenciais."],
    designRisks: ["Validar identidade visual real antes da produção."],
    observations: [],
    nextSteps: [],
    technicalJustification: "Justificativa técnica para auditoria do Lucas: hierarquia e grid preservam leitura mobile sem reinterpretar Sofia.",
    ...overrides,
  };
}

function createBiancaPedroBriefing(overrides = {}) {
  return {
    ...createBiancaDesign(),
    status: "structured",
    channel: "instagram",
    notes: ["Este briefing cobre o layout completo.", "Conceito criativo, paleta e tipografia foram definidos pela Sofia."],
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um carrossel de lançamento do novo pacote de casamento all-inclusive.",
    biancaDesign: createBiancaDesign(),
    biancaPedroBriefing: createBiancaPedroBriefing(),
    channel: "instagram",
    format: "carrossel",
    imageCount: 1,
    desiredAspectRatio: "4:5",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "pedro-image-generation",
    input,
    context: {
      executionId: "exec-pedro",
      taskId: "task-image",
      correlationId: "corr-pedro",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createPedro(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const icaro = overrides.icaro ?? new FakeIcaroBrain([singleImageJson()]);
  const logger = overrides.logger ?? new InMemoryPedroLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const pedro = new PedroImageGenerationSkill({
    valentina,
    clara,
    icaro,
    storage: overrides.storage,
    artifactDelivery: overrides.artifactDelivery,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: overrides.now ?? (() => new Date("2026-07-02T12:00:00.000Z")),
    imageGenerationMode: overrides.imageGenerationMode,
  });
  return { pedro, valentina, clara, icaro, logger, events };
}

test("Pedro possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(pedroImageGenerationManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "pedro-image-generation");
  assert.deepEqual(result.manifest.capabilities, ["image_generation"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
  assert.ok(result.manifest.dependencies.some((dependency) => dependency.name === "IcaroBrainPort" && dependency.optional === false));
});

test("Pedro consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { pedro, valentina } = createPedro();

  await pedro.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await pedro.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Pedro consulta Clara com os módulos de identidade visual, marca e publicação", async () => {
  const { pedro, clara } = createPedro();

  await pedro.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, ["BrandContext", "IdentityContext", "PublishingContext"]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Pedro usa o Ícaro obrigatoriamente para gerar imagem, com taskType image_generation", async () => {
  const icaro = new FakeIcaroBrain([singleImageJson()]);
  const { pedro } = createPedro({ icaro });

  const response = await pedro.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "image_generation");
  assert.equal(icaro.calls[0].specialistId, "pedro-image-generation");
  assert.equal(icaro.calls[0].expectedOutput, "json");
});

test("Pedro monta o prompt final de imagem com o design da Bianca, o briefing e a identidade visual da Clara", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "pedro-image-generation", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "IdentityContext", "PublishingContext"],
  });
  const input = createInput();

  const prompt = buildFinalImagePrompt(input, context);

  assert.ok(prompt.includes("ESPECIFICAÇÃO DE DESIGN DA BIANCA"));
  assert.ok(prompt.includes("BRIEFING DA BIANCA PARA O PEDRO"));
  assert.ok(prompt.includes("PADRÃO DE QUALIDADE OBRIGATÓRIO"));
  assert.ok(prompt.includes("BRIEF OPERACIONAL ENRIQUECIDO DA BIANCA"));
  assert.ok(prompt.includes("NEGATIVE PROMPT"));
  assert.ok(prompt.includes("QUALITY CHECKLIST"));
  assert.ok(prompt.includes("ESPECIFICAÇÃO OPERACIONAL POR SLIDE"));
  assert.ok(prompt.includes("TEXTOS VISÍVEIS AUTORIZADOS"));
  assert.ok(prompt.includes("RELATÓRIO DE PRONTIDÃO DO BRIEFING"));
  assert.ok(prompt.includes("layout premium"));
  assert.ok(prompt.includes("hierarquia visual inequívoca"));
  assert.ok(prompt.includes("IDENTIDADE VISUAL DA MARCA"));
  assert.ok(prompt.includes("FORMATO OBRIGATÓRIO DO JSON"));
  assert.ok(prompt.includes("Gerar exatamente 1 imagem(ns)."));
  assert.ok(prompt.includes("CANAL: instagram"));
  assert.ok(prompt.includes("PROPORÇÃO DESEJADA: 4:5"));
  assert.ok(prompt.includes("RESOLUÇÃO SUGERIDA: 1080x1350"));
  assert.ok(prompt.includes("#D4AF37"));
});

test("Pedro utiliza os novos campos ricos da Bianca no prompt final sem resumir o Design Brief", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "pedro-image-generation", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "IdentityContext", "PublishingContext"],
  });

  const prompt = buildFinalImagePrompt(createInput(), context);

  assert.ok(prompt.includes("Gerar confiança imediata e desejo de organizar o casamento com leveza."));
  assert.ok(prompt.includes("Premium, humano, acolhedor e simples de entender"));
  assert.ok(prompt.includes("Minimalismo médio-alto"));
  assert.ok(prompt.includes("Capa com impacto, slides internos com uma ideia por tela"));
  assert.ok(prompt.includes("Área segura de feed/carrossel"));
  assert.ok(prompt.includes("Iluminação suave e editorial"));
  assert.ok(prompt.includes("Profundidade moderada"));
  assert.ok(prompt.includes("Tratamento fotográfico editorial romântico"));
  assert.ok(prompt.includes("Fotografia como protagonista"));
  assert.ok(prompt.includes("Ícones apenas como apoio de escaneabilidade"));
  assert.ok(prompt.includes("Cards para organizar texto curto"));
  assert.ok(prompt.includes("Blocos coloridos para separar planos"));
  assert.ok(prompt.includes("CTA final deve ser a ação visual principal"));
  assert.ok(prompt.includes("Justificativa técnica para auditoria do Lucas"));
});

test("Pedro deriva o Creative DNA da campanha e o usa no prompt final (Hero Frame, metáfora visual, palavras-chave)", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "pedro-image-generation", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "IdentityContext", "PublishingContext"],
  });

  const prompt = buildFinalImagePrompt(createInput(), context);

  assert.ok(prompt.includes("CREATIVE DNA DA CAMPANHA"));
  assert.ok(prompt.includes("Hero Frame de referência"));
  assert.ok(prompt.includes("Metáfora visual a preservar"));
  assert.ok(prompt.includes("Palavras-chave visuais"));
});

test("Pedro gera Negative Prompt e Quality Checklist com critérios profissionais de imagem", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "pedro-image-generation", type: "specialist" },
    clientId: CLIENT_ID,
    modules: ["BrandContext", "IdentityContext", "PublishingContext"],
  });

  const prompt = buildFinalImagePrompt(createInput({ imageCount: 3, format: "carrossel" }), context);

  assert.match(prompt, /NEGATIVE PROMPT:[\s\S]*evitar excesso de texto/i);
  assert.match(prompt, /NEGATIVE PROMPT:[\s\S]*evitar aparência de template genérico/i);
  assert.match(prompt, /NEGATIVE PROMPT:[\s\S]*evitar elementos desalinhados/i);
  assert.match(prompt, /NEGATIVE PROMPT:[\s\S]*evitar baixa resolução/i);
  assert.match(prompt, /NEGATIVE PROMPT:[\s\S]*evitar elementos fora da safe area/i);
  assert.match(prompt, /QUALITY CHECKLIST:[\s\S]*✓ leitura mobile clara/i);
  assert.match(prompt, /QUALITY CHECKLIST:[\s\S]*✓ CTA destacado/i);
  assert.match(prompt, /QUALITY CHECKLIST:[\s\S]*✓ contraste adequado/i);
  assert.match(prompt, /QUALITY CHECKLIST:[\s\S]*✓ identidade visual preservada/i);
  assert.match(prompt, /QUALITY CHECKLIST:[\s\S]*✓ carrossel com storytelling/i);
});

test("Pedro bloqueia briefing pobre quando precisaria inventar decisões de layout da Bianca", async () => {
  const icaro = new FakeIcaroBrain([carouselImagesJson(3)]);
  const { pedro, logger, events } = createPedro({ icaro });
  const weakDesign = createBiancaDesign({
    gridSystem: "",
    visualHierarchyStrategy: "",
    typographyScale: { headline: "", subheadline: "", body: "", caption: "" },
    suggestedPalette: ["#FFFFFF"],
    slides: [],
  });
  const weakBriefing = createBiancaPedroBriefing({
    ...weakDesign,
    status: "structured",
    slides: [],
    carouselFlow: undefined,
  });

  const response = await pedro.execute(createRequest(createInput({
    imageCount: 3,
    format: "carrossel",
    biancaDesign: weakDesign,
    biancaPedroBriefing: weakBriefing,
  })));

  assert.equal(response.status, "needs_more_context");
  assert.equal(icaro.calls.length, 0);
  assert.ok(response.warnings.some((warning) => warning.includes("Briefing de produção insuficiente")));
  assert.ok(response.warnings.some((warning) => warning.includes("sistema de grid")));
  assert.ok(response.warnings.some((warning) => warning.includes("Carrossel solicitado com 3 imagens")));
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.payload.reason === "INSUFFICIENT_PRODUCTION_BRIEFING"));
});

test("Pedro gera uma imagem única e devolve um único artefato do tipo image", async () => {
  const icaro = new FakeIcaroBrain([singleImageJson()]);
  const { pedro } = createPedro({ icaro, storage: undefined });

  const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.imageCount, 1);
  assert.equal(response.artifacts.length, 1);
  assert.equal(response.artifacts[0].type, "image");
  assert.equal(response.artifacts[0].status, "ready");
  assert.equal(response.artifacts[0].file.mimeType, "image/png");
  assert.equal(response.artifacts[0].file.extension, "png");
  assert.equal(response.artifacts[0].dimensions.width, 1080);
  assert.equal(response.artifacts[0].dimensions.height, 1080);
  assert.ok(response.output.creativeDna);
  assert.ok(response.output.creativeDna.visualMetaphor.length > 0);
});

test("Pedro gera um carrossel e agrupa as imagens em um único artefato composto com items", async () => {
  const icaro = new FakeIcaroBrain([carouselImagesJson(3)]);
  const { pedro } = createPedro({ icaro });

  const response = await pedro.execute(createRequest(createInput({ imageCount: 3, format: "carrossel" })));

  assert.equal(response.status, "completed");
  assert.equal(response.output.imageCount, 3);
  assert.equal(response.artifacts.length, 1);
  assert.equal(response.artifacts[0].type, "carousel");
  assert.equal(response.artifacts[0].items.length, 3);
  assert.ok(response.artifacts[0].items.every((item) => item.type === "image"));
});

test("Pedro devolve saída estruturada completa", async () => {
  const icaro = new FakeIcaroBrain([singleImageJson()]);
  const { pedro } = createPedro({ icaro });

  const response = await pedro.execute(createRequest());
  const output = response.output;

  assert.ok(output.generationSummary.length > 0);
  assert.ok(output.finalPrompt.includes("ESPECIFICAÇÃO DE DESIGN DA BIANCA"));
  assert.ok(output.finalPrompt.includes("PADRÃO DE QUALIDADE OBRIGATÓRIO"));
  assert.ok(output.qualityReport);
  assert.ok(["ready", "ready_with_warnings"].includes(output.qualityReport.status));
  assert.equal(typeof output.qualityReport.score, "number");
  assert.equal(output.qualityReport.agencyChecklist.gridReady, true);
  assert.equal(output.qualityReport.agencyChecklist.hierarchyReady, true);
  assert.equal(output.imageCount, 1);
  assert.equal(output.images.length, 1);
  assert.equal(output.artifacts.length, 1);
  assert.equal(output.providerUsed, "fake-image-provider");
  assert.equal(output.modelUsed, "fake-image-model");
  assert.equal(output.cost.estimated, 0.05);
  assert.equal(output.cost.actual, 0.048);
  assert.equal(output.usage.total > 0, true);
  assert.ok(output.executionDurationMs >= 0);
  assert.ok(Array.isArray(output.warnings));
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
});

test("Pedro relaia no prompt final o tamanho/posição de CTA, regras de contraste, acessibilidade e padronização visual definidos pela Bianca — sem decidir nenhum deles", async () => {
  const icaro = new FakeIcaroBrain([singleImageJson()]);
  const { pedro } = createPedro({ icaro });

  const response = await pedro.execute(createRequest());
  const prompt = response.output.finalPrompt;

  assert.ok(prompt.includes("ctaPlacement"));
  assert.ok(prompt.includes("contrastRules"));
  assert.ok(prompt.includes("accessibilityGuidelines"));
  assert.ok(prompt.includes("visualStandardizationRules"));
  assert.ok(prompt.includes("Metade inferior do slide de fechamento"));
  assert.ok(prompt.includes("não alterar paleta, grid, hierarquia, estilo, posicionamento ou posição/tamanho de CTA decididos pela Bianca"));
});

test("Pedro exige ctaPlacement da Bianca (bloqueante) e sinaliza como aviso, não bloqueio, a ausência de contrastRules/accessibilityGuidelines/visualStandardizationRules", async () => {
  const { pedro: pedroWithoutCta } = createPedro();
  const responseWithoutCta = await pedroWithoutCta.execute(createRequest(createInput({
    biancaDesign: createBiancaDesign({ ctaPlacement: "" }),
  })));
  assert.equal(responseWithoutCta.status, "needs_more_context");
  assert.ok(responseWithoutCta.warnings.some((warning) => warning.includes("posição e destaque do CTA")));

  const { pedro: pedroWithoutExtras } = createPedro({ icaro: new FakeIcaroBrain([singleImageJson()]) });
  const responseWithoutExtras = await pedroWithoutExtras.execute(createRequest(createInput({
    imageCount: 1,
    biancaDesign: createBiancaDesign({ contrastRules: [], accessibilityGuidelines: [], visualStandardizationRules: [] }),
  })));
  assert.equal(responseWithoutExtras.status, "completed");
  const qualityWarnings = responseWithoutExtras.output.qualityReport.warnings;
  assert.ok(qualityWarnings.some((warning) => warning.includes("regras dedicadas de contraste")));
  assert.ok(qualityWarnings.some((warning) => warning.includes("diretrizes de acessibilidade visual")));
  assert.ok(qualityWarnings.some((warning) => warning.includes("regras de padronização visual")));
  assert.equal(responseWithoutExtras.output.qualityReport.agencyChecklist.accessibilityGuided, false);
  assert.equal(responseWithoutExtras.output.qualityReport.agencyChecklist.visualStandardizationGuided, false);
});

test("Pedro persiste imagens via StoragePort quando configurada, sem acessar storage diretamente", async () => {
  const icaro = new FakeIcaroBrain([imageWithDataJson()]);
  const storage = new FakeStorage();
  const { pedro } = createPedro({ icaro, storage });

  const response = await pedro.execute(createRequest());

  assert.equal(storage.saved.length, 1);
  assert.equal(response.artifacts[0].uri, "local://assets/instagram-1.jpg");
  assert.ok(response.artifacts[0].file.sizeBytes > 0);
});

test("Pedro gera página HTML local de entrega com download real para uma imagem", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({
      imageCount: 1,
      workflowContext: {
        caption: "Legenda final pronta para o cliente.",
        hashtags: ["#Casamento", "#Zuno"],
      },
    })));

    assert.equal(response.status, "completed");
    assert.ok(response.output.delivery);
    assert.ok(response.output.delivery.htmlPath.endsWith("index.html"));
    assert.equal(response.output.delivery.imagePaths.length, 1);
    assert.equal(response.output.delivery.imageRelativePaths[0], "images/slide-01.jpg");
    assert.equal(response.output.delivery.promptRelativePaths[0], "image-prompt.txt");
    assert.ok(response.output.delivery.promptPaths[0].endsWith("image-prompt.txt"));
    assert.ok(response.output.delivery.captionPath.endsWith("caption.txt"));
    assert.ok(response.output.delivery.metadataPath.endsWith("metadata.json"));
    assert.equal(response.output.delivery.zipPath, undefined);

    const imageInfo = await stat(response.output.delivery.imagePaths[0]);
    assert.equal(imageInfo.isFile(), true);
    assert.ok(imageInfo.size > 0);

    const html = await readFile(response.output.delivery.htmlPath, "utf8");
    assert.ok(html.includes('href="images/slide-01.jpg"'));
    assert.ok(html.includes('src="images/slide-01.jpg"'));
    assert.ok(html.includes('download="slide-01.jpg"'));
    assert.ok(html.includes("Abrir em nova aba"));
    assert.ok(html.includes("Copiar legenda"));
    assert.ok(html.includes("Copiar hashtags"));
    assert.ok(html.includes("navigator.clipboard.writeText"));
    assert.ok(html.includes("document.execCommand('copy')"));
    assert.ok(html.includes("Salvar imagem como"));
    assert.ok(html.includes("Resumo técnico da execução"));
    assert.ok(html.includes("Layout premium"));

    const caption = await readFile(response.output.delivery.captionPath, "utf8");
    assert.ok(caption.includes("Legenda final pronta para o cliente."));
    assert.ok(caption.includes("#Casamento #Zuno"));

    const promptFile = await readFile(response.output.delivery.promptPaths[0], "utf8");
    assert.equal(promptFile, response.output.images[0].prompt);
    assert.ok(promptFile.includes("NEGATIVE PROMPT"));
    assert.ok(promptFile.includes("QUALITY CHECKLIST"));
    assert.ok(html.includes('href="image-prompt.txt"'));
    assert.ok(html.includes('download="image-prompt.txt"'));

    const metadata = JSON.parse(await readFile(response.output.delivery.metadataPath, "utf8"));
    assert.equal(metadata.executionId, "exec-pedro");
    assert.equal(metadata.imageCount, 1);
    assert.equal(metadata.images[0].relativePath, "images/slide-01.jpg");
    assert.deepEqual(metadata.promptRelativePaths, ["image-prompt.txt"]);
    assert.ok(metadata.qualityReport);
    assert.ok(metadata.qualityReport.agencyChecklist.gridReady);
  });
});

test("Pedro organiza o HTML de entrega na ordem Preview -> Ações -> Legenda -> Hashtags -> CTA -> Resumo técnico -> Relatório das Skills, e a seção de Skills só aparece quando o Caio a envia", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({
      imageCount: 1,
      workflowContext: {
        caption: "Legenda final pronta para o cliente.",
        hashtags: ["#Casamento", "#Zuno"],
        cta: "Conheça o Rumo ao Altar",
        upstreamSkillsReport: [
          { skillId: "joao-marketing-strategy", name: "Estratégia de marketing", state: "COMPLETED" },
          { skillId: "maria-copywriting", name: "Criação da copy", state: "COMPLETED" },
        ],
      },
    })));

    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    const previewIndex = html.indexOf("class=\"gallery\"");
    const actionsIndex = html.indexOf("class=\"toolbar\"");
    const captionIndex = html.indexOf("Copiar legenda");
    const hashtagsIndex = html.indexOf("Copiar hashtags");
    const ctaIndex = html.indexOf("Copiar CTA");
    const summaryIndex = html.indexOf("Resumo técnico da execução");
    const skillsReportIndex = html.indexOf("Relatório das Skills utilizadas");

    for (const index of [previewIndex, actionsIndex, captionIndex, hashtagsIndex, ctaIndex, summaryIndex, skillsReportIndex]) {
      assert.ok(index >= 0, "todas as seções deveriam estar presentes no HTML");
    }
    assert.ok(previewIndex < actionsIndex, "Preview deve vir antes dos botões de ação");
    assert.ok(actionsIndex < captionIndex, "Botões de ação devem vir antes da legenda");
    assert.ok(captionIndex < hashtagsIndex, "Legenda deve vir antes das hashtags");
    assert.ok(hashtagsIndex < ctaIndex, "Hashtags devem vir antes do CTA");
    assert.ok(ctaIndex < summaryIndex, "CTA deve vir antes do resumo técnico");
    assert.ok(summaryIndex < skillsReportIndex, "Resumo técnico deve vir antes do relatório de Skills");

    assert.ok(html.includes("Conheça o Rumo ao Altar"));
    assert.ok(html.includes("Estratégia de marketing"));
    assert.ok(html.includes("Criação da copy"));
  });
});

test("Pedro omite a seção de Relatório das Skills e a seção de CTA quando o workflowContext não os informa", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.equal(html.includes("Relatório das Skills utilizadas"), false);
    assert.equal(html.includes("Copiar CTA"), false);
  });
});

test("Pedro inclui zoom/lightbox no HTML, sem botões de navegação para uma única imagem", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.ok(html.includes('id="lightbox"'));
    assert.ok(html.includes("openLightbox("));
    assert.ok(html.includes("Ampliar"));
    assert.ok(html.includes("function toggleLightboxZoom"));
    assert.equal(html.includes('onclick="lightboxStep(-1)"'), false);
    assert.equal(html.includes('onclick="lightboxStep(1)"'), false);
  });
});

test("Pedro inclui botões de navegação anterior/próxima no lightbox quando há mais de uma imagem", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([carouselImagesJson(3)]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 3, format: "carrossel" })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.ok(html.includes('onclick="lightboxStep(-1)"'));
    assert.ok(html.includes('onclick="lightboxStep(1)"'));
  });
});

test("Pedro exibe tempo de execução e consumo estimado no resumo técnico do HTML", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.ok(html.includes("Tempo de execução"));
    assert.ok(html.includes("Provider / modelo"));
    assert.ok(html.includes("Tokens consumidos"));
    assert.ok(html.includes("Custo estimado"));
    assert.ok(html.includes("fake-image-provider"));
  });
});

test("Pedro exibe comando de gerar novamente e oculta o de publicar quando publishingEnabled é falso", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({
      imageCount: 1,
      originalRequest: "crie um post para o Rumo ao Altar no Instagram",
      workflowContext: { publishingEnabled: false },
    })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.ok(html.includes("Gerar novamente"));
    assert.ok(html.includes("npm run zuno"));
    assert.ok(html.includes("crie um post para o Rumo ao Altar no Instagram"));
    assert.equal(html.includes("Publicar</span>"), false);
    assert.equal(html.includes("--approve"), false);
  });
});

test("Pedro exibe comando de publicar quando o Caio sinaliza publishingEnabled=true no workflowContext", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([imageWithDataJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({
      imageCount: 1,
      workflowContext: { publishingEnabled: true },
    })));
    const html = await readFile(response.output.delivery.htmlPath, "utf8");

    assert.ok(html.includes("Publicar</span>"));
    assert.ok(html.includes("--approve exec-pedro"));
  });
});

test("Pedro (developer_assisted) devolve needs_assisted_generation com prompt técnico e caminho esperado quando a imagem ainda não existe", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    assert.equal(response.status, "needs_assisted_generation");
    assert.equal(icaro.calls.length, 0);
    assert.equal(response.output.mode, "developer_assisted");
    assert.equal(response.output.instruction, "Crie a imagem usando este prompt e salve neste caminho.");
    assert.equal(response.output.pendingImages.length, 1);
    assert.equal(response.output.pendingImages[0].expectedRelativePath, "images/slide-01.png");
    assert.equal(response.output.pendingImages[0].width, 1080);
    assert.equal(response.output.pendingImages[0].height, 1350);
    assert.ok(response.output.pendingImages[0].prompt.includes("PADRÃO DE QUALIDADE OBRIGATÓRIO"));
    assert.ok(response.output.pendingImages[0].prompt.includes("BRIEF OPERACIONAL ENRIQUECIDO DA BIANCA"));
    assert.ok(response.output.pendingImages[0].prompt.includes("NEGATIVE PROMPT"));
    assert.ok(response.output.pendingImages[0].prompt.includes("QUALITY CHECKLIST"));
    assert.ok(response.output.pendingImages[0].prompt.includes("Nunca simplifique este prompt"));
    assert.ok(response.output.pendingImages[0].prompt.includes("Fotografia como protagonista"));
    assert.equal(response.output.resumeCommand, "npm run zuno -- --continue exec-pedro");
    assert.deepEqual(response.artifacts, []);
  });
});

test("Pedro (developer_assisted) pede Story único em 1080x1920, não mais 1080x1350 (regressão do BUG-06)", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({
      format: "story",
      imageCount: 1,
      desiredAspectRatio: "9:16",
      biancaDesign: createBiancaDesign({ recommendedFormat: "story", recommendedAspectRatio: "9:16" }),
      biancaPedroBriefing: createBiancaPedroBriefing({ recommendedFormat: "story", recommendedAspectRatio: "9:16" }),
    })));

    assert.equal(response.status, "needs_assisted_generation");
    assert.equal(response.output.pendingImages.length, 1);
    assert.equal(response.output.pendingImages[0].width, 1080);
    assert.equal(response.output.pendingImages[0].height, 1920);
  });
});

test("Pedro (developer_assisted) pede Story com 3 telas, todas em 1080x1920 (regressão do BUG-06)", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({
      format: "story",
      imageCount: 3,
      desiredAspectRatio: "9:16",
      biancaDesign: createBiancaDesign({ recommendedFormat: "story", recommendedAspectRatio: "9:16" }),
      biancaPedroBriefing: createBiancaPedroBriefing({ recommendedFormat: "story", recommendedAspectRatio: "9:16" }),
    })));

    assert.equal(response.status, "needs_assisted_generation");
    assert.equal(response.output.pendingImages.length, 3);
    for (const pendingImage of response.output.pendingImages) {
      assert.equal(pendingImage.width, 1080);
      assert.equal(pendingImage.height, 1920);
    }
  });
});

test("Pedro não gera warning de proporção divergente quando desiredAspectRatio e recommendedAspectRatio são representações equivalentes (regressão do BUG-06)", async () => {
  const { pedro } = createPedro();

  const response = await pedro.execute(createRequest(createInput({
    format: "story",
    imageCount: 1,
    desiredAspectRatio: "9:16",
    biancaDesign: createBiancaDesign({ recommendedFormat: "story", recommendedAspectRatio: "1080:1920" }),
    biancaPedroBriefing: createBiancaPedroBriefing({ recommendedFormat: "story", recommendedAspectRatio: "1080:1920" }),
  })));

  assert.equal(response.output.warnings.some((warning) => warning.includes("Proporção divergente")), false);
});

test("Pedro (developer_assisted) rejeita um PNG de resolução implausível (placeholder) e continua aguardando", async () => {
  await withTempArtifacts(async (rootDir) => {
    await writeAssistedImage(rootDir, "exec-pedro", "images/slide-01.png", 1, 1);
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro, logger } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    assert.equal(response.status, "needs_assisted_generation");
    assert.equal(icaro.calls.length, 0);
    assert.equal(response.output.pendingImages.length, 1);
    assert.ok(response.warnings.some((warning) => warning.includes("implausível")));
    assert.ok(logger.list().some((entry) => entry.action === "AssistedImageValidationFailed"));
  });
});

test("Pedro (developer_assisted) rejeita um PNG com resolução diferente da esperada e continua aguardando", async () => {
  await withTempArtifacts(async (rootDir) => {
    await writeAssistedImage(rootDir, "exec-pedro", "images/slide-01.png", 800, 800);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    assert.equal(response.status, "needs_assisted_generation");
    assert.ok(response.warnings.some((warning) => warning.includes("não corresponde à resolução esperada")));
  });
});

test("Pedro (developer_assisted) completa normalmente quando a imagem real já existe em disco, com generationMode e providerUsed corretos", async () => {
  await withTempArtifacts(async (rootDir) => {
    await writeAssistedImage(rootDir, "exec-pedro", "images/slide-01.png", 1080, 1350);
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    assert.equal(response.status, "completed");
    assert.equal(icaro.calls.length, 0);
    assert.equal(response.output.generationMode, "developer_assisted");
    assert.equal(response.output.providerUsed, "developer-assisted");
    assert.equal(response.output.modelUsed, "claude-code-developer-assisted");
    assert.equal(response.output.images[0].width, 1080);
    assert.equal(response.output.images[0].height, 1350);
    assert.equal(response.output.images[0].sizeBytes > 0, true);
    assert.ok(response.output.delivery.htmlPath.endsWith("index.html"));

    const html = await readFile(response.output.delivery.htmlPath, "utf8");
    assert.ok(html.includes("developer-assisted"));
  });
});

test("Pedro (developer_assisted) REJEITA um mockup placeholder do Autonomous Engine mesmo com bytes/dimensão válidos — proveniência não publicável (migração GPT/PR 3)", async () => {
  await withTempArtifacts(async (rootDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    // Mesmo mecanismo real de `mockup-generation.action.ts`: escreve no MESMO caminho que Pedro
    // espera, com bytes/dimensão que passam na validação de PNG, mas com proveniência explícita
    // `publishable: false` — exatamente o vazamento que a auditoria "GPT como motor criativo
    // único" encontrou (validatePngBytes só checava formato/dimensão, nunca proveniência).
    await artifactDelivery.writeFile({
      executionId: "exec-pedro",
      relativePath: "images/slide-01.png",
      content: createMinimalPng(1080, 1350),
      mimeType: "image/png",
      provenance: {
        producer: "placeholder_mockup",
        publishable: false,
        reason: "Caixa de dispositivo HTML/CSS — nunca uma interface real.",
      },
    });
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    // Nunca aceito como imagem final — Pedro continua aguardando intervenção assistida real.
    assert.equal(response.status, "needs_assisted_generation");
    assert.equal(icaro.calls.length, 0);
  });
});

test("Pedro (developer_assisted) ACEITA normalmente uma imagem assistida legítima sem sidecar de proveniência (regressão — humano/IDE nunca passa pelo ArtifactDeliveryPort)", async () => {
  await withTempArtifacts(async (rootDir) => {
    // Mesmo helper já usado pelo teste "completa normalmente" acima: escreve bytes DIRETO no
    // disco (nunca via ArtifactDeliveryPort.writeFile), exatamente como um humano/IDE faria —
    // por isso nunca existe sidecar de proveniência para este arquivo, e isso é o caso normal,
    // nunca motivo de rejeição.
    await writeAssistedImage(rootDir, "exec-pedro", "images/slide-01.png", 1080, 1350);
    const icaro = new FakeIcaroBrain([singleImageJson()]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery, imageGenerationMode: "developer_assisted" });

    const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

    assert.equal(response.status, "completed");
    assert.equal(response.output.generationMode, "developer_assisted");
  });
});

test("Pedro (developer_assisted) sem ArtifactDeliveryPort configurada devolve erro estruturado dedicado", async () => {
  const { pedro } = createPedro({ imageGenerationMode: "developer_assisted", artifactDelivery: undefined });

  const response = await pedro.execute(createRequest(createInput({ imageCount: 1 })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY");
});

test("Pedro (developer_assisted) nunca executa comando externo nem child_process para gerar imagem", async () => {
  const source = await readFile("src/skills/pedro-image-generation/pedro-image-generation.skill.ts", "utf8");
  assert.equal(source.includes("from \"node:child_process\""), false);
  assert.equal(source.includes("from \"child_process\""), false);
  assert.equal(source.includes("require(\"child_process\")"), false);
  assert.equal(source.includes("spawn("), false);
  assert.equal(source.includes("execSync("), false);
  assert.equal(source.includes("ZUNO_NATIVE_IMAGE_GENERATOR_COMMAND"), false);
});

test("Pedro gera entrega de carrossel com botões por slide e ZIP com todas as imagens", async () => {
  await withTempArtifacts(async (rootDir) => {
    const icaro = new FakeIcaroBrain([carouselImagesJson(3)]);
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const { pedro } = createPedro({ icaro, artifactDelivery });

    const response = await pedro.execute(createRequest(createInput({
      imageCount: 3,
      format: "carrossel",
      workflowContext: {
        caption: "Legenda do carrossel.",
        hashtags: ["#Carrossel"],
      },
    })));

    assert.equal(response.status, "completed");
    assert.equal(response.output.delivery.imagePaths.length, 3);
    assert.deepEqual(response.output.delivery.imageRelativePaths, [
      "images/slide-01.png",
      "images/slide-02.png",
      "images/slide-03.png",
    ]);
    assert.deepEqual(response.output.delivery.promptRelativePaths, [
      "image-prompt-slide-01.txt",
      "image-prompt-slide-02.txt",
      "image-prompt-slide-03.txt",
    ]);
    assert.ok(response.output.delivery.zipPath.endsWith("carousel.zip"));

    for (const imagePath of response.output.delivery.imagePaths) {
      const imageInfo = await stat(imagePath);
      assert.equal(imageInfo.isFile(), true);
      assert.ok(imageInfo.size > 0);
    }

    const zipBytes = await readFile(response.output.delivery.zipPath);
    assert.equal(zipBytes.subarray(0, 2).toString("utf8"), "PK");

    const html = await readFile(response.output.delivery.htmlPath, "utf8");
    assert.ok(html.includes('href="images/slide-01.png"'));
    assert.ok(html.includes('download="slide-01.png"'));
    assert.ok(html.includes('href="images/slide-02.png"'));
    assert.ok(html.includes('download="slide-02.png"'));
    assert.ok(html.includes('href="images/slide-03.png"'));
    assert.ok(html.includes('download="slide-03.png"'));
    assert.ok(html.includes('href="carousel.zip"'));
    assert.ok(html.includes('download="carousel.zip"'));
    assert.ok(html.includes("Baixar todas em ZIP"));
    assert.ok(html.includes('href="image-prompt-slide-01.txt"'));
    assert.ok(html.includes('download="image-prompt-slide-01.txt"'));

    const promptFiles = await Promise.all(response.output.delivery.promptPaths.map((promptPath) => readFile(promptPath, "utf8")));
    assert.equal(promptFiles.length, 3);
    assert.ok(promptFiles.every((prompt) => prompt.includes("NEGATIVE PROMPT")));
    assert.ok(promptFiles.every((prompt) => prompt.includes("QUALITY CHECKLIST")));

    const metadata = JSON.parse(await readFile(response.output.delivery.metadataPath, "utf8"));
    assert.equal(metadata.imageCount, 3);
    assert.ok(metadata.zipPath.endsWith("carousel.zip"));
    assert.deepEqual(metadata.promptRelativePaths, [
      "image-prompt-slide-01.txt",
      "image-prompt-slide-02.txt",
      "image-prompt-slide-03.txt",
    ]);
    assert.equal(metadata.qualityReport.agencyChecklist.carouselStorytellingReady, true);
  });
});

test("Pedro não publica; a saída não contém nenhuma indicação de publicação realizada", async () => {
  const { pedro } = createPedro();

  const response = await pedro.execute(createRequest());

  assert.equal(response.output.published, undefined);
  assert.equal(response.output.postId, undefined);
  assert.ok(response.output.nextSteps.some((step) => step.toLowerCase().includes("aprovação humana")));
});

test("Pedro valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { pedro, valentina, clara, logger, events } = createPedro();

  const response = await pedro.execute(createRequest(createInput({ imageCount: 0 })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "ImageGenerationFailed"));
});

test("Pedro trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { pedro, logger, events } = createPedro({ valentina: new FakeValentina([]) });

  const response = await pedro.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "ImageGenerationFailed"));
});

test("Pedro trata contexto visual incompleto na Clara como necessidade de mais contexto", async () => {
  const { pedro, logger, events } = createPedro({ clara: new FakeClara({}) });

  const response = await pedro.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "ImageGenerationFailed"));
});

test("Pedro trata falha do Ícaro como erro estruturado, sem tentativa adicional", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { pedro, logger, events } = createPedro({ icaro });

  const response = await pedro.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "IMAGE_GENERATION_FAILED");
  assert.equal(icaro.calls.length, 1);
  assert.ok(logger.list().some((entry) => entry.action === "Error"));
  assert.ok(events.list().some((event) => event.name === "ImageGenerationFailed"));
});

test("Pedro registra os logs esperados em uma execução completa", async () => {
  const { pedro, logger } = createPedro();

  await pedro.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("VisualContextConsulted"));
  assert.ok(actions.includes("ProductionBriefingValidated"));
  assert.ok(actions.includes("PromptBuilt"));
  assert.ok(actions.includes("GenerationStarted"));
  assert.ok(actions.includes("GenerationFinished"));
  assert.ok(actions.includes("ArtifactCreated"));
});

test("Pedro emite os eventos esperados em uma execução completa", async () => {
  const { pedro, events } = createPedro();

  await pedro.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "ImageGenerationStarted",
    "ImagePromptBuilt",
    "ImageGenerationFinished",
    "ImageArtifactCreated",
  ]);
});

test("Pedro não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/pedro-image-generation/pedro-image-generation.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Pedro não acessa storage diretamente; usa apenas portas quando configuradas", async () => {
  const source = await readFile("src/skills/pedro-image-generation/pedro-image-generation.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("storageport"));
  assert.ok(lowered.includes("artifactdeliveryport"));
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("node:path"), false);
  assert.equal(lowered.includes("from \"fs\""), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("infrastructure/artifacts"), false);
  assert.equal(lowered.includes("socialpublisherport"), false);
  assert.equal(lowered.includes("campaignproviderport"), false);
});

test("Pedro não chama outra Skill diretamente: todo import relativo de nível único aponta apenas para application/domain, nunca para uma pasta irmã em src/skills", async () => {
  const source = await readFile("src/skills/pedro-image-generation/pedro-image-generation.skill.ts", "utf8");
  const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    const isSameFolder = specifier.startsWith("./");
    const isApplicationOrDomain = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
    assert.ok(isSameFolder || isApplicationOrDomain, `Import inesperado que pode apontar para outra Skill: ${specifier}`);
  }
});
