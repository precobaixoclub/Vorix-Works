// Benchmark final — lado DIRECT: geração direta pelo MESMO modelo de imagem do Vorix (gpt-image-1,
// quality medium, 1024x1536), com os MESMOS briefing/textos/assets/perfil. Nada do Vorix (output,
// layout, imagem) entra aqui. Roda DENTRO do zuno-api (chave pelo secret manager; nunca impressa).
// Uso: node bench-direct.mjs <scenarios.json> <profilesDir> <outDir> <S1,S2,...>
import { readFile, writeFile } from "node:fs/promises";
const [scenariosPath, profilesDir, outDir, only] = process.argv.slice(2);
const scenarios = JSON.parse(await readFile(scenariosPath, "utf8")).filter((s) => !only || only.split(",").includes(s.id));

const ROLE_PT = { PRIMARY: "cor primária", SECONDARY: "cor secundária", ACCENT: "cor de destaque (CTA e detalhes)", NEUTRAL: "neutro (fundos/texto)" };
const LABEL = {
  PREMIUM: "premium", EDITORIAL: "editorial", TECH: "tecnológico", BOLD: "ousado", CORPORATE: "corporativo", MINIMAL: "minimalista",
  SERIF: "serifada", SANS: "sem serifa", REGULAR: "regular", BOLD_W: "negrito", HEAVY: "extra pesada",
  SOFT: "levemente arredondados", PILL: "em pílula (totalmente arredondados)", SHARP: "retos, sem arredondamento",
  HAIRLINE: "fios finos", NONE: "nenhum", SUBTLE: "sutis", PRONOUNCED: "marcadas",
  LOW: "baixa", MEDIUM: "média", HIGH: "alta",
  NO_STRONG_SHADOWS: "sem sombras fortes", NO_EMOJI: "sem emoji", NO_GRADIENTS: "sem degradês", NO_DARK_BACKGROUNDS: "sem fundos escuros", NO_ALL_CAPS: "nada em caixa alta",
  HAIRLINE_DIVIDERS: "divisores em fio fino", GENEROUS_WHITESPACE: "respiro generoso", DEPTH_LAYERS: "camadas com profundidade", SOFT_GLOW: "brilho suave",
  EDITORIAL_PHOTOGRAPHY: "fotografia editorial", GRADIENT: "degradês", MINIMAL_BACKGROUND: "fundo minimalista", STUDIO_PRODUCT: "produto em estúdio",
};
const l = (key) => LABEL[key] ?? String(key).toLowerCase();

/** Brand Profile estruturado → instruções naturais equivalentes (o que um designer leria). */
function brandToNatural(p) {
  const lines = [];
  const colors = p.colors.filter((c) => c.role !== "FORBIDDEN").map((c) => `${c.name} ${c.hex} (${ROLE_PT[c.role]})`);
  lines.push(`Paleta da marca: ${colors.join("; ")}.`);
  for (const c of p.colors.filter((c) => c.role === "FORBIDDEN")) lines.push(`Cor proibida: ${c.name} ${c.hex} — nunca usar.`);
  lines.push(`Estilo: ${l(p.style.primary)}${p.style.traits?.length ? `, ${p.style.traits.map(l).join(", ")}` : ""}. Densidade visual ${l(p.density)}; contraste ${({ SOFT: "suave", BALANCED: "equilibrado", HIGH: "alto" })[p.contrast] ?? String(p.contrast).toLowerCase()}.`);
  const t = p.typography;
  lines.push(`Tipografia: ${l(t.family)}, peso ${t.weight === "BOLD" ? "negrito" : l(t.weight)}${t.headlineCase === "UPPERCASE" ? ", headline em CAIXA ALTA" : t.headlineCase === "SENTENCE" ? ", headline em caixa normal (só a primeira letra maiúscula)" : ""}.`);
  lines.push(`Formas: cantos ${l(p.shape.corners)}; linhas: ${l(p.shape.lines)}; sombras: ${l(p.shape.shadow)}.`);
  if (p.imageStyles?.length) lines.push(`Estilo de imagem: ${p.imageStyles.map(l).join(", ")}.`);
  lines.push(`Intensidade comercial ${l(p.commercialIntensity)}.`);
  if (p.forbiddenPatterns?.length) lines.push(`Proibido: ${p.forbiddenPatterns.map(l).join(", ")}.`);
  if (p.preferredPatterns?.length) lines.push(`Preferir: ${p.preferredPatterns.map(l).join(", ")}.`);
  if (p.notes) lines.push(`Nota da marca: ${p.notes}`);
  return lines.join("\n");
}

