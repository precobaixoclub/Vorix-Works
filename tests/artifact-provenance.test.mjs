import test from "node:test";
import assert from "node:assert/strict";
import { assertPublishable, isExplicitlyNonPublishable, isPublishable } from "../dist/shared/utils/artifact-provenance.js";

test("isPublishable: true só quando a proveniência existe E diz publishable:true", () => {
  assert.equal(isPublishable({ producer: "real_ai_generation", publishable: true }), true);
  assert.equal(isPublishable({ producer: "placeholder_mockup", publishable: false }), false);
  assert.equal(isPublishable(undefined), false, "ausência de proveniência é fail-closed aqui");
});

test("assertPublishable: não lança para proveniência publishable:true", () => {
  assert.doesNotThrow(() => assertPublishable({ producer: "gpt_creative_engine", publishable: true }, "teste"));
});

test("assertPublishable: lança NON_PUBLISHABLE_ARTIFACT com o motivo quando publishable:false", () => {
  assert.throws(
    () => assertPublishable({ producer: "placeholder_mockup", publishable: false, reason: "caixa fake" }, "peça final"),
    /NON_PUBLISHABLE_ARTIFACT: peça final.*placeholder_mockup.*caixa fake/s,
  );
});

test("assertPublishable: lança quando a proveniência está ausente", () => {
  assert.throws(() => assertPublishable(undefined, "peça final"), /NON_PUBLISHABLE_ARTIFACT: peça final.*ausente/s);
});

test("isExplicitlyNonPublishable: fail-open — ausência de proveniência NUNCA é rejeição (caso normal de intervenção assistida)", () => {
  assert.equal(isExplicitlyNonPublishable(undefined), false);
});

test("isExplicitlyNonPublishable: só rejeita quando existe proveniência explícita publishable:false", () => {
  assert.equal(isExplicitlyNonPublishable({ producer: "placeholder_mockup", publishable: false }), true);
  assert.equal(isExplicitlyNonPublishable({ producer: "real_ai_generation", publishable: true }), false);
});
