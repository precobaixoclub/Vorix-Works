import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaraKnowledgeCenter } from "../dist/application/knowledge/index.js";
import { ValentinaTenantManager } from "../dist/application/tenancy/index.js";
import { ArthurOrchestrator } from "../dist/application/orchestration/index.js";
import { CaioWorkflowExecutor } from "../dist/application/workflows/index.js";
import { HelenaSkillManager, SkillManifestValidator, SkillRegistry } from "../dist/application/skills/index.js";
import {
  InMemoryClaraLogger,
  InMemoryValentinaLogger,
  InMemoryZunoEventRecorder,
  InMemoryCaioLogger,
} from "../dist/infrastructure/telemetry/index.js";
import {
  InMemoryClaraKnowledgeRepository,
  InMemoryValentinaTenantRepository,
} from "../dist/infrastructure/storage/index.js";
import { LocalArtifactDelivery } from "../dist/infrastructure/artifacts/index.js";
import { DeterministicFakeIcaroProvider } from "../dist/infrastructure/ai/index.js";
import { EduardoEditorialPlanningSkill } from "../dist/skills/eduardo-editorial-planning/index.js";
import { JoaoMarketingStrategySkill } from "../dist/skills/joao-marketing-strategy/index.js";
import { MariaCopywritingSkill } from "../dist/skills/maria-copywriting/index.js";
import { SofiaArtDirectionSkill } from "../dist/skills/sofia-art-direction/index.js";
import { BiancaSocialMediaDesignSkill } from "../dist/skills/bianca-social-media-design/index.js";
import { PedroImageGenerationSkill } from "../dist/skills/pedro-image-generation/index.js";
import { LucasQualityReviewSkill } from "../dist/skills/lucas-quality-review/index.js";
import { AnaSocialPublishingSkill } from "../dist/skills/ana-social-publishing/index.js";

const CLIENT_ID = "client-rumo-organic-cycle";
const TENANT_ID_EXPECTED_PREFIX = "tenant-";
const CORRELATION_ID = "corr-organic-cycle";
const NOW = "2026-07-02T12:00:00.000Z";

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

function actor(overrides = {}) {
  return {
    id: "organic-cycle-test",
    type: "system",
    name: "Teste ponta a ponta do ciclo orgânico",
    ...overrides,
  };
}

function audit(reason = "Preparação do teste ponta a ponta") {
  return {
    actor: actor(),
    reason,
    correlationId: CORRELATION_ID,
  };
}

function createValentina() {
  const eventRecorder = new InMemoryZunoEventRecorder();
  const valentina = new ValentinaTenantManager({
    repository: new InMemoryValentinaTenantRepository(),
    logger: new InMemoryValentinaLogger(),
    eventRecorder,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date(NOW),
  });

  return { valentina, eventRecorder };
}

function createClara() {
  const eventRecorder = new InMemoryZunoEventRecorder();
  const clara = new ClaraKnowledgeCenter({
    repository: new InMemoryClaraKnowledgeRepository(),
    logger: new InMemoryClaraLogger(),
    eventRecorder,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date(NOW),
  });

  return { clara, eventRecorder };
}

async function createOrganicTenant(valentina) {
  const tenant = await valentina.createTenant({
    clientId: CLIENT_ID,
    displayName: "Rumo ao Altar",
    plan: "PRO",
    subscriptionStatus: "active",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    country: "BR",
    environment: "development",
    niche: "wedding tech",
    mainObjectives: ["captar noivos", "explicar presentes via Pix", "gerar visitas para o site"],
    preferences: { aiPriority: "balanced", approvalRequired: true },
    audit: audit("Cliente criado para validar o ciclo orgânico"),
  });

  await valentina.activateTenant({
    tenantId: tenant.id,
    audit: audit("Ativação para execução ponta a ponta"),
  });

  await valentina.connectIntegration({
    tenantId: tenant.id,
    network: "instagram",
    tokenReference: "fake-instagram-token-reference",
    scopes: ["content_publish"],
    audit: audit("Conectar Instagram fake para dry run"),
  });

  await valentina.connectIntegration({
    tenantId: tenant.id,
    network: "facebook",
    tokenReference: "fake-facebook-token-reference",
    scopes: ["pages_manage_posts"],
    audit: audit("Conectar Facebook fake para dry run"),
  });

  return valentina.getTenant({ tenantId: tenant.id, status: "all" });
}

