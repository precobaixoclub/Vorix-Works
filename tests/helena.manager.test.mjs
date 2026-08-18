import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HelenaSkillManager } from "../dist/application/skills/helena.manager.js";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { SkillRegistry } from "../dist/application/skills/skill-registry.js";
import { FileSystemSkillDiscovery } from "../dist/infrastructure/skills/file-system-skill-discovery.js";
import { FileSystemSkillModuleLoader } from "../dist/infrastructure/skills/file-system-skill-module-loader.js";
import { InMemoryHelenaLogger } from "../dist/infrastructure/telemetry/in-memory-helena-logger.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(testDirectory, "fixtures", "skills");

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

function createHelena() {
  const registry = new SkillRegistry();
  const logger = new InMemoryHelenaLogger();
  const events = new InMemoryZunoEventRecorder();
  const helena = new HelenaSkillManager({
    discovery: new FileSystemSkillDiscovery({ rootDirectories: [fixtureRoot] }),
    loader: new FileSystemSkillModuleLoader(),
    validator: new SkillManifestValidator(),
    registry,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
    zunoVersion: "0.1.0",
  });

  return { helena, registry, logger, events };
}

test("Helena descobre, valida, carrega e registra Skills no Registry", async () => {
  const { helena, registry, logger } = createHelena();

  await helena.discoverAndLoadSkills();

  const records = registry.list();
  assert.equal(records.length, 5);
  assert.equal(registry.getBySkillId("ready-copy").state, "READY");
  assert.equal(registry.getBySkillId("disabled-image").state, "DISABLED");
  assert.equal(registry.getBySkillId("failing-review").state, "READY");
  assert.equal(registry.getBySkillId("incompatible-social").state, "FAILED");
  assert.ok(records.some((record) => record.source.location.includes("invalid-manifest") && record.state === "FAILED"));
  assert.ok(logger.list().some((entry) => entry.action === "ManifestInvalid"));
  assert.ok(logger.list().some((entry) => entry.action === "SkillLoaded" && entry.skillId === "ready-copy"));
});

test("Helena localiza Skill pronta por capability", async () => {
  const { helena, logger } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("copywriting");

  assert.equal(record.manifest.id, "ready-copy");
  assert.ok(logger.list().some((entry) => entry.action === "CapabilityFound" && entry.capability === "copywriting"));
});

test("Helena continua encontrando a Skill por capability enquanto uma execução concorrente está em andamento (RUNNING)", async () => {
  // Regressão: `findByCapability` costumava exigir state em ["READY","COMPLETED"] — como
  // `executeSkill` marca a Skill como RUNNING assim que começa a executar, uma segunda geração
  // concorrente para a MESMA capability recebia "SKILL_NOT_FOUND" em vez de rodar em paralelo
  // (a Skill em si não guarda estado mutável por chamada, então não há razão real pra bloquear).
  const { helena, registry } = createHelena();
  await helena.discoverAndLoadSkills();

  registry.updateState("ready-copy", "RUNNING", new Date().toISOString());

  const record = await helena.findSkillByCapability("copywriting");
  assert.equal(record?.manifest.id, "ready-copy");
});

test("Helena continua encontrando a Skill por capability depois que uma execução anterior falhou (FAILED)", async () => {
  // Regressão: sem isto, a PRIMEIRA falha de execução de uma Skill (timeout, erro do provider,
  // etc.) a deixava marcada como FAILED para sempre no processo — todo pedido seguinte pra mesma
  // capability recebia "SKILL_NOT_FOUND" mesmo a Skill estando perfeitamente carregada e pronta.
  const { helena, registry } = createHelena();
  await helena.discoverAndLoadSkills();

  registry.updateState("failing-review", "FAILED", new Date().toISOString(), { validationErrors: ["falha simulada de uma execução anterior"] });

  const record = await helena.findSkillByCapability("quality_review");
  assert.equal(record?.manifest.id, "failing-review");
});

test("Helena executa Skill solicitada por Arthur, controla estados e registra eventos", async () => {
  const { helena, registry, events } = createHelena();
  await helena.discoverAndLoadSkills();

  const result = await helena.executeSkill({
    requestedBy: "arthur",
    capability: "copywriting",
    input: { briefing: "Teste" },
    context: {
      executionId: "exec-1",
      taskId: "task-1",
      correlationId: "corr-1",
      locale: "pt-BR",
      dryRun: true,
    },
  });

  assert.equal(result.skillId, "ready-copy");
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.response.output.receivedBy, "helena");
  assert.equal(result.response.output.orchestratedBy, "arthur");
  assert.equal(registry.getBySkillId("ready-copy").state, "COMPLETED");
  assert.deepEqual(events.list().map((event) => event.name), [
    "ExecutionStarted",
    "SkillStarted",
    "SkillFinished",
    "ExecutionFinished",
  ]);
});

test("Helena trata erro de execução e marca Skill como FAILED", async () => {
  const { helena, registry, logger, events } = createHelena();
  await helena.discoverAndLoadSkills();

  const result = await helena.executeSkill({
    requestedBy: "arthur",
    capability: "quality_review",
    input: { draft: "Texto fake" },
    context: {
      executionId: "exec-2",
      taskId: "task-2",
      correlationId: "corr-2",
      locale: "pt-BR",
      dryRun: true,
    },
  });

  assert.equal(result.state, "FAILED");
  assert.equal(result.response.status, "failed");
  assert.equal(result.response.error.code, "SKILL_EXECUTION_FAILED");
  assert.equal(registry.getBySkillId("failing-review").state, "FAILED");
  assert.ok(logger.list().some((entry) => entry.action === "ExecutionFailed" && entry.skillId === "failing-review"));
  assert.ok(events.list().some((event) => event.name === "SkillFailed"));
});

test("Helena bloqueia solicitação de execução que não veio de Arthur, Caio ou Execution", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  await assert.rejects(
    () => helena.executeSkill({
      requestedBy: "skill",
      capability: "copywriting",
      input: {},
      context: {
        executionId: "exec-3",
        taskId: "task-3",
        correlationId: "corr-3",
        locale: "pt-BR",
        dryRun: true,
      },
    }),
    /apenas do Arthur, do Caio ou do Execution/,
  );
});
