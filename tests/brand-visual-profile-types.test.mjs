import test from "node:test";
import assert from "node:assert/strict";
import { buildConservativeDefaultProfile, COMPONENT_SKINS, ENERGY_LEVELS, DENSITY_PREFERENCES } from "../dist/shared/utils/brand-visual-profile.types.js";

test("buildConservativeDefaultProfile: nunca inventa uma identidade exagerada — cores neutras, energia/densidade moderadas", () => {
  const profile = buildConservativeDefaultProfile("workspace-1", "2026-01-01T00:00:00.000Z");

  assert.equal(profile.workspaceId, "workspace-1");
  assert.equal(profile.source, "bootstrap_conservative");
  assert.equal(profile.personality.visualEnergy, "moderate");
  assert.equal(profile.personality.graphicDensityPreference, "moderate");
  assert.ok(ENERGY_LEVELS.includes(profile.personality.visualEnergy));
  assert.ok(DENSITY_PREFERENCES.includes(profile.personality.graphicDensityPreference));
});

test("buildConservativeDefaultProfile: todo skin de componente é um valor válido de COMPONENT_SKINS", () => {
  const profile = buildConservativeDefaultProfile("workspace-1", "2026-01-01T00:00:00.000Z");

  for (const skin of Object.values(profile.components)) {
    assert.ok(COMPONENT_SKINS.includes(skin), `'${skin}' não é um skin válido`);
  }
});

test("buildConservativeDefaultProfile: determinístico — mesma entrada sempre produz o mesmo perfil", () => {
  const a = buildConservativeDefaultProfile("workspace-1", "2026-01-01T00:00:00.000Z");
  const b = buildConservativeDefaultProfile("workspace-1", "2026-01-01T00:00:00.000Z");

  assert.deepEqual(a, b);
});

test("buildConservativeDefaultProfile: createdAt/updatedAt refletem o timestamp passado, workspaceId reflete o workspace", () => {
  const profile = buildConservativeDefaultProfile("workspace-42", "2026-03-05T10:00:00.000Z");

  assert.equal(profile.createdAt, "2026-03-05T10:00:00.000Z");
  assert.equal(profile.updatedAt, "2026-03-05T10:00:00.000Z");
  assert.equal(profile.workspaceId, "workspace-42");
});
