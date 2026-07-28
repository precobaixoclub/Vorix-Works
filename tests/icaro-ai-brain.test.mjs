import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IcaroAIBrain } from "../dist/application/ai/index.js";
import {
  InMemoryIcaroCostLedger,
  InMemoryIcaroLogger,
  InMemoryZunoEventRecorder,
} from "../dist/infrastructure/telemetry/index.js";

function createModel(overrides = {}) {
  return {
    id: "text-pro",
    supportedTaskTypes: ["text_generation", "analysis", "classification", "summary", "translation", "review"],
    priority: 10,
    qualityScore: 90,
    speedScore: 80,
    costPer1kInputTokens: 0.002,
    costPer1kOutputTokens: 0.004,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1200,
    maxTokens: 4000,
    ...overrides,
  };
}

function createProviderProfile(overrides = {}) {
  return {
    id: "text-provider",
    name: "Provider Text",
    kind: "text",
    priority: 10,
    enabled: true,
    supportedTaskTypes: ["text_generation", "analysis", "classification", "summary", "translation", "review"],
    models: [createModel()],
    ...overrides,
  };
}

function createIcaroRequest(overrides = {}) {
  return {
    taskType: "text_generation",
    prompt: "Crie uma copy curta para Instagram.",
    specialistId: "maria-copywriting",
    executionId: "exec-icaro",
    taskId: "task-ai",
    correlationId: "corr-ai",
    expectedOutput: "json",
    priority: "balanced",
    ...overrides,
  };
}

class FakeAIProvider {
  constructor(profile, responses) {
    this.profile = profile;
    this.responses = [...responses];
    this.calls = [];
  }

  async execute(request) {
    this.calls.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return await next(request);
    return next ?? {
      content: "ok",
      model: request.model,
      tokens: { input: 10, output: 5 },
    };
  }
}

function temporaryError(message = "Falha temporária") {
  const error = new Error(message);
  error.kind = "temporary";
  error.retryable = true;
  return error;
}

function providerError(message = "Provider falhou") {
  const error = new Error(message);
  error.kind = "provider_error";
  error.retryable = false;
  return error;
}

test("Ícaro seleciona Provider e Modelo corretos para geração de texto", async () => {
  const provider = new FakeAIProvider(createProviderProfile(), [
    { content: "texto gerado", model: "text-pro", tokens: { input: 12, output: 7 } },
  ]);
  const logger = new InMemoryIcaroLogger();
  const events = new InMemoryZunoEventRecorder();
  const ledger = new InMemoryIcaroCostLedger();
  const icaro = new IcaroAIBrain({
    providers: [provider],
    logger,
    eventRecorder: events,
    costLedger: ledger,
    retryPolicy: { maxAttemptsPerProvider: 1 },
  });

  const response = await icaro.request(createIcaroRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.provider.id, "text-provider");
  assert.equal(response.model.id, "text-pro");
  assert.equal(response.content, "texto gerado");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].taskType, "text_generation");
  assert.equal(provider.calls[0].temperature, 0.7);
  assert.equal(provider.calls[0].maxTokens, 1200);
  assert.ok(response.cost.estimated > 0);
  assert.equal(ledger.list().length, 1);
  assert.ok(logger.list().some((entry) => entry.action === "ProviderSelected"));
  assert.ok(logger.list().some((entry) => entry.action === "ModelSelected"));
  assert.ok(events.list().some((event) => event.name === "AIRequestStarted"));
  assert.ok(events.list().some((event) => event.name === "AIRequestFinished"));
});

