import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_REGISTRY } from "../dist/application/orchestration/autonomous/action-registry.js";
import { selectActionsForBlocker } from "../dist/application/orchestration/autonomous/autonomous-execution-engine.js";
import { ACTION_IDS, BLOCKER_KINDS, DEFAULT_ACTION_PRIORITY } from "../dist/application/orchestration/autonomous/autonomous-types.js";

function blockerOf(kind) {
  return { kind, stepId: "step-1", stepName: "Step", executionState: "WAITING_ASSISTED_GENERATION", message: "m" };
}

test("action-registry: ids são únicos e pertencem ao vocabulário fechado ACTION_IDS", () => {
  const ids = ACTION_REGISTRY.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(ACTION_IDS.includes(id), `id "${id}" não está em ACTION_IDS`);
});

test("action-registry: toda ActionDefinition declara os campos exigidos pela seção 2 (nada hardcoded fora da declaração)", () => {
  for (const action of ACTION_REGISTRY) {
    assert.equal(typeof action.name, "string");
    assert.equal(typeof action.description, "string");
    assert.ok(Array.isArray(action.resolves) && action.resolves.length > 0);
    assert.ok(Array.isArray(action.prerequisites));
    assert.ok(Array.isArray(action.sideEffects));
    assert.ok(Array.isArray(action.limitations));
    assert.ok(action.maxAttempts >= 1);
    assert.ok(action.backoffMs >= 0);
    assert.equal(typeof action.isApplicable, "function");
    assert.equal(typeof action.execute, "function");
  }
});

// Cobertura do REGISTRY (contrato estático: alguma ação declara resolver o bloqueio) é diferente de
// aplicabilidade NESTA máquina (`isApplicable`). Este teste antes exigia candidato aplicável e por
// isso falhava no Linux: a única ação de `narration_invalid` é a síntese via Windows SAPI, que se
// declara só-Windows de propósito (ver `narration-regeneration.action.ts`).
test("action-registry: todo BlockerKind resolvível tem ao menos uma ação registrada que o resolve (exceto os documentados como sem solução automática)", () => {
  const knownWithoutAutomaticAction = new Set(["visual_asset_missing"]); // ver ADR/limitação: geração real de imagem exige julgamento criativo, não é uma ação mecânica registrada.
  for (const kind of BLOCKER_KINDS) {
    if (kind === "unknown" || knownWithoutAutomaticAction.has(kind)) continue;
    assert.ok(ACTION_REGISTRY.some((action) => action.resolves.includes(kind)), `bloqueio "${kind}" não tem nenhuma ação que o resolva no registry`);
  }
});

test("action-registry: fora as ações declaradamente dependentes de plataforma, todo bloqueio resolvível tem candidato aplicável aqui", () => {
  const knownWithoutAutomaticAction = new Set(["visual_asset_missing"]);
  const platformBound = new Map([["narration_regeneration", "win32"]]);
  for (const kind of BLOCKER_KINDS) {
    if (kind === "unknown" || knownWithoutAutomaticAction.has(kind)) continue;
    const resolvers = ACTION_REGISTRY.filter((action) => action.resolves.includes(kind));
    if (resolvers.every((action) => platformBound.has(action.id) && platformBound.get(action.id) !== process.platform)) continue;
    const candidates = selectActionsForBlocker(blockerOf(kind), ACTION_REGISTRY, DEFAULT_ACTION_PRIORITY);
    assert.ok(candidates.length > 0, `bloqueio "${kind}" não tem nenhuma ação candidata aplicável no registry`);
  }
});

test("action-registry: narration_regeneration (Windows SAPI) é aplicável só no Windows — limitação explícita, nunca candidato silencioso em Linux", () => {
  const narration = ACTION_REGISTRY.find((action) => action.id === "narration_regeneration");
  assert.ok(narration.resolves.includes("narration_invalid"));
  assert.equal(narration.isApplicable(blockerOf("narration_invalid")), process.platform === "win32");
  assert.ok(narration.prerequisites.some((item) => /Windows/.test(item)));
});

test("action-registry: 'unknown' só resolve via gap_analysis (diagnóstico, nunca correção real)", () => {
  const candidates = selectActionsForBlocker(blockerOf("unknown"), ACTION_REGISTRY, DEFAULT_ACTION_PRIORITY);
  assert.deepEqual(candidates.map((action) => action.id), ["gap_analysis"]);
});

test("action-registry: video_coverage_low tenta footage_acquisition antes de visual_validation (prioridade padrão)", () => {
  const candidates = selectActionsForBlocker(blockerOf("video_coverage_low"), ACTION_REGISTRY, DEFAULT_ACTION_PRIORITY);
  const ids = candidates.map((action) => action.id);
  assert.ok(ids.indexOf("footage_acquisition") < ids.indexOf("visual_validation"));
});

test("action-registry: product_coverage_low tenta product_screen_catalog antes de product_compositing", () => {
  const candidates = selectActionsForBlocker(blockerOf("product_coverage_low"), ACTION_REGISTRY, DEFAULT_ACTION_PRIORITY);
  const ids = candidates.map((action) => action.id);
  assert.deepEqual(ids, ["product_screen_catalog", "product_compositing"]);
});

test("action-registry: footage_acquisition faz fail fast (isApplicable=false) sem MEDIA_PROVIDER configurado", () => {
  const original = { provider: process.env.MEDIA_PROVIDER, key: process.env.MEDIA_PROVIDER_API_KEY };
  delete process.env.MEDIA_PROVIDER;
  delete process.env.MEDIA_PROVIDER_API_KEY;
  try {
    const footage = ACTION_REGISTRY.find((action) => action.id === "footage_acquisition");
    assert.equal(footage.isApplicable(blockerOf("video_coverage_low")), false);
  } finally {
    if (original.provider !== undefined) process.env.MEDIA_PROVIDER = original.provider;
    if (original.key !== undefined) process.env.MEDIA_PROVIDER_API_KEY = original.key;
  }
});
