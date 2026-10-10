// Fonte única do benchmark: mesmos briefings, textos, assets, perfis e formatos para Vorix e Direct.
const fs = require("fs");
const path = require("path");
const S = path.resolve(__dirname, "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), "utf8"));
const A45 = read("bp-a-body.json"), A916 = read("v916-a-body.json"), B916 = read("v916-b-body.json"), C45 = read("bp-c-body.json"), C916 = read("v916-c-body.json");
const B45 = { ...B916, aspectRatio: "4:5", objective: B916.objective.replace("9:16 (Stories/Reels)", "4:5 (feed)") };

const PRODUCT = { headline: "Sem Correria", subheadline: "Presentes, lista e RSVP em um só lugar.", price: "R$ 149,00", cta: "Comprar agora" };
const INSTITUTIONAL = { headline: "O casamento organizado como vocês sonharam", subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.", cta: "Conheça o Rumo ao Altar" };
const DIGITAL = { headline: "Sua lista de presentes, linda e sem planilha", subheadline: "Site do casamento com lista de presentes e confirmação de presença em um só lugar.", cta: "Criar meu site" };

const scenarios = [
  { id: "S1", family: "PRODUCT_OFFER", format: "4:5", profile: "P3", body: A45, texts: PRODUCT, brief: "Peça de oferta de produto. Produto real: relógio físico dourado com laço rosa, almofada rosa e alianças. Composição limpa, produto como foco." },
  { id: "S2", family: "PRODUCT_OFFER", format: "9:16", profile: "P2", body: A916, texts: PRODUCT, brief: "Peça de oferta de produto para Stories. Produto real: relógio físico dourado com laço rosa, almofada rosa e alianças. Composição limpa, produto como foco." },
  { id: "S3", family: "PREMIUM_INSTITUTIONAL", format: "4:5", profile: "P1", body: B45, texts: INSTITUTIONAL, brief: "Peça institucional premium de marca, sem venda direta, sem preço, sem oferta. Fotografia editorial real e atmosférica de casamento: luz dourada de fim de tarde, detalhes de cerimônia, flores, tecidos, profundidade de campo." },
  { id: "S4", family: "PREMIUM_INSTITUTIONAL", format: "9:16", profile: "P3", body: B916, texts: INSTITUTIONAL, brief: "Peça institucional premium de marca para Stories, sem venda direta, sem preço, sem oferta. Fotografia editorial real e atmosférica de casamento: luz dourada de fim de tarde, detalhes de cerimônia, flores, tecidos, profundidade de campo." },
  { id: "S5", family: "SERVICE_DIGITAL", format: "4:5", profile: "P2", body: C45, texts: DIGITAL, brief: "Peça de serviço digital mostrando a lista de presentes real do site do casamento (screenshot real fornecido, protagonista, fiel e legível, sem redesenho). Convite para o casal criar o próprio site. Sem preço em destaque, sem promoção." },
  { id: "S6", family: "SERVICE_DIGITAL", format: "9:16", profile: "P1", body: C916, texts: DIGITAL, brief: "Peça de serviço digital para Stories mostrando a lista de presentes real do site do casamento (screenshot real fornecido, protagonista, fiel e legível, sem redesenho). Convite para o casal criar o próprio site. Sem preço em destaque, sem promoção." },
];

const out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });
for (const s of scenarios) {
  const body = { ...s.body, name: `Benchmark final ${s.id} — ${s.family} ${s.format} (${s.profile})` };
  fs.writeFileSync(path.join(out, `body-${s.id}.json`), JSON.stringify(body));
}
fs.writeFileSync(path.join(out, "scenarios.json"), JSON.stringify(scenarios.map(({ body, ...rest }) => ({ ...rest, assets: body.referenceAssets.map((asset) => ({ role: asset.role, url: asset.url })) })), null, 1));
console.log(scenarios.map((s) => `${s.id} ${s.family} ${s.format} ${s.profile} assets=${s.body.referenceAssets.map((a) => a.role).join("+")} ar=${s.body.aspectRatio}`).join("\n"));
