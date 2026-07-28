import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignManager, CAMPAIGN_CONTENT_STATUSES } from "../dist/application/campaign/index.js";
import { InMemoryCampaignRepository, LocalJsonCampaignRepository } from "../dist/infrastructure/storage/index.js";

const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";

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

class FakeValentina {
  constructor(tenants = [{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]) {
    this.tenants = tenants;
  }

  async getClientContext(tenantId) {
    const tenant = this.tenants.find((candidate) => candidate.id === tenantId);
    if (!tenant) throw new Error(`Cliente ${tenantId} não encontrado pela Valentina.`);
    return { tenantId: tenant.id, clientId: tenant.clientId, plan: tenant.plan ?? "PRO" };
  }

  async getTenant(query) {
    return this.tenants.find((candidate) => candidate.clientId === query.clientId);
  }
}

class FakeClara {
  constructor(recordsByModule = {}) {
    this.recordsByModule = recordsByModule;
  }

  async requestContext(request) {
    const modules = {};
    for (const moduleName of request.modules ?? Object.keys(this.recordsByModule)) {
      const records = this.recordsByModule[moduleName] ?? [];
      if (records.length > 0) modules[moduleName] = records;
    }
    return { clientId: request.clientId, deliveredAt: "2026-07-10T12:00:00.000Z", modules, records: [] };
  }
}

function claraRecord(payload) {
  return { updatedAt: "2026-01-01T00:00:00.000Z", payload };
}

class FakeArthur {
  constructor() {
    this.calls = [];
    this.nextPlanNumber = 1;
  }