async function seedKnowledge(clara) {
  await clara.create({
    module: "BrandContext",
    title: "Marca Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      brandId: "brand-rumo-ao-altar",
      brandName: "Rumo ao Altar",
      positioning: "Plataforma para noivos criarem site de casamento, presentes via Pix e experiências para convidados.",
      promise: "Casamentos digitais organizados com leveza, humor e controle para os noivos.",
      toneOfVoice: "leve divertido persuasivo",
      preferredHashtags: ["#Casamento", "#Noivos", "#Presentes"],
      forbiddenHashtags: ["#spam"],
      preferredCtas: ["Conheça o Rumo ao Altar"],
      mandatoryWords: ["Rumo ao Altar"],
      forbiddenWords: ["garantia absoluta"],
      importantLinks: ["https://rumoaoaltar.com.br"],
      keywords: ["casamento", "pix", "presentes", "noivos"],
    },
    tags: ["marca", "casamento"],
    audit: audit("Cadastrar contexto de marca"),
  });

  await clara.create({
    module: "AudienceContext",
    title: "Público de noivos",
    payload: {
      clientId: CLIENT_ID,
      targetAudience: "Noivos que querem organizar o casamento com praticidade e convidados que preferem presentear por Pix.",
      personas: [
        {
          name: "Casal planejador",
          pains: ["organizar lista de presentes", "centralizar informações do casamento"],
          desires: ["site bonito", "pagamentos simples", "experiência leve para convidados"],
        },
      ],
      keywords: ["noivos", "convidados", "presente via pix"],
    },
    tags: ["público"],
    audit: audit("Cadastrar público-alvo"),
  });

  await clara.create({
    module: "ProductContext",
    title: "Produto principal",
    payload: {
      clientId: CLIENT_ID,
      productId: "product-rumo-site",
      productName: "Rumo ao Altar",
      description: "Site de casamento com lista de presentes, Pix, ações de festa, fotos colaborativas e QR Codes.",
      benefits: ["Presentes via Pix direto para os noivos", "QR Codes para convidados", "painel simples para acompanhar tudo"],
      differentiators: ["Fluxo de publicação guiado", "presentes criativos", "experiência divertida para convidados"],
      keywords: ["lista de presentes", "pix", "site de casamento"],
    },
    tags: ["produto"],
    audit: audit("Cadastrar produto"),
  });

  await clara.create({
    module: "CampaignContext",
    title: "Campanha orgânica Pix",
    payload: {
      clientId: CLIENT_ID,
      campaignId: "campaign-pix-organic",
      campaignName: "Presentes via Pix sem climão",
      status: "active",
      objective: "Explicar que convidados podem presentear por Pix direto no site do casal.",
      keywords: ["pix", "presentes", "convidados"],
    },
    tags: ["campanha"],
    audit: audit("Cadastrar campanha orgânica"),
  });

  await clara.create({
    module: "ContentContext",
    title: "Histórico editorial",
    payload: {
      clientId: CLIENT_ID,
      publicationHistory: [
        {
          publicationId: "pub-history-1",
          channel: "instagram",
          publishedAt: "2026-06-20T10:00:00.000Z",
          topic: "site de casamento",
        },
      ],
    },
    tags: ["conteúdo"],
    audit: audit("Cadastrar histórico editorial"),
  });

  await clara.create({
    module: "IdentityContext",
    title: "Identidade visual",
    payload: {
      clientId: CLIENT_ID,
      brandId: "brand-rumo-ao-altar",
      colors: ["#C97F91", "#111111", "#FFFFFF"],
      fonts: ["Playfair Display", "Inter"],
      imageStyle: "editorial romântico com humor leve",
      visualGuidelines: [
        "Usar fotos com casal real ou mockups elegantes.",
        "Aplicar contraste limpo e espaço para texto.",
        "Evitar visual poluído ou promessa exagerada.",
      ],
      keywords: ["visual", "marca", "romântico"],
    },
    tags: ["identidade"],
    audit: audit("Cadastrar identidade visual"),
  });

  await clara.create({
    module: "PublishingContext",
    title: "Regras de publicação",
    payload: {
      clientId: CLIENT_ID,
      connectedSocialNetworks: [
        { network: "instagram", status: "connected" },
        { network: "facebook", status: "connected" },
      ],
      approvalFlow: "Publicar somente após revisão do Lucas e aprovação humana.",
    },
    tags: ["publicação"],
    audit: audit("Cadastrar regras de publicação"),
  });
}

