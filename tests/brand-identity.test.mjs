import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  commitBrandIdentity,
  deriveBrandSkin,
  describeBrandIdentityForDirector,
  describeBrandIdentityForImage,
  detectBrandRequestConflicts,
  selectBrandLogoForSurface,
  validateBrandIdentityInput,
  BRAND_DENSITY_TO_PLAN,
} from "../dist/shared/utils/brand-identity.js";
import { BrandIdentityService } from "../dist/application/brand/brand-identity-service.js";
import { buildCreativeContext } from "../dist/application/creative-engine/build-creative-context.js";
import { buildCreativePlanPrompt, buildImageGenerationPromptFromPlan } from "../dist/shared/utils/gpt-creative-plan.types.js";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";
import { InMemoryAssetLibraryRepository } from "../dist/infrastructure/storage/in-memory-asset-library-repository.js";
import { InMemoryBrandVisualProfileRepository } from "../dist/infrastructure/storage/in-memory-brand-visual-profile-repository.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { InMemoryProductionSettingsRepository } from "../dist/infrastructure/storage/in-memory-production-settings-repository.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { registerBrandIdentityRoutes } from "../dist/interfaces/api/routes/v1/brand-identity.route.js";
import { registerBrandProfileRoutes } from "../dist/interfaces/api/routes/v1/brand-profile.route.js";
import { registerProductionSettingsRoutes } from "../dist/interfaces/api/routes/v1/production-settings.route.js";
import { SYNTHETIC_PROFILES } from "./fixtures/editorial/brand/profiles.mjs";

const NOW = "2026-10-10T12:00:00.000Z";
const FX = "tests/fixtures/editorial";

function committed(profileKey) {
  const validated = validateBrandIdentityInput(SYNTHETIC_PROFILES[profileKey]);
  assert.ok(validated.ok, JSON.stringify(validated));
  return commitBrandIdentity(validated.identity, undefined, NOW);
}
function creativeBrand(identity, logos = []) {
  return { profileId: "brand-profile-1", workspaceId: "workspace-a", version: identity.version, updatedAt: identity.updatedAt, identity, logos };
}

// ------------------------------------------------------------------ modelo / validação

test("brand identity: perfil completo, parcial e vazio são válidos; nada é inventado", () => {
  for (const key of ["P1", "P2", "P3"]) assert.ok(validateBrandIdentityInput(SYNTHETIC_PROFILES[key]).ok, key);
  const partial = validateBrandIdentityInput({ colors: [{ hex: "#123456", role: "PRIMARY" }] });
  assert.ok(partial.ok);
  assert.equal(partial.identity.style, undefined);
  assert.equal(partial.identity.typography, undefined);
  assert.deepEqual(partial.identity.forbiddenPatterns, []);
  const empty = validateBrandIdentityInput({});
  assert.ok(empty.ok);
  assert.deepEqual(empty.identity.colors, []);
});

