import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assertEditorialRuntimeFontAvailable, buildEditorialFontFaceCss, renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

async function image(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

function plan(overrides = {}) {
  return {
    objective: "Criar uma arte comercial",
    angle: "Oferta clara com acabamento premium",
    targetAudience: "Casais organizando casamento",
    title: "Oferta editorial",
    description: "Arte experimental",
    headline: "Kit Noivos Sem Correria",
    subheadline: "Lista, presentes e RSVP em um unico lugar.",
    cta: "Saiba mais",
    visualDirection: "Fotografia elegante com composicao editorial",
    compositionIntent: "Produto e oferta com hierarquia clara",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: ["Kit Noivos Sem Correria", "Lista, presentes e RSVP em um unico lugar.", "Saiba mais"],
    requiredElements: ["headline", "cta"],
    forbiddenElements: ["CAPTURA QA REAL"],
    visualDensity: "balanced",
    styleNotes: "premium, limpo",
    rationale: "Valor comercial direto",
    artDirection: {
      concept: "Produto real preservado em area fotografica com bloco editorial proprio",
      visualFocus: "Produto em destaque e texto em area de contraste controlado",
      elementHierarchy: ["produto", "headline", "preco", "cta", "logo"],
      primaryMassPct: 50,
      contrastStrategy: "Texto sobre area editorial consistente",
      chromaticDirection: "Tons quentes com acento da marca",
      atmosphere: "Comercial premium",
      backgroundTreatment: "Fotografia tratada",
      productTextRelationship: "Texto nunca atravessa o produto",
      avoidedCliches: ["card branco generico"],
      justifiedCliches: [],
    },
    layoutPlan: [],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    brandName: "Vorix QA",
    objective: "Validar compositor editorial",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte de teste",
    brandColors: ["#8B2F48", "#E8C785"],
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

test("renderEditorialCreative: produto/oferta preserva produto e usa somente preco confirmado", async () => {
  const baseImageBuffer = await image(1080, 1350, "#392229");
  const product = await image(640, 760, "#E8C785");
  const logo = await image(420, 120, "#8B2F48");

  const result = await renderEditorialCreative({
    baseImageBuffer,
    context: context({ confirmedFacts: ["Preco atual: R$ 149,00"] }),
    plan: plan({ textZones: [{ kind: "price", text: "R$ 999,00", rect: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer", backingStyle: "solid", align: "left" }] }),
    assets: [
      { role: "product_photo", url: "memory://product.png", buffer: product },
      { role: "logo", url: "memory://logo.png", buffer: logo },
    ],
  });

  const meta = await sharp(result.buffer).metadata();
  assert.equal(result.family, "product_offer");
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1350);
  assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "product_photo"]);
  assert.ok(result.renderedTextZones.some((zone) => zone.text === "R$ 149,00"));
  assert.ok(!result.renderedTextZones.some((zone) => zone.text === "R$ 999,00"));
});

test("renderEditorialCreative: fonte runtime bundled esta disponivel para acentos e R$", async () => {
  const font = await assertEditorialRuntimeFontAvailable();

  assert.equal(font.family, "GeistEditorial");
  assert.ok(font.bytes > 1000);
});

test("renderEditorialCreative: usa familia registrada no runtime sem embutir fonte data-uri no SVG", async () => {
  const css = await buildEditorialFontFaceCss();

  assert.match(css, /font-family:GeistEditorial/);
  assert.doesNotMatch(css, /data:font\/truetype/);
});

test("renderEditorialCreative: renderer aceita acentos, cedilha e R$ sem reprovar geometria", async () => {
  const baseImageBuffer = await image(1080, 1350, "#392229");
  const product = await image(640, 760, "#E8C785");

  const result = await renderEditorialCreative({
    baseImageBuffer,
    context: context({ confirmedFacts: ["Preco atual: R$ 149,00"] }),
    plan: plan({
      headline: "Preço e Promoção Você em Ação",
      subheadline: "Comprar agora com condição especial.",
      cta: "Comprar agora",
      allowedRenderedTexts: ["Preço e Promoção Você em Ação", "Comprar agora com condição especial.", "Comprar agora", "R$ 149,00"],
    }),
    assets: [{ role: "product_photo", url: "memory://product.png", buffer: product }],
  });

  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.ok(result.renderedTextZones.some((zone) => zone.text.includes("Promoção")));
  assert.ok(result.renderedTextZones.some((zone) => zone.text === "R$ 149,00"));
});

test("renderEditorialCreative: servico digital usa screenshot real no mockup 9:16 sem texto QA comercial", async () => {
  const baseImageBuffer = await image(1080, 1920, "#1B1A1F");
  const screenshot = await image(720, 1280, "#FFFFFF");
  const logo = await image(420, 120, "#8B2F48");

  const result = await renderEditorialCreative({
    baseImageBuffer,
    context: context({ format: "9:16", confirmedFacts: ["Preco atual: R$ 89,00"] }),
    plan: plan({ headline: "Seu RSVP organizado no celular", cta: "Ver planos" }),
    assets: [
      { role: "screenshot", url: "memory://screen.png", buffer: screenshot },
      { role: "logo", url: "memory://logo.png", buffer: logo },
    ],
  });

  const meta = await sharp(result.buffer).metadata();
  assert.equal(result.family, "digital_service");
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "screenshot"]);
  assert.ok(!result.renderedTextZones.some((zone) => /QA|CAPTURA/i.test(zone.text)));
});

test("renderEditorialCreative: institucional premium mantem headline dentro da coluna em 4:5", async () => {
  const baseImageBuffer = await image(1080, 1350, "#3A2230");
  const logo = await image(420, 120, "#8B2F48");

  const result = await renderEditorialCreative({
    baseImageBuffer,
    context: context(),
    plan: plan({
      headline: "Uma presenca de marca mais elegante para casamentos memoraveis",
      subheadline: "Direcao visual, consistencia e campanha com acabamento profissional.",
      cta: "Conheca",
    }),
    assets: [{ role: "logo", url: "memory://logo.png", buffer: logo }],
  });

  assert.equal(result.family, "premium_institutional");
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.ok(result.renderedTextZones.some((zone) => zone.kind === "headline"));
});