class OrganicCycleStorageFake {
  constructor() {
    this.saved = [];
    this.nextId = 1;
  }

  async save(input) {
    const id = `asset-${String(this.nextId).padStart(4, "0")}`;
    const asset = {
      id,
      uri: `local://organic-cycle/${input.name}`,
      mimeType: input.mimeType,
      metadata: { sizeBytes: input.data.byteLength },
    };
    this.nextId += 1;
    this.saved.push({ input, asset });
    return asset;
  }

  async read() {
    throw new Error("Storage fake não deve ser lido durante o ciclo orgânico.");
  }
}

class OrganicCycleSocialPublisherFake {
  constructor() {
    this.capabilities = { supportsScheduling: true };
    this.publishCalls = [];
    this.scheduleCalls = [];
  }

  async publish(draft) {
    this.publishCalls.push(draft);
    return {
      channel: draft.channel,
      status: "published",
      externalId: `fake-${draft.channel}-post`,
      url: `https://social.example/${draft.channel}/fake-post`,
    };
  }

  async schedule(draft) {
    this.scheduleCalls.push(draft);
    return {
      channel: draft.channel,
      status: "scheduled",
      externalId: `fake-${draft.channel}-scheduled-post`,
      scheduledAt: draft.scheduledAt,
    };
  }
}

