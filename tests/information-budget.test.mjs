import test from "node:test";
import assert from "node:assert/strict";
import { resolveInformationBudget, applyInformationBudget } from "../dist/shared/utils/information-budget.js";

test("resolveInformationBudget: max_performance em 4:5 comporta mais zonas que clean em 9:16", () => {
  const maxPerf45 = resolveInformationBudget("max_performance", "4:5");
  const clean916 = resolveInformationBudget("clean", "9:16");
  assert.ok(maxPerf45 > clean916, `esperava max_performance/4:5 (${maxPerf45}) > clean/9:16 (${clean916})`);
});

test("resolveInformationBudget: nunca fica abaixo do mínimo de 2 zonas", () => {
  const budget = resolveInformationBudget("clean", "9:16");
  assert.ok(budget >= 2);
});

test("applyInformationBudget: dentro do orçamento, devolve todas as zonas sem alterar", () => {
  const zones = [{ type: "price", priority: 1, position: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } }];
  const result = applyInformationBudget(zones, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0], zones[0]);
});

test("applyInformationBudget: acima do orçamento, remove as zonas de MENOR prioridade primeiro", () => {
  const zones = [
    { type: "specs", priority: 3, position: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } },
    { type: "price", priority: 1, position: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } },
    { type: "badge", priority: 4, position: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } },
    { type: "cta", priority: 2, position: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } },
  ];
  const result = applyInformationBudget(zones, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((z) => z.type), ["price", "cta"]);
});
