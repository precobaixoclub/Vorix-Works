// Fixtures visuais do product_offer editorial (compositor adaptativo) — ZERO OpenAI. Usa a foto
// JPEG real do produto e a logo real dos smokes; o fundo é controlado localmente (no lugar da base
// da IA). A variante NUNCA é forçada: sai da seleção determinística (`selectProductOfferVariant`) a
// partir de sinais do plano (massa do produto, densidade) e do conteúdo (headline, subheadline,
// preço) — os casos abaixo variam esses sinais.
//
// Uso: node scripts/render-editorial-product-offer-fixtures.mjs [outDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outDir = process.argv[2] ?? "docs/creative-editorial-prototype/product-offer-fixtures";
await mkdir(join(outDir, "matrix"), { recursive: true });

const PRODUCT_JPEG = await readFile("tests/fixtures/editorial/product-ring-reminder.jpg");
const LOGO_PNG = await readFile("tests/fixtures/editorial/logo-rumo-ao-altar.png");
// Variações reais da MESMA foto/logo (nunca shapes sintéticos): recortes vertical/horizontal e o
// símbolo da logo como versão compacta.
const PRODUCT_VERTICAL = await sharp(PRODUCT_JPEG).extract({ left: 130, top: 0, width: 540, height: 800 }).jpeg({ quality: 92 }).toBuffer();
const PRODUCT_HORIZONTAL = await sharp(PRODUCT_JPEG).extract({ left: 0, top: 120, width: 800, height: 540 }).jpeg({ quality: 92 }).toBuffer();
const LOGO_SQUARE = await sharp(LOGO_PNG).extract({ left: 0, top: 0, width: 50, height: 50 }).png().toBuffer();

const W = 1024;
const H = 1280;

async function withGrain(svg, sigma = 9) {
  const noise = await sharp({ create: { width: W, height: H, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma } } }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: noise, blend: "soft-light" }]).jpeg({ quality: 92 }).toBuffer();
}

/** Fundos locais controlados: claro, escuro fotográfico, gradiente editorial e textura leve. */
const BACKGROUNDS = {
  light: () => withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.72" cy="0.28" r="0.9"><stop offset="0" stop-color="#FBF1E6"/><stop offset="0.6" stop-color="#EAD6C3"/><stop offset="1" stop-color="#CFB39C"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`),
  darkPhoto: () => withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.6" cy="0.35" r="0.85"><stop offset="0" stop-color="#4A2C24"/><stop offset="0.65" stop-color="#22130F"/><stop offset="1" stop-color="#0D0807"/></radialGradient><filter id="b"><feGaussianBlur stdDeviation="22"/></filter></defs><rect width="${W}" height="${H}" fill="url(#g)"/><g filter="url(#b)" opacity="0.7"><circle cx="210" cy="260" r="60" fill="#E8B76A"/><circle cx="820" cy="180" r="44" fill="#F2C987"/><circle cx="760" cy="980" r="70" fill="#C98A52"/><circle cx="160" cy="1040" r="38" fill="#F5D7A0"/></g></svg>`, 12),
  gradient: () => withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7E6DD"/><stop offset="0.55" stop-color="#EBC9C0"/><stop offset="1" stop-color="#C98F8A"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`, 6),
  texture: () => withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#EFE5D8"/>${Array.from({ length: 40 }, (_, i) => `<line x1="0" y1="${i * 34}" x2="${W}" y2="${i * 34 + 120}" stroke="#E2D3C1" stroke-width="10" opacity="0.5"/>`).join("")}</svg>`, 14),
};

function plan(overrides = {}) {
  const headline = overrides.headline ?? "Kit Noivos Sem Correria";
  const subheadline = overrides.subheadline ?? "Organize presentes, lista de presentes e RSVP em um só lugar.";
  const cta = overrides.cta ?? "Comprar agora";
  return {
    objective: "Validar product_offer adaptativo sem OpenAI",
    angle: "Oferta de produto real",
    targetAudience: "Casais organizando casamento",
    title: headline,
    description: "Fixture local determinístico",
    headline,
    subheadline,
    cta,
    visualDirection: "Produto real preservado em composição editorial",
    compositionIntent: "Produto protagonista com copy integrada",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: [headline, subheadline, cta].filter(Boolean),
    requiredRenderedFacts: [],
    requiredElements: ["headline", "cta", "logo", "price", ...(subheadline ? ["subheadline"] : [])],
    forbiddenElements: ["texto QA", "preco inventado", "cta inventado"],
    visualDensity: overrides.visualDensity ?? "balanced",
    styleNotes: "premium, comercial, integrado",
    rationale: "Teste local do renderer",
    artDirection: { primaryMassPct: overrides.primaryMassPct ?? 50 },
    layoutPlan: [],
  };
}

