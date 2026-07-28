import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArthurOrchestrator } from "../dist/application/orchestration/index.js";
import { CaioWorkflowExecutor } from "../dist/application/workflows/index.js";
import { ValentinaTenantManager, getValentinaPlanDefinition } from "../dist/application/tenancy/index.js";
import { InMemoryValentinaLogger, InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/index.js";
import {
  InMemoryValentinaTenantRepository,
  LocalJsonValentinaTenantRepository,
} from "../dist/infrastructure/storage/index.js";

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
    id: "admin-zuno",
    type: "human",
    name: "Administrador",
    ...overrides,
  };
}

function audit(reason = "Operação administrativa") {
  return {
    actor: actor(),
    reason,
    correlationId: "corr-valentina",
  };
}

function createValentina(repository = new InMemoryValentinaTenantRepository()) {
  const logger = new InMemoryValentinaLogger();
  const events = new InMemoryZunoEventRecorder();
  const valentina = new ValentinaTenantManager({
    repository,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return { valentina, logger, events, repository };
}

async function createTenant(valentina, overrides = {}) {
  return valentina.createTenant({
    clientId: "client-rumo",
    displayName: "Rumo ao Altar",
    plan: "START",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    country: "BR",
    environment: "development",
    niche: "wedding tech",
    mainObjectives: ["captar noivos", "vender planos"],
    preferences: { aiPriority: "balanced" },
    audit: audit("Cadastro inicial"),
    ...overrides,
  });
}

class FakeHelena {
  constructor() {
    this.calls = [];
  }

  async discoverAndLoadSkills() {
    return [];
  }

  async findSkillByCapability(capability) {
    return { manifest: { id: `skill-${capability}`, capabilities: [capability] }, state: "READY" };
  }

  async executeSkill(request) {
    this.calls.push(request);
    return {
      skillId: `skill-${request.capability}`,
      state: "COMPLETED",
      response: {
        skillId: `skill-${request.capability}`,
        taskId: request.context.taskId,
        status: "completed",
        output: { capability: request.capability },
        artifacts: [],
        warnings: [],
      },
    };
  }
}

test("Valentina cadastra cliente com plano, limites, versão inicial, logs e eventos", async () => {
  const { valentina, logger, events } = createValentina();
  const tenant = await createTenant(valentina);

  assert.equal(tenant.id, "tenant-0001");
  assert.equal(tenant.clientId, "client-rumo");
  assert.equal(tenant.plan, "START");
  assert.equal(tenant.status, "created");
  assert.equal(tenant.settings.timezone, "America/Sao_Paulo");
  assert.equal(tenant.currentVersion, 1);
  assert.equal(tenant.versions.length, 1);
  assert.equal(tenant.history.length, 1);
  assert.equal(tenant.history[0].action, "created");
  assert.equal(tenant.planLimits.monthlyAiTokens, 100000);
  assert.ok(logger.list().some((entry) => entry.action === "TenantCreated"));
  assert.ok(events.list().some((event) => event.name === "TenantCreated"));
});

test("Valentina atualiza, ativa, suspende e mantém histórico versionado", async () => {
  const { valentina, logger, events } = createValentina();
  const created = await createTenant(valentina);
  const updated = await valentina.updateTenant({
    tenantId: created.id,
    patch: {
      displayName: "Rumo ao Altar Oficial",
      preferences: { aiPriority: "quality" },
    },
    audit: audit("Ajuste de identidade do cliente"),
  });
  const activated = await valentina.activateTenant({ tenantId: created.id, audit: audit("Pagamento confirmado") });
  const suspended = await valentina.suspendTenant({ tenantId: created.id, audit: audit("Teste de suspensão") });

  assert.equal(updated.currentVersion, 2);
  assert.equal(updated.displayName, "Rumo ao Altar Oficial");
  assert.equal(updated.settings.preferences.aiPriority, "quality");
  assert.equal(activated.currentVersion, 3);
  assert.equal(activated.status, "active");
  assert.equal(suspended.currentVersion, 4);
  assert.equal(suspended.status, "suspended");
  assert.deepEqual(suspended.history.map((entry) => entry.action), ["created", "updated", "activated", "suspended"]);
  assert.ok(logger.list().some((entry) => entry.action === "TenantUpdated"));
  assert.ok(events.list().some((event) => event.name === "TenantActivated"));
  assert.ok(events.list().some((event) => event.name === "TenantSuspended"));
});

test("Valentina troca plano e recalcula especialistas, recursos e permissões", async () => {
  const { valentina, events } = createValentina();
  const created = await createTenant(valentina, { plan: "FREE" });
  const changed = await valentina.changePlan({
    tenantId: created.id,
    plan: "PRO",
    expiresAt: "2026-12-31T23:59:59.000Z",
    audit: audit("Upgrade para Pro"),
  });

  assert.equal(changed.plan, "PRO");
  assert.equal(changed.currentVersion, 2);
  assert.equal(changed.planLimits.monthlyAiTokens, 500000);
  assert.ok(changed.enabledSpecialists.includes("image_generation"));
  assert.equal(changed.permissions.canCreateCampaigns, true);
  assert.equal(changed.history[1].oldValues.plan, "FREE");
  assert.equal(changed.history[1].newValues.plan, "PRO");
  assert.ok(events.list().some((event) => event.name === "PlanChanged"));
});

test("Valentina controla consumo, limites diários, limites mensais e créditos extras", async () => {
  const { valentina, events } = createValentina();
  const created = await createTenant(valentina, { plan: "START" });
  await valentina.activateTenant({ tenantId: created.id, audit: audit("Ativação") });

  let consumed;
  for (let day = 1; day <= 12; day += 1) {
    consumed = await valentina.consumeCredits({
      tenantId: created.id,
      aiTokens: 8000,
      estimatedCost: 0.1,
      realCost: 0.08,
      publications: day === 1 ? 3 : 0,
      images: day === 1 ? 2 : 0,
      occurredAt: `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      audit: audit("Uso de IA"),
    });
  }

  assert.equal(consumed.usage.monthly[0].aiTokens, 96000);
  assert.equal(consumed.usage.monthly[0].publications, 3);
  assert.equal(consumed.usage.monthly[0].images, 2);
  assert.equal(consumed.credits.availableExtraAiTokens, 0);

  await assert.rejects(
    () => valentina.consumeCredits({
      tenantId: created.id,
      aiTokens: 8000,
      occurredAt: "2026-07-13T13:00:00.000Z",
      audit: audit("Exceder limite sem crédito"),
    }),
    /bloqueado pela Valentina/,
  );

  await valentina.addCredits({ tenantId: created.id, aiTokens: 50000, audit: audit("Crédito avulso") });
  const withExtra = await valentina.consumeCredits({
    tenantId: created.id,
    aiTokens: 8000,
    occurredAt: "2026-07-13T13:00:00.000Z",
    audit: audit("Uso com crédito extra"),
  });

  assert.equal(withExtra.usage.monthly[0].aiTokens, 104000);
  assert.equal(withExtra.credits.consumedExtraAiTokens, 4000);
  assert.equal(withExtra.credits.availableExtraAiTokens, 46000);
  assert.ok(events.list().some((event) => event.name === "CreditsConsumed"));
  assert.ok(events.list().some((event) => event.name === "CreditsAdded"));
});

test("Valentina valida especialistas, recursos e integrações liberadas por plano", async () => {
  const { valentina } = createValentina();
  const created = await createTenant(valentina, { plan: "FREE" });

  assert.equal(await valentina.canUseSpecialist(created.id, "copywriting"), true);
  assert.equal(await valentina.canUseSpecialist(created.id, "image_generation"), false);

  const blockedIntegration = await valentina.checkLimits({
    tenantId: created.id,
    integration: "instagram",
  });
  assert.equal(blockedIntegration.allowed, false);
  assert.ok(blockedIntegration.reasons.some((reason) => reason.includes("Integração instagram")));

  const changed = await valentina.changePlan({ tenantId: created.id, plan: "PRO", audit: audit("Upgrade") });
  const allowedIntegration = await valentina.checkLimits({
    tenantId: changed.id,
    integration: "instagram",
    capability: "image_generation",
    feature: "image_generation",
  });
  assert.equal(allowedIntegration.allowed, true);
});

test("Valentina prepara integrações futuras sem conversar com APIs externas", async () => {
  const { valentina, events } = createValentina();
  const created = await createTenant(valentina, { plan: "PRO" });
  const connected = await valentina.connectIntegration({
    tenantId: created.id,
    network: "instagram",
    tokenReference: "vault://tenant-rumo/instagram",
    scopes: ["posts:write", "insights:read"],
    expiresAt: "2026-12-31T23:59:59.000Z",
    audit: audit("Conectar Instagram"),
  });
  const disconnected = await valentina.disconnectIntegration({
    tenantId: created.id,
    network: "instagram",
    audit: audit("Desconectar Instagram"),
  });

  assert.equal(connected.integrations.instagram.status, "connected");
  assert.equal(connected.integrations.instagram.tokenReference, "vault://tenant-rumo/instagram");
  assert.deepEqual(connected.connectedSocialNetworks, ["instagram"]);
  assert.equal(disconnected.integrations.instagram.status, "disconnected");
  assert.deepEqual(disconnected.connectedSocialNetworks, []);
  assert.ok(events.list().some((event) => event.name === "IntegrationConnected"));
  assert.ok(events.list().some((event) => event.name === "IntegrationDisconnected"));
});

test("Valentina mascara tokenReference em versions/history, mas mantém o valor real no estado atual", async () => {
  const { valentina } = createValentina();
  const created = await createTenant(valentina, { plan: "PRO" });

  const connected = await valentina.connectIntegration({
    tenantId: created.id,
    network: "instagram",
    tokenReference: "vault://tenant-rumo/instagram",
    scopes: ["posts:write"],
    audit: audit("Conectar Instagram"),
  });

  assert.equal(connected.integrations.instagram.tokenReference, "vault://tenant-rumo/instagram");

  const lastVersion = connected.versions[connected.versions.length - 1];
  assert.equal(lastVersion.snapshot.integrations.instagram.tokenReference, "••••gram");

  const lastHistory = connected.history[connected.history.length - 1];
  assert.equal(lastHistory.newValues.integration.tokenReference, "••••gram");
});

test("Arthur consulta Valentina para resolver tenant antes de planejar", async () => {
  const { valentina } = createValentina();
  const tenant = await createTenant(valentina, { plan: "PRO" });
  const arthur = new ArthurOrchestrator({
    tenants: valentina,
    idGenerator: createDeterministicIdGenerator(),
  });

  const result = await arthur.planFromText({
    clientId: tenant.clientId,
    command: "Criar uma publicação para Instagram sobre o Rumo ao Altar.",
  });

  assert.equal(result.executionPlan.tenant.clientId, tenant.clientId);
  assert.equal(result.executionPlan.tenant.tenantId, tenant.id);
  assert.equal(result.executionPlan.tenant.source, "valentina");
  assert.equal(result.executionPlan.steps[0].input.clientId, tenant.clientId);
});

test("Caio carrega contexto do cliente pela Valentina antes do workflow", async () => {
  const { valentina } = createValentina();
  const tenant = await createTenant(valentina, { plan: "PRO" });
  const activated = await valentina.activateTenant({ tenantId: tenant.id, audit: audit("Ativação") });
  const helena = new FakeHelena();
  const caio = new CaioWorkflowExecutor({
    helena,
    tenants: valentina,
    idGenerator: createDeterministicIdGenerator(),
  });
  const plan = {
    id: "plan-valentina",
    createdBy: "arthur",
    tenant: {
      clientId: activated.clientId,
      tenantId: activated.id,
      source: "valentina",
    },
    intent: {
      id: "intent-valentina",
      objective: "Criar copy.",
      channels: ["instagram"],
      successCriteria: ["Executar com cliente."],
    },
    steps: [
      {
        id: "step-copy",
        order: 1,
        type: "skill",
        name: "Copy",
        skillCapability: "copywriting",
        instructions: "Criar copy.",
        input: { clientId: activated.clientId },
        expectedOutput: "Copy.",
        dependsOn: [],
      },
    ],
    acceptanceCriteria: ["Cliente carregado."],
  };

  const report = await caio.execute({ plan });

  assert.equal(report.state, "COMPLETED");
  assert.equal(report.clientId, activated.clientId);
  assert.equal(report.tenantId, activated.id);
  assert.equal(helena.calls[0].context.clientId, activated.clientId);
  assert.equal(helena.calls[0].context.tenantId, activated.id);
});

test("Valentina persiste tenants em JSON local", async () => {
  const filePath = join(tmpdir(), `zuno-valentina-${Date.now()}.json`);
  try {
    const first = createValentina(new LocalJsonValentinaTenantRepository(filePath));
    const created = await createTenant(first.valentina, { clientId: "client-json" });
    await first.valentina.activateTenant({ tenantId: created.id, audit: audit("Ativar JSON") });

    const second = createValentina(new LocalJsonValentinaTenantRepository(filePath));
    const found = await second.valentina.getTenant({ clientId: "client-json", status: "all" });

    assert.equal(found.clientId, "client-json");
    assert.equal(found.status, "active");
  } finally {
    await rm(filePath, { force: true });
  }
});

test("LocalJsonValentinaTenantRepository rejeita caminho de arquivo vazio ou com caractere inválido", () => {
  assert.throws(() => new LocalJsonValentinaTenantRepository(""), /obrigatório/);
  assert.throws(() => new LocalJsonValentinaTenantRepository("   "), /obrigatório/);
  assert.throws(() => new LocalJsonValentinaTenantRepository("tenants\0.json"), /inválido/);
});

test("Valentina mantém isolamento arquitetural de conhecimento, IA e APIs externas", async () => {
  const files = [
    "src/application/tenancy/valentina-tenant-manager.ts",
    "src/skills/maria-copywriting/maria-copywriting.skill.ts",
    "src/application/knowledge/clara-knowledge-center.ts",
    "src/application/ai/icaro-brain.ts",
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (file.includes("valentina")) {
      assert.equal(source.includes("IcaroAIBrain"), false);
      assert.equal(source.includes("ClaraKnowledgeCenter"), false);
      assert.equal(source.toLowerCase().includes("openai"), false);
      assert.equal(source.toLowerCase().includes("facebook-nodejs"), false);
    }
  }

  const pro = getValentinaPlanDefinition("PRO");
  assert.equal(pro.code, "PRO");
  assert.ok(pro.limits.monthlyAiTokens > 0);
});
