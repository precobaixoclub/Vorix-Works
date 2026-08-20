import test from "node:test";
import assert from "node:assert/strict";
import { assertCreativeEngineExclusivity, resolveCreativeEngineMode } from "../dist/application/creative-engine/creative-engine-mode.js";

test("resolveCreativeEngineMode: só gpt ligado -> mode gpt", () => {
  const selection = resolveCreativeEngineMode({ creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: false });
  assert.equal(selection.mode, "gpt");
});

test("resolveCreativeEngineMode: só legacy ligado -> mode legacy", () => {
  const selection = resolveCreativeEngineMode({ creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: true });
  assert.equal(selection.mode, "legacy");
});

test("resolveCreativeEngineMode: os dois ligados -> CREATIVE_ENGINE_AMBIGUOUS", () => {
  assert.throws(
    () => resolveCreativeEngineMode({ creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: true }),
    /CREATIVE_ENGINE_AMBIGUOUS/,
  );
});

test("resolveCreativeEngineMode: nenhum ligado -> CREATIVE_ENGINE_NONE", () => {
  assert.throws(
    () => resolveCreativeEngineMode({ creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: false }),
    /CREATIVE_ENGINE_NONE/,
  );
});

test("assertCreativeEngineExclusivity: não lança para flags válidas (exatamente uma ligada)", () => {
  assert.doesNotThrow(() => assertCreativeEngineExclusivity({
    realExecutionEnabled: true, realExecutionResearchEnabled: false, realPlanningEnabled: false,
    realCopyEnabled: false, realVisualEnabled: true, realDistributionEnabled: false,
    creativeEngineGptEnabled: false, legacyCreativeEngineEnabled: true,
  }));
});

test("assertCreativeEngineExclusivity: lança para flags ambíguas — usado no boot do container para falhar cedo", () => {
  assert.throws(() => assertCreativeEngineExclusivity({
    realExecutionEnabled: true, realExecutionResearchEnabled: false, realPlanningEnabled: false,
    realCopyEnabled: false, realVisualEnabled: true, realDistributionEnabled: false,
    creativeEngineGptEnabled: true, legacyCreativeEngineEnabled: true,
  }));
});