async function renderCase(file, options) {
  const result = await renderEditorialCreative({
    baseImageBuffer: await BACKGROUNDS[options.background ?? "light"](),
    context: {
      brandName: "Rumo ao Altar",
      objective: "Fixture local",
      channel: "instagram",
      format: "4:5",
      ideaText: "Fixture local sem OpenAI",
      assets: [],
      confirmedFacts: [`Preço atual: ${options.price ?? "R$ 149,00"}`],
    },
    plan: plan(options),
    assets: [
      { role: "product_photo", url: "fixture://product.jpg", buffer: options.product ?? PRODUCT_JPEG },
      { role: "logo", url: "fixture://logo.png", buffer: options.logo ?? LOGO_PNG },
    ],
  });
  const path = join(outDir, file);
  await writeFile(path, result.buffer);
  return {
    file: path,
    background: options.background ?? "light",
    composition: result.composition,
    geometryValid: result.geometry.valid,
    issues: result.geometry.issues,
    verification: result.assetVerification.map((item) => ({ role: item.role, visible: item.visible, fidelityPass: item.fidelityPass, fidelityMeanAbsDiff: item.fidelityMeanAbsDiff })),
    renderedGeometry: result.renderedGeometry,
  };
}

const MAIN = [
  ["01-hero-short.jpg", { headline: "Sem Correria", subheadline: "Presentes, lista e RSVP organizados em um só lugar.", primaryMassPct: 65, background: "light" }],
  ["02-hero-long.jpg", { headline: "Kit Noivos Sem Correria Para Celebrar Cada Detalhe", subheadline: "Uma oferta direta para tirar a organização do casamento do improviso.", primaryMassPct: 65, background: "gradient" }],
  ["03-split-medium.jpg", { headline: "Kit Noivos Sem Correria", background: "texture" }],
  ["04-split-wide-price.jpg", { headline: "Kit Noivos Premium", subheadline: "Produto real em destaque com chamada comercial clara.", cta: "Reservar agora", price: "R$ 12.499,90", background: "light" }],
  ["05-overlay-short.jpg", { headline: "Sem Correria", subheadline: "Presentes, lista e RSVP em um só lugar.", visualDensity: "clean", background: "darkPhoto" }],
  ["06-overlay-long-subheadline.jpg", { headline: "Tempo de Amor", subheadline: "Organize presentes, lista de presentes, confirmação de presença e cada detalhe do grande dia em um só lugar, sem correria.", visualDensity: "clean", background: "light" }],
];

const MATRIX = [
  ["matrix/m01-split-dark-background.jpg", { background: "darkPhoto" }],
  ["matrix/m02-hero-price-129999.jpg", { primaryMassPct: 65, price: "R$ 129.999,90" }],
  ["matrix/m03-split-price-129999.jpg", { price: "R$ 129.999,90", headline: "Kit Noivos Premium" }],
  ["matrix/m04-overlay-price-12499.jpg", { visualDensity: "clean", headline: "Sem Correria", price: "R$ 12.499,90" }],
  ["matrix/m05-split-product-vertical.jpg", { product: PRODUCT_VERTICAL }],
  ["matrix/m06-auto-product-horizontal.jpg", { product: PRODUCT_HORIZONTAL }],
  ["matrix/m07-hero-logo-square.jpg", { primaryMassPct: 65, logo: LOGO_SQUARE, headline: "Sem Correria" }],
  ["matrix/m08-overlay-logo-square.jpg", { visualDensity: "clean", logo: LOGO_SQUARE, headline: "Sem Correria" }],
  ["matrix/m09-hero-medium-headline-texture.jpg", { primaryMassPct: 65, background: "texture" }],
];

const results = [];
for (const [file, options] of [...MAIN, ...MATRIX]) results.push(await renderCase(file, options));
await writeFile(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((item) => ({
  file: item.file,
  variant: item.composition?.variant,
  price: item.composition?.priceTreatment,
  logo: item.composition?.logoTreatment,
  tone: item.composition?.pageTone,
  prominence: item.composition?.productVisualProminence,
  emptyBand: item.composition?.largestEmptyBandPct,
  valid: item.geometryValid,
  issues: item.issues.map((issue) => issue.code),
  verify: item.verification.map((v) => `${v.role}:${v.visible}/${v.fidelityMeanAbsDiff}`),
})), null, 1));