test("brand identity: cores inválidas, papéis inválidos, duplicatas e conflitos são recusados (nunca aceitos em silêncio)", () => {
  const cases = [
    [{ colors: [{ hex: "red", role: "PRIMARY" }] }, /hex inválido/],
    [{ colors: [{ hex: "#12345", role: "PRIMARY" }] }, /hex inválido/],
    [{ colors: [{ hex: "#123456", role: "MAIN" }] }, /função inválida/],
    [{ colors: [{ hex: "#123456", role: "PRIMARY" }, { hex: "#123456", role: "ACCENT" }] }, /repetida/],
    [{ colors: [{ hex: "#E10600", role: "PRIMARY" }, { hex: "#E20501", role: "FORBIDDEN" }] }, /cor proibida/],
    [{ style: { primary: "FUTURISTA" } }, /estilo principal inválido/],
    [{ imageStyles: ["GRADIENT"], forbiddenPatterns: ["NO_GRADIENTS"] }, /conflita/],
    [{ logos: [{ assetId: "a1", variant: "PRIMARY", backgrounds: [] }] }, /fundo compatível/],
    [{ logos: [{ assetId: "a1", variant: "GIGANTE", backgrounds: ["LIGHT"] }] }, /tipo inválido/],
    [{ colors: Array.from({ length: 13 }, (_, index) => ({ hex: `#0000${(index + 16).toString(16).padStart(2, "0")}`, role: "SECONDARY" })) }, /no máximo 12/],
  ];
  for (const [input, pattern] of cases) {
    const result = validateBrandIdentityInput(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.ok(result.errors.some((error) => pattern.test(error)), `${JSON.stringify(input)} → ${result.errors.join(" | ")}`);
  }
});

test("brand identity: versão incrementa a cada gravação e sugestão de IA só vira fato quando o usuário grava", () => {
  const first = commitBrandIdentity(validateBrandIdentityInput({ colors: [{ hex: "#123456", role: "PRIMARY", provenance: "AI_SUGGESTED" }], style: { primary: "MINIMAL", traits: [] }, fieldProvenance: { style: "AI_SUGGESTED" } }).identity, undefined, NOW);
  assert.equal(first.version, 1);
  assert.equal(first.colors[0].provenance, "USER_CONFIGURED");
  assert.equal(first.fieldProvenance.style, "USER_CONFIGURED");
  const extracted = commitBrandIdentity(validateBrandIdentityInput({ colors: [{ hex: "#654321", role: "PRIMARY", provenance: "ASSET_EXTRACTED" }] }).identity, first, NOW);
  assert.equal(extracted.version, 2);
  assert.equal(extracted.colors[0].provenance, "ASSET_EXTRACTED", "origem extraída do asset é preservada (confirmada pelo usuário ao salvar)");
});

// ------------------------------------------------------------------ mapeadores

test("brand identity → diretor: contexto estruturado resumido (não o JSON), com papéis e proibições", () => {
  const lines = describeBrandIdentityForDirector(creativeBrand(committed("P1"))).join("\n");
  assert.match(lines, /Cores principais \(podem dominar\): vinho \(#6E2433\)/);
  assert.match(lines, /Cores de destaque .*dourado envelhecido/);
  assert.match(lines, /Cores PROIBIDAS \(nunca usar\): vermelho vivo \(#E10600\)/);
  assert.match(lines, /Estilo: premium com traços editorial/);
  assert.match(lines, /nunca é fonte de fato comercial/);
  assert.doesNotMatch(lines, /"colors"|fieldProvenance|schemaVersion/);
});

test("brand identity → imagem base: só direção visual; nunca marca, logo, CTA, preço ou claim", () => {
  const lines = describeBrandIdentityForImage(creativeBrand(committed("P1"))).join("\n");
  assert.match(lines, /Avoid these colors entirely: red/);
  assert.match(lines, /editorial photography/);
  assert.doesNotMatch(lines, /Rumo|Altar|R\$|CTA|comprar|desconto|elegância discreta/i);
  const plan = basePlan();
  const context = baseContext({ brandIdentity: creativeBrand(committed("P2")) });
  const prompt = buildImageGenerationPromptFromPlan(plan, context, { compositionMode: "editorial_experimental", editorialFamily: "digital_service" });
  assert.match(prompt, /Brand visual language \(non-textual\): modern tech/);
  assert.match(prompt, /Avoid these colors entirely: orange/);
  assert.doesNotMatch(prompt, /Rumo ao Altar/);
  assert.doesNotMatch(prompt, /Comprar agora|R\$ 149/);
  const director = buildCreativePlanPrompt(context);
  assert.match(director, /IDENTIDADE VISUAL ESTRUTURADA DA MARCA/);
});

test("brand identity: pedido conflitante com restrição explícita → a marca prevalece e fica registrado", () => {
  const brand = creativeBrand(committed("P3"));
  const rules = detectBrandRequestConflicts(brand, "Faça tudo vermelho, com fundo escuro e um degradê forte");
  assert.deepEqual(rules.map((rule) => [rule.code, rule.outcome]), [
    ["FORBIDDEN_COLOR_REQUESTED", "PROFILE_PREVAILED"],
    ["FORBIDDEN_PATTERN_REQUESTED", "PROFILE_PREVAILED"],
    ["FORBIDDEN_PATTERN_REQUESTED", "PROFILE_PREVAILED"],
  ]);
  assert.deepEqual(detectBrandRequestConflicts(brand, "peça institucional elegante"), []);
});

test("brand identity: skin e densidade derivadas dos papéis; sem perfil → SYSTEM_DEFAULT", () => {
  assert.equal(deriveBrandSkin(undefined), undefined);
  const p3 = deriveBrandSkin(creativeBrand(committed("P3")));
  assert.equal(p3.accent, "#115E59");
  assert.equal(p3.darkNeutral, "#111827");
  assert.equal(p3.lightNeutral, "#FFFFFF");
  assert.deepEqual(p3.forbidden, ["#DC2626"]);
  assert.equal(p3.flat, true);
  assert.equal(p3.forceLight, true);
  assert.equal(p3.ctaUppercase, false);
  assert.equal(p3.shadow, "NONE");
  const p2 = deriveBrandSkin(creativeBrand(committed("P2")));
  assert.equal(p2.headlineUppercase, true);
  assert.equal(p2.ctaCorners, "PILL");
  assert.equal(deriveBrandSkin(creativeBrand(committed("P1"))).headlineSerif, true);
  assert.equal(BRAND_DENSITY_TO_PLAN.LOW, "clean");
});

test("brand identity: versão de logo escolhida pela compatibilidade de fundo (nunca inventa variação)", () => {
  const logos = [
    { assetId: "dark", backgrounds: ["LIGHT"], priority: 1 },
    { assetId: "light", backgrounds: ["DARK", "PHOTO"], priority: 2 },
  ];
  assert.equal(selectBrandLogoForSurface(logos, "light").assetId, "dark");
  assert.equal(selectBrandLogoForSurface(logos, "dark").assetId, "light");
  assert.equal(selectBrandLogoForSurface(logos, "photo").assetId, "light");
  assert.equal(selectBrandLogoForSurface([logos[0]], "dark"), undefined, "sem versão para fundo escuro → tratamento permitido sobre a logo padrão");
});

// ------------------------------------------------------------------ API multi-tenant

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

async function apiContext(tenantId = TENANT_A) {
  let seq = 0;
  const workspaceRepository = new InMemoryWorkspaceRepository({ idGenerator: () => ["workspace-a", "workspace-a2", "workspace-b"][seq++] });
  const assetLibraryRepository = new InMemoryAssetLibraryRepository();
  const brandVisualProfileRepository = new InMemoryBrandVisualProfileRepository();
  const productionSettingsRepository = new InMemoryProductionSettingsRepository();
  const workspaceA = await workspaceRepository.create({ tenantId: TENANT_A, name: "A" });
  const workspaceA2 = await workspaceRepository.create({ tenantId: TENANT_A, name: "A2" });
  const workspaceB = await workspaceRepository.create({ tenantId: TENANT_B, name: "B" });
  const libraryA = await assetLibraryRepository.createLibrary({ workspaceId: workspaceA.id });
  const libraryA2 = await assetLibraryRepository.createLibrary({ workspaceId: workspaceA2.id });
  const logoA = await assetLibraryRepository.registerAsset({ libraryId: libraryA.id, kind: "logo", name: "Logo escura", storageRef: { provider: "object_storage", objectKey: "assets/tenant-a/workspace-a/logo.png" } });
  const logoA2 = await assetLibraryRepository.registerAsset({ libraryId: libraryA2.id, kind: "logo", name: "Logo de outro workspace", storageRef: { provider: "object_storage", objectKey: "assets/tenant-a/workspace-a2/logo.png" } });
  const logoBuffer = await readFile(join(FX, "brand/lumen-logo-dark.png"));
  const brandIdentityService = new BrandIdentityService({
    brandVisualProfileRepository,
    assetLibraryRepository,
    resolveAssetUrl: (key) => `https://api.vorixworks.com/uploads/${key}`,
    extractPalette: async () => (await import("../dist/infrastructure/brand/extract-logo-palette.js")).extractLogoPalette(logoBuffer),
    now: () => NOW,
  });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: { userId: "user-1", tenantId, role: "owner", sessionId: "s", isPlatformAdmin: false } };
  });
  await registerBrandIdentityRoutes(app, { brandIdentityService, workspaceRepository });
  await registerBrandProfileRoutes(app, { resolveBrandProfile: async () => ({ brandName: "X" }), updateBrandProfile: async () => undefined, workspaceRepository });
  await registerProductionSettingsRoutes(app, { productionSettingsRepository, workspaceRepository });
  return { app, workspaceA, workspaceA2, workspaceB, logoA, logoA2, brandIdentityService, brandVisualProfileRepository };
}

test("API brand identity: workspace de outro tenant → 404 em GET/PUT/sugestão (sem vazar nem gravar)", async () => {
  const ctx = await apiContext(TENANT_A);
  const get = await ctx.app.inject({ method: "GET", url: `/brand-identity?workspaceId=${ctx.workspaceB.id}` });
  assert.equal(get.statusCode, 404);
  const put = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceB.id, identity: SYNTHETIC_PROFILES.P1 } });
  assert.equal(put.statusCode, 404);
  assert.equal(await ctx.brandVisualProfileRepository.getByWorkspace(ctx.workspaceB.id), undefined);
  const suggest = await ctx.app.inject({ method: "POST", url: "/brand-identity/suggest-from-logo", payload: { workspaceId: ctx.workspaceB.id, assetId: ctx.logoA.id } });
  assert.equal(suggest.statusCode, 404);
  for (const url of [`/brand-profile?workspaceId=${ctx.workspaceB.id}`, `/production-settings?workspaceId=${ctx.workspaceB.id}`]) {
    assert.equal((await ctx.app.inject({ method: "GET", url })).statusCode, 404, url);
  }
  assert.equal((await ctx.app.inject({ method: "POST", url: "/production-settings", payload: { workspaceId: ctx.workspaceB.id, productionPrompt: "x" } })).statusCode, 404);
  await ctx.app.close();
});

