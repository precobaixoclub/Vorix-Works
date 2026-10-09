// Isolated visual prototype for comparing the current Creative Engine composition style
// with a proposed editorial compositor. This script does not call OpenAI, does not touch
// production paths, and only writes review artifacts under docs/creative-editorial-prototype.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "docs/creative-editorial-prototype");
const W = 1080;
const H = 1350;
const STORY_W = 1080;
const STORY_H = 1920;

const assets = {
  logo: resolve(ROOT, "assets/visual/library/rumo-ao-altar/logo-oficial-rumo-ao-altar.png"),
  product: resolve(ROOT, "assets/visual/library/rumo-ao-altar/ring-reminder.jpg"),
  productVertical: resolve(ROOT, "assets/visual/library/rumo-ao-altar/context-gifts-vertical.jpg"),
  institutional: resolve(ROOT, "assets/visual/library/rumo-ao-altar/context-party-vertical.jpg"),
  serviceContext: resolve(ROOT, "assets/visual/library/rumo-ao-altar/context-album-vertical.jpg"),
  serviceMockup: resolve(ROOT, "assets/visual/library/rumo-ao-altar/site-official-mobile-mockup.png"),
  serviceQaScreenshot: resolve(ROOT, "assets/media/company-screenshots/site-demo-presentes.png"),
};

const brand = {
  name: "Rumo ao Altar",
  rose: "#B15B6C",
  roseDark: "#7A3543",
  ink: "#24171A",
  cream: "#FFF8F1",
  champagne: "#E8C785",
  green: "#4E6D58",
  white: "#FFFFFF",
};

const scenarios = [
  {
    id: "a-produto-preco-cta",
    label: "A. Produto fisico com preco e CTA",
    base: assets.product,
    editorialBase: assets.productVertical,
    headline: "Kit Noivos Sem Correria",
    subhead: "Convite, lembretes e presentes em uma experiencia organizada.",
    price: "R$ 149,00",
    kicker: "Oferta de lancamento",
    cta: "Comprar agora",
    note: "Produto fisico simulado com asset local de aliancas/relogio. O compositor preserva o asset original como produto quando fornecido; preco fixture nao e preco comercial real confirmado.",
  },
  {
    id: "b-institucional-premium",
    label: "B. Publicacao institucional premium",
    base: assets.institutional,
    editorialBase: assets.institutional,
    headline: "A calma de um casamento bem guiado",
    subhead: "Uma presenca digital elegante para orientar convidados antes, durante e depois da festa.",
    price: "",
    kicker: "Identidade premium",
    cta: "Conhecer experiencia",
    note: "Usa fotografia contextual local sem chamada comercial de preco.",
  },
  {
    id: "c-divulgacao-servico",
    label: "C. Divulgacao de servico",
    base: assets.serviceContext,
    editorialBase: assets.serviceContext,
    mockup: assets.serviceQaScreenshot,
    headline: "Site de casamento pronto para convidados",
    subhead: "RSVP, lista de presentes e informacoes essenciais em um unico link.",
    price: "Planos a partir de R$ 149",
    kicker: "Servico completo",
    cta: "Montar meu site",
    note: "Usa screenshot local real/controlado do produto Rumo ao Altar com dados demonstrativos QA; nao apresenta UI inventada como captura real.",
  },
];

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dataUri(filePath) {
  const ext = extname(filePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return readFile(filePath).then((buffer) => `data:${mime};base64,${buffer.toString("base64")}`);
}

function wrapText(text, maxChars, maxLines = 4) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `${lines.slice(maxLines - 1).join(" ").slice(0, maxChars - 1)}...`];
}

function textBlock({ text, x, y, width, size, lineHeight = 1.08, fill = brand.white, weight = 700, anchor = "start", maxLines = 4, uppercase = false, letterSpacing = 0 }) {
  const maxChars = Math.max(8, Math.floor(width / (size * 0.52)));
  const lines = wrapText(uppercase ? String(text).toUpperCase() : text, maxChars, maxLines);
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : size * lineHeight}">${xmlEscape(line)}</tspan>`).join("")}</text>`;
}

function logoImage(href, x, y, width, height, extra = "") {
  return `<image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" ${extra}/>`;
}

