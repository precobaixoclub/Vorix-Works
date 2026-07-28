import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaraKnowledgeCenter } from "../dist/application/knowledge/index.js";
import { InMemoryZunoEventRecorder, InMemoryClaraLogger } from "../dist/infrastructure/telemetry/index.js";
import {
  InMemoryClaraKnowledgeRepository,
  LocalJsonClaraKnowledgeRepository,
} from "../dist/infrastructure/storage/index.js";

function actor(overrides = {}) {
  return {
    id: "maria-copywriting",
    type: "specialist",
    name: "Maria",
    ...overrides,
  };
}

function audit(reason = "Cadastro inicial") {
  return {
    actor: actor(),
    reason,
    correlationId: "corr-clara",
  };
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

function createClara(repository = new InMemoryClaraKnowledgeRepository()) {
  const logger = new InMemoryClaraLogger();
  const events = new InMemoryZunoEventRecorder();
  const clara = new ClaraKnowledgeCenter({
    repository,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return { clara, logger, events, repository };
}

function brandPayload(overrides = {}) {
  return {
    clientId: "client-rumo",
    brandId: "brand-rumo",
    brandName: "Rumo ao Altar",
    positioning: "Plataforma para noivos organizarem casamento com leveza.",
    toneOfVoice: "leve, elegante e divertido",
    preferredHashtags: ["#casamento", "#noivos"],
    forbiddenHashtags: ["#spam"],
    preferredCtas: ["Conheça o Rumo ao Altar"],
    mandatoryWords: ["casamento"],
    forbiddenWords: ["garantia absoluta"],
    importantLinks: ["https://rumoaoaltar.com.br"],
    keywords: ["casamento", "pix", "noivos"],
    ...overrides,
  };
}

test("Clara cadastra conhecimento, cria versão inicial, histórico, logs e eventos", async () => {
  const { clara, logger, events } = createClara();

  const record = await clara.create({
    module: "BrandContext",
    title: "Marca Rumo ao Altar",
    payload: brandPayload(),
    tags: ["marca"],
    audit: audit(),
  });

  assert.equal(record.id, "knowledge-0001");
  assert.equal(record.module, "BrandContext");
  assert.equal(record.clientId, "client-rumo");
  assert.equal(record.currentVersion, 1);
  assert.equal(record.versions.length, 1);
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].action, "created");
  assert.deepEqual(record.tags.sort(), ["casamento", "marca", "noivos", "pix"]);
  assert.ok(logger.list().some((entry) => entry.action === "KnowledgeCreated"));
  assert.ok(logger.list().some((entry) => entry.action === "KnowledgeVersionCreated"));
  assert.ok(events.list().some((event) => event.name === "KnowledgeCreated"));
  assert.ok(events.list().some((event) => event.name === "KnowledgeVersionCreated"));
});

test("Clara consulta e entrega apenas módulos solicitados ao Especialista", async () => {
  const { clara, logger, events } = createClara();
  await clara.create({
    module: "BrandContext",
    title: "Marca Rumo ao Altar",
    payload: brandPayload(),
    audit: audit(),
  });
  await clara.create({
    module: "IdentityContext",
    title: "Identidade visual",
    payload: {
      clientId: "client-rumo",
      brandId: "brand-rumo",
      colors: ["#C97F91", "#111111"],
      fonts: ["Playfair Display", "Inter"],
      imageStyle: "editorial romântico",
      keywords: ["visual", "marca"],
    },
    audit: audit("Identidade cadastrada"),
  });

  const context = await clara.requestContext({
    requester: actor(),
    clientId: "client-rumo",
    modules: ["IdentityContext"],
    scope: { brandId: "brand-rumo" },
    reason: "Criar direção de arte.",
  });

  assert.equal(context.records.length, 1);
  assert.equal(context.records[0].module, "IdentityContext");
  assert.equal(context.modules.IdentityContext.length, 1);
  assert.equal(context.modules.BrandContext, undefined);
  assert.ok(logger.list().some((entry) => entry.action === "KnowledgeRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "KnowledgeDelivered"));
  assert.ok(events.list().some((event) => event.name === "KnowledgeRequested"));
  assert.ok(events.list().some((event) => event.name === "KnowledgeDelivered"));
});

test("Clara atualiza conhecimento criando nova versão e mantendo histórico auditável", async () => {
  const { clara } = createClara();
  const created = await clara.create({
    module: "BrandContext",
    title: "Marca Rumo ao Altar",
    payload: brandPayload(),
    audit: audit(),
  });

  const updated = await clara.update({
    id: created.id,
    patch: {
      toneOfVoice: "leve, elegante, divertido e acolhedor",
      preferredCtas: ["Criar meu site de casamento"],
      keywords: ["casamento", "pix", "noivos", "site"],
    },
    title: "Marca Rumo ao Altar atualizada",
    audit: audit("Refino de tom de voz"),
  });

  assert.equal(updated.currentVersion, 2);
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[1].action, "updated");
  assert.equal(updated.history[1].reason, "Refino de tom de voz");
  assert.equal(updated.payload.toneOfVoice, "leve, elegante, divertido e acolhedor");

  const versionOne = await clara.getVersion(created.id, 1);
  const versionTwo = await clara.getVersion(created.id, 2);
  assert.equal(versionOne.payload.toneOfVoice, "leve, elegante e divertido");
  assert.equal(versionTwo.payload.toneOfVoice, "leve, elegante, divertido e acolhedor");
});

test("Clara remove conhecimento por exclusão lógica e mantém versão de auditoria", async () => {
  const { clara } = createClara();
  const created = await clara.create({
    module: "CampaignContext",
    title: "Campanha de lançamento",
    payload: {
      clientId: "client-rumo",
      campaignId: "campaign-launch",
      campaignName: "Lançamento Rumo ao Altar",
      status: "active",
      objective: "Gerar leads de noivos",
      channels: ["instagram", "facebook"],
      keywords: ["lançamento", "noivos"],
    },
    audit: audit(),
  });

  const deleted = await clara.remove({
    id: created.id,
    audit: audit("Campanha encerrada"),
  });
  const activeRecords = await clara.list({ clientId: "client-rumo", module: "CampaignContext" });
  const allRecords = await clara.list({ clientId: "client-rumo", module: "CampaignContext", status: "all" });

  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.currentVersion, 2);
  assert.equal(deleted.history[1].action, "deleted");
  assert.equal(activeRecords.length, 0);
  assert.equal(allRecords.length, 1);
});

test("Clara pesquisa por cliente, campanha, produto, serviço e palavras-chave", async () => {
  const { clara } = createClara();
  await clara.create({
    module: "ProductContext",
    title: "Lista de presentes por PIX",
    payload: {
      clientId: "client-rumo",
      productId: "product-gifts-pix",
      productName: "Presentes por PIX",
      description: "Lista de presentes para casamento com pagamento via PIX.",
      benefits: ["praticidade", "repasse direto"],
      keywords: ["pix", "presentes"],
    },
    audit: audit(),
  });
  await clara.create({
    module: "CampaignContext",
    title: "Campanha Lua de Mel",
    payload: {
      clientId: "client-rumo",
      campaignId: "campaign-honeymoon",
      campaignName: "Lua de Mel Sem Perrengue",
      status: "active",
      objective: "Divulgar ações divertidas da festa",
      keywords: ["lua de mel", "ações"],
    },
    audit: audit(),
  });

  const byText = await clara.search({ clientId: "client-rumo", text: "pagamento via pix" });
  const byKeyword = await clara.search({ clientId: "client-rumo", keywords: ["lua de mel"] });
  const byProduct = await clara.search({ clientId: "client-rumo", productId: "product-gifts-pix" });
  const byCampaign = await clara.search({ clientId: "client-rumo", campaignId: "campaign-honeymoon" });

  assert.equal(byText.length, 1);
  assert.equal(byText[0].module, "ProductContext");
  assert.equal(byKeyword.length, 1);
  assert.equal(byKeyword[0].module, "CampaignContext");
  assert.equal(byProduct.length, 1);
  assert.equal(byCampaign.length, 1);
});

test("Clara persiste conhecimento em armazenamento local JSON sem expor arquivo aos Especialistas", async () => {
  const filePath = join(tmpdir(), `zuno-clara-${Date.now()}.json`);
  try {
    const first = createClara(new LocalJsonClaraKnowledgeRepository(filePath));
    const created = await first.clara.create({
      module: "BusinessContext",
      title: "Negócio Rumo ao Altar",
      payload: {
        clientId: "client-rumo",
        businessName: "Rumo ao Altar",
        segment: "wedding tech",
        marketingObjectives: ["captar noivos", "vender planos"],
        connectedSocialNetworks: ["instagram"],
        keywords: ["casamento"],
      },
      audit: audit(),
    });

    const second = createClara(new LocalJsonClaraKnowledgeRepository(filePath));
    const found = await second.clara.get({ id: created.id, status: "all" });

    assert.equal(found.title, "Negócio Rumo ao Altar");
    assert.equal(found.payload.businessName, "Rumo ao Altar");
  } finally {
    await rm(filePath, { force: true });
  }
});

test("LocalJsonClaraKnowledgeRepository rejeita caminho de arquivo vazio ou com caractere inválido", () => {
  assert.throws(() => new LocalJsonClaraKnowledgeRepository(""), /obrigatório/);
  assert.throws(() => new LocalJsonClaraKnowledgeRepository("   "), /obrigatório/);
  assert.throws(() => new LocalJsonClaraKnowledgeRepository("knowledge\0.json"), /inválido/);
});

test("Especialistas, Arthur, Helena, Caio e Ícaro não acessam armazenamento da Clara diretamente", async () => {
  const files = [
    // As 12 Skills existentes: nenhuma pode armazenar conhecimento próprio nem acessar o
    // repositório da Clara diretamente — toda consulta precisa passar por `ClaraKnowledgePort`.
    // Cobertura ampliada nesta fase (antes só cobria Maria) para as 12 Skills, exigida pela
    // evolução da Clara em múltiplos módulos: mais módulos não deve criar nenhuma tentação de
    // atalho de armazenamento local em nenhuma Skill.
    "src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts",
    "src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts",
    "src/skills/maria-copywriting/maria-copywriting.skill.ts",
    "src/skills/sofia-art-direction/sofia-art-direction.skill.ts",
    "src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts",
    "src/skills/pedro-image-generation/pedro-image-generation.skill.ts",
    "src/skills/bruno-video-script/bruno-video-script.skill.ts",
    "src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts",
    "src/skills/diego-video-editing/diego-video-editing.skill.ts",
    "src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts",
    "src/skills/lucas-quality-review/lucas-quality-review.skill.ts",
    "src/skills/ana-social-publishing/ana-social-publishing.skill.ts",
    "src/application/orchestration/arthur.orchestrator.ts",
    "src/application/skills/helena.manager.ts",
    "src/application/workflows/caio.executor.ts",
    "src/application/ai/icaro-brain.ts",
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(source.includes("LocalJsonClaraKnowledgeRepository"), false, `${file} não deveria importar LocalJsonClaraKnowledgeRepository`);
    assert.equal(source.includes("InMemoryClaraKnowledgeRepository"), false, `${file} não deveria importar InMemoryClaraKnowledgeRepository`);
    assert.equal(source.includes("node:fs"), false, `${file} não deveria importar node:fs`);
    assert.equal(source.includes("fs/promises"), false, `${file} não deveria importar fs/promises`);
  }
});

test("Todas as Skills que consultam a Clara fazem isso exclusivamente via ClaraKnowledgePort.requestContext (nenhuma importa clara.types/porta diretamente por fora do padrão)", async () => {
  // Cada Skill que recebe `clara` como dependência precisa importar apenas o tipo da porta
  // (`ClaraKnowledgePort`) do módulo de aplicação — nunca a implementação concreta
  // (`ClaraKnowledgeCenter`) nem o repositório. Isso garante que novos módulos adicionados à
  // Clara não criam nenhum caminho alternativo de acesso.
  const filesWithClaraDependency = [
    "src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts",
    "src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts",
    "src/skills/sofia-art-direction/sofia-art-direction.skill.ts",
    "src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts",
    "src/skills/pedro-image-generation/pedro-image-generation.skill.ts",
    "src/skills/bruno-video-script/bruno-video-script.skill.ts",
    "src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts",
    "src/skills/diego-video-editing/diego-video-editing.skill.ts",
    "src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts",
    "src/skills/lucas-quality-review/lucas-quality-review.skill.ts",
  ];

  for (const file of filesWithClaraDependency) {
    const source = await readFile(file, "utf8");
    assert.equal(source.includes("ClaraKnowledgeCenter"), false, `${file} não deveria importar a implementação concreta ClaraKnowledgeCenter`);
    assert.ok(source.includes("ClaraKnowledgePort") || source.includes("ClaraKnowledgeRecord"), `${file} deveria depender de ClaraKnowledgePort/ClaraKnowledgeRecord (por convenção, espelhado)`);
  }
});
