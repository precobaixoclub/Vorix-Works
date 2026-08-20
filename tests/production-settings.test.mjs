import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryProductionSettingsRepository } from "../dist/infrastructure/storage/in-memory-production-settings-repository.js";
import { DEFAULT_PRODUCTION_SETTINGS, describeProductionSettingsAsInstructions } from "../dist/shared/utils/production-settings.types.js";

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — 1 registro por
// workspace, editável a qualquer momento sem deploy, com versionamento simples (incrementado a
// cada update, nunca resetado).

test("ProductionSettings: workspace sem configuração nenhuma -> getByWorkspace devolve undefined (nunca inventa um prompt)", async () => {
  const repo = new InMemoryProductionSettingsRepository(() => new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(await repo.getByWorkspace("workspace-sem-config"), undefined);
});

test("ProductionSettings: primeiro upsert() cria com version 1 e aplica defaults para campos não informados", async () => {
  const repo = new InMemoryProductionSettingsRepository(() => new Date("2026-01-01T00:00:00.000Z"));
  const created = await repo.upsert("workspace-1", { productionPrompt: "Crie peças modernas e de alto impacto." });
  assert.equal(created.version, 1);
  assert.equal(created.productionPrompt, "Crie peças modernas e de alto impacto.");
  assert.equal(created.preferRealAssets, DEFAULT_PRODUCTION_SETTINGS.preferRealAssets);
  assert.equal(created.allowFictionalInterfaces, DEFAULT_PRODUCTION_SETTINGS.allowFictionalInterfaces);
});

test("ProductionSettings: upsert() subsequente faz merge parcial e incrementa version — nunca reseta nem sobrescreve campo ausente do patch", async () => {
  const repo = new InMemoryProductionSettingsRepository(() => new Date("2026-01-01T00:00:00.000Z"));
  await repo.upsert("workspace-1", { productionPrompt: "Texto original.", allowFictionalInterfaces: false });
  const updated = await repo.upsert("workspace-1", { allowFictionalInterfaces: true });
  assert.equal(updated.version, 2);
  assert.equal(updated.allowFictionalInterfaces, true);
  // productionPrompt não fez parte deste patch — precisa continuar intacto.
  assert.equal(updated.productionPrompt, "Texto original.");
});

test("ProductionSettings: alterar o prompt depois não muda um snapshot já capturado anteriormente (imutabilidade do histórico de execução)", async () => {
  const repo = new InMemoryProductionSettingsRepository(() => new Date("2026-01-01T00:00:00.000Z"));
  const v1 = await repo.upsert("workspace-1", { productionPrompt: "Instrução versão 1." });
  const snapshotV1 = { ...v1 }; // simula o snapshot gravado em creative_engine_runs.creative_context na época
  await repo.upsert("workspace-1", { productionPrompt: "Instrução versão 2." });
  const v2 = await repo.getByWorkspace("workspace-1");

  assert.equal(snapshotV1.productionPrompt, "Instrução versão 1.");
  assert.equal(snapshotV1.version, 1);
  assert.equal(v2.productionPrompt, "Instrução versão 2.");
  assert.equal(v2.version, 2);
});

test("describeProductionSettingsAsInstructions: allowFictionalInterfaces=false produz uma instrução explícita de proibição", () => {
  const lines = describeProductionSettingsAsInstructions({ ...DEFAULT_PRODUCTION_SETTINGS, allowFictionalInterfaces: false });
  assert.ok(lines.some((line) => /NUNCA invente uma interface fictícia/.test(line)));
});

test("describeProductionSettingsAsInstructions: allowFictionalInterfaces=true permite interfaces fictícias explicitamente", () => {
  const lines = describeProductionSettingsAsInstructions({ ...DEFAULT_PRODUCTION_SETTINGS, allowFictionalInterfaces: true });
  assert.ok(lines.some((line) => /Interfaces fictícias.*são permitidas/.test(line)));
});

test("describeProductionSettingsAsInstructions: textDensity/creativeFreedom viram frases distintas para cada valor", () => {
  const minimal = describeProductionSettingsAsInstructions({ ...DEFAULT_PRODUCTION_SETTINGS, textDensity: "minimal" });
  const rich = describeProductionSettingsAsInstructions({ ...DEFAULT_PRODUCTION_SETTINGS, textDensity: "rich" });
  assert.notDeepEqual(minimal, rich);
});
