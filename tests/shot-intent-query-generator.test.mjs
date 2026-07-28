import test from "node:test";
import assert from "node:assert/strict";
import { buildShotIntentQueryPlan } from "../dist/infrastructure/footage-acquisition/shot-intent-query-generator.js";

function baseIntent(overrides = {}) {
  return {
    sceneOrder: 1,
    narrativeGoal: "mostrar facilidade",
    mainAction: "casal usando celular",
    device: "none",
    deviceOrientation: "any",
    screenVisibleRequired: false,
    minDurationSeconds: 1,
    assetType: "video",
    compositingRequired: false,
    ...overrides,
  };
}

test("gera MÚLTIPLAS consultas (nunca apenas uma) quando o Shot pede celular com tela visível", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "phone", screenVisibleRequired: true, protagonist: "casal recém-noivos" }));
  assert.ok(plan.positiveQueries.length >= 8, `esperava várias consultas, recebeu ${plan.positiveQueries.length}`);
  assert.ok(plan.positiveQueries.every((query) => typeof query === "string" && query.length > 0));
});

test("consultas geradas para celular estão em inglês (provider internacional)", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "phone", screenVisibleRequired: true }));
  assert.ok(plan.positiveQueries.some((query) => query.includes("smartphone") || query.includes("phone")));
  assert.ok(!plan.positiveQueries.some((query) => /celular|tela/i.test(query)));
});

test("gera padrões negativos para celular (verso, bolso, tela escondida etc.) e NUNCA os inclui nas consultas positivas", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "phone", screenVisibleRequired: true }));
  assert.ok(plan.negativePatterns.includes("phone back"));
  assert.ok(plan.negativePatterns.includes("phone pocket"));
  assert.ok(plan.negativePatterns.includes("screen hidden"));
  for (const negative of plan.negativePatterns) {
    assert.ok(!plan.positiveQueries.some((query) => query === negative), `padrão negativo "${negative}" nunca deveria aparecer como consulta positiva`);
  }
});

test("descarta o objetivo/tema como consulta primária, documentando o motivo (mudança de filosofia)", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "phone", screenVisibleRequired: true, narrativeGoal: "mostrar facilidade do RSVP" }));
  assert.ok(plan.discardedQueries.some((discarded) => discarded.query === "mostrar facilidade do RSVP"));
  assert.ok(plan.discardedQueries[0].reason.length > 20, "motivo do descarte deve ser uma justificativa real, não um texto vazio");
});

test("Shot sem dispositivo cai para consulta de ação+protagonista+emoção, nunca gera consultas de tela/dispositivo", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "none", screenVisibleRequired: false, mainAction: "casal caminhando na praia", protagonist: "casal", emotion: "alegria" }));
  assert.equal(plan.negativePatterns.length, 0);
  assert.ok(plan.positiveQueries.length >= 1);
  assert.ok(!plan.positiveQueries.some((query) => /smartphone|phone|tablet|laptop/i.test(query)));
});

test("consultas de tablet e notebook usam vocabulário próprio (nunca reaproveita literalmente as de phone)", () => {
  const tabletPlan = buildShotIntentQueryPlan(baseIntent({ device: "tablet", screenVisibleRequired: true }));
  const notebookPlan = buildShotIntentQueryPlan(baseIntent({ device: "notebook", screenVisibleRequired: true }));
  assert.ok(tabletPlan.positiveQueries.some((query) => query.includes("tablet")));
  assert.ok(notebookPlan.positiveQueries.some((query) => query.includes("laptop")));
  assert.notDeepEqual(tabletPlan.positiveQueries, notebookPlan.positiveQueries);
});

test("consultas nunca têm duplicatas (normalização de subject não gera repetição)", () => {
  const plan = buildShotIntentQueryPlan(baseIntent({ device: "phone", screenVisibleRequired: true, protagonist: "casal" }));
  const unique = new Set(plan.positiveQueries);
  assert.equal(unique.size, plan.positiveQueries.length);
});