  async planFromText(input) {
    this.calls.push(input);
    const id = `plan-${String(this.nextPlanNumber).padStart(4, "0")}`;
    this.nextPlanNumber += 1;
    return {
      interpretedIntent: {
        intent: { id: `intent-${id}`, objective: input.command },
        detectedChannels: ["instagram"],
        requiredCapabilities: ["strategy", "copywriting"],
        notes: [],
      },
      executionPlan: {
        id,
        intent: { id: `intent-${id}`, objective: input.command },
        createdBy: "arthur",
        tenant: { clientId: input.clientId, tenantId: input.tenantId, source: "input" },
        steps: [
          { id: "step-1", order: 1, type: "skill", name: "Estratégia de marketing", skillCapability: "strategy", instructions: "", input: {}, expectedOutput: "", dependsOn: [] },
          { id: "step-2", order: 2, type: "skill", name: "Criação da copy", skillCapability: "copywriting", instructions: "", input: {}, expectedOutput: "", dependsOn: [] },
        ],
        acceptanceCriteria: [],
      },
    };
  }
}

function createManager(overrides = {}) {
  return new CampaignManager({
    valentina: overrides.valentina ?? new FakeValentina(),
    arthur: overrides.arthur ?? new FakeArthur(),
    clara: overrides.clara,
    repository: overrides.repository ?? new InMemoryCampaignRepository(),
    idGenerator: overrides.idGenerator ?? createDeterministicIdGenerator(),
    now: overrides.now ?? (() => new Date("2026-07-10T12:00:00.000Z")),
  });
}

// --- Quebra automática do objetivo em Campaign Plan --------------------------------------------

test('Campaign Manager quebra "campanha para divulgar durante 30 dias" em um Campaign Plan de divulgação com todos os campos pedidos', async () => {
  const manager = createManager();

  const plan = await manager.createCampaign({
    clientId: CLIENT_ID,
    objective: "Quero uma campanha para divulgar o Rumo ao Altar durante 30 dias.",
  });

  assert.equal(plan.clientId, CLIENT_ID);
  assert.equal(plan.objectiveType, "divulgacao");
  assert.equal(plan.durationDays, 30);
  assert.ok(plan.persona.length > 0);
  assert.ok(Array.isArray(plan.channels) && plan.channels.length > 0);
  assert.ok(plan.frequency.postsPerWeek > 0);
  assert.ok(plan.frequency.label.includes("semana"));
  assert.equal(plan.calendar.length, plan.contents.length);
  assert.equal(plan.contents.length, 10); // round(30/3)

  for (const content of plan.contents) {
    assert.ok(content.id);
    assert.ok(content.topic.length > 0);
    assert.ok(["imagem_unica", "carrossel", "reels", "video", "story"].includes(content.recommendedFormat));
    assert.ok(["alta", "media", "baixa"].includes(content.priority));
    assert.ok(content.cta.length > 0);
    assert.ok(content.scheduledDate);
    assert.equal(content.status, "pending");
  }

  assert.equal(plan.contents[0].role, "abertura");
  assert.equal(plan.contents[0].priority, "alta");
  assert.deepEqual(plan.contents[0].relatedContentIds, []);

  const last = plan.contents[plan.contents.length - 1];
  assert.equal(last.role, "cta_final");
  assert.equal(last.priority, "alta");

  // Relação entre os conteúdos: todo conteúdo além da abertura referencia o id da abertura.
  for (const content of plan.contents.slice(1)) {
    assert.deepEqual(content.relatedContentIds, [plan.contents[0].id]);
  }
});

test('Campaign Manager classifica "captar casais recém-noivos" como captação, com persona e estrutura próprias, usando duração padrão de 30 dias', async () => {
  const manager = createManager();

  const plan = await manager.createCampaign({
    clientId: CLIENT_ID,
    objective: "Quero uma campanha para captar casais recém-noivos.",
  });

  assert.equal(plan.objectiveType, "captacao");
  assert.equal(plan.durationDays, 30);
  assert.ok(plan.persona.toLowerCase().includes("recém-noivos") || plan.persona.toLowerCase().includes("recem-noivos"));
  assert.equal(plan.contents[0].role, "abertura");
  assert.match(plan.contents[0].topic, /organizar o casamento/i);
});

test('Campaign Manager classifica "divulgar a lista de presentes" como conversão específica e interpola o recurso nos tópicos', async () => {
  const manager = createManager();

  const plan = await manager.createCampaign({
    clientId: CLIENT_ID,
    objective: "Quero uma campanha para divulgar a lista de presentes.",
  });

  assert.equal(plan.objectiveType, "conversao_especifica");
  for (const content of plan.contents) {
    assert.match(content.topic, /lista de presentes/i);
  }
});

test("Campaign Manager respeita duração e canais explícitos quando informados, sem depender do texto", async () => {
  const manager = createManager();

  const plan = await manager.createCampaign({
    clientId: CLIENT_ID,
    objective: "Quero uma campanha para divulgar o Rumo ao Altar.",
    durationDays: 9,
    channels: ["tiktok"],
  });

  assert.equal(plan.durationDays, 9);
  assert.deepEqual(plan.channels, ["tiktok"]);
  assert.equal(plan.contents.length, 3); // round(9/3), respeita o mínimo de 3
  for (const content of plan.contents) assert.equal(content.channel, "tiktok");
});

test("Campaign Manager extrai duração explícita do texto (dias, semanas, meses)", async () => {
  const manager = createManager();

  const inDays = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 15 dias." });
  assert.equal(inDays.durationDays, 15);

  const inWeeks = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 2 semanas." });
  assert.equal(inWeeks.durationDays, 14);

  const inMonths = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 1 mes." });
  assert.equal(inMonths.durationDays, 30);
});

test("Campaign Manager limita a quantidade de conteúdos entre 3 e 20, mesmo para durações extremas", async () => {
  const manager = createManager();

  const short = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha rápida por 1 dia." });
  assert.equal(short.contents.length, 3);

  const long = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha longa por 365 dias." });
  assert.equal(long.contents.length, 20);
});

test("Campaign Manager enriquece persona e CTA a partir da Clara quando disponível", async () => {
  const clara = new FakeClara({
    AudienceContext: [claraRecord({ targetAudience: "Noivos de alto padrão em São Paulo." })],
    BrandContext: [claraRecord({ preferredCtas: ["Fale com um consultor", "Garanta sua vaga agora"] })],
  });
  const manager = createManager({ clara });

  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Quero uma campanha para divulgar o Rumo ao Altar." });

  assert.equal(plan.persona, "Noivos de alto padrão em São Paulo.");
  assert.equal(plan.contents[0].cta, "Fale com um consultor");
  assert.equal(plan.contents[plan.contents.length - 1].cta, "Garanta sua vaga agora");
});

// --- Regressão / validação -----------------------------------------------------------------------

test("Campaign Manager rejeita solicitação sem cliente ou sem objetivo", async () => {
  const manager = createManager();

  await assert.rejects(() => manager.createCampaign({ objective: "Campanha sem cliente." }), /clientId ou tenantId/);
  await assert.rejects(() => manager.createCampaign({ clientId: CLIENT_ID, objective: "" }), /objective/);
});

test("Campaign Manager rejeita durationDays inválido e channels vazio", async () => {
  const manager = createManager();

  await assert.rejects(
    () => manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha", durationDays: 0 }),
    /durationDays/,
  );
  await assert.rejects(
    () => manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha", channels: [] }),
    /channels/,
  );
});

test("Campaign Manager trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const manager = createManager({ valentina: new FakeValentina([]) });

  await assert.rejects(
    () => manager.createCampaign({ clientId: "cliente-inexistente", objective: "Campanha qualquer" }),
    /não encontrou o cliente/,
  );
});

