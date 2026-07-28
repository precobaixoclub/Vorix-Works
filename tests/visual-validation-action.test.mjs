import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visualValidationAction } from "../dist/application/orchestration/autonomous/actions/visual-validation.action.js";

/**
 * Regressão real (validação autônoma ponta-a-ponta): uma versão anterior desta ação reportava
 * `ok: true` mesmo com "0 de 0 candidatos" rejeitados — como é a ÚLTIMA ação candidata na
 * prioridade padrão para video_coverage_low/asset_diversity_low, esse falso sucesso nunca deixava
 * o Engine esgotar tentativas e escalonar, consumindo o teto global de iterações inteiro (25/25,
 * ~17min reais) sem nunca pedir ajuda humana. Fixado para nunca reivindicar sucesso sem efeito real.
 */

async function withIsolatedCatalog(run) {
  const dataDir = await mkdtemp(join(tmpdir(), "zuno-visual-validation-test-"));
  const original = process.env.ZUNO_DATA_DIR;
  process.env.ZUNO_DATA_DIR = dataDir;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.ZUNO_DATA_DIR;
    else process.env.ZUNO_DATA_DIR = original;
    await rm(dataDir, { recursive: true, force: true });
  }
}

const fakeReport = { executionId: "exec-test", state: "WAITING_ASSISTED_GENERATION", waitingForStepId: "step-1", message: "m", steps: [] };
const fakeBlocker = { kind: "video_coverage_low", stepId: "step-1", stepName: "Rafa", executionState: "WAITING_ASSISTED_GENERATION", message: "m" };

test("visual_validation: catálogo vazio (0 candidatos pendentes) nunca é reportado como sucesso", async () => {
  await withIsolatedCatalog(async () => {
    const outcome = await visualValidationAction.execute({ executionId: "exec-test", blocker: fakeBlocker, report: fakeReport, attemptNumber: 1, dryRun: false });
    assert.equal(outcome.ok, false, "0 de 0 candidatos rejeitados nunca deve contar como sucesso");
    assert.deepEqual(outcome.sideEffectsApplied, []);
    assert.match(outcome.detail, /no-op|nada a corrigir|nenhum candidato/i);
  });
});

test("visual_validation: dry-run também nunca reivindica wouldSucceed quando não há candidatos", async () => {
  await withIsolatedCatalog(async () => {
    const outcome = await visualValidationAction.execute({ executionId: "exec-test", blocker: fakeBlocker, report: fakeReport, attemptNumber: 1, dryRun: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.wouldSucceed, false, "dry-run sem candidatos pendentes nunca deve prometer sucesso");
  });
});
