import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import {
  assertEditorialRuntimeFontAvailable,
  buildEditorialFontFaceCss,
  checkEditorialSafeArea,
  detectImageMime,
  measureCompositedAssetFidelity,
  PRODUCT_OFFER_MAX_EMPTY_BAND,
  PRODUCT_OFFER_MIN_PROMINENCE,
  productShadowExtent,
  selectProductOfferVariant,
  renderEditorialCreative,
} from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

// Mesma classe de asset que falhou no Smoke A (cer-runtime-muyx4qzs-hoinur): foto JPEG real.
const REAL_PRODUCT_JPEG = await readFile(new URL("./fixtures/editorial/product-ring-reminder.jpg", import.meta.url));
const REAL_LOGO_PNG = await readFile(new URL("./fixtures/editorial/logo-rumo-ao-altar.png", import.meta.url));
// Arte final publicada pelo Smoke A — frame do produto vazio (JPEG rotulado como PNG).
const SMOKE_A_EMPTY_FRAME_FINAL = await readFile(new URL("./fixtures/editorial/smoke-a-ea98e88-final-empty-frame.jpg", import.meta.url));
const SMOKE_A_PRODUCT_RECT = { xPct: 46.289, yPct: 6.719, widthPct: 51.758, heightPct: 61.719 };

