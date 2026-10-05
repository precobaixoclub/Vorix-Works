import test from "node:test";
import assert from "node:assert/strict";
import { neutralizeGhostTextZone } from "../dist/application/creative-engine/neutralize-ghost-text.js";

/**
 * ETAPA 3.1 (Rodada 4, benchmark de qualidade criativa) — testes da orquestração de neutralização
 * de texto fantasma: trata → recorta a região tratada → reverifica (visão, isolada) → escala até
 * 2 vezes → nunca mais que isso. Deps 100% mockados (nunca sharp real, nunca rede real) — a lógica
 * de blur/scrim real já é testada em `region-pixel-stats.test.mjs`.
 */

function makeDeps(overrides = {}) {
  const calls = { computeRegionPixelStats: 0, applyLocalBlur: [], applyLocalScrim: [], extractRegionBuffer: 0, put: 0 };
  return {
    calls,
    deps: {
      // stdDev 50 -> intensidade inicial "medium" (ver classifyGhostTextIntensity) — deixa espaço
      // real pra escalar até "high" num 2º passe, em vez de já nascer saturado.
      computeRegionPixelStats: async () => { calls.computeRegionPixelStats += 1; return { meanLuminance: 180, stdDevLuminance: 50 }; },
      applyLocalBlur: async (buf, rect, sigma) => { calls.applyLocalBlur.push(sigma); return Buffer.from(`${buf.toString()}|blur(${sigma})`); },
      applyLocalScrim: async (buf, rect, opacity) => { calls.applyLocalScrim.push(opacity); return Buffer.from(`${buf.toString()}|scrim(${opacity})`); },
      extractRegionBuffer: async (buf) => { calls.extractRegionBuffer += 1; return Buffer.from(`crop:${buf.toString()}`); },
      objectStorage: { put: async () => { calls.put += 1; return { url: "https://x/recheck-crop.png" }; } },
      ...overrides,
    },
  };
}

function fakeIcaroAnswering(answers) {
  let index = 0;
  return {
    calls: [],
    request: async function (request) {
      this.calls.push(request);
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return { status: "completed", content: JSON.stringify({ hasLegibleText: answer }) };
    },
  };
}

const baseInput = { imageBuffer: Buffer.from("base-image"), rect: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }, tenantId: "tenant-1", specialistId: "gpt-creative-director" };

test("neutralizeGhostTextZone: 1 passe resolve — reverificação confirma 'não legível mais', nunca escala", async () => {
  const { deps, calls } = makeDeps();
  const icaro = fakeIcaroAnswering([false]);

  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);

  assert.equal(result.neutralizedLocally, true);
  assert.equal(result.passes, 1);
  assert.equal(icaro.calls.length, 1, "só 1 reverificação — resolveu de primeira");
  assert.equal(calls.applyLocalBlur.length, 1);
});

test("neutralizeGhostTextZone: pass 1 ainda legível -> escala pra pass 2, que resolve", async () => {
  const { deps, calls } = makeDeps();
  const icaro = fakeIcaroAnswering([true, false]);

  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);

  assert.equal(result.neutralizedLocally, true);
  assert.equal(result.passes, 2);
  assert.equal(icaro.calls.length, 2);
  assert.ok(calls.applyLocalBlur[1] > calls.applyLocalBlur[0], "2º passe precisa de um blur MAIS forte que o 1º");
  assert.ok(calls.applyLocalScrim[1] > calls.applyLocalScrim[0], "2º passe precisa de um véu MAIS opaco que o 1º");
});

test("neutralizeGhostTextZone: AMBOS os passes ainda legíveis -> neutralizedLocally=false (UNRECOVERABLE), nunca um 3º passe", async () => {
  const { deps, calls } = makeDeps();
  const icaro = fakeIcaroAnswering([true, true]);

  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);

  assert.equal(result.neutralizedLocally, false);
  assert.equal(result.passes, 2);
  assert.equal(icaro.calls.length, 2, "nunca um 3º passe — máximo 2");
  assert.equal(calls.applyLocalBlur.length, 2);
});

test("neutralizeGhostTextZone: resposta ilegível/falha na reverificação é CONSERVADORA — conta como 'ainda legível', nunca declara sucesso sem confirmação", async () => {
  const { deps } = makeDeps();
  const icaro = { calls: [], request: async () => ({ status: "failed" }) };

  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);

  assert.equal(result.neutralizedLocally, false, "sem confirmação real, nunca assume que funcionou");
});

test("neutralizeGhostTextZone: falha ao recortar a região (extractRegionBuffer undefined) é conservadora — nunca lança, trata como ainda legível", async () => {
  const { deps } = makeDeps({ extractRegionBuffer: async () => undefined });
  const icaro = fakeIcaroAnswering([false]); // nunca deveria ser chamado, pois o recorte falhou

  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);

  assert.equal(icaro.calls.length, 0, "sem recorte válido, não dá pra reverificar — nunca chama a visão com um crop inexistente");
  assert.equal(result.neutralizedLocally, false);
});

test("neutralizeGhostTextZone: intensidade inicial calculada a partir da estatística de pixel REAL da região (nunca um valor arbitrário)", async () => {
  const { deps } = makeDeps({ computeRegionPixelStats: async () => ({ meanLuminance: 200, stdDevLuminance: 20 }) }); // stdDev baixo -> "low"
  const icaro = fakeIcaroAnswering([false]);
  const { result } = await neutralizeGhostTextZone(icaro, deps, baseInput);
  assert.equal(result.finalIntensity, "low");
});

test("neutralizeGhostTextZone: backgroundIsDark reflete a luminância média real da região (determina a cor do véu)", async () => {
  const { deps: darkDeps } = makeDeps({ computeRegionPixelStats: async () => ({ meanLuminance: 20, stdDevLuminance: 50 }) });
  const { result: darkResult } = await neutralizeGhostTextZone(fakeIcaroAnswering([false]), darkDeps, baseInput);
  assert.equal(darkResult.backgroundIsDark, true);

  const { deps: lightDeps } = makeDeps({ computeRegionPixelStats: async () => ({ meanLuminance: 220, stdDevLuminance: 50 }) });
  const { result: lightResult } = await neutralizeGhostTextZone(fakeIcaroAnswering([false]), lightDeps, baseInput);
  assert.equal(lightResult.backgroundIsDark, false);
});

test("neutralizeGhostTextZone: custo de cada reverificação é rastreado via onCost", async () => {
  const { deps } = makeDeps();
  const icaro = fakeIcaroAnswering([true, false]);
  const costs = [];
  await neutralizeGhostTextZone(icaro, deps, { ...baseInput, onCost: (response) => costs.push(response) });
  assert.equal(costs.length, 2, "1 custo rastreado por passe de reverificação");
});