// --- Histórico de campanhas ------------------------------------------------------------------------

test("Campaign Manager mantém histórico de campanhas consultável por listCampaigns e getCampaign", async () => {
  const repository = new InMemoryCampaignRepository();
  const idGenerator = createDeterministicIdGenerator();
  const manager = createManager({ repository, idGenerator });

  const first = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação." });
  const second = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha para captar casais recém-noivos." });

  const all = await manager.listCampaigns({ clientId: CLIENT_ID });
  assert.equal(all.length, 2);

  const onlyCaptacao = await manager.listCampaigns({ clientId: CLIENT_ID, objectiveType: "captacao" });
  assert.deepEqual(onlyCaptacao.map((plan) => plan.id), [second.id]);

  const fetched = await manager.getCampaign(first.id);
  assert.equal(fetched.id, first.id);
  assert.equal(await manager.getCampaign("inexistente"), undefined);
});

test("Campaign Manager persiste em armazenamento local JSON e recarrega em uma nova instância", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-campaign-manager-"));
  try {
    const filePath = join(rootDir, "campaigns.json");
    const firstManager = createManager({ repository: new LocalJsonCampaignRepository(filePath) });
    const plan = await firstManager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha persistida." });

    const secondManager = createManager({ repository: new LocalJsonCampaignRepository(filePath) });
    const reloaded = await secondManager.getCampaign(plan.id);
    assert.ok(reloaded);
    assert.equal(reloaded.objective, "Campanha persistida.");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- Cada conteúdo gera um ExecutionPlan independente através do Arthur --------------------------

test("Campaign Manager gera um ExecutionPlan independente por conteúdo, chamando arthur.planFromText com o clientId da campanha", async () => {
  const arthur = new FakeArthur();
  const manager = createManager({ arthur });

  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 9 dias." });
  const [contentA, contentB] = plan.contents;

  const resultA = await manager.generateExecutionPlanForContent(plan.id, contentA.id);
  const resultB = await manager.generateExecutionPlanForContent(plan.id, contentB.id);

  assert.equal(arthur.calls.length, 2);
  assert.equal(arthur.calls[0].clientId, CLIENT_ID);
  assert.ok(arthur.calls[0].command.includes(contentA.topic));
  assert.notEqual(resultA.executionPlan.id, resultB.executionPlan.id);

  const updatedCampaign = await manager.getCampaign(plan.id);
  const updatedContentA = updatedCampaign.contents.find((content) => content.id === contentA.id);
  assert.equal(updatedContentA.executionPlanId, resultA.executionPlan.id);
  assert.equal(updatedContentA.status, "execution_planned");
});

test("Campaign Manager não sobrescreve um status já avançado ao regenerar o ExecutionPlan de um conteúdo", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 9 dias." });
  const content = plan.contents[0];

  await manager.generateExecutionPlanForContent(plan.id, content.id);
  await manager.updateContentStatus(plan.id, content.id, "approved");

  const result = await manager.generateExecutionPlanForContent(plan.id, content.id);
  assert.ok(result.executionPlan.id);

  const updatedCampaign = await manager.getCampaign(plan.id);
  const updatedContent = updatedCampaign.contents.find((candidate) => candidate.id === content.id);
  assert.equal(updatedContent.status, "approved");
});

test("Campaign Manager rejeita gerar plano para campanha ou conteúdo inexistente", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação." });

  await assert.rejects(() => manager.generateExecutionPlanForContent("campanha-inexistente", "x"), /não encontrada/);
  await assert.rejects(() => manager.generateExecutionPlanForContent(plan.id, "conteudo-inexistente"), /não encontrado/);
});