async function renderSvg(filePath, svg) {
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

async function currentStyleScenario(scenario) {
  const base = await dataUri(scenario.base);
  const logo = await dataUri(assets.logo);
  const hasPrice = Boolean(scenario.price);
  const priceY = hasPrice ? 1034 : 1058;
  const priceFontSize = scenario.price.length > 18 ? 42 : 62;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.10"/>
      <stop offset="0.55" stop-color="#000" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.26"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#111"/>
  <image href="${base}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <rect x="64" y="64" width="320" height="98" rx="22" fill="#FFFFFF" opacity="0.94" filter="url(#softShadow)"/>
  ${logoImage(logo, 90, 88, 268, 48)}
  <rect x="70" y="732" width="940" height="218" rx="28" fill="rgba(0,0,0,0.60)" filter="url(#softShadow)"/>
  ${textBlock({ text: scenario.headline, x: 112, y: 800, width: 846, size: 50, fill: brand.white, maxLines: 3, uppercase: true })}
  ${textBlock({ text: scenario.subhead, x: 114, y: 910, width: 800, size: 26, fill: "#F9E9D8", weight: 500, maxLines: 2 })}
  ${hasPrice ? `<rect x="70" y="984" width="422" height="170" rx="28" fill="#FFFFFF" filter="url(#softShadow)"/>
  ${textBlock({ text: scenario.kicker, x: 112, y: 1032, width: 330, size: 22, fill: brand.roseDark, weight: 700, uppercase: true, maxLines: 1 })}
  ${textBlock({ text: scenario.price, x: 112, y: 1102, width: 348, size: priceFontSize, fill: brand.ink, weight: 800, maxLines: 2 })}` : ""}
  <rect x="${hasPrice ? 522 : 70}" y="${priceY}" width="${hasPrice ? 488 : 940}" height="120" rx="28" fill="${brand.rose}" filter="url(#softShadow)"/>
  ${textBlock({ text: scenario.cta, x: hasPrice ? 766 : 540, y: priceY + 76, width: hasPrice ? 420 : 820, size: 42, fill: brand.white, weight: 800, anchor: "middle", uppercase: true, maxLines: 1 })}
  <text x="70" y="1260" fill="#FFFFFF" opacity="0.70" font-family="Inter, Arial, sans-serif" font-size="22">Pipeline atual simulado: foto + logo em card + zonas de texto seguras</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-current.png`);
  await renderSvg(out, svg);
  return out;
}

async function editorialProduct(scenario) {
  const hero = await dataUri(scenario.editorialBase);
  const detail = await dataUri(scenario.base);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="heroClip"><path d="M384 0H1080V1350H256C408 1100 416 796 302 614C210 468 212 210 384 0Z"/></clipPath>
    <clipPath id="coin"><circle cx="264" cy="300" r="166"/></clipPath>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF8F1"/>
      <stop offset="1" stop-color="#F0D7BE"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#4A1C25" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>
  <path d="M0 0H472C300 254 300 490 420 680C540 870 470 1120 308 1350H0Z" fill="#FFF8F1"/>
  <image href="${hero}" x="256" y="0" width="824" height="${H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
  <rect x="256" y="0" width="824" height="${H}" clip-path="url(#heroClip)" fill="#2B1116" opacity="0.16"/>
  <circle cx="264" cy="300" r="174" fill="${brand.white}" opacity="0.82" filter="url(#shadow)"/>
  <image href="${detail}" x="74" y="110" width="380" height="380" preserveAspectRatio="xMidYMid slice" clip-path="url(#coin)"/>
  <path d="M78 300A186 186 0 0 1 450 300" fill="none" stroke="${brand.champagne}" stroke-width="10" stroke-linecap="round"/>
  ${logoImage(logo, 74, 70, 238, 44)}
  <text x="76" y="560" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 72, y: 660, width: 458, size: 78, fill: brand.ink, weight: 850, maxLines: 3 })}
  ${textBlock({ text: scenario.subhead, x: 78, y: 908, width: 430, size: 29, fill: "#5C4345", weight: 500, maxLines: 3 })}
  <g filter="url(#shadow)">
    <path d="M72 1044H520C568 1044 594 1096 566 1135L476 1260H72Z" fill="${brand.roseDark}"/>
    <path d="M412 1044H592C628 1044 648 1084 628 1114L530 1260H444L536 1125C552 1101 536 1070 506 1070H412Z" fill="${brand.champagne}"/>
  </g>
  <text x="108" y="1112" fill="#F8E9D8" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700">PRECO</text>
  <text x="108" y="1192" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="850">${xmlEscape(scenario.price)}</text>
  <rect x="620" y="1128" width="338" height="82" rx="41" fill="${brand.white}" opacity="0.92" filter="url(#shadow)"/>
  <text x="789" y="1182" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="29" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial.png`);
  await renderSvg(out, svg);
  return out;
}