test("Ícaro seleciona Provider de imagem para tarefa de imagem", async () => {
  const textProvider = new FakeAIProvider(createProviderProfile(), []);
  const imageProvider = new FakeAIProvider(createProviderProfile({
    id: "image-provider",
    name: "Provider Image",
    kind: "image",
    priority: 8,
    supportedTaskTypes: ["image_generation"],
    models: [createModel({
      id: "image-pro",
      supportedTaskTypes: ["image_generation"],
      qualityScore: 88,
      speedScore: 70,
      costPer1kInputTokens: 0.01,
      costPer1kOutputTokens: 0.02,
    })],
  }), [
    { content: { assetUri: "file://imagem.png" }, model: "image-pro", tokens: { input: 20, output: 0 } },
  ]);
  const icaro = new IcaroAIBrain({
    providers: [textProvider, imageProvider],
    retryPolicy: { maxAttemptsPerProvider: 1 },
  });

  const response = await icaro.request(createIcaroRequest({
    taskType: "image_generation",
    prompt: "Crie uma imagem de campanha.",
    expectedOutput: "image",
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.provider.id, "image-provider");
  assert.equal(response.model.id, "image-pro");
  assert.equal(textProvider.calls.length, 0);
  assert.equal(imageProvider.calls.length, 1);
});

test("Ícaro aplica retry quando a falha é temporária", async () => {
  const provider = new FakeAIProvider(createProviderProfile(), [
    temporaryError(),
    { content: "recuperado", model: "text-pro", tokens: { input: 10, output: 5 } },
  ]);
  const events = new InMemoryZunoEventRecorder();
  const logger = new InMemoryIcaroLogger();
  const icaro = new IcaroAIBrain({
    providers: [provider],
    logger,
    eventRecorder: events,
    retryPolicy: { maxAttemptsPerProvider: 2 },
  });

  const response = await icaro.request(createIcaroRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.attempt.total, 2);
  assert.equal(provider.calls.length, 2);
  assert.ok(events.list().some((event) => event.name === "AIRetry"));
  assert.ok(logger.list().some((entry) => entry.action === "RetryScheduled"));
});

test("Ícaro usa fallback quando o Provider primário falha", async () => {
  const primary = new FakeAIProvider(createProviderProfile({
    id: "primary-provider",
    name: "Primary",
    priority: 20,
    models: [createModel({ id: "primary-model" })],
  }), [providerError()]);
  const fallback = new FakeAIProvider(createProviderProfile({
    id: "fallback-provider",
    name: "Fallback",
    priority: 1,
    models: [createModel({ id: "fallback-model" })],
  }), [
    { content: "resposta via fallback", model: "fallback-model", tokens: { input: 11, output: 6 } },
  ]);
  const events = new InMemoryZunoEventRecorder();
  const icaro = new IcaroAIBrain({
    providers: [primary, fallback],
    eventRecorder: events,
    retryPolicy: { maxAttemptsPerProvider: 1 },
    fallbackPolicy: { enabled: true, maxFallbackProviders: 1 },
  });

  const response = await icaro.request(createIcaroRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.provider.id, "fallback-provider");
  assert.equal(response.fallbackUsed, true);
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 1);
  assert.ok(events.list().some((event) => event.name === "AIFallback"));
});

test("Ícaro respeita timeout e devolve falha padronizada", async () => {
  const slowProvider = new FakeAIProvider(createProviderProfile(), [
    () => new Promise((resolve) => setTimeout(() => resolve({
      content: "tarde demais",
      model: "text-pro",
      tokens: { input: 10, output: 4 },
    }), 40)),
  ]);
  const logger = new InMemoryIcaroLogger();
  const icaro = new IcaroAIBrain({
    providers: [slowProvider],
    logger,
    retryPolicy: { maxAttemptsPerProvider: 1 },
    fallbackPolicy: { enabled: false },
  });

  const response = await icaro.request(createIcaroRequest({ timeoutMs: 5 }));

  assert.equal(response.status, "failed");
  assert.equal(response.error.kind, "timeout");
  assert.equal(response.attempt.total, 1);
  assert.equal(slowProvider.calls.length, 1);
  assert.ok(logger.list().some((entry) => entry.action === "Timeout"));
});

test("Ícaro registra tokens, custo real e custo estimado", async () => {
  const provider = new FakeAIProvider(createProviderProfile(), [
    {
      content: "conteúdo",
      model: "text-pro",
      tokens: { input: 100, output: 50, total: 150 },
      cost: { actual: 0.03, estimated: 0.025, currency: "USD" },
    },
  ]);
  const ledger = new InMemoryIcaroCostLedger();
  const icaro = new IcaroAIBrain({
    providers: [provider],
    costLedger: ledger,
    retryPolicy: { maxAttemptsPerProvider: 1 },
  });

  const response = await icaro.request(createIcaroRequest());
  const [record] = ledger.list();

  assert.equal(response.tokens.total, 150);
  assert.equal(response.cost.actual, 0.03);
  assert.equal(response.cost.estimated, 0.025);
  assert.equal(record.tokens.total, 150);
  assert.equal(record.cost.actual, 0.03);
  assert.equal(record.providerId, "text-provider");
});

test("Ícaro devolve resposta de no_provider quando não há Provider compatível", async () => {
  const provider = new FakeAIProvider(createProviderProfile({
    enabled: false,
  }), []);
  const icaro = new IcaroAIBrain({ providers: [provider] });

  const response = await icaro.request(createIcaroRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.error.kind, "no_provider");
  assert.equal(response.provider.id, undefined);
  assert.equal(provider.calls.length, 0);
});

test("Arthur, Helena e Caio não dependem do Ícaro, e Maria não depende de Providers", async () => {
  const arthur = await readFile("src/application/orchestration/arthur.orchestrator.ts", "utf8");
  const helena = await readFile("src/application/skills/helena.manager.ts", "utf8");
  const caio = await readFile("src/application/workflows/caio.executor.ts", "utf8");
  const maria = await readFile("src/skills/maria-copywriting/maria-copywriting.skill.ts", "utf8");

  assert.equal(arthur.includes("Icaro"), false);
  assert.equal(helena.includes("Icaro"), false);
  assert.equal(caio.includes("Icaro"), false);
  assert.ok(maria.includes("IcaroBrainPort"));
  assert.equal(maria.includes("AITextProviderPort"), false);
  assert.equal(maria.includes("AIProviderPort"), false);
  assert.equal(maria.toLowerCase().includes("from \"openai\""), false);
});
