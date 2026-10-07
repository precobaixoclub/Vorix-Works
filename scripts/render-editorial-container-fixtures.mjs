import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { buildEditorialFontFaceCss, renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outputDir = resolve(process.argv[2] ?? "docs/creative-editorial-prototype");
await mkdir(outputDir, { recursive: true });

const fontCss = await buildEditorialFontFaceCss();
const glyphText = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "R$ 149,00",
  "Preço",
  "Promoção",
  "Você",
  "Ação",
  "Comprar agora",
];

const glyphSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  ${fontCss}
  <rect width="1200" height="900" fill="#FFF8F1"/>
  <text x="80" y="110" fill="#24171A" font-family="GeistEditorial" font-size="46" font-weight="800">
    ${glyphText.map((line, index) => `<tspan x="80" dy="${index === 0 ? 0 : 82}">${line}</tspan>`).join("")}
  </text>
</svg>`;
const glyphBuffer = await sharp(Buffer.from(glyphSvg)).png().toBuffer();
await writeFile(join(outputDir, "container-font-glyph-fixture.png"), glyphBuffer);

const baseImageBuffer = await sharp({ create: { width: 1080, height: 1350, channels: 4, background: "#392229" } }).png().toBuffer();
const productBuffer = await sharp({
  create: { width: 720, height: 900, channels: 4, background: "#E8C785" },
})
  .composite([
    {
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
        <rect x="130" y="120" width="460" height="650" rx="42" fill="#FFF8F1"/>
        <circle cx="360" cy="330" r="112" fill="#8B2F48"/>
        <rect x="214" y="520" width="292" height="86" rx="22" fill="#24171A"/>
      </svg>`),
      left: 0,
      top: 0,
    },
  ])
  .png()
  .toBuffer();

const editorial = await renderEditorialCreative({
  baseImageBuffer,
  context: {
    brandName: "Vorix QA",
    objective: "Validar compositor editorial",
    channel: "instagram",
    format: "4:5",
    ideaText: "Fixture deterministica sem OpenAI",
    brandColors: ["#8B2F48", "#E8C785"],
    assets: [{ role: "product_photo", url: "memory://product.png", description: "Produto QA controlado" }],
    confirmedFacts: ["Preco atual: R$ 149,00"],
  },
  plan: {
    objective: "Criar fixture editorial",
    angle: "Oferta clara com acabamento premium",
    targetAudience: "QA",
    title: "Fixture editorial",
    description: "Render deterministico",
    headline: "Preço e Promoção Você em Ação",
    subheadline: "Comprar agora com condição especial.",
    cta: "Comprar agora",
    visualDirection: "Produto controlado com area editorial",
    compositionIntent: "Validar fonte e geometria",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: ["Preço e Promoção Você em Ação", "Comprar agora com condição especial.", "Comprar agora", "R$ 149,00"],
    requiredRenderedFacts: ["R$ 149,00"],
    requiredElements: ["produto", "headline", "cta"],
    forbiddenElements: [],
    visualDensity: "balanced",
    styleNotes: "premium, limpo",
    rationale: "Fixture",
    artDirection: {
      concept: "Produto real preservado em area fotografica com bloco editorial proprio",
      visualFocus: "Produto em destaque e texto em area de contraste controlado",
      elementHierarchy: ["produto", "headline", "preco", "cta"],
      primaryMassPct: 50,
      contrastStrategy: "Texto sobre area editorial consistente",
      chromaticDirection: "Tons quentes com acento da marca",
      atmosphere: "Comercial premium",
      backgroundTreatment: "Fotografia tratada",
      productTextRelationship: "Texto nunca atravessa o produto",
      avoidedCliches: [],
      justifiedCliches: [],
    },
    layoutPlan: [],
  },
  assets: [{ role: "product_photo", url: "memory://product.png", buffer: productBuffer }],
});
await writeFile(join(outputDir, "container-editorial-renderer-fixture.jpg"), editorial.buffer);

console.log(JSON.stringify({
  outputDir,
  files: ["container-font-glyph-fixture.png", "container-editorial-renderer-fixture.jpg"],
  editorialGeometryValid: editorial.geometry.valid,
  editorialIssues: editorial.geometry.issues,
}, null, 2));
