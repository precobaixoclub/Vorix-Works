// Bateria visual do motor criativo (Etapa C) — gera as peças "depois" com o MESMO caminho do piloto
// (plano → composição → renderização → Quality Gate → revisão), sem IA paga e sem publicar nada.
//
// Uso (na raiz, depois de `npm run build`):
//   node scripts/editorial/creative-benchmark.mjs <fixtures> <saída>
// <fixtures>/brands/<workspace>.profile.json + <workspace>.logos.txt + <workspace>.logoN.bin (perfil e logos oficiais)
// <fixtures>/cmkv-photos/<código>_<cor>.webp (fotos do catálogo, uso autorizado)
// <fixtures>/demo-photos/*.jpg (marca demonstrativa de outro segmento)
// As capturas da Vorix vêm de scripts/editorial/library/vorix-works (front real + dados demo).
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { renderArt } from "./codex-social-render.mjs";
import { produceScreen } from "./creative-pipeline.mjs";

const [fixtures, out] = process.argv.slice(2);
if (!fixtures || !out) throw new Error("Uso: node scripts/editorial/creative-benchmark.mjs <fixtures> <saída>");
const dist = (path) => import(pathToFileURL(join(process.cwd(), "dist", path)).href);
const { planEditorialCreative } = await dist("application/creative-engine/plan-editorial-creative.js");
const { COMPOSITION_ARCHETYPES } = await dist("application/creative-engine/creative-spec.js");
const { catalogPhotoSignals } = await dist("infrastructure/media/creative/catalog-photo-signals.js");

/** Foto do catálogo como candidata: sinais de captura de tela + cor medida vs. nome da variante. */
async function catalogCandidate(id, code, variantLabel, data, explicitRole) {
  return { id, source: "catalog", productCode: code, variantLabel, ...(await catalogPhotoSignals(data, variantLabel)), ...(explicitRole ? { explicitRole } : {}) };
}
const archetypes = Object.fromEntries(COMPOSITION_ARCHETYPES.map((item) => [item.id, { operation: item.operation, mode: item.mode }]));
await mkdir(out, { recursive: true });

async function brand(workspaceId, name) {
  const profile = JSON.parse(await readFile(join(fixtures, "brands", `${workspaceId}.profile.json`), "utf8"));
  const rows = (await readFile(join(fixtures, "brands", `${workspaceId}.logos.txt`), "utf8")).trim().split("\n").filter(Boolean);
  const logos = await Promise.all(rows.map(async (row, index) => {
    const [, variant, backgrounds] = row.split("|");
    const data = await sharp(await readFile(join(fixtures, "brands", `${workspaceId}.logo${index + 1}.bin`))).png().toBuffer();
    return { data: data.toString("base64"), variant, backgrounds: JSON.parse(backgrounds || "[]") };
  }));
  return { name, profile, logos, logoConfig: {} };
}

const VORIX_FEATURES = [
  { key: "atendimento_whatsapp", label: "Atendimento pelo WhatsApp", keywords: ["whatsapp", "atendimento", "mensagens", "responder", "caixa de entrada"] },
  { key: "continuidade_atendimento", label: "Histórico e continuidade do atendimento", keywords: ["historico", "continuidade", "transferencia", "repasse", "muda de pessoa", "proximo atendente", "contexto"] },
  { key: "conteudo_ia", label: "Produção de conteúdo com IA", keywords: ["conteudo", "conteudos", "posts", "redes sociais", "calendario", "pautas", "marketing"] },
  { key: "reunioes_analise", label: "Gravação e análise de reuniões", keywords: ["reuniao", "reunioes", "gravacao", "gravador", "transcricao", "resumo", "decisoes", "ata"] },
];

async function vorixCaptures() {
  const dir = "scripts/editorial/library/vorix-works";
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const assets = {};
  const candidates = [];
  for (const capture of manifest.captures) {
    const id = `biblioteca:vorix:${capture.file}`;
    assets[id] = { data: (await readFile(join(dir, capture.file))).toString("base64"), devicePixelRatio: capture.devicePixelRatio, focus: capture.focus, feature: capture.feature, form: capture.form };
    candidates.push({ id, source: "brand_library", materialType: "screenshot_app", name: capture.label, tags: [`feature:${capture.feature}`, ...capture.keywords], notes: capture.label, form: capture.form });
  }
  return { assets, candidates };
}

async function catalog(dir, codes) {
  const files = (await readdir(dir)).filter((file) => /\.(webp|jpe?g|png)$/i.test(file)).sort();
  const assets = {};
  const products = [];
  for (const code of codes) {
    const photos = [];
    for (const file of files.filter((name) => name.startsWith(`${code}_`))) {
      const data = await readFile(join(dir, file));
      const id = `produto:${code}:${file.replace(/^[^_]+_|\.\w+$/g, "")}`;
      assets[id] = { data: data.toString("base64") };
      photos.push({ id, data, variantLabel: file.replace(/^[^_]+_|\.\w+$/g, "").replace(/-Logo(Branca|Preta|Vermelha)$/, "") });
    }
    products.push({ code, photos });
  }
  return { assets, products };
}