test("API brand identity: logo de OUTRO workspace (mesmo tenant) é recusada; logo própria aceita; versão incrementa", async () => {
  const ctx = await apiContext(TENANT_A);
  const empty = await ctx.app.inject({ method: "GET", url: `/brand-identity?workspaceId=${ctx.workspaceA.id}` });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().data.identity, null, "sem identidade configurada nunca inventa uma");
  const foreign = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceA.id, identity: { ...SYNTHETIC_PROFILES.P1, logos: [{ assetId: ctx.logoA2.id, variant: "PRIMARY", backgrounds: ["LIGHT"] }] } } });
  assert.equal(foreign.statusCode, 404);
  const invalid = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceA.id, identity: { colors: [{ hex: "vermelho", role: "PRIMARY" }] } } });
  assert.equal(invalid.statusCode, 400);
  const ok = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceA.id, identity: { ...SYNTHETIC_PROFILES.P1, logos: [{ assetId: ctx.logoA.id, variant: "PRIMARY", backgrounds: ["LIGHT"] }] } } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().data.identity.version, 1);
  const again = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceA.id, identity: SYNTHETIC_PROFILES.P3 } });
  assert.equal(again.json().data.identity.version, 2);
  const resolved = await ctx.brandIdentityService.resolveForCreative(ctx.workspaceA.id);
  assert.equal(resolved.brand.version, 2);
  assert.equal(resolved.brand.workspaceId, ctx.workspaceA.id);
  assert.equal(await ctx.brandIdentityService.resolveForCreative(ctx.workspaceA2.id), undefined, "workspace sem identidade → SYSTEM_DEFAULT");
  const cleared = await ctx.app.inject({ method: "PUT", url: "/brand-identity", payload: { workspaceId: ctx.workspaceA.id, identity: {} } });
  assert.equal(cleared.json().data.identity.version, 3, "limpar também é uma versão auditável");
  assert.equal(await ctx.brandIdentityService.resolveForCreative(ctx.workspaceA.id), undefined, "identidade vazia → SYSTEM_DEFAULT");
  await ctx.app.close();
});

