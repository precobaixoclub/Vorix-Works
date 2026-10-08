import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outDir = process.argv[2] ?? "docs/creative-editorial-prototype/product-offer-fixtures";
await mkdir(outDir, { recursive: true });

async function png(width, height, background) {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

async function productAsset() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100">
    <rect width="900" height="1100" fill="#fff7ed"/>
    <rect x="180" y="120" width="540" height="860" rx="72" fill="#edd08a" stroke="#94324d" stroke-width="34"/>
    <circle cx="450" cy="370" r="132" fill="#94324d"/>
    <rect x="282" y="650" width="336" height="88" rx="28" fill="#231418"/>
    <rect x="318" y="810" width="264" height="34" rx="17" fill="#fff7ed"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function logoAsset() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160">
    <rect width="640" height="160" rx="42" fill="#94324d"/>
    <circle cx="80" cy="80" r="34" fill="#fff8f1"/>
    <rect x="140" y="48" width="350" height="22" rx="11" fill="#fff8f1"/>
    <rect x="140" y="90" width="250" height="22" rx="11" fill="#fff8f1"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function baseScene() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f8eadb"/>
        <stop offset="0.55" stop-color="#fdf8f1"/>
        <stop offset="1" stop-color="#e6c682"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1350" fill="url(#g)"/>
    <circle cx="892" cy="198" r="230" fill="#94324d" opacity="0.18"/>
    <circle cx="188" cy="1058" r="280" fill="#f3d7bd" opacity="0.75"/>
    <path d="M0 934C196 862 372 892 526 988C692 1090 892 1078 1080 944V1350H0Z" fill="#fff8f1" opacity="0.72"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

function plan(overrides = {}) {
  const headline = overrides.headline ?? "Kit Noivos Sem Correria";
  const subheadline = overrides.subheadline ?? "Organize presentes, listas e RSVP com acabamento simples de vender.";
  const cta = overrides.cta ?? "Comprar agora";
  return {
    objective: "Validar product_offer editorial sem OpenAI",
    angle: "Oferta de produto real",
    targetAudience: "Casais organizando casamento",
    title: headline,
    description: "Fixture local deterministico",
    headline,
    subheadline,
    cta,
    visualDirection: "Produto real preservado em composicao editorial",
    compositionIntent: "Produto, copy e bloco comercial coesos",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: [headline, subheadline, cta],
    requiredElements: ["headline", "cta", "product_photo"],
    forbiddenElements: ["texto QA", "preco inventado", "cta inventado"],
    visualDensity: "balanced",
    styleNotes: "premium, comercial, integrado",
    rationale: "Teste local do renderer",
    artDirection: {
      concept: "Produto fisico em frame editorial com area de copy conectada ao bloco comercial",
      visualFocus: "Produto e oferta",
      elementHierarchy: ["produto", "headline", "preco", "cta", "logo"],
      primaryMassPct: 52,
      contrastStrategy: "Texto em painel editorial consistente",
      chromaticDirection: "Vinho, champagne e creme",
      atmosphere: "Comercial premium",
      backgroundTreatment: "Cena suave tratada como ambientacao",
      productTextRelationship: "Texto nunca atravessa o produto",
      avoidedCliches: ["wireframe"],
      justifiedCliches: [],
    },
    layoutPlan: [],
  };
}

async function renderCase(name, options) {
  const product = await productAsset();
  const logo = await logoAsset();
  const baseImageBuffer = await baseScene();
  const result = await renderEditorialCreative({
    baseImageBuffer,
    context: {
      brandName: "Vorix QA",
      objective: "Fixture local",
      channel: "instagram",
      format: "4:5",
      ideaText: "Fixture local sem OpenAI",
      brandColors: ["#94324d", "#e8c785"],
      assets: [],
      confirmedFacts: [options.fact],
    },
    plan: plan(options),
    assets: [
      { role: "product_photo", url: "fixture://product.png", buffer: product },
      { role: "logo", url: "fixture://logo.png", buffer: logo },
    ],
  });
  const file = join(outDir, `${name}.jpg`);
  await writeFile(file, result.buffer);
  return { name, file, family: result.family, geometry: result.geometry, renderedGeometry: result.renderedGeometry, textZones: result.renderedTextZones, assetPlacements: result.renderedAssetPlacements };
}

const results = [];
results.push(await renderCase("product-offer-balanced", { fact: "Preco atual: R$ 149,00" }));
results.push(await renderCase("product-offer-long-headline", {
  headline: "Kit Noivos Sem Correria Para Celebrar Melhor",
  subheadline: "Uma oferta direta para tirar a organizacao do improviso.",
  fact: "Preco atual: R$ 149,00",
}));
results.push(await renderCase("product-offer-wide-price", {
  headline: "Kit Noivos Premium",
  subheadline: "Produto real em destaque com chamada comercial clara.",
  cta: "Reservar agora",
  fact: "Preco atual: R$ 12.499,90",
}));

await writeFile(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((item) => ({ name: item.name, file: item.file, valid: item.geometry.valid, issues: item.geometry.issues })), null, 2));