const idea = (id, title, keyMessage, over = {}) => ({ id, externalId: id, title, format: "single_image", keyMessage, cta: over.cta ?? "", ...over });

const vorix = await brand("workspace-mscc9pi2-jkvwbo", "Vorix Works");
const cmkv = await brand("workspace-cee-prelaunch-mv47cmfh", "CMKV Wears");
const captures = await vorixCaptures();
const cmkvCatalog = await catalog(join(fixtures, "cmkv-photos"), ["000048", "000033", "000043", "000044", "000047"]);
const demoDir = join(fixtures, "demo-photos");
const demoAssets = {
  "produto:AUR-01:Obsidian": { data: (await readFile(join(demoDir, "pbc07.jpg"))).toString("base64") },
  "produto:AUR-02:Preto": { data: (await readFile(join(demoDir, "pbc01.jpg"))).toString("base64") },
};
const demoLogo = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="120"><text x="0" y="88" font-family="Georgia, serif" font-size="92" letter-spacing="10" fill="#F3E6CF">AURUM</text></svg>`)).png().toBuffer();
const demo = {
  name: "Aurum Perfumaria (demonstração)", logoConfig: {},
  profile: { identity: { colors: [{ name: "Preto profundo", hex: "#0E0B09", role: "PRIMARY" }, { name: "Âmbar", hex: "#E0913A", role: "ACCENT" }, { name: "Creme", hex: "#F3E6CF" }], typography: { family: "SERIF" }, notes: "Perfumaria autoral, fundo sempre escuro, luz âmbar." } },
  logos: [{ data: demoLogo.toString("base64"), variant: "LIGHT", backgrounds: ["DARK"] }],
};

const cases = [
  // Vorix — software: as demonstrações usam a interface real.
  { brand: vorix, key: "vorix-1-whatsapp", businessKind: "software", features: VORIX_FEATURES, library: captures.candidates, assets: captures.assets,
    idea: idea("v1", "Atendimento pelo WhatsApp sem perder cliente", "Responda pelo WhatsApp com toda a equipe\n\nUma caixa de entrada para todos os atendentes", { cta: "Conheça a Vorix" }) },
  { brand: vorix, key: "vorix-2-continuidade", businessKind: "software", features: VORIX_FEATURES, library: captures.candidates, assets: captures.assets,
    idea: idea("v2", "Continuidade de atendimento entre colaboradores", "O atendimento muda de pessoa. O histórico continua.\n\nQuem assume vê a conversa, a nota interna e o responsável", { cta: "Veja na Vorix" }) },
  { brand: vorix, key: "vorix-3-conteudo", businessKind: "software", features: VORIX_FEATURES, library: captures.candidates, assets: captures.assets,
    idea: idea("v3", "Produção de conteúdo com IA", "Seus posts planejados e agendados num só calendário\n\nIdeias, produção e publicação no mesmo lugar", { cta: "Conheça o Marketing da Vorix" }) },
  { brand: vorix, key: "vorix-4-reunioes", businessKind: "software", features: VORIX_FEATURES, library: captures.candidates, assets: captures.assets,
    idea: idea("v4", "Gravação e análise de reuniões", "A reunião termina. As decisões ficam registradas.\n\nResumo, decisões e próximos passos gerados da gravação", { cta: "Grave sua próxima reunião" }) },
  { brand: vorix, key: "vorix-5-carrossel-reunioes", businessKind: "software", features: VORIX_FEATURES, library: captures.candidates, assets: captures.assets,
    idea: idea("v5", "Reunião sem ata é reunião perdida", "", { format: "carousel", carouselScript: [{ headline: "A reunião acabou. O que foi decidido?" }, { headline: "A transcrição mostra quem falou o quê" }, { headline: "O resumo traz decisões e próximos passos" }] }) },
  // CMKV — produto físico: a foto original do SKU é a referência e a peça é protagonista.
  { brand: cmkv, key: "cmkv-1-isolado", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000048", "Azul-Marinho"]],
    idea: idea("c1", "Novidade: camiseta Be Yourself", "Be Yourself, do seu jeito\n\nAlgodão macio e estampa que não passa despercebida", { cta: "Confira no catálogo" }) },
  { brand: cmkv, key: "cmkv-2-lifestyle", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000033", "Preto"]],
    idea: idea("c2", "Look do fim de semana", "Para o café de sábado e o passeio de domingo\n\nNo rain, no flowers", { cta: "Monte seu look", approach: "lifestyle, dia a dia" }) },
  { brand: cmkv, key: "cmkv-3-editorial", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000043", "Verde-Militar"]],
    idea: idea("c3", "Editorial: estilo leve", "Estilo leve, atemporal\n\nUma estampa delicada para usar o ano todo", { cta: "Ver a peça", approach: "editorial elegante" }) },
  { brand: cmkv, key: "cmkv-4-variacoes", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000048", "Azul-Marinho"], ["000048", "Bege"], ["000048", "Branco"]],
    idea: idea("c4", "Qual cor é a sua?", "Uma estampa, três cores\n\nQual versão você escolhe?", { cta: "Escolha a sua cor" }) },
  { brand: cmkv, key: "cmkv-5-estampa", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000044", "Preto"]],
    idea: idea("c5", "Detalhe da estampa", "All we need is love\n\nA estampa original, em detalhe", { cta: "Ver detalhes" }) },
  { brand: cmkv, key: "cmkv-6-comercial", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000047", "Marrom"]],
    idea: idea("c6", "Chegou: Love is all around", "Chegou. Garanta a sua.\n\nEstoque limitado", { cta: "Compre agora" }) },
  { brand: cmkv, key: "cmkv-7-variante-errada", businessKind: "physical_products", catalog: cmkvCatalog, products: [["000033", "Azul-Marinho"], ["000033", "Marrom"]],
    idea: idea("c7", "No rain, no flowers em azul-marinho", "No rain, no flowers\n\nAgora em azul-marinho", { cta: "Confira no catálogo" }) },
  // Marca demonstrativa de outro segmento (perfumaria): fotos com fundo de ambiente.
  { brand: demo, key: "demo-1-perfume", businessKind: "physical_products", demoProducts: [{ code: "AUR-01", photos: [{ id: "produto:AUR-01:Obsidian", variantLabel: "Obsidian" }] }], assets: demoAssets,
    idea: idea("d1", "Lançamento Obsidian Elixir", "Obsidian Elixir\n\nNotas de âmbar e madeira escura", { cta: "Descubra a fragrância", approach: "lançamento" }) },
  { brand: demo, key: "demo-2-relogio", businessKind: "physical_products", demoProducts: [{ code: "AUR-02", photos: [{ id: "produto:AUR-02:Preto", variantLabel: "Preto" }] }], assets: demoAssets,
    idea: idea("d2", "Presente de fim de ano", "Um presente que marca o tempo\n\nCronógrafo preto em aço", { cta: "Escolha o presente", approach: "destaque" }) },
];

const history = new Map();
const report = [];
for (const item of cases) {
  const started = Date.now();
  const assets = item.assets ?? item.catalog?.assets ?? {};
  const ideaReferences = [];
  // Produto e variantes escolhidos na pauta (como o usuário faria ao selecionar no catálogo).
  for (const [index, [code, variant]] of (item.products ?? []).entries()) {
    const photo = item.catalog.products.find((entry) => entry.code === code).photos.find((entry) => entry.variantLabel === variant);
    ideaReferences.push(await catalogCandidate(photo.id, code, photo.variantLabel, photo.data, index ? "product_variant" : undefined));
  }
  for (const product of item.demoProducts ?? []) {
    for (const photo of product.photos) ideaReferences.push(await catalogCandidate(photo.id, product.code, photo.variantLabel, Buffer.from(assets[photo.id].data, "base64")));
  }
  const brandHistory = history.get(item.brand.name) ?? [];
  const plan = planEditorialCreative({
    workspaceId: item.key, brandName: item.brand.name, businessKind: item.businessKind, softwareFeatures: item.features, idea: item.idea,
    ideaReferences, libraryCaptures: item.library, history: brandHistory, allowAi: false,
  });
  const screens = [];
  for (const [index, planned] of plan.screens.entries()) {
    const result = await produceScreen({ planned, brand: item.brand, assets, history: brandHistory, render: renderArt, generateAi: undefined, archetypes, seriesKey: planned.spec.seriesKey });
    const file = `${item.key}${plan.screens.length > 1 ? `-${index + 1}` : ""}.jpg`;
    if (result.ok) {
      await writeFile(join(out, file), Buffer.from(result.image, "base64"));
      brandHistory.unshift(result.fingerprint);
    }
    screens.push({ file: result.ok ? file : null, approved: result.ok, archetype: result.archetype, requestedArchetype: planned.spec.composition.archetype, attempts: result.attempts.map(({ gate, ...rest }) => ({ ...rest, ...(gate ? { failures: gate.failures, passes: gate.passes } : {}) })), evidence: result.evidence });
  }
  history.set(item.brand.name, brandHistory);
  report.push({
    case: item.key, brand: item.brand.name, mode: plan.decision.mode, modeReasons: plan.decision.reasons, feature: plan.decision.feature?.feature.key,
    transmitted: plan.resolved.transmitted.map((reference) => ({ id: reference.id, role: reference.role })), excluded: plan.resolved.excluded.map((entry) => ({ id: entry.reference.id, reason: entry.reason })),
    autoSelected: plan.autoSelected, blockers: plan.resolved.missing, screens, ms: Date.now() - started,
  });
  console.log(`${item.key}: ${plan.decision.mode} → ${screens.map((screen) => `${screen.archetype}:${screen.approved ? "aprovada" : "reprovada"}`).join(", ")} (${Date.now() - started} ms)`);
}
await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