test("API brand identity: sugestão de cores a partir da logo é ASSET_EXTRACTED/SUGGESTION e não é gravada", async () => {
  const ctx = await apiContext(TENANT_A);
  const response = await ctx.app.inject({ method: "POST", url: "/brand-identity/suggest-from-logo", payload: { workspaceId: ctx.workspaceA.id, assetId: ctx.logoA.id } });
  assert.equal(response.statusCode, 200, response.body);
  const { suggestions } = response.json().data;
  assert.ok(suggestions.length >= 1);
  assert.ok(suggestions.every((item) => item.provenance === "ASSET_EXTRACTED" && item.status === "SUGGESTION"));
  assert.equal(await ctx.brandVisualProfileRepository.getByWorkspace(ctx.workspaceA.id), undefined, "sugestão nunca grava sozinha");
  await ctx.app.close();
});

// ------------------------------------------------------------------ contexto criativo

test("buildCreativeContext: identidade estruturada + conflitos registrados; ausente → contexto como antes", async () => {
  const brand = creativeBrand(committed("P3"));
  const withBrand = await buildCreativeContext({ resolveBrandIdentity: async () => ({ brand, skipped: [] }) }, contextInput({ ideaText: "Quero tudo vermelho" }));
  assert.equal(withBrand.brandIdentity.version, 1);
  assert.ok(withBrand.appliedBrandRules.some((rule) => rule.code === "FORBIDDEN_COLOR_REQUESTED"));
  const without = await buildCreativeContext({ resolveBrandIdentity: async () => undefined }, contextInput({}));
  assert.equal(without.brandIdentity, undefined);
  assert.equal(without.appliedBrandRules, undefined);
});