async function editorialInstitutional(scenario) {
  const photo = await dataUri(scenario.editorialBase);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="mainPhoto"><rect x="478" y="88" width="510" height="1032" rx="44"/></clipPath>
    <clipPath id="stripe"><rect x="72" y="88" width="222" height="676" rx="111"/></clipPath>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2B171A"/>
      <stop offset="0.56" stop-color="#6E3341"/>
      <stop offset="1" stop-color="#D6A77D"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#17090B" flood-opacity="0.34"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wash)"/>
  <circle cx="88" cy="1178" r="280" fill="#F6D6C6" opacity="0.18"/>
  <image href="${photo}" x="478" y="88" width="510" height="1032" preserveAspectRatio="xMidYMid slice" clip-path="url(#mainPhoto)" filter="url(#shadow)"/>
  <rect x="478" y="88" width="510" height="1032" rx="44" fill="#000" opacity="0.10"/>
  <image href="${photo}" x="72" y="88" width="222" height="676" preserveAspectRatio="xMidYMid slice" clip-path="url(#stripe)" opacity="0.72"/>
  <rect x="72" y="88" width="222" height="676" rx="111" fill="${brand.champagne}" opacity="0.22"/>
  <rect x="70" y="72" width="926" height="1080" rx="56" fill="none" stroke="#F7E5D3" stroke-opacity="0.26" stroke-width="2"/>
  <rect x="108" y="1026" width="366" height="2" fill="#F4D5B6" opacity="0.72"/>
  ${logoImage(logo, 108, 110, 260, 50, 'opacity="0.96"')}
  <text x="108" y="318" fill="#F4D5B6" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 108, y: 438, width: 392, size: 66, fill: "#FFFFFF", weight: 850, maxLines: 4 })}
  ${textBlock({ text: scenario.subhead, x: 112, y: 772, width: 330, size: 27, fill: "#FFECDD", weight: 500, maxLines: 5 })}
  <rect x="94" y="1080" width="352" height="76" rx="38" fill="#F8E7D8" opacity="0.95"/>
  <text x="270" y="1131" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  <text x="908" y="1198" fill="#FFF6EB" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" text-anchor="end" letter-spacing="2">GUIA DIGITAL PARA CONVIDADOS</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial.png`);
  await renderSvg(out, svg);
  return out;
}