class InMemorySkillLogger {
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

/**
 * Nenhuma Skill é chamada diretamente aqui: cada uma é registrada na `SkillRegistry` real
 * (mesma classe usada em produção) e localizada por Helena unicamente pela `capability`
 * declarada em seu manifesto — exatamente como Caio a encontra via `HelenaSkillManager` de
 * verdade. `discovery`/`loader`/`validator` nunca são chamados porque o registro é populado
 * diretamente (o teste `skills-discovery.test.mjs` já cobre a descoberta real em disco).
 */
function createHelena(skills, now) {
  const registry = new SkillRegistry();
  for (const skill of skills) {
    const source = { sourceId: skill.manifest.id, location: "in-memory", manifest: skill.manifest };
    registry.registerDiscovered(source, now().toISOString());
    registry.attachManifest(skill.manifest.id, skill.manifest, now().toISOString());
    registry.attachSkill(skill.manifest.id, skill, now().toISOString());
    registry.updateState(skill.manifest.id, "READY", now().toISOString());
  }

  const unusedDiscovery = { async discover() { return []; } };
  const unusedLoader = { async load() { throw new Error("Loader não deveria ser chamado neste teste."); } };

  return new HelenaSkillManager({
    discovery: unusedDiscovery,
    loader: unusedLoader,
    validator: new SkillManifestValidator(),
    registry,
    eventRecorder: new InMemoryZunoEventRecorder(),
  });
}

function createSkills({ valentina, clara, icaro, storage, socialPublisher, artifactDelivery }) {
  const eventRecorder = new InMemoryZunoEventRecorder();
  const logger = new InMemorySkillLogger();
  const now = () => new Date(NOW);

  return [
    new EduardoEditorialPlanningSkill({ valentina, clara, icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new JoaoMarketingStrategySkill({ valentina, clara, icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new MariaCopywritingSkill({ icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new SofiaArtDirectionSkill({ valentina, clara, icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new BiancaSocialMediaDesignSkill({ valentina, clara, icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new PedroImageGenerationSkill({ valentina, clara, icaro, storage, artifactDelivery, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new LucasQualityReviewSkill({ valentina, clara, icaro, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
    new AnaSocialPublishingSkill({ valentina, clara, socialPublisher, logger, eventRecorder, idGenerator: createDeterministicIdGenerator(), now }),
  ];
}

function stepOutput(report, stepName) {
  const step = report.steps.find((candidate) => candidate.name === stepName);
  assert.ok(step, `Etapa "${stepName}" deveria existir no relatório do workflow`);
  assert.equal(step.state, "COMPLETED", `Etapa "${stepName}" deveria estar concluída`);
  assert.equal(step.response?.status, "completed");
  return step.response.output;
}

function assertMariaBriefingCompatible(briefing) {
  assert.equal(typeof briefing.objective, "string");
  assert.equal(briefing.channel, "instagram");
  assert.equal(typeof briefing.targetAudience, "string");
  assert.equal(typeof briefing.toneOfVoice, "string");
  assert.equal(typeof briefing.cta, "string");
  assert.equal(typeof briefing.keyMessage, "string");
}

function assertSofiaBriefingCompatible(briefing) {
  assert.equal(briefing.status, "preliminary");
  assert.equal(briefing.channel, "instagram");
  assert.ok(Array.isArray(briefing.keyMessages));
}

function assertBiancaBriefingCompatible(briefing) {
  assert.equal(briefing.status, "preliminary");
  assert.equal(briefing.channel, "instagram");
  assert.ok(Array.isArray(briefing.suggestedPalette));
}

function assertPedroBriefingCompatible(briefing) {
  assert.equal(briefing.status, "structured");
  assert.equal(briefing.channel, "instagram");
  assert.ok(Array.isArray(briefing.slides));
  assert.ok(briefing.slides.length >= 1);
}

async function assertNoDirectSkillCalls() {
  const skillFolders = [
    "eduardo-editorial-planning",
    "joao-marketing-strategy",
    "maria-copywriting",
    "sofia-art-direction",
    "bianca-social-media-design",
    "pedro-image-generation",
    "lucas-quality-review",
    "ana-social-publishing",
  ];

  for (const folder of skillFolders) {
    const source = await readFile(`src/skills/${folder}/${folder}.skill.ts`, "utf8");
    const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

    assert.ok(importSpecifiers.length > 0, `${folder} deveria declarar imports explícitos`);
    for (const specifier of importSpecifiers) {
      const sameFolderImport = specifier.startsWith("./");
      const architectureImport = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
      assert.ok(
        sameFolderImport || architectureImport,
        `${folder} possui import inesperado que pode apontar para outra Skill: ${specifier}`,
      );
    }
  }
}

async function assertMirroredContractsDoNotDrift() {
  const [joaoTypes, mariaTypes, sofiaTypes, biancaTypes, pedroTypes] = await Promise.all([
    readFile("src/skills/joao-marketing-strategy/joao-marketing-strategy.types.ts", "utf8"),
    readFile("src/skills/maria-copywriting/maria-copywriting.types.ts", "utf8"),
    readFile("src/skills/sofia-art-direction/sofia-art-direction.types.ts", "utf8"),
    readFile("src/skills/bianca-social-media-design/bianca-social-media-design.types.ts", "utf8"),
    readFile("src/skills/pedro-image-generation/pedro-image-generation.types.ts", "utf8"),
  ]);

  const joaoMariaKeys = extractTopLevelKeys(joaoTypes, "JoaoMariaBriefing");
  const mariaBriefingKeys = extractTopLevelKeys(mariaTypes, "MariaCopyBriefing");
  for (const key of joaoMariaKeys) {
    assert.ok(mariaBriefingKeys.includes(key), `MariaCopyBriefing não possui campo espelhado de João: ${key}`);
  }

  assert.deepEqual(
    extractTopLevelKeys(joaoTypes, "JoaoSofiaBriefing").sort(),
    extractTopLevelKeys(sofiaTypes, "SofiaJoaoBriefing").sort(),
    "JoaoSofiaBriefing e SofiaJoaoBriefing devem continuar espelhados",
  );

  assert.deepEqual(
    extractTopLevelKeys(sofiaTypes, "SofiaBiancaBriefing").sort(),
    extractTopLevelKeys(biancaTypes, "BiancaSofiaBriefing").sort(),
    "SofiaBiancaBriefing e BiancaSofiaBriefing devem continuar espelhados",
  );

  assert.deepEqual(
    extractTopLevelKeys(biancaTypes, "BiancaPedroBriefing").sort(),
    extractTopLevelKeys(pedroTypes, "PedroBiancaBriefing").sort(),
    "BiancaPedroBriefing e PedroBiancaBriefing devem continuar espelhados",
  );
}

function extractTopLevelKeys(source, typeName) {
  const marker = `export type ${typeName} =`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Tipo ${typeName} não encontrado`);

  const openIndex = source.indexOf("{", markerIndex);
  assert.notEqual(openIndex, -1, `Tipo ${typeName} não possui bloco de objeto`);

  const lines = source.slice(openIndex).split("\n");
  const keys = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (depth === 1) {
      const match = trimmed.match(/^([a-zA-Z0-9_]+)\??:/);
      if (match) keys.push(match[1]);
    }

    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }

    if (depth === 0 && keys.length > 0) break;
  }

  return keys;
}

test("Ciclo orgânico roda de ponta a ponta por Arthur -> Caio -> Helena -> Skills reais, com Caio encadeando automaticamente as saídas (sem montagem manual)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-organic-cycle-"));
  try {
    const { valentina } = createValentina();
    const { clara } = createClara();
    const tenant = await createOrganicTenant(valentina);
    await seedKnowledge(clara);

    assert.ok(tenant.id.startsWith(TENANT_ID_EXPECTED_PREFIX));
    assert.equal(tenant.clientId, CLIENT_ID);
    assert.equal(tenant.integrations.instagram.status, "connected");
    assert.equal(tenant.integrations.facebook.status, "connected");

    const icaro = new DeterministicFakeIcaroProvider();
    const storage = new OrganicCycleStorageFake();
    const socialPublisher = new OrganicCycleSocialPublisherFake();
    const artifactDelivery = new LocalArtifactDelivery({ rootDir });
    const now = () => new Date(NOW);

    const skills = createSkills({ valentina, clara, icaro, storage, socialPublisher, artifactDelivery });
    const helena = createHelena(skills, now);
    const caioLogger = new InMemoryCaioLogger();
    const caio = new CaioWorkflowExecutor({ helena, tenants: valentina, logger: caioLogger, now });
    const arthur = new ArthurOrchestrator({ tenants: valentina, now });

    const originalRequest = "Quero criar uma publicação orgânica para Instagram e Facebook sobre o Rumo ao Altar, explicando que os convidados podem enviar presentes via Pix direto para os noivos, e publicar após aprovação.";

    const { executionPlan } = await arthur.planFromText({ command: originalRequest, clientId: CLIENT_ID });
    assert.equal(executionPlan.createdBy, "arthur");
    assert.deepEqual(
      executionPlan.steps.map((step) => step.skillCapability ?? step.type),
      ["editorial_planning", "strategy", "copywriting", "art_direction", "social_media_design", "image_generation", "quality_review", "human_gate", "social_publishing"],
    );

    const waitingReport = await caio.execute({ plan: executionPlan, dryRun: true, correlationId: CORRELATION_ID });
    assert.equal(waitingReport.state, "WAITING_HUMAN_APPROVAL");

    const report = await caio.resume(waitingReport.executionId, {
      confirmed: true,
      approvedBy: "qa@zuno.local",
      approvedAt: NOW,
    });
    assert.equal(report.state, "COMPLETED");

    const eduardoOutput = stepOutput(report, "Planejamento editorial");
    assert.ok(["imagem_unica", "carrossel", "reels", "video", "story"].includes(eduardoOutput.recommendedFormat));
    assert.ok(Array.isArray(eduardoOutput.narrativeStructure) && eduardoOutput.narrativeStructure.length > 0);
    assert.ok(Array.isArray(eduardoOutput.recommendationsForJoao) && eduardoOutput.recommendationsForJoao.length > 0);

    const joaoOutput = stepOutput(report, "Estratégia de marketing");
    // João não decide mais o formato sozinho: o valor final vem do Editorial Brief do Eduardo,
    // encadeado automaticamente por Caio via inputBinding (sem montagem manual).
    assert.equal(joaoOutput.format, eduardoOutput.recommendedFormatLabel);
    assertMariaBriefingCompatible(joaoOutput.mariaBriefing);
    assertSofiaBriefingCompatible(joaoOutput.sofiaBriefing);
    assert.deepEqual(joaoOutput.mariaBriefing.mandatoryWords, ["Rumo ao Altar"]);
    assert.deepEqual(joaoOutput.mariaBriefing.forbiddenTerms, ["garantia absoluta"]);

    const mariaOutput = stepOutput(report, "Criação da copy");
    assert.equal(mariaOutput.deliveredBestEffort, false);
    assert.equal(mariaOutput.quality.passed, true);
    assert.ok(mariaOutput.caption.includes("Rumo ao Altar") || mariaOutput.title.includes("Rumo ao Altar"));

    const sofiaOutput = stepOutput(report, "Direção de arte");
    assertBiancaBriefingCompatible(sofiaOutput.biancaBriefing);

    const biancaOutput = stepOutput(report, "Design de redes sociais");
    assertPedroBriefingCompatible(biancaOutput.pedroBriefing);

    const pedroOutput = stepOutput(report, "Geração de imagem");
    assert.equal(pedroOutput.imageCount, 1);
    assert.equal(pedroOutput.images.length, 1);
    assert.ok(pedroOutput.delivery.htmlPath.endsWith("index.html"));
    assert.equal(storage.saved.length, 1);

    const lucasOutput = stepOutput(report, "Revisão");
    assert.ok(["approved", "approved_with_warnings"].includes(lucasOutput.reviewStatus));
    assert.equal(lucasOutput.approvalRecommended, true);

    const anaOutput = stepOutput(report, "Publicação Meta");
    assert.equal(anaOutput.overallStatus, "local_ready");
    assert.deepEqual(anaOutput.requestedChannels.slice().sort(), ["facebook", "instagram"]);
    assert.equal(anaOutput.payloadSentToPublisher.length, 2);
    assert.ok(anaOutput.payloadSentToPublisher.every((draft) => draft.assetUris.length === 1));
    assert.equal(socialPublisher.publishCalls.length, 0);
    assert.equal(socialPublisher.scheduleCalls.length, 0);

    assert.deepEqual(
      icaro.calls.map((call) => call.specialistId),
      [
        "eduardo-editorial-planning",
        "joao-marketing-strategy",
        "maria-copywriting",
        "sofia-art-direction",
        "bianca-social-media-design",
        "pedro-image-generation",
        "lucas-quality-review",
      ],
    );
    assert.equal(icaro.calls.find((call) => call.specialistId === "pedro-image-generation").taskType, "image_generation");
    assert.equal(icaro.calls.find((call) => call.specialistId === "maria-copywriting").taskType, "text_generation");

    assert.equal(report.artifactSummary.htmlPaths.length, 1);
    const html = await readFile(report.artifactSummary.htmlPaths[0], "utf8");
    assert.ok(html.includes("Relatório das Skills utilizadas"));
    assert.ok(html.includes("Planejamento editorial"));
    assert.ok(html.includes("Estratégia de marketing"));
    assert.ok(html.includes("Criação da copy"));
    assert.ok(html.includes("Direção de arte"));
    assert.ok(html.includes("Design de redes sociais"));
    assert.ok(html.includes("Resumo técnico da execução"));

    assert.ok(caioLogger.list().some((entry) => entry.action === "WorkflowResumed"));

    await assertNoDirectSkillCalls();
    await assertMirroredContractsDoNotDrift();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