// ------------------------------------------------------------------ renderer

async function scenario(key) {
  const files = { a: ["916/a-base.webp", [["product_photo", "916/a-product.webp"]]], b: ["916/b-base.webp", []], c: ["916/c-base.webp", [["screenshot", "screenshot-desktop-presentes.png"]]] }[key];
  const { plan, context } = JSON.parse(await readFile(join(FX, `916/${key}-plan.json`), "utf8"));
  const assets = [
    ...(await Promise.all(files[1].map(async ([role, file]) => ({ role, url: `fixture://${file}`, buffer: await readFile(join(FX, file)) })))),
    { role: "logo", url: "fixture://logo.png", buffer: await readFile(join(FX, "logo-rumo-ao-altar.png")) },
  ];
  return { base: await readFile(join(FX, files[0])), plan, context, assets };
}

test("renderer: perfis diferentes mudam a linguagem visual mas NUNCA textos, produto, screenshot, preço ou geometria válida", async () => {
  for (const key of ["a", "b", "c"]) {
    const fx = await scenario(key);
    const plain = await renderEditorialCreative({ baseImageBuffer: fx.base, context: fx.context, plan: fx.plan, assets: fx.assets });
    for (const profile of ["P1", "P2", "P3"]) {
      const brand = creativeBrand(committed(profile));
      const branded = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: brand }, plan: fx.plan, assets: fx.assets });
      const label = `${key}/${profile}`;
      assert.equal(branded.geometry.valid, true, `${label}: ${JSON.stringify(branded.geometry.issues)}`);
      assert.deepEqual(branded.renderedTextZones.map((zone) => zone.text.toLocaleLowerCase("pt-BR")).sort(), plain.renderedTextZones.map((zone) => zone.text.toLocaleLowerCase("pt-BR")).sort(), `${label}: textos autorizados idênticos (só caixa pode mudar)`);
      assert.ok(branded.assetVerification.every((item) => item.visible && item.fidelityPass), `${label}: ${JSON.stringify(branded.assetVerification)}`);
      assert.equal(branded.buffer.equals(plain.buffer), false, `${label}: a marca precisa mudar a peça`);
      assert.ok((branded.composition?.brandRules ?? []).length > 0, `${label}: regras de marca registradas`);
    }
  }
});