function buildPrompt(s, profile) {
  const crop = s.format === "4:5"
    ? "Formato final 4:5 (feed do Instagram). A imagem será recortada no centro para 4:5: mantenha TODO texto, a logo e os elementos importantes dentro da área central, deixando as faixas de cima e de baixo (cerca de 8% cada) só com fundo."
    : "Formato final 9:16 (Stories). A imagem será recortada no centro para 9:16: mantenha TODO texto, a logo e os elementos importantes dentro da área central, deixando as faixas laterais (cerca de 8% de cada lado) só com fundo; respeite a área segura de Stories (nada importante nos 11% de cima e 14% de baixo).";
  const texts = [
    `Headline: "${s.texts.headline}"`,
    `Subheadline: "${s.texts.subheadline}"`,
    ...(s.texts.price ? [`Preço: "${s.texts.price}"`] : []),
    `Botão de CTA: "${s.texts.cta}"`,
  ];
  const refs = s.assets.map((a, i) => `Imagem de referência ${i + 1}: ${a.role === "product_photo" ? "foto REAL do produto — use exatamente este produto, sem alterar nem substituir" : a.role === "logo" ? "logo OFICIAL da marca Rumo ao Altar — reproduza exatamente, sem redesenhar" : "screenshot REAL do site (lista de presentes) — mostre fiel e legível, sem redesenhar nem inventar interface"}.`);
  return [
    `Crie uma peça publicitária FINAL e pronta para publicar no Instagram para a marca Rumo ao Altar (sites de casamento com lista de presentes e confirmação de presença).`,
    crop,
    `Briefing: ${s.brief}`,
    `Escreva EXATAMENTE estes textos em português, com a mesma grafia e acentos, e nenhum outro texto:`,
    ...texts,
    `Não invente preço, desconto, urgência, selo, claim ou qualquer outro texto.`,
    ...refs,
    `Identidade visual da marca:`,
    brandToNatural(profile),
  ].join("\n");
}

if (process.env.DRY === "1") { for (const s of scenarios) console.log("=====", s.id, "\n" + buildPrompt(s, JSON.parse(await readFile(`${profilesDir}/profile-${s.profile}.json`, "utf8")))); process.exit(0); }
const { loadApiConfig } = await import("/app/dist/interfaces/api/config/api-config.js");
const { buildApiContainer } = await import("/app/dist/interfaces/api/di/container.js");
const config = loadApiConfig();
const container = buildApiContainer(config);
const apiKey = (await container.secretManager.get("ai-provider:openai").catch(() => undefined))?.value?.apiKey ?? config.mediaProviders.openaiApiKey;
const baseUrl = config.mediaProviders.openaiApiBaseUrl ?? "https://api.openai.com";
const PRICE = { text: 5 / 1e6, image: 10 / 1e6, output: 40 / 1e6 };
const results = [];
for (const s of scenarios) {
  const profile = JSON.parse(await readFile(`${profilesDir}/profile-${s.profile}.json`, "utf8"));
  const prompt = buildPrompt(s, profile);
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", "1024x1536");
  form.append("quality", "medium");
  form.append("n", "1");
  for (const asset of s.assets) {
    const r = await fetch(asset.url);
    const buf = Buffer.from(await r.arrayBuffer());
    const type = asset.url.endsWith(".png") ? "image/png" : "image/jpeg";
    form.append("image[]", new Blob([buf], { type }), asset.url.split("/").pop());
  }
  const started = Date.now();
  const response = await fetch(`${baseUrl}/v1/images/edits`, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
  const json = await response.json();
  if (!response.ok) { results.push({ id: s.id, ok: false, status: response.status, error: json?.error?.message }); continue; }
  const usage = json.usage ?? {};
  const cost = (usage.input_tokens_details?.text_tokens ?? 0) * PRICE.text + (usage.input_tokens_details?.image_tokens ?? 0) * PRICE.image + (usage.output_tokens ?? 0) * PRICE.output;
  await writeFile(`${outDir}/direct-${s.id}.png`, Buffer.from(json.data[0].b64_json, "base64"));
  await writeFile(`${outDir}/direct-${s.id}-prompt.txt`, prompt);
  results.push({ id: s.id, ok: true, costUsd: Number(cost.toFixed(4)), usage, ms: Date.now() - started });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(`${outDir}/direct-results.json`, JSON.stringify(results, null, 1));
console.log("BENCH_DIRECT_DONE");
process.exit(0);