async function editorialService(scenario) {
  const photo = await dataUri(scenario.editorialBase);
  const mockup = await dataUri(scenario.mockup);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="phone"><rect x="634" y="252" width="298" height="612" rx="46"/></clipPath>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12080A" stop-opacity="0.05"/>
      <stop offset="0.52" stop-color="#12080A" stop-opacity="0.50"/>
      <stop offset="1" stop-color="#12080A" stop-opacity="0.92"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="26" stdDeviation="28" flood-color="#000" flood-opacity="0.40"/>
    </filter>
  </defs>
  <image href="${photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#bottom)"/>
  <path d="M0 0H594C522 186 516 384 628 568C742 758 710 1018 516 1350H0Z" fill="#FFF8F1" opacity="0.96"/>
  <path d="M0 0H110V1350H0Z" fill="${brand.roseDark}" opacity="0.96"/>
  <text x="55" y="1210" fill="#F8E7D8" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" text-anchor="middle" transform="rotate(-90 55 1210)" letter-spacing="4">SERVICO DIGITAL</text>
  ${logoImage(logo, 154, 116, 270, 52)}
  <text x="154" y="310" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 154, y: 430, width: 398, size: 56, fill: brand.ink, weight: 850, maxLines: 4 })}
  ${textBlock({ text: scenario.subhead, x: 158, y: 732, width: 372, size: 29, fill: "#61484A", weight: 500, maxLines: 4 })}
  <rect x="154" y="928" width="362" height="86" rx="20" fill="#F0DDC8"/>
  <text x="178" y="984" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="31" font-weight="850">${xmlEscape(scenario.price)}</text>
  <rect x="154" y="1060" width="338" height="82" rx="41" fill="${brand.roseDark}"/>
  <text x="323" y="1114" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  <g filter="url(#shadow)">
    <rect x="604" y="218" width="358" height="690" rx="62" fill="#1B1214"/>
    <rect x="623" y="237" width="320" height="652" rx="52" fill="#FFF8F1"/>
    <image href="${mockup}" x="634" y="252" width="298" height="612" preserveAspectRatio="xMidYMid slice" clip-path="url(#phone)"/>
    <rect x="724" y="238" width="118" height="20" rx="10" fill="#1B1214"/>
  </g>
  <rect x="682" y="974" width="322" height="102" rx="51" fill="#FFFFFF" opacity="0.90" filter="url(#shadow)"/>
  <text x="843" y="1038" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="27" font-weight="850" text-anchor="middle">RSVP + PRESENTES</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial.png`);
  await renderSvg(out, svg);
  return out;
}

async function refinedProduct45(scenario) {
  const product = await dataUri(scenario.base);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="productClip"><rect x="462" y="86" width="542" height="812" rx="42"/></clipPath>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF8F1"/>
      <stop offset="1" stop-color="#EED8C3"/>
    </linearGradient>
    <linearGradient id="footer" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${brand.roseDark}"/>
      <stop offset="0.64" stop-color="#923E4F"/>
      <stop offset="0.64" stop-color="${brand.champagne}"/>
      <stop offset="1" stop-color="#F2D798"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#3B121B" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>
  <rect x="56" y="56" width="968" height="1238" rx="54" fill="#FFFDF8" opacity="0.76"/>
  <path d="M70 930C210 870 356 892 478 970C636 1072 820 1058 1008 930V1294H70Z" fill="#F7E7D8"/>
  <image href="${product}" x="462" y="86" width="542" height="812" preserveAspectRatio="xMidYMid slice" clip-path="url(#productClip)" filter="url(#shadow)"/>
  <rect x="462" y="86" width="542" height="812" rx="42" fill="none" stroke="#FFFFFF" stroke-opacity="0.80" stroke-width="10"/>
  ${logoImage(logo, 92, 88, 282, 54)}
  <text x="92" y="306" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 92, y: 416, width: 336, size: 68, fill: brand.ink, weight: 850, maxLines: 4 })}
  ${textBlock({ text: scenario.subhead, x: 96, y: 720, width: 322, size: 28, fill: "#60484A", weight: 500, maxLines: 4 })}
  <g filter="url(#shadow)">
    <rect x="92" y="1010" width="896" height="170" rx="34" fill="url(#footer)"/>
    <rect x="690" y="1034" width="266" height="122" rx="61" fill="#FFF9F1" opacity="0.96"/>
  </g>
  <text x="136" y="1072" fill="#F8E9D8" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="1.5">PRECO DO FIXTURE</text>
  <text x="136" y="1144" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="66" font-weight="850">${xmlEscape(scenario.price)}</text>
  <text x="823" y="1112" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="27" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  <text x="92" y="1248" fill="#7B5A58" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="600">Produto original preservado quando fornecido - texto comercial deterministico</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial-refined-4x5.png`);
  await renderSvg(out, svg);
  return out;
}

async function refinedInstitutional45(scenario) {
  const photo = await dataUri(scenario.editorialBase);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="photo"><rect x="470" y="96" width="520" height="1028" rx="46"/></clipPath>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#261416"/>
      <stop offset="0.58" stop-color="#783847"/>
      <stop offset="1" stop-color="#C79270"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="26" flood-color="#120607" flood-opacity="0.36"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect x="72" y="72" width="936" height="1206" rx="58" fill="none" stroke="#F5DCC6" stroke-opacity="0.24" stroke-width="2"/>
  <image href="${photo}" x="470" y="96" width="520" height="1028" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)" filter="url(#shadow)"/>
  <rect x="470" y="96" width="520" height="1028" rx="46" fill="#000000" opacity="0.08"/>
  <rect x="112" y="148" width="306" height="66" rx="0" fill="#FFFFFF" opacity="0.94"/>
  ${logoImage(logo, 134, 162, 260, 40)}
  <text x="112" y="348" fill="#F3D4BC" font-family="Inter, Arial, sans-serif" font-size="23" font-weight="850" letter-spacing="3">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 112, y: 476, width: 330, size: 60, fill: "#FFFFFF", weight: 850, maxLines: 4 })}
  <rect x="112" y="770" width="278" height="2" fill="#F3D4BC" opacity="0.70"/>
  ${textBlock({ text: scenario.subhead, x: 112, y: 842, width: 316, size: 27, fill: "#FFEDE1", weight: 500, maxLines: 5 })}
  <rect x="112" y="1110" width="326" height="80" rx="40" fill="#F8E6D8"/>
  <text x="275" y="1163" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  <text x="918" y="1200" fill="#FFF1E6" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" text-anchor="end" letter-spacing="2">PRESENCA DIGITAL PREMIUM</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial-refined-4x5.png`);
  await renderSvg(out, svg);
  return out;
}