test("renderer: cor PROIBIDA nunca vira destaque nem superfície — nem quando vem da própria UI do screenshot", async () => {
  const fx = await scenario("c");
  // O acento da UI real do screenshot é #B66B77; a marca proíbe exatamente esse rosa e não define destaque.
  const validated = validateBrandIdentityInput({ colors: [{ hex: "#B66B77", role: "FORBIDDEN", name: "rosa" }] });
  assert.ok(validated.ok);
  const identity = commitBrandIdentity(validated.identity, undefined, NOW);
  const plain = await renderEditorialCreative({ baseImageBuffer: fx.base, context: fx.context, plan: fx.plan, assets: fx.assets });
  assert.equal(plain.composition.screenshot.palette.accent.toUpperCase(), "#B66B77");
  const result = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: creativeBrand(identity) }, plan: fx.plan, assets: fx.assets });
  assert.equal(result.geometry.valid, true);
  const guards = result.composition.brandRules.filter((rule) => rule.code === "FORBIDDEN_COLOR_GUARD");
  assert.ok(guards.length >= 1, JSON.stringify(result.composition.brandRules));
  assert.ok(result.assetVerification.every((item) => item.fidelityPass), "screenshot real nunca é recolorido");
});

test("renderer: escolhe a versão FORNECIDA da logo pelo fundo real e prova em pixel a versão usada", async () => {
  const fx = await scenario("c");
  const dark = await readFile(join(FX, "brand/lumen-logo-dark.png"));
  const light = await readFile(join(FX, "brand/lumen-logo-light.png"));
  const identity = commitBrandIdentity(validateBrandIdentityInput({ colors: [{ hex: "#2B4C7E", role: "PRIMARY" }], logos: [{ assetId: "lumen-dark", variant: "DARK", backgrounds: ["LIGHT"] }, { assetId: "lumen-light", variant: "LIGHT", backgrounds: ["DARK", "PHOTO"] }] }).identity, undefined, NOW);
  const brand = creativeBrand(identity, [{ ...identity.logos[0], url: "fixture://lumen-dark.png" }, { ...identity.logos[1], url: "fixture://lumen-light.png" }]);
  const assets = [
    ...fx.assets.filter((asset) => asset.role !== "logo"),
    { role: "logo", url: "fixture://lumen-dark.png", buffer: dark, brandLogo: { assetId: "lumen-dark", variant: "DARK", backgrounds: ["LIGHT"], priority: 1 } },
    { role: "logo", url: "fixture://lumen-light.png", buffer: light, brandLogo: { assetId: "lumen-light", variant: "LIGHT", backgrounds: ["DARK", "PHOTO"], priority: 2 } },
  ];
  const onLight = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: brand }, plan: fx.plan, assets });
  assert.equal(onLight.composition.logoTreatment, "BRAND_LOGO_VARIANT");
  assert.deepEqual(onLight.composition.brandLogo, { assetId: "lumen-dark", variant: "DARK", surface: "light" });
  assert.ok(onLight.assetVerification.find((item) => item.role === "logo").fidelityPass);
  const onDark = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: brand }, plan: fx.plan, assets, qaVariantOption: "dark", qaVariantOverride: "FLOATING_PRODUCT" });
  assert.deepEqual(onDark.composition.brandLogo, { assetId: "lumen-light", variant: "LIGHT", surface: "dark" });
  assert.ok(onDark.assetVerification.find((item) => item.role === "logo").fidelityPass, JSON.stringify(onDark.assetVerification));
  assert.equal(onDark.geometry.valid, true, JSON.stringify(onDark.geometry.issues));
});

