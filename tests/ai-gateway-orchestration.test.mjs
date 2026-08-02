import { test } from "node:test";
import assert from "node:assert/strict";

import { AiGateway } from "../dist/application/ai-gateway/ai-gateway.js";
import { BRIEFING_FIELD_EXTRACTION_POLICY } from "../dist/application/ai-gateway/policies.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { InMemoryAiExecutionRepository } from "../dist/infrastructure/storage/in-memory-ai-execution-repository.js";
import { FakeAiModelProvider, fakeSuccess, fakeFailure } from "../dist/infrastructure/ai/fake-ai-model-provider.js";

function validRawOutput(overrides = {}) {
  return {
    schemaVersion: 1,
    candidates: [
      {
        fieldKey: "channel",
        originalText: "vamos de instagram",
        proposedValue: "instagram",
        normalizedValue: "instagram",
        confidence: 0.9,
        evidence: "instagram",
        requiresConfirmation: true,
        sensitivityDetected: false,
        rationaleCode: "explicit_statement",
      },
    ],
    ambiguities: [],
    unsupportedClaims: [],
    warnings: [],
    ...overrides,
  };
}

function makeGateway({ providers, bindings, rateLimiter, circuitBreaker, now } = {}) {
  const executionRepository = new InMemoryAiExecutionRepository(now ? { now } : {});
  const telemetry = new InMemoryAiTelemetry();
  const gateway = new AiGateway({
    providers: providers ?? [],
    bindings: bindings ?? { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    rateLimiter: rateLimiter ?? new InMemoryAiRateLimiter(),
    circuitBreaker: circuitBreaker ?? new InMemoryAiCircuitBreaker(),
    executionRepository,
    telemetry,
  });
  return { gateway, executionRepository, telemetry };
}

function baseRequest(overrides = {}) {
  return {
    operation: "briefing_field_extraction",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    correlationId: "corr-1",
    input: { schemaType: "campaign_creation", schemaVersion: 1, message: "vamos de instagram", knownFieldKeys: [] },
    outputSchema: { id: "briefing-field-extraction-result", version: 1 },
    policy: BRIEFING_FIELD_EXTRACTION_POLICY,
    ...overrides,
  };
}

test("AiGateway: caminho feliz — resultado validado, execução persistida como succeeded, telemetria registrada, traceId == id persistido", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess(validRawOutput())] });
  const { gateway, executionRepository, telemetry } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, true);
  assert.equal(result.data.validated, true);
  assert.equal(result.data.output.candidates.length, 1);
  assert.equal(result.data.usage.currency, "USD");

  const persisted = await executionRepository.getById(result.data.traceId);
  assert.ok(persisted, "a execução deve estar persistida sob o mesmo id do traceId");
  assert.equal(persisted.status, "succeeded");
  assert.equal(persisted.provider, "anthropic");
  assert.ok(!("prompt" in persisted) && !("response" in persisted) && !("output" in persisted), "nunca persiste prompt/resposta completos");

  const events = telemetry.list();
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "succeeded");
});

test("AiGateway: saída estrutural inválida vira invalid_output, nunca é retentada", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess({ nonsense: true })] });
  const { gateway, executionRepository } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "invalid_output");
  assert.equal(provider.callCount, 1, "invalid_output nunca é retentável");

  const executions = await executionRepository.listByWorkspace({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(executions.length, 1);
  assert.equal(executions[0].status, "failed");
  assert.equal(executions[0].errorCategory, "invalid_output");
});

test("AiGateway: timeout (retentável) seguido de sucesso — retryCount registrado corretamente", async () => {
  const provider = new FakeAiModelProvider({
    id: "anthropic",
    script: [fakeFailure("timeout", "timeout simulado"), fakeSuccess(validRawOutput())],
  });
  const { gateway, executionRepository } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 2);

  const executions = await executionRepository.listByWorkspace({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(executions[0].retryCount, 1);
});

test("AiGateway: falha não-retentável (authentication_failed) nunca tenta de novo", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeFailure("authentication_failed", "credencial inválida")] });
  const { gateway } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "authentication_failed");
  assert.equal(provider.callCount, 1);
});

test("AiGateway: content_blocked nunca é retentado", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeFailure("content_blocked", "bloqueado pelo provider")] });
  const { gateway } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "content_blocked");
  assert.equal(provider.callCount, 1);
});

test("AiGateway: rate limit bloqueia ANTES de qualquer chamada ao provider", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess(validRawOutput())] });
  const rateLimiter = new InMemoryAiRateLimiter({ maxCallsPerWindow: 0, windowMs: 60_000 });
  const { gateway } = makeGateway({ providers: [provider], rateLimiter });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "rate_limited");
  assert.equal(provider.callCount, 0, "o provider nunca deveria ter sido chamado");
});

test("AiGateway: circuit breaker aberto depois de falhas consecutivas passa a bloquear sem chamar o provider", async () => {
  const provider = new FakeAiModelProvider({
    id: "anthropic",
    script: [fakeFailure("provider_unavailable", "indisponível"), fakeFailure("provider_unavailable", "indisponível")],
  });
  const circuitBreaker = new InMemoryAiCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
  const { gateway } = makeGateway({ providers: [provider], circuitBreaker });

  const first = await gateway.execute(baseRequest());
  assert.equal(first.ok, false);
  assert.equal(circuitBreaker.getState("anthropic"), "open");

  const callCountAfterFirst = provider.callCount;
  const second = await gateway.execute(baseRequest());
  assert.equal(second.ok, false);
  assert.equal(second.error.category, "provider_unavailable");
  assert.equal(provider.callCount, callCountAfterFirst, "o circuit breaker deveria ter impedido uma nova chamada ao provider");
});

test("AiGateway: provider não configurado (sem credencial) nunca é chamado", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess(validRawOutput())], configured: false });
  const { gateway } = makeGateway({ providers: [provider] });

  const result = await gateway.execute(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "not_configured");
  assert.equal(provider.callCount, 0);
});

test("AiGateway: sanitização roda DENTRO do Gateway antes do provider — input desproporcionalmente grande é rejeitado sem nenhuma chamada real", async () => {
  const provider = new FakeAiModelProvider({ id: "anthropic", script: [fakeSuccess(validRawOutput())] });
  const { gateway } = makeGateway({ providers: [provider] });

  const oversizedMessage = "x".repeat(50_000);
  const result = await gateway.execute(
    baseRequest({
      input: { schemaType: "campaign_creation", schemaVersion: 1, message: oversizedMessage, knownFieldKeys: [] },
      policy: { ...BRIEFING_FIELD_EXTRACTION_POLICY, maxInputTokens: 10 },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "invalid_request");
  assert.equal(provider.callCount, 0, "o provider nunca deveria ser chamado quando a sanitização rejeita o input");
});