async function refinedService45(scenario) {
  const photo = await dataUri(scenario.editorialBase);
  const screenshot = await dataUri(scenario.mockup);
  const logo = await dataUri(assets.logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="deviceScreen"><rect x="642" y="250" width="296" height="500" rx="34"/></clipPath>
    <linearGradient id="photoShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16090A" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#16090A" stop-opacity="0.72"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#000" flood-opacity="0.38"/>
    </filter>
  </defs>
  <image href="${photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#photoShade)"/>
  <path d="M0 0H594C520 194 526 386 628 558C746 754 708 1010 520 1350H0Z" fill="#FFF8F1" opacity="0.97"/>
  <rect x="0" y="0" width="102" height="1350" fill="${brand.roseDark}"/>
  <text x="51" y="1215" fill="#F8E7D8" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="850" text-anchor="middle" transform="rotate(-90 51 1215)" letter-spacing="4">SERVICO DIGITAL</text>
  ${logoImage(logo, 150, 116, 270, 52)}
  <text x="150" y="312" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  ${textBlock({ text: scenario.headline, x: 150, y: 430, width: 382, size: 54, fill: brand.ink, weight: 850, maxLines: 4 })}
  ${textBlock({ text: scenario.subhead, x: 154, y: 700, width: 360, size: 28, fill: "#62484A", weight: 500, maxLines: 4 })}
  <rect x="150" y="896" width="362" height="82" rx="20" fill="#F0DDC8"/>
  <text x="174" y="948" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="850">${xmlEscape(scenario.price)}</text>
  <rect x="150" y="1028" width="326" height="80" rx="40" fill="${brand.roseDark}"/>
  <text x="313" y="1081" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="27" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  <g filter="url(#shadow)">
    <rect x="604" y="202" width="374" height="604" rx="56" fill="#171011"/>
    <rect x="622" y="220" width="338" height="568" rx="42" fill="#FFFDF8"/>
    <image href="${screenshot}" x="642" y="250" width="296" height="500" preserveAspectRatio="xMidYMin slice" clip-path="url(#deviceScreen)"/>
    <rect x="708" y="222" width="166" height="24" rx="12" fill="#171011"/>
  </g>
  <rect x="658" y="832" width="282" height="72" rx="36" fill="#FFFFFF" opacity="0.93" filter="url(#shadow)"/>
  <text x="799" y="878" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="850" text-anchor="middle">CAPTURA QA REAL</text>
  <rect x="668" y="1050" width="330" height="94" rx="47" fill="#FFFFFF" opacity="0.92" filter="url(#shadow)"/>
  <text x="833" y="1110" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="850" text-anchor="middle">RSVP + PRESENTES</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-editorial-refined-4x5.png`);
  await renderSvg(out, svg);
  return out;
}

async function refinedStoryScenario(scenario) {
  const logo = await dataUri(assets.logo);
  const base = await dataUri(scenario.id.startsWith("b-") ? scenario.editorialBase : scenario.base);
  const servicePhoto = scenario.id.startsWith("c-") ? await dataUri(scenario.editorialBase) : undefined;
  const screenshot = scenario.id.startsWith("c-") ? await dataUri(scenario.mockup) : undefined;
  let svg;
  if (scenario.id.startsWith("a-")) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}" viewBox="0 0 ${STORY_W} ${STORY_H}">
    <defs><clipPath id="photo"><rect x="86" y="110" width="908" height="850" rx="54"/></clipPath><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="26" stdDeviation="28" flood-color="#3B121B" flood-opacity="0.24"/></filter></defs>
    <rect width="${STORY_W}" height="${STORY_H}" fill="#FFF8F1"/>
    <image href="${base}" x="86" y="110" width="908" height="850" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)" filter="url(#shadow)"/>
    <rect x="86" y="110" width="908" height="850" rx="54" fill="none" stroke="#FFFFFF" stroke-width="10"/>
    ${logoImage(logo, 92, 1040, 300, 58)}
    <text x="92" y="1224" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="850" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
    ${textBlock({ text: scenario.headline, x: 92, y: 1360, width: 700, size: 88, fill: brand.ink, weight: 850, maxLines: 3 })}
    <rect x="92" y="1644" width="420" height="128" rx="28" fill="${brand.roseDark}"/>
    <text x="126" y="1694" fill="#F8E9D8" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="850">PRECO DO FIXTURE</text>
    <text x="126" y="1750" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="850">${xmlEscape(scenario.price)}</text>
    <rect x="548" y="1668" width="338" height="84" rx="42" fill="${brand.champagne}"/>
    <text x="717" y="1723" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="27" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  </svg>`;
  } else if (scenario.id.startsWith("b-")) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}" viewBox="0 0 ${STORY_W} ${STORY_H}">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170809" stop-opacity="0.12"/><stop offset="0.55" stop-color="#170809" stop-opacity="0.30"/><stop offset="1" stop-color="#170809" stop-opacity="0.84"/></linearGradient></defs>
    <image href="${base}" x="0" y="0" width="${STORY_W}" height="${STORY_H}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${STORY_W}" height="${STORY_H}" fill="url(#shade)"/>
    <rect x="76" y="92" width="304" height="68" fill="#FFFFFF" opacity="0.94"/>
    ${logoImage(logo, 100, 108, 256, 38)}
    <rect x="76" y="1012" width="832" height="594" rx="44" fill="#5E2A36" opacity="0.90"/>
    <text x="126" y="1110" fill="#F3D4BC" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" letter-spacing="3">${xmlEscape(scenario.kicker.toUpperCase())}</text>
    ${textBlock({ text: scenario.headline, x: 126, y: 1256, width: 600, size: 76, fill: "#FFFFFF", weight: 850, maxLines: 3 })}
    ${textBlock({ text: scenario.subhead, x: 130, y: 1514, width: 560, size: 30, fill: "#FFEDE1", weight: 500, maxLines: 3 })}
    <rect x="126" y="1712" width="344" height="84" rx="42" fill="#F8E6D8"/>
    <text x="298" y="1768" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
  </svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}" viewBox="0 0 ${STORY_W} ${STORY_H}">
    <defs><clipPath id="screen"><rect x="608" y="344" width="326" height="562" rx="36"/></clipPath><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150809" stop-opacity="0.10"/><stop offset="1" stop-color="#150809" stop-opacity="0.72"/></linearGradient><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="30" stdDeviation="30" flood-color="#000" flood-opacity="0.40"/></filter></defs>
    <image href="${servicePhoto}" x="0" y="0" width="${STORY_W}" height="${STORY_H}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${STORY_W}" height="${STORY_H}" fill="url(#shade)"/>
    <path d="M0 0H572C500 282 520 574 650 830C780 1088 720 1488 518 1920H0Z" fill="#FFF8F1" opacity="0.97"/>
    <rect x="0" y="0" width="104" height="${STORY_H}" fill="${brand.roseDark}"/>
    ${logoImage(logo, 152, 144, 292, 56)}
    <text x="152" y="392" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" letter-spacing="2">${xmlEscape(scenario.kicker.toUpperCase())}</text>
    ${textBlock({ text: scenario.headline, x: 152, y: 520, width: 380, size: 58, fill: brand.ink, weight: 850, maxLines: 4 })}
    ${textBlock({ text: scenario.subhead, x: 156, y: 838, width: 354, size: 28, fill: "#62484A", weight: 500, maxLines: 4 })}
    <rect x="152" y="1080" width="360" height="82" rx="20" fill="#F0DDC8"/>
    <text x="176" y="1132" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="850">${xmlEscape(scenario.price)}</text>
    <rect x="152" y="1222" width="326" height="80" rx="40" fill="${brand.roseDark}"/>
    <text x="315" y="1275" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="27" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
    <g filter="url(#shadow)"><rect x="570" y="300" width="406" height="658" rx="64" fill="#171011"/><rect x="590" y="320" width="366" height="616" rx="48" fill="#FFFDF8"/><image href="${screenshot}" x="608" y="344" width="326" height="562" preserveAspectRatio="xMidYMin slice" clip-path="url(#screen)"/></g>
    <rect x="618" y="1016" width="304" height="72" rx="36" fill="#FFFFFF" opacity="0.93"/>
    <text x="770" y="1062" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="850" text-anchor="middle">CAPTURA QA REAL</text>
  </svg>`;
  }
  const out = resolve(OUT_DIR, `${scenario.id}-editorial-refined-9x16.png`);
  await renderSvg(out, svg);
  return out;
}

async function currentStyleStory(scenario) {
  const base = await dataUri(scenario.base);
  const logo = await dataUri(assets.logo);
  const hasPrice = Boolean(scenario.price);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}" viewBox="0 0 ${STORY_W} ${STORY_H}">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.10"/><stop offset="0.56" stop-color="#000" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.28"/></filter></defs>
  <image href="${base}" x="0" y="0" width="${STORY_W}" height="${STORY_H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${STORY_W}" height="${STORY_H}" fill="url(#shade)"/>
  <rect x="74" y="84" width="330" height="100" rx="22" fill="#FFFFFF" opacity="0.94" filter="url(#shadow)"/>
  ${logoImage(logo, 100, 110, 276, 46)}
  <rect x="72" y="1120" width="936" height="306" rx="34" fill="rgba(0,0,0,0.60)" filter="url(#shadow)"/>
  ${textBlock({ text: scenario.headline, x: 116, y: 1210, width: 824, size: 58, fill: brand.white, weight: 850, uppercase: true, maxLines: 3 })}
  ${textBlock({ text: scenario.subhead, x: 118, y: 1388, width: 790, size: 29, fill: "#F9E9D8", weight: 500, maxLines: 2 })}
  ${hasPrice ? `<rect x="72" y="1486" width="432" height="154" rx="28" fill="#FFFFFF" filter="url(#shadow)"/>
  <text x="112" y="1540" fill="${brand.roseDark}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="850">${xmlEscape(scenario.kicker.toUpperCase())}</text>
  <text x="112" y="1604" fill="${brand.ink}" font-family="Inter, Arial, sans-serif" font-size="${scenario.price.length > 18 ? 38 : 58}" font-weight="850">${xmlEscape(scenario.price)}</text>` : ""}
  <rect x="${hasPrice ? 540 : 72}" y="${hasPrice ? 1522 : 1488}" width="${hasPrice ? 468 : 936}" height="118" rx="30" fill="${brand.rose}" filter="url(#shadow)"/>
  <text x="${hasPrice ? 774 : 540}" y="${hasPrice ? 1598 : 1564}" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="850" text-anchor="middle">${xmlEscape(scenario.cta.toUpperCase())}</text>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-current-9x16.png`);
  await renderSvg(out, svg);
  return out;
}