async function image(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

/** Produto sintético COM conteúdo (formas/cores) — cor sólida agora é rejeitada como asset vazio. */
async function productImage(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#F3E2CF"/><rect x="${width * 0.2}" y="${height * 0.12}" width="${width * 0.6}" height="${height * 0.76}" rx="40" fill="#E8C785" stroke="#94324D" stroke-width="24"/><circle cx="${width / 2}" cy="${height * 0.38}" r="${width * 0.16}" fill="#94324D"/><rect x="${width * 0.3}" y="${height * 0.62}" width="${width * 0.4}" height="${height * 0.08}" rx="16" fill="#231418"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function screenshotImage(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#FFFFFF"/><rect width="${width}" height="${height * 0.14}" fill="#8B2F48"/><rect x="${width * 0.08}" y="${height * 0.22}" width="${width * 0.84}" height="${height * 0.2}" rx="24" fill="#F0DDC8"/><rect x="${width * 0.08}" y="${height * 0.48}" width="${width * 0.6}" height="${height * 0.05}" rx="12" fill="#24171A"/><rect x="${width * 0.08}" y="${height * 0.58}" width="${width * 0.84}" height="${height * 0.24}" rx="24" fill="#E8C785"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Fundo neutro controlado (no lugar da base da IA). */
async function studioBase(width = 1024, height = 1280) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><radialGradient id="g" cx="0.7" cy="0.3" r="0.9"><stop offset="0" stop-color="#FBF1E6"/><stop offset="1" stop-color="#CFB39C"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

function productOfferInput(overrides = {}) {
  return {
    baseImageBuffer: overrides.baseImageBuffer,
    context: context({ brandName: "Rumo ao Altar", confirmedFacts: [overrides.fact ?? "Preço atual: R$ 149,00 BRL"] }),
    plan: plan({
      headline: "Kit Noivos Sem Correria",
      subheadline: "Organize presentes, lista de presentes e RSVP em um só lugar.",
      cta: "Comprar agora",
      allowedRenderedTexts: ["Kit Noivos Sem Correria", "Organize presentes, lista de presentes e RSVP em um só lugar.", "Comprar agora"],
      requiredElements: ["headline", "subheadline", "cta", "logo", "price"],
      ...overrides.plan,
    }),
    assets: overrides.assets ?? [
      { role: "product_photo", url: "fixture://product-ring-reminder.jpg", buffer: REAL_PRODUCT_JPEG },
      { role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: REAL_LOGO_PNG },
    ],
  };
}

async function renderProductOffer(overrides = {}) {
  return renderEditorialCreative(productOfferInput({ ...overrides, baseImageBuffer: overrides.baseImageBuffer ?? await studioBase() }));
}

function verificationFor(result, role) {
  return result.assetVerification.find((item) => item.role === role);
}

function box(result, id) {
  return [...result.renderedGeometry.textBoxes, ...result.renderedGeometry.assetBoxes].find((item) => item.id === id);
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
  const product = await productImage(640, 760);
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
  const product = await productImage(640, 760);

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
  const screenshot = await screenshotImage(720, 1280);
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
  // Logo claro sobre o painel vinho — um logo vinho ali seria (corretamente) reprovado como
  // invisível pela verificação de pixel.
  const logo = await image(420, 120, "#F8E6D8");

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

// ---------------------------------------------------------------------------------------------
// Bloqueador 1 do Smoke A — MIME do asset. dataUri() rotulava todo buffer como image/png; o
// rasterizador descartava o JPEG real em silêncio e deixava o frame do produto vazio.
// ---------------------------------------------------------------------------------------------

test("detectImageMime: identifica PNG, JPEG, WEBP e SVG pelo conteúdo, nunca pela extensão", async () => {
  const png = await productImage(40, 40);
  const webp = await sharp(REAL_PRODUCT_JPEG).webp().toBuffer();
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(REAL_PRODUCT_JPEG), "image/jpeg");
  assert.equal(detectImageMime(webp), "image/webp");
  assert.equal(detectImageMime(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
  assert.equal(detectImageMime(Buffer.from("not an image at all")), undefined);
  assert.equal(detectImageMime(Buffer.alloc(0)), undefined);
});

test("renderEditorialCreative: foto JPEG real do produto aparece nos pixels da arte final", async () => {
  const result = await renderProductOffer();
  const product = verificationFor(result, "product_photo");

  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.equal(product.detectedMime, "image/jpeg");
  assert.equal(product.visible, true, JSON.stringify(product));
  assert.ok(product.assetMatchRatio >= 0.95, `match ${product.assetMatchRatio}`);
  assert.equal(product.fidelityPass, true, `fidelidade ${product.fidelityMeanAbsDiff}`);
  assert.equal(verificationFor(result, "logo").visible, true, JSON.stringify(verificationFor(result, "logo")));
});

test("renderEditorialCreative: a mesma foto em PNG e em WEBP também aparece", async () => {
  const variants = [
    ["image/png", await sharp(REAL_PRODUCT_JPEG).png().toBuffer()],
    ["image/webp", await sharp(REAL_PRODUCT_JPEG).webp({ quality: 90 }).toBuffer()],
  ];
  for (const [mime, buffer] of variants) {
    const result = await renderProductOffer({ assets: [{ role: "product_photo", url: `fixture://product.${mime.split("/")[1]}`, buffer }] });
    const product = verificationFor(result, "product_photo");
    assert.equal(product.detectedMime, mime);
    assert.equal(product.visible, true, `${mime}: ${JSON.stringify(product)}`);
    assert.equal(result.geometry.valid, true, `${mime}: ${JSON.stringify(result.geometry.issues)}`);
  }
});

test("renderEditorialCreative: asset de produto indecodificável falha fechado (PRODUCT_ASSET_DECODE_FAILED), nunca frame vazio", async () => {
  const base = await studioBase();
  for (const buffer of [Buffer.from("isto não é uma imagem"), REAL_PRODUCT_JPEG.subarray(0, 600)]) {
    await assert.rejects(
      renderProductOffer({ baseImageBuffer: base, assets: [{ role: "product_photo", url: "fixture://broken.jpg", buffer }] }),
      (error) => error.code === "PRODUCT_ASSET_DECODE_FAILED",
    );
  }
});

test("renderEditorialCreative: logo indecodificável falha fechado (EDITORIAL_ASSET_DECODE_FAILED)", async () => {
  const brokenPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("quebrado")]);
  await assert.rejects(
    renderProductOffer({ assets: [{ role: "product_photo", url: "fixture://product.jpg", buffer: REAL_PRODUCT_JPEG }, { role: "logo", url: "fixture://logo.png", buffer: brokenPng }] }),
    (error) => error.code === "EDITORIAL_ASSET_DECODE_FAILED",
  );
});

test("renderEditorialCreative: asset de produto transparente ou de cor única é rejeitado (PRODUCT_ASSET_EMPTY)", async () => {
  const transparent = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const flat = await image(400, 400, "#E8C785");
  for (const buffer of [transparent, flat]) {
    await assert.rejects(
      renderProductOffer({ assets: [{ role: "product_photo", url: "fixture://empty.png", buffer }] }),
      (error) => error.code === "PRODUCT_ASSET_EMPTY",
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Bloqueador 4 — o gate confiava na bbox declarada. Agora existe prova em pixel.
// ---------------------------------------------------------------------------------------------

test("measureCompositedAssetFidelity: o frame vazio publicado pelo Smoke A é detectado como produto ausente", async () => {
  const audit = await measureCompositedAssetFidelity({
    finalImage: SMOKE_A_EMPTY_FRAME_FINAL,
    rect: SMOKE_A_PRODUCT_RECT,
    asset: { role: "product_photo", url: "fixture://product-ring-reminder.jpg", buffer: REAL_PRODUCT_JPEG },
  });
  assert.equal(audit.fidelityPass, false, `diferença média ${audit.fidelityMeanAbsDiff}`);
  assert.ok(audit.fidelityMeanAbsDiff > 40, `diferença média ${audit.fidelityMeanAbsDiff}`);
});

test("measureCompositedAssetFidelity: a mesma foto composta pelo renderer corrigido é comprovada", async () => {
  const result = await renderProductOffer();
  const audit = await measureCompositedAssetFidelity({
    finalImage: result.buffer,
    rect: box(result, "product_photo").rect,
    asset: { role: "product_photo", url: "fixture://product-ring-reminder.jpg", buffer: REAL_PRODUCT_JPEG },
  });
  assert.equal(audit.fidelityPass, true, `diferença média ${audit.fidelityMeanAbsDiff}`);
});

test("measureCompositedAssetFidelity: produto parcialmente coberto pelo fundo reprova", async () => {
  const result = await renderProductOffer();
  const rect = box(result, "product_photo").rect;
  const meta = await sharp(result.buffer).metadata();
  const left = Math.round((rect.xPct / 100) * meta.width);
  const top = Math.round((rect.yPct / 100) * meta.height);
  const width = Math.round((rect.widthPct / 100) * meta.width);
  const height = Math.round((rect.heightPct / 100) * meta.height);
  const cover = await sharp({ create: { width, height: Math.round(height * 0.6), channels: 3, background: "#F6EDE4" } }).png().toBuffer();
  const partial = await sharp(result.buffer).composite([{ input: cover, left, top }]).jpeg().toBuffer();
  const audit = await measureCompositedAssetFidelity({ finalImage: partial, rect, asset: { role: "product_photo", url: "fixture://p.jpg", buffer: REAL_PRODUCT_JPEG } });
  assert.equal(audit.fidelityPass, false, `diferença média ${audit.fidelityMeanAbsDiff}`);
});

// ---------------------------------------------------------------------------------------------
// Bloqueador 3 — CRITICAL_ASSET_CROP estrutural. O frame 4:5 terminava em ~98,05% da largura.
// ---------------------------------------------------------------------------------------------

test("renderEditorialCreative: product frame 4:5 respeita a safe area de 2% e a sombra cabe no canvas", async () => {
  for (const baseImageBuffer of [await studioBase(1024, 1280), await studioBase(1080, 1350)]) {
    const result = await renderProductOffer({ baseImageBuffer });
    const rect = box(result, "product_photo").rect;
    assert.ok(rect.xPct >= 2 && rect.yPct >= 2, JSON.stringify(rect));
    assert.ok(rect.xPct + rect.widthPct <= 98, `borda direita ${rect.xPct + rect.widthPct}%`);
    assert.ok(rect.yPct + rect.heightPct <= 98, `borda inferior ${rect.yPct + rect.heightPct}%`);
    const shadow = productShadowExtent({ x: (rect.xPct / 100) * 1080, y: (rect.yPct / 100) * 1350, width: (rect.widthPct / 100) * 1080, height: (rect.heightPct / 100) * 1350 });
    assert.ok(shadow.x >= 0 && shadow.y >= 0 && shadow.x + shadow.width <= 1080 && shadow.y + shadow.height <= 1350, JSON.stringify(shadow));
    assert.ok(!result.geometry.issues.some((issue) => issue.code === "SAFE_AREA_VIOLATION"), JSON.stringify(result.geometry.issues));
  }
});

test("checkEditorialSafeArea: produto perto da margem mas dentro passa; produto que invade a margem reprova", () => {
  const canvas = { width: 1080, height: 1350, format: "4:5" };
  const near = [{ id: "product_photo", kind: "asset", role: "product_photo", rect: { xPct: 46, yPct: 6, widthPct: 51.9, heightPct: 60 } }];
  const invading = [{ id: "product_photo", kind: "asset", role: "product_photo", rect: { xPct: 46.289, yPct: 6.719, widthPct: 51.758, heightPct: 61.719 } }];
  assert.deepEqual(checkEditorialSafeArea(near, canvas, "premium_institutional"), []);
  assert.ok(checkEditorialSafeArea(invading, canvas, "product_offer").some((issue) => issue.code === "SAFE_AREA_VIOLATION"));
});

test("renderEditorialCreative: canvas de saída 1024x1280 (base real do Smoke A) não deixa componentes vazarem a borda", async () => {
  const result = await renderProductOffer({ baseImageBuffer: await studioBase(1024, 1280) });
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1280);
  assert.ok(!result.geometry.issues.some((issue) => issue.code === "COMPONENT_OVERFLOW"), JSON.stringify(result.geometry.issues));
});

// ---------------------------------------------------------------------------------------------
// Bloqueador 2 — subheadline exigida pelo plano não chegava ao renderer.
// ---------------------------------------------------------------------------------------------

test("renderEditorialCreative: headline + subheadline são ambas desenhadas e registradas na geometria final", async () => {
  const result = await renderProductOffer();
  assert.ok(result.renderedTextZones.some((zone) => zone.kind === "subheadline" && zone.text === "Organize presentes, lista de presentes e RSVP em um só lugar."));
  assert.ok(box(result, "headline"));
  assert.ok(box(result, "subheadline"), "subheadline precisa existir na geometria final renderizada");
});

test("renderEditorialCreative: headline sem subheadline opcional é válido", async () => {
  const result = await renderProductOffer({ plan: { subheadline: undefined, requiredElements: ["headline", "cta", "price"], allowedRenderedTexts: ["Kit Noivos Sem Correria", "Comprar agora"] } });
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.equal(box(result, "subheadline"), undefined);
});

test("renderEditorialCreative: subheadline exigida sem texto rejeita antes de rasterizar (EDITORIAL_REQUIRED_TEXT_MISSING)", async () => {
  await assert.rejects(
    renderProductOffer({ plan: { subheadline: undefined, requiredElements: ["headline", "subheadline", "cta"] } }),
    (error) => error.code === "EDITORIAL_REQUIRED_TEXT_MISSING" && /subheadline/.test(error.message),
  );
});

test("renderEditorialCreative: preço exigido sem fato confirmado rejeita antes de rasterizar", async () => {
  await assert.rejects(
    renderEditorialCreative({ ...productOfferInput({ fact: "Sem preço" }), baseImageBuffer: await studioBase() }),
    (error) => error.code === "EDITORIAL_REQUIRED_TEXT_MISSING" && /price/.test(error.message),
  );
});

test("renderEditorialCreative: texto longo adapta o layout sem overflow; texto impossível falha fechado", async () => {
  const long = await renderProductOffer({
    plan: {
      headline: "Kit Noivos Sem Correria Para Celebrar Cada Detalhe",
      subheadline: "Uma oferta direta para tirar a organização do casamento do improviso.",
    },
    fact: "Preço atual: R$ 12.499,90",
  });
  assert.equal(long.geometry.valid, true, JSON.stringify(long.geometry.issues));
  assert.ok(box(long, "headline").fontSizePx < 80, "headline longa deveria reduzir a fonte");
  assert.ok(box(long, "headline").rect.yPct + box(long, "headline").rect.heightPct <= box(long, "subheadline").rect.yPct);

  const impossible = await renderProductOffer({ plan: { headline: "Palavra ".repeat(40).trim() } });
  assert.ok(impossible.geometry.issues.some((issue) => issue.code === "TEXT_OVERFLOW"));
  assert.equal(impossible.geometry.valid, false);
});

// ---------------------------------------------------------------------------------------------
// Regressão — geometria final renderizada continua sendo a fonte de verdade.
// ---------------------------------------------------------------------------------------------

test("renderEditorialCreative: manifesto final_rendered_geometry tem produto, headline, subheadline, preço, CTA e logo sem colisão", async () => {
  const result = await renderProductOffer();
  assert.equal(result.renderedGeometry.source, "final_rendered_geometry");
  for (const id of ["product_photo", "headline", "subheadline", "price", "cta", "logo"]) {
    assert.ok(box(result, id), `caixa ${id} ausente`);
  }
  assert.ok(!result.geometry.issues.some((issue) => issue.code === "COLLISION"), JSON.stringify(result.geometry.issues));
  const headlineZone = result.renderedTextZones.find((zone) => zone.kind === "headline");
  assert.deepEqual(headlineZone.rect, box(result, "headline").rect, "zona entregue ao gate deve ser a mesma bbox renderizada");
});

// ---------------------------------------------------------------------------------------------
// product_offer 4:5 — compositor adaptativo (HERO_DOMINANT / SPLIT_EDITORIAL / OVERLAY_EDITORIAL).
// ---------------------------------------------------------------------------------------------

function adaptivePlan(overrides = {}) {
  const headline = overrides.headline ?? "Kit Noivos Sem Correria";
  const subheadline = Object.prototype.hasOwnProperty.call(overrides, "subheadline") ? overrides.subheadline : "Organize presentes, lista de presentes e RSVP em um só lugar.";
  const cta = overrides.cta ?? "Comprar agora";
  return plan({
    headline,
    subheadline,
    cta,
    allowedRenderedTexts: [headline, subheadline, cta].filter(Boolean),
    requiredElements: ["headline", "cta", "price", ...(subheadline ? ["subheadline"] : [])],
    visualDensity: overrides.visualDensity ?? "balanced",
    artDirection: { ...plan().artDirection, primaryMassPct: overrides.primaryMassPct ?? 50 },
  });
}

async function renderAdaptive(overrides = {}) {
  return renderEditorialCreative({
    baseImageBuffer: overrides.baseImageBuffer ?? await studioBase(),
    context: context({ brandName: "Rumo ao Altar", confirmedFacts: [`Preço atual: ${overrides.price ?? "R$ 149,00"}`] }),
    plan: adaptivePlan(overrides),
    assets: [
      { role: "product_photo", url: "fixture://product.jpg", buffer: overrides.product ?? REAL_PRODUCT_JPEG },
      { role: "logo", url: "fixture://logo.png", buffer: overrides.logo ?? REAL_LOGO_PNG },
    ],
  });
}

async function darkBase() {
  return sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#1C110E" } }).jpeg().toBuffer();
}

function assertAdaptiveTechnicalPass(result, label) {
  assert.equal(result.geometry.valid, true, `${label}: ${JSON.stringify(result.geometry.issues)}`);
  for (const role of ["product_photo", "logo"]) {
    const verification = result.assetVerification.find((item) => item.role === role);
    assert.equal(verification?.visible, true, `${label}: ${role} ${JSON.stringify(verification)}`);
    assert.equal(verification?.fidelityPass, true, `${label}: ${role} fidelidade`);
  }
  assert.equal(result.renderedGeometry.source, "final_rendered_geometry");
  for (const id of ["product_photo", "logo", "headline", "price", "cta"]) assert.ok(box(result, id), `${label}: caixa ${id}`);
  assert.ok(result.composition.productVisualProminence >= PRODUCT_OFFER_MIN_PROMINENCE, `${label}: proeminência ${result.composition.productVisualProminence}`);
  assert.ok(result.composition.largestEmptyBandPct <= PRODUCT_OFFER_MAX_EMPTY_BAND, `${label}: faixa vazia ${result.composition.largestEmptyBandPct}`);
}

test("selectProductOfferVariant: regras determinísticas por sinais do plano e do conteúdo", () => {
  const base = { productAspect: 1, productComplexity: 60, productIsCutout: false, headlineChars: 23, subheadlineChars: 60, priceChars: 9, hasCta: true, primaryMassPct: 50, visualDensity: "balanced" };
  assert.equal(selectProductOfferVariant({ ...base, primaryMassPct: 65 }).variant, "HERO_DOMINANT");
  assert.equal(selectProductOfferVariant({ ...base, primaryMassPct: 65, headlineChars: 50 }).variant, "HERO_DOMINANT");
  assert.equal(selectProductOfferVariant({ ...base, visualDensity: "clean", headlineChars: 12 }).variant, "OVERLAY_EDITORIAL");
  assert.equal(selectProductOfferVariant({ ...base, visualDensity: "clean", headlineChars: 12, productIsCutout: true }).variant, "SPLIT_EDITORIAL", "recorte transparente não vira overlay de cena");
  assert.equal(selectProductOfferVariant({ ...base, priceChars: 12 }).variant, "SPLIT_EDITORIAL");
  assert.equal(selectProductOfferVariant({ ...base, productAspect: 1.4 }).variant, "HERO_DOMINANT");
  assert.equal(selectProductOfferVariant(base).variant, "SPLIT_EDITORIAL");
  assert.deepEqual(selectProductOfferVariant(base), selectProductOfferVariant({ ...base }), "mesmo input → mesma escolha");
  assert.ok(selectProductOfferVariant(base).reasons.length > 0);
});

test("product_offer adaptativo: as três variantes passam tecnicamente com a foto JPEG real", async () => {
  const cases = [
    ["HERO_DOMINANT", { primaryMassPct: 65, headline: "Sem Correria" }],
    ["SPLIT_EDITORIAL", {}],
    ["OVERLAY_EDITORIAL", { visualDensity: "clean", headline: "Sem Correria" }],
  ];
  for (const [variant, overrides] of cases) {
    const result = await renderAdaptive(overrides);
    assert.equal(result.composition.variant, variant);
    assertAdaptiveTechnicalPass(result, variant);
  }
});

test("product_offer adaptativo: tratamento de preço é adaptativo (inline vs rodapé comercial)", async () => {
  assert.equal((await renderAdaptive()).composition.priceTreatment, "INLINE_PRICE");
  assert.equal((await renderAdaptive({ price: "R$ 12.499,90", headline: "Kit Noivos Premium" })).composition.priceTreatment, "COMMERCIAL_FOOTER");
  assert.equal((await renderAdaptive({ visualDensity: "clean", headline: "Sem Correria" })).composition.priceTreatment, "INLINE_PRICE");
});

test("product_offer adaptativo: preços largos (R$ 12.499,90 e R$ 129.999,90) cabem em todas as variantes", async () => {
  for (const price of ["R$ 12.499,90", "R$ 129.999,90"]) {
    for (const overrides of [{ primaryMassPct: 65 }, { headline: "Kit Noivos Premium" }, { visualDensity: "clean", headline: "Sem Correria" }]) {
      const result = await renderAdaptive({ ...overrides, price });
      assertAdaptiveTechnicalPass(result, `${price} ${result.composition.variant}`);
      assert.ok(result.renderedTextZones.some((zone) => zone.kind === "price" && zone.text === price));
    }
  }
});

test("product_offer adaptativo: headline longa não comprime o produto nem empurra preço/CTA para fora", async () => {
  const result = await renderAdaptive({ primaryMassPct: 65, headline: "Kit Noivos Sem Correria Para Celebrar Cada Detalhe", subheadline: "Uma oferta direta para tirar a organização do casamento do improviso." });
  assertAdaptiveTechnicalPass(result, "hero longa");
  assert.ok(result.composition.productVisualProminence >= 0.3, `proeminência ${result.composition.productVisualProminence}`);
  assert.ok(box(result, "headline").lineCount <= 3);
});

test("product_offer adaptativo: logo com caixa branca — multiply no claro (sem caixa visível) e chip só no escuro, pixel fiel nos dois", async () => {
  const light = await renderAdaptive();
  assert.equal(light.composition.logoTreatment, "MULTIPLY_ON_LIGHT");
  assertAdaptiveTechnicalPass(light, "logo claro");
  const dark = await renderAdaptive({ baseImageBuffer: await darkBase() });
  assert.equal(dark.composition.pageTone, "dark");
  assert.equal(dark.composition.logoTreatment, "CHIP");
  assertAdaptiveTechnicalPass(dark, "logo escuro");
});

test("product_offer adaptativo: produto vertical/horizontal e logo compacta não quebram a composição", async () => {
  const vertical = await sharp(REAL_PRODUCT_JPEG).extract({ left: 130, top: 0, width: 540, height: 800 }).jpeg().toBuffer();
  const horizontal = await sharp(REAL_PRODUCT_JPEG).extract({ left: 0, top: 120, width: 800, height: 540 }).jpeg().toBuffer();
  const squareLogo = await sharp(REAL_LOGO_PNG).extract({ left: 0, top: 0, width: 50, height: 50 }).png().toBuffer();
  for (const [label, overrides] of [["vertical", { product: vertical }], ["horizontal", { product: horizontal }], ["logo quadrada hero", { logo: squareLogo, primaryMassPct: 65 }], ["logo quadrada overlay", { logo: squareLogo, visualDensity: "clean", headline: "Sem Correria" }]]) {
    assertAdaptiveTechnicalPass(await renderAdaptive(overrides), label);
  }
});

test("product_offer adaptativo: mesmo input produz exatamente a mesma peça", async () => {
  const base = await studioBase();
  const first = await renderAdaptive({ baseImageBuffer: base, visualDensity: "clean", headline: "Sem Correria" });
  const second = await renderAdaptive({ baseImageBuffer: base, visualDensity: "clean", headline: "Sem Correria" });
  assert.deepEqual(first.composition, second.composition);
  assert.equal(first.buffer.equals(second.buffer), true);
});

test("product_offer 9:16 continua no layout anterior (fora do escopo desta rodada)", async () => {
  const result = await renderEditorialCreative({ ...productOfferInput(), context: context({ format: "9:16", confirmedFacts: ["Preço atual: R$ 149,00"] }), baseImageBuffer: await studioBase(1080, 1920) });
  assert.equal(result.composition, undefined);
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
});