// --- Status por conteúdo, percentual concluído e contagens --------------------------------------

test("Campaign Manager atualiza status de conteúdo e mantém statusHistory auditável", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 9 dias." });
  const content = plan.contents[0];

  const updated = await manager.updateContentStatus(plan.id, content.id, "in_review", "Aguardando revisão do Lucas.");
  assert.equal(updated.status, "in_review");
  assert.equal(updated.statusHistory.length, 2);
  assert.equal(updated.statusHistory[1].status, "in_review");
  assert.equal(updated.statusHistory[1].reason, "Aguardando revisão do Lucas.");
});

test("Campaign Manager rejeita status inválido", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação." });

  await assert.rejects(
    () => manager.updateContentStatus(plan.id, plan.contents[0].id, "publicado_com_sucesso"),
    /Status inválido/,
  );
});

test("Campaign Manager calcula percentual concluído e contagens por status (pendentes, aprovados, publicados, rejeitados)", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 9 dias." });
  const [first, second, third] = plan.contents;

  await manager.updateContentStatus(plan.id, first.id, "approved");
  await manager.updateContentStatus(plan.id, second.id, "published");
  await manager.updateContentStatus(plan.id, third.id, "rejected");

  const summary = await manager.getStatusSummary(plan.id);
  assert.equal(summary.totalContents, 3);
  assert.equal(summary.approvedCount, 1);
  assert.equal(summary.publishedCount, 1);
  assert.equal(summary.rejectedCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.percentComplete, roundToOneDecimal((2 / 3) * 100));
});

test("Campaign Manager reporta 0% concluído e todos pendentes logo após criar a campanha", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação por 9 dias." });

  const summary = await manager.getStatusSummary(plan.id);
  assert.equal(summary.percentComplete, 0);
  assert.equal(summary.pendingCount, plan.contents.length);
});

test("CAMPAIGN_CONTENT_STATUSES cobre todos os status usados pelo módulo", () => {
  assert.deepEqual(CAMPAIGN_CONTENT_STATUSES, ["pending", "execution_planned", "in_review", "approved", "rejected", "published", "failed"]);
});

// --- Isolamento arquitetural: não é Skill, não cria conteúdo -------------------------------------

test("Campaign Manager não é uma Skill: não possui manifesto e não é descoberto por Helena", async () => {
  await assert.rejects(() => access("src/application/campaign/skill.manifest.json"));
  await assert.rejects(() => access("dist/skills/campaign-manager"));
});

test("Campaign Manager não cria copy, imagem ou vídeo; devolve apenas estrutura de planejamento", async () => {
  const manager = createManager();
  const plan = await manager.createCampaign({ clientId: CLIENT_ID, objective: "Campanha de divulgação." });

  assert.equal(plan.caption, undefined);
  assert.equal(plan.images, undefined);
  assert.equal(plan.video, undefined);
  for (const content of plan.contents) {
    assert.equal(content.caption, undefined);
    assert.equal(content.imageUrl, undefined);
  }
});

test("Campaign Manager não importa nenhuma Skill nem chama Caio/Helena diretamente", async () => {
  const source = await readFile("src/application/campaign/campaign-manager.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("src/skills"), false);
  assert.equal(lowered.includes("helenaskillmanager"), false);
  assert.equal(lowered.includes("caioworkflowexecutor"), false);
  assert.equal(lowered.includes("node:fs"), false);
});

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}