async function editorialStyleScenario(scenario) {
  if (scenario.id.startsWith("a-")) return refinedProduct45(scenario);
  if (scenario.id.startsWith("b-")) return refinedInstitutional45(scenario);
  return refinedService45(scenario);
}

async function makeBoard(scenario, currentPath, editorialPath) {
  const current = await dataUri(currentPath);
  const editorial = await dataUri(editorialPath);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2360" height="1540" viewBox="0 0 2360 1540">
  <rect width="2360" height="1540" fill="#171113"/>
  <text x="80" y="74" fill="#FFF8F1" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="850">${xmlEscape(scenario.label)}</text>
  <text x="80" y="122" fill="#DABCA2" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="500">Comparativo visual isolado - sem novas geracoes OpenAI</text>
  <text x="80" y="198" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800">Pipeline atual</text>
  <text x="1220" y="198" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800">Composicao editorial refinada</text>
  <image href="${current}" x="80" y="230" width="1000" height="1250" preserveAspectRatio="xMidYMid meet"/>
  <image href="${editorial}" x="1220" y="230" width="1000" height="1250" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-comparison.png`);
  await renderSvg(out, svg);
  return out;
}

async function makeStoryBoard(scenario, currentPath, editorialPath) {
  const current = await dataUri(currentPath);
  const editorial = await dataUri(editorialPath);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2360" height="2140" viewBox="0 0 2360 2140">
  <rect width="2360" height="2140" fill="#171113"/>
  <text x="80" y="74" fill="#FFF8F1" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="850">${xmlEscape(scenario.label)} - 9:16</text>
  <text x="80" y="122" fill="#DABCA2" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="500">Teste de enquadramento vertical - prototipo isolado</text>
  <text x="230" y="198" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800">Pipeline atual</text>
  <text x="1390" y="198" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800">Editorial refinado</text>
  <image href="${current}" x="180" y="230" width="720" height="1280" preserveAspectRatio="xMidYMid meet"/>
  <image href="${editorial}" x="1280" y="230" width="720" height="1280" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  const out = resolve(OUT_DIR, `${scenario.id}-comparison-9x16.png`);
  await renderSvg(out, svg);
  return out;
}

async function makeOverview(results) {
  const images = await Promise.all(results.flatMap((result) => [result.current, result.editorial]).map(dataUri));
  const labels = results.flatMap((result) => [`${result.scenario.label} - atual`, `${result.scenario.label} - editorial`]);
  const cells = images.map((href, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 60 + col * 710;
    const y = 128 + row * 920;
    return `<text x="${x}" y="${y - 28}" fill="#FFF8F1" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800">${xmlEscape(labels[index])}</text>
    <image href="${href}" x="${x}" y="${y}" width="620" height="775" preserveAspectRatio="xMidYMid meet"/>`;
  }).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2200" height="1900" viewBox="0 0 2200 1900">
  <rect width="2200" height="1900" fill="#171113"/>
  <text x="60" y="70" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="850">VORIX - Prototipo editorial refinado 4:5</text>
  ${cells}
</svg>`;
  const out = resolve(OUT_DIR, "00-overview.png");
  await renderSvg(out, svg);
  return out;
}

