// Fixtures visuais do product_offer editorial — ZERO OpenAI. Usa a MESMA classe de asset que
// falhou no Smoke A (cer-runtime-muyx4qzs-hoinur): foto JPEG real do produto + logo real.
// O fundo é um estúdio neutro controlado (no lugar da base da IA), para provar que produto real +
// copy + preço + CTA + logo já formam uma peça aceitável quando o compositor recebe bons assets.
//
// Uso: node scripts/render-editorial-product-offer-fixtures.mjs [outDir] [format]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outDir = process.argv[2] ?? "docs/creative-editorial-prototype/product-offer-fixtures";
const format = process.argv[3] === "9:16" ? "9:16" : "4:5";
await mkdir(outDir, { recursive: true });

const PRODUCT_JPEG = await readFile("tests/fixtures/editorial/product-ring-reminder.jpg");
const LOGO_PNG = await readFile("tests/fixtures/editorial/logo-rumo-ao-altar.png");

/** Estúdio neutro: parede quente com luz lateral suave, piso levemente mais escuro e grão fino —
 * o renderer desfoca a base de qualquer forma, então o objetivo é só luz/cor plausíveis. */
async function studioBackground(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <radialGradient id="light" cx="0.72" cy="0.28" r="0.85">
        <stop offset="0" stop-color="#FBF1E6"/>
        <stop offset="0.55" stop-color="#EAD6C3"/>
        <stop offset="1" stop-color="#CFB39C"/>
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#D9BFA8" stop-opacity="0"/>
        <stop offset="1" stop-color="#B8957C" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#light)"/>
    <rect y="${height * 0.68}" width="${width}" height="${height * 0.32}" fill="url(#floor)"/>
    <ellipse cx="${width * 0.2}" cy="${height * 0.35}" rx="${width * 0.18}" ry="${height * 0.2}" fill="#F7E3D3" opacity="0.5"/>
  </svg>`;
  const noise = await sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 10 } } }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: noise, blend: "soft-light" }]).jpeg({ quality: 92 }).toBuffer();
}

function plan(overrides = {}) {
  const headline = overrides.headline ?? "Kit Noivos Sem Correria";
  const subheadline = overrides.subheadline ?? "Organize presentes, lista de presentes e RSVP em um só lugar.";
  const cta = overrides.cta ?? "Comprar agora";
  return {
    objective: "Validar product_offer editorial sem OpenAI",
    angle: "Oferta de produto real",
    targetAudience: "Casais organizando casamento",
    title: headline,
    description: "Fixture local determinístico",
    headline,
    subheadline,
    cta,
    visualDirection: "Produto real preservado em composição editorial",
    compositionIntent: "Produto, copy e bloco comercial coesos",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: [headline, subheadline, cta],
    requiredRenderedFacts: [],
    requiredElements: ["headline", "subheadline", "cta", "logo", "price"],
    forbiddenElements: ["texto QA", "preco inventado", "cta inventado"],
    visualDensity: "balanced",
    styleNotes: "premium, comercial, integrado",
    rationale: "Teste local do renderer",
    layoutPlan: [],
  };
}

async function renderCase(name, options) {
  const size = format === "9:16" ? { width: 1080, height: 1920 } : { width: 1024, height: 1280 };
  const result = await renderEditorialCreative({
    baseImageBuffer: await studioBackground(size.width, size.height),
    context: {
      brandName: "Rumo ao Altar",
      objective: "Fixture local",
      channel: "instagram",
      format,
      ideaText: "Fixture local sem OpenAI",
      assets: [],
      confirmedFacts: [options.fact],
    },
    plan: plan(options),
    assets: [
      { role: "product_photo", url: "fixture://product-ring-reminder.jpg", buffer: PRODUCT_JPEG },
      { role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: LOGO_PNG },
    ],
  });
  const file = join(outDir, `${name}${format === "9:16" ? "-9x16" : ""}.jpg`);
  await writeFile(file, result.buffer);
  return {
    name,
    file,
    format,
    family: result.family,
    geometryValid: result.geometry.valid,
    issues: result.geometry.issues,
    renderedGeometry: result.renderedGeometry,
    assetVerification: result.assetVerification,
  };
}

const results = [];
// Reprodução exata dos textos/fatos do Smoke A.
results.push(await renderCase("product-offer-smoke-a-replay", { fact: "Preço atual: R$ 149,00 BRL" }));
// A) headline curta
results.push(await renderCase("product-offer-a-short-headline", { headline: "Sem Correria", subheadline: "Presentes, lista e RSVP organizados em um só lugar.", fact: "Preço atual: R$ 149,00" }));
// B) headline longa
results.push(await renderCase("product-offer-b-long-headline", {
  headline: "Kit Noivos Sem Correria Para Celebrar Cada Detalhe",
  subheadline: "Uma oferta direta para tirar a organização do casamento do improviso.",
  fact: "Preço atual: R$ 149,00",
}));
// C) preço largo
results.push(await renderCase("product-offer-c-wide-price", {
  headline: "Kit Noivos Premium",
  subheadline: "Produto real em destaque com chamada comercial clara.",
  cta: "Reservar agora",
  fact: "Preço atual: R$ 12.499,90",
}));

await writeFile(join(outDir, `summary${format === "9:16" ? "-9x16" : ""}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((item) => ({
  name: item.name,
  file: item.file,
  geometryValid: item.geometryValid,
  issues: item.issues,
  verification: item.assetVerification.map((v) => `${v.role}:${v.detectedMime}:visible=${v.visible}:match=${v.assetMatchRatio}:fidelityMAD=${v.fidelityMeanAbsDiff}`),
})), null, 2));
