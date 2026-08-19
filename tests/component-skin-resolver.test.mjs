import test from "node:test";
import assert from "node:assert/strict";
import { resolveZoneSkins } from "../dist/shared/utils/component-skin-resolver.js";
import { buildConservativeDefaultProfile, COMPONENT_SKINS } from "../dist/shared/utils/brand-visual-profile.types.js";

test("resolveZoneSkins: sem perfil de marca, todas as zonas caem no skin \"clean\" (visual de sempre, sem regressão)", () => {
  const skins = resolveZoneSkins(undefined);
  assert.equal(skins.price, "clean");
  assert.equal(skins.discount, "clean");
  assert.equal(skins.cta, "clean");
  assert.equal(skins.headline, "clean");
});

test("resolveZoneSkins: preço/desconto/CTA/badge usam exatamente a escolha explícita de components.*Skin do perfil", () => {
  const profile = buildConservativeDefaultProfile("ws-1", "2026-08-16T00:00:00.000Z");
  profile.components = { priceSkin: "premium", discountSkin: "marketplace", ctaSkin: "outlined", badgeSkin: "editorial" };
  const skins = resolveZoneSkins(profile);
  assert.equal(skins.price, "premium");
  assert.equal(skins.discount, "marketplace");
  assert.equal(skins.cta, "outlined");
  assert.equal(skins.badge, "editorial");
});

test("resolveZoneSkins: marca premium (sophistication=premium) usa skin \"premium\" nas zonas secundárias (headline/benefits/rating)", () => {
  const profile = buildConservativeDefaultProfile("ws-2", "2026-08-16T00:00:00.000Z");
  profile.personality = { ...profile.personality, sophistication: "premium" };
  const skins = resolveZoneSkins(profile);
  assert.equal(skins.headline, "premium");
  assert.equal(skins.benefits, "premium");
  assert.equal(skins.rating, "premium");
});

test("resolveZoneSkins: marca agressiva e densa usa skin \"marketplace\" nas zonas secundárias", () => {
  const profile = buildConservativeDefaultProfile("ws-3", "2026-08-16T00:00:00.000Z");
  profile.personality = { ...profile.personality, commercialAggressiveness: "aggressive", graphicDensityPreference: "dense" };
  const skins = resolveZoneSkins(profile);
  assert.equal(skins.headline, "marketplace");
});

test("resolveZoneSkins: marca agressiva mas não densa usa skin \"bold\" (distinto de marketplace)", () => {
  const profile = buildConservativeDefaultProfile("ws-4", "2026-08-16T00:00:00.000Z");
  profile.personality = { ...profile.personality, commercialAggressiveness: "aggressive", graphicDensityPreference: "moderate" };
  const skins = resolveZoneSkins(profile);
  assert.equal(skins.headline, "bold");
});

test("resolveZoneSkins: marca com densidade gráfica mínima usa skin \"editorial\" nas zonas secundárias", () => {
  const profile = buildConservativeDefaultProfile("ws-5", "2026-08-16T00:00:00.000Z");
  profile.personality = { ...profile.personality, graphicDensityPreference: "minimal" };
  const skins = resolveZoneSkins(profile);
  assert.equal(skins.headline, "editorial");
});

test("resolveZoneSkins: todo skin resolvido é sempre um valor válido de COMPONENT_SKINS", () => {
  const profile = buildConservativeDefaultProfile("ws-6", "2026-08-16T00:00:00.000Z");
  const skins = resolveZoneSkins(profile);
  for (const value of Object.values(skins)) {
    assert.ok(COMPONENT_SKINS.includes(value), `"${value}" deveria ser um ComponentSkin válido`);
  }
});