function rel(filePath) {
  return basename(filePath);
}

async function writeReport(results, overview) {
  const rows = results.map((result) => `| ${result.scenario.label} | [Atual 4:5](${rel(result.current)}) | [Editorial 4:5](${rel(result.editorial)}) | [Comparativo 4:5](${rel(result.board)}) | [Comparativo 9:16](${rel(result.storyBoard)}) | ${result.scenario.note} |`).join("\n");
  const report = `# VORIX - Prototipo isolado de composicao editorial

Data local: 2026-10-06.

Escopo obedecido:

- Nenhuma chamada OpenAI.
- Nenhuma alteracao no Creative Engine ativo.
- Nenhum deploy.
- Nenhum benchmark final.
- Assets locais/controlados reaproveitados.

## Pranchas

[Overview](00-overview.png)

| Cenario | Pipeline atual | Editorial refinado | Lado a lado 4:5 | Lado a lado 9:16 | Observacao de asset |
|---|---|---|---|---|---|
${rows}

## Regras ajustadas nesta rodada

1. Headline nunca cruza mascaras, fotos ou transicoes de contraste: cada texto tem um plano visual consistente.
2. Produto/oferta preserva o asset original como produto principal quando existe, sem duplicacao decorativa circular.
3. Preco e CTA passam a formar um bloco comercial integrado, com preco deterministico e CTA em area propria.
4. Institucional premium ganhou area editorial mais equilibrada, headline contida e fotografia sem competir com o texto.
5. Servico/produto digital usa screenshot local real/controlado do produto com dados QA, nao UI inventada.
6. Foram mantidas tres linguagens distintas: vitrine de produto, editorial institucional e produto digital com device.
7. A saida 9:16 foi gerada separadamente para testar enquadramento vertical, nao apenas recortar a versao 4:5.

## Limitacoes que permanecem

1. Os precos dos fixtures servem apenas para testar composicao; nao devem ser tratados como preco comercial real sem confirmacao.
2. O cenario A ainda usa asset local de casamento como produto fisico simulado; um packshot real de cliente melhoraria fidelidade.
3. O screenshot do cenario C e real/controlado, mas vem de captura desktop; em producao o ideal e priorizar captura mobile real quando o formato for celular.
4. A validacao visual aqui e manual/local. A integracao futura ainda precisa de regras automaticas para contraste, overflow e colisao com mascaras.

Parecer: este prototipo deve ser avaliado visualmente antes de qualquer implementacao no motor ativo.
`;
  await writeFile(resolve(OUT_DIR, "README.md"), report, "utf8");
  await writeFile(resolve(OUT_DIR, "prototype-summary.json"), JSON.stringify({
    generatedAt: "2026-10-06",
    openAiCalls: 0,
    activeEngineModified: false,
    deployExecuted: false,
    overview: rel(overview),
    results: results.map((result) => ({
      scenario: result.scenario.id,
      current: rel(result.current),
      editorial: rel(result.editorial),
      comparison: rel(result.board),
      currentStory: rel(result.currentStory),
      editorialStory: rel(result.editorialStory),
      comparisonStory: rel(result.storyBoard),
      note: result.scenario.note,
    })),
  }, null, 2), "utf8");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];
  for (const scenario of scenarios) {
    const current = await currentStyleScenario(scenario);
    const editorial = await editorialStyleScenario(scenario);
    const board = await makeBoard(scenario, current, editorial);
    const currentStory = await currentStyleStory(scenario);
    const editorialStory = await refinedStoryScenario(scenario);
    const storyBoard = await makeStoryBoard(scenario, currentStory, editorialStory);
    results.push({ scenario, current, editorial, board, currentStory, editorialStory, storyBoard });
  }
  const overview = await makeOverview(results);
  await writeReport(results, overview);
  console.log(`[editorial-prototype] Generated ${results.length * 6 + 2} artifacts in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error("[editorial-prototype] failed", error);
  process.exitCode = 1;
});