test("renderer: sem fundos escuros transforma o OVERLAY escuro em HERO claro; intensidade comercial baixa reduz o preço sem removê-lo", async () => {
  const fx = await scenario("a");
  const p3 = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: creativeBrand(committed("P3")) }, plan: fx.plan, assets: fx.assets });
  assert.equal(p3.composition.variant, "HERO_DOMINANT");
  assert.equal(p3.composition.pageTone, "light");
  const plain = await renderEditorialCreative({ baseImageBuffer: fx.base, context: fx.context, plan: fx.plan, assets: fx.assets });
  const p1 = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, brandIdentity: creativeBrand(committed("P1")) }, plan: fx.plan, assets: fx.assets });
  const price = (result) => result.renderedGeometry.textBoxes.find((box) => box.id === "price");
  assert.ok(price(p1).fontSizePx < price(plain).fontSizePx, `${price(p1).fontSizePx} < ${price(plain).fontSizePx}`);
  assert.ok(p1.renderedTextZones.some((zone) => zone.text === "R$ 149,00"), "preço confirmado continua presente");
});

// ------------------------------------------------------------------ helpers

function contextInput(overrides) {
  return { workspaceId: "workspace-a", brandName: "Marca", objective: "Divulgar", channel: "instagram", format: "4:5", ideaText: "", assets: [], ...overrides };
}

function baseContext(overrides = {}) {
  return { brandName: "Rumo ao Altar", objective: "Divulgar", channel: "instagram", format: "4:5", ideaText: "", assets: [], confirmedFacts: ["Preço atual: R$ 149,00"], ...overrides };
}

function basePlan() {
  return {
    objective: "o", angle: "a", targetAudience: "t", title: "Comprar agora", description: "d", headline: "Sem Correria", subheadline: "Presentes", cta: "Comprar agora",
    visualDirection: "cena", compositionIntent: "c", assetUsage: {}, assetPlacements: [], textZones: [], allowedRenderedTexts: ["Sem Correria", "Comprar agora"], requiredRenderedFacts: [],
    requiredElements: [], forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "", layoutPlan: [],
    artDirection: { concept: "", visualFocus: "", atmosphere: "", backgroundTreatment: "", chromaticDirection: "", contrastStrategy: "", elementHierarchy: [], primaryMassPct: 50 },
  };
}

test("buildCreativeContext: com identidade, a paleta oficial (diretor/base/gate) vem dela, sem as proibidas; sem identidade, o legado", async () => {
  const brand = creativeBrand(committed("P1"));
  const legacy = { resolveBrandProfile: async () => ({ brandColors: ["#FF69B4", "#FFFFFF"] }) };
  const withBrand = await buildCreativeContext({ ...legacy, resolveBrandIdentity: async () => ({ brand, skipped: [] }) }, contextInput({}));
  assert.deepEqual(withBrand.brandColors, ["#6E2433", "#A8834B", "#F4EDE3", "#24191A"]);
  assert.ok(!withBrand.brandColors.includes("#E10600"));
  const without = await buildCreativeContext({ ...legacy, resolveBrandIdentity: async () => undefined }, contextInput({}));
  assert.deepEqual(without.brandColors, ["#FF69B4", "#FFFFFF"]);
});

test("renderer: variante legada (colagem) também veste a marca — superfícies, destaque, logo; sem marca, idêntica", async () => {
  const fx = await scenario("b");
  const collageBase = await readFile(join(FX, "scenario-b-openai-base.webp"));
  const plain = await renderEditorialCreative({ baseImageBuffer: collageBase, context: fx.context, plan: fx.plan, assets: fx.assets });
  assert.equal(plain.composition.variant, "COLLAGE_EDITORIAL");
  for (const profile of ["P1", "P3"]) {
    const branded = await renderEditorialCreative({ baseImageBuffer: collageBase, context: { ...fx.context, brandIdentity: creativeBrand(committed(profile)) }, plan: fx.plan, assets: fx.assets });
    assert.equal(branded.composition.variant, "COLLAGE_EDITORIAL");
    assert.equal(branded.geometry.valid, true, JSON.stringify(branded.geometry.issues));
    assert.ok(branded.composition.brandRules.some((rule) => rule.code === "BRAND_SURFACES"), JSON.stringify(branded.composition.brandRules));
    assert.ok(!branded.composition.brandRules.some((rule) => rule.code === "BRAND_SKIN_PARTIAL"));
    assert.ok(branded.assetVerification.every((item) => item.fidelityPass));
    assert.equal(branded.buffer.equals(plain.buffer), false);
  }
});
