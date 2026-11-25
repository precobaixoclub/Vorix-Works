// Amostra CONTROLADA de geração real pela API da OpenAI (autorizada em 25/11/2026, teto de US$ 3,50).
// Nada é publicado. Para cada caso: plano com os materiais originais → registro da operação prevista →
// checagem do orçamento ANTES da chamada → geração/edição (via openai-image-gateway.mjs no container) →
// localização da peça pela cor original → revisão visual contra a foto original → Quality Gate no
// renderizador → refação direcionada (se houver orçamento) → senão, composição com a foto original.
//
// Uso: node scripts/editorial/creative-real-sample.mjs <fixtures> <saída> [--dry | --codex]
//   --codex: gera e revisa pelo Codex do servidor (mesmo usuário/modelo do piloto, plano ChatGPT, sem custo por
//   imagem). Arquivos temporários só em /var/lib/vorix-codex/jobs/amostra-* e apagados ao fim; nada é publicado.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { renderArt } from "./codex-social-render.mjs";
import { aiReviewFromVerdict, productReviewPrompt } from "./creative-pipeline.mjs";

const [fixtures, out, flag] = process.argv.slice(2);
const DRY = flag === "--dry";
const REREVIEW = flag === "--rereview";
const CODEX = flag === "--codex" || REREVIEW;
const HOST = "rumoaoaltar-netcup";
const AGENT_HOME = "/var/lib/vorix-codex";
const CODEX_BIN = "/opt/vorix-editorial/tools/node_modules/.bin/codex";
// Não concorre com o piloto: para antes do horário de preparo (11:15/18:15, Brasília).
const STOP_AT = ["10:50", "17:50"];
const BUDGET_USD = 3.5;
const dist = (path) => import(pathToFileURL(join(process.cwd(), "dist", path)).href);
const { planEditorialCreative } = await dist("application/creative-engine/plan-editorial-creative.js");
const { COMPOSITION_ARCHETYPES } = await dist("application/creative-engine/creative-spec.js");
const { computeGptImageCostUsd, getGptImageModel, parseGptImageUsage } = await dist("shared/utils/gpt-image-models.js");
const { catalogPhotoSignals } = await dist("infrastructure/media/creative/catalog-photo-signals.js");
const { cutoutProduct, productColor } = await dist("infrastructure/media/creative/product-cutout.js");
const { locateProductByColor } = await dist("infrastructure/media/creative/measure-fidelity.js");
await mkdir(out, { recursive: true });

const MODEL = "gpt-image-2.6-sunburst";
const REVIEW_MODEL = "gpt-4o-mini";
const SIZE = "1088x1360";
// Estimativa prévia (conservadora) por operação, usada para NÃO passar do teto antes de chamar.
const ESTIMATE = { edit_high: 0.3, generate_medium: 0.1, review: 0.03 };
const gateway = await readFile("scripts/editorial/openai-image-gateway.mjs", "utf8");
const ledger = { spentUsd: 0, operations: [] };

function callGateway(request) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", ["rumoaoaltar-netcup", "docker exec -i zuno-zuno-api-1 node --input-type=module"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", () => undefined);
    child.once("error", reject);
    child.once("close", () => {
      const line = Buffer.concat(chunks).toString("utf8").trim().split("\n").at(-1);
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Resposta ilegível do gateway")); }
    });
    child.stdin.end(`const request = ${JSON.stringify(request)};\n${gateway}`);
  });
}

function ssh(command, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [HOST, command], { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().trim().split("\n").slice(-3).join(" ") || `ssh ${code}`))));
    child.stdin.end(input ?? "");
  });
}

const nowBrt = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const nearPilotSlot = () => { const now = nowBrt(); return STOP_AT.some((stop) => now >= stop && now < `${stop.slice(0, 2)}:59`); };

const IMAGE_SCHEMA = { type: "object", additionalProperties: false, required: ["image", "layout", "logoPlacement", "protectedAreas"], properties: {
  image: { type: "string" }, layout: { type: "string", enum: ["top", "left", "bottom"] },
  logoPlacement: { type: "string", enum: ["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"] },
  protectedAreas: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "x", "y", "width", "height"], properties: { kind: { type: "string", enum: ["face", "product", "person", "key_object"] }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } } } } };
const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["garmentMatches", "fabricColorMatches", "printElementsMatch", "printPositionMatches", "materialDifferences", "acceptableVariations", "verdict"],
  properties: { garmentMatches: { type: "boolean" }, fabricColorMatches: { type: "boolean" }, printElementsMatch: { type: "boolean" }, printPositionMatches: { type: "boolean" },
    materialDifferences: { type: "array", items: { type: "string" } }, acceptableVariations: { type: "array", items: { type: "string" } }, verdict: { type: "string", enum: ["approve", "reject"] } },
};

/** Mesmo prompt-moldura do piloto: regras fixas + instrução do plano; devolve o caminho e as áreas protegidas. */
const pilotPrompt = (instruction) => `Você é responsável pela base visual desta pauta aprovada para Instagram/Facebook. Use a ferramenta nativa de geração/edição de imagem exatamente uma vez.\n` +
  `As instruções da peça no fim descrevem somente a criação da imagem. Não use shell nem publique.\n` +
  `Formato final obrigatório: retrato 4:5 (1080 x 1350), com todos os elementos relevantes dentro de margens de 8%. A arte será composta com texto e logo oficial depois. ` +
  `Responda JSON com image sendo o caminho absoluto do arquivo que a ferramenta produziu e protectedAreas listando, em porcentagem da imagem gerada (0–100: x, y do canto superior esquerdo, width, height), ` +
  `cada rosto (face), a pessoa principal (person), o produto/peça principal (product) e outros elementos que não podem ser cobertos (key_object).\n\nINSTRUÇÕES DA PEÇA (planejamento criativo):\n${instruction}`;

async function codexExec(job, schema, prompt, images, timeoutMs) {
  const schemaPath = `${job}/schema-${Date.now()}.json`;
  await ssh(`cat > ${schemaPath} && chmod 644 ${schemaPath}`, JSON.stringify(schema));
  const args = ["--ask-for-approval", "never", "exec", "--model", "gpt-6.2-sol", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--cd", job, "--json", "--output-schema", schemaPath, ...images.flatMap((image) => ["--image", image]), "-"];
  const command = `timeout ${Math.round(timeoutMs / 1000)} runuser -u vorix-codex -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=${AGENT_HOME} CODEX_HOME=${AGENT_HOME}/.codex ${CODEX_BIN} ${args.join(" ")}`;
  const events = (await ssh(command, prompt)).toString("utf8");
  const last = events.split("\n").flatMap((line) => { try { const event = JSON.parse(line); return event.type === "item.completed" && event.item?.type === "agent_message" ? [event.item.text] : []; } catch { return []; } }).at(-1);
  if (!last) throw new Error("Codex não devolveu resposta");
  return JSON.parse(last);
}

/** Geração/edição e revisão pelo Codex do servidor, no formato do gateway da API. */
async function codexCall(request) {
  const started = Date.now();
  const job = `${AGENT_HOME}/jobs/amostra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await ssh(`mkdir -p ${job} && chown vorix-codex:vorix-codex ${job} && chmod 755 ${job}`);
    const files = [];
    for (const [index, image] of (request.images ?? []).entries()) {
      const name = `${job}/imagem-${index + 1}.png`;
      await ssh(`cat > ${name} && chmod 644 ${name}`, Buffer.from(image, "base64"));
      files.push(name);
    }
    if (request.op === "review") {
      const verdict = await codexExec(job, REVIEW_SCHEMA, `${request.prompt} Não gere imagens; só compare e responda o JSON.`, files, 240000);
      return { ok: true, content: JSON.stringify(verdict), ms: Date.now() - started };
    }
    const plan = await codexExec(job, IMAGE_SCHEMA, pilotPrompt(request.prompt), files, 330000);
    const path = String(plan.image ?? "");
    if (!path.startsWith(`${AGENT_HOME}/.codex/generated_images/`) || !/\.(png|jpe?g|webp)$/i.test(path) || path.includes("..")) throw new Error("Caminho de imagem fora do diretório do Codex");
    const bytes = await ssh(`cat '${path}' && rm -f '${path}'`);
    const png = await sharp(bytes).png().toBuffer();
    return { ok: true, image: png.toString("base64"), protectedAreas: plan.protectedAreas ?? [], layout: plan.layout, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, code: "codex", message: String(error.message ?? error).slice(0, 300), ms: Date.now() - started };
  } finally {
    await ssh(`rm -rf ${job}`).catch(() => undefined);
  }
}

const reviewCost = (usage) => usage ? (usage.prompt_tokens * 0.15 + usage.completion_tokens * 0.6) / 1_000_000 : 0;

/** Registra a operação prevista, confere o orçamento e só então chama a API. */
async function paidCall(kind, request, meta) {
  const estimate = ESTIMATE[kind];
  const planned = { kind, ...meta, estimateUsd: estimate, spentBeforeUsd: Math.round(ledger.spentUsd * 10000) / 10000 };
  if (CODEX) {
    if (nearPilotSlot()) {
      ledger.operations.push({ ...planned, engine: "codex", outcome: "skipped_pilot_window" });
      console.log(`  ⏸ ${kind} pulado: perto do horário do piloto (${nowBrt()})`);
      return undefined;
    }
    console.log(`  → codex ${kind} ${meta.case}${meta.attempt ? ` tentativa ${meta.attempt}` : ""} (${nowBrt()})`);
    const result = await codexCall(request);
    ledger.operations.push({ ...planned, engine: "codex", model: "gpt-6.2-sol", estimateUsd: 0, outcome: result.ok ? "ok" : `failed:${result.message ?? ""}`, ms: result.ms, costUsd: 0 });
    if (!result.ok) console.log(`  ✗ ${kind}: ${result.message}`);
    return result.ok ? { ...result, costUsd: 0 } : undefined;
  }
  if (ledger.spentUsd + estimate > BUDGET_USD) {
    ledger.operations.push({ ...planned, outcome: "skipped_budget" });
    console.log(`  ✋ orçamento: ${kind} pulado (gasto US$ ${ledger.spentUsd.toFixed(3)})`);
    return undefined;
  }
  console.log(`  → ${kind} ${meta.case}${meta.attempt ? ` tentativa ${meta.attempt}` : ""} (estimado US$ ${estimate}, gasto até aqui US$ ${ledger.spentUsd.toFixed(3)})`);
  if (DRY) { ledger.operations.push({ ...planned, outcome: "dry_run" }); return undefined; }
  const result = await callGateway(request);
  let costUsd = 0;
  if (result.ok && kind !== "review") {
    const usage = parseGptImageUsage(result.usage);
    costUsd = usage ? computeGptImageCostUsd(getGptImageModel(MODEL), usage) : estimate;
  } else if (result.ok) costUsd = reviewCost(result.usage);
  ledger.spentUsd += costUsd;
  ledger.operations.push({ ...planned, outcome: result.ok ? "ok" : `failed:${result.status}:${result.code ?? ""}`, ms: result.ms, costUsd: Math.round(costUsd * 10000) / 10000, ...(result.ok ? {} : { message: result.message }) });
  if (!result.ok) console.log(`  ✗ ${kind}: ${result.status} ${result.code ?? ""} ${result.message ?? ""}`);
  return result.ok ? { ...result, costUsd } : undefined;
}

async function brand(workspaceId, name) {
  const profile = JSON.parse(await readFile(join(fixtures, "brands", `${workspaceId}.profile.json`), "utf8"));
  const rows = (await readFile(join(fixtures, "brands", `${workspaceId}.logos.txt`), "utf8")).trim().split("\n").filter(Boolean);
  const logos = await Promise.all(rows.map(async (row, index) => {
    const [, variant, backgrounds] = row.split("|");
    return { data: (await sharp(await readFile(join(fixtures, "brands", `${workspaceId}.logo${index + 1}.bin`))).png().toBuffer()).toString("base64"), variant, backgrounds: JSON.parse(backgrounds || "[]") };
  }));
  return { name, profile, logos, logoConfig: {} };
}
const cmkv = await brand("workspace-cee-prelaunch-mv47cmfh", "CMKV Wears");
const vorix = await brand("workspace-mscc9pi2-jkvwbo", "Vorix Works");
const demoLogo = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="120"><text x="0" y="88" font-family="Georgia, serif" font-size="92" letter-spacing="10" fill="#F3E6CF">AURUM</text></svg>`)).png().toBuffer();
const aurum = { name: "Aurum Perfumaria (demonstração)", logoConfig: {}, profile: { identity: { colors: [{ name: "Preto profundo", hex: "#0E0B09", role: "PRIMARY" }, { name: "Âmbar", hex: "#E0913A", role: "ACCENT" }, { name: "Creme", hex: "#F3E6CF" }], typography: { family: "SERIF" }, notes: "Perfumaria autoral, fundo sempre escuro, luz âmbar." } }, logos: [{ data: demoLogo.toString("base64"), variant: "LIGHT", backgrounds: ["DARK"] }] };
const ARCHETYPES = COMPOSITION_ARCHETYPES.map((item) => item.id);

// Seis campanhas da CMKV (validação de 25/11/2026). Produtos e cores diferentes, fotos consistentes.
// As variantes Azul-Marinho do 000033 e do 000035 estão com foto de outra cor no catálogo: proibidas aqui
// (além do bloqueio automático da checagem de cor).
const FORBIDDEN_VARIANTS = new Set(["000033:Azul-Marinho", "000035:Azul-Marinho-LogoBranca"]);
const LIFESTYLE = [
  { key: "cmkv-ls-1-masculino", label: "Modelo masculino", code: "000037", variant: "Preto", layout: "left", headline: "Fé no que você veste", body: "Camiseta preta, estampa fé", scene: "um homem jovem de barba curta vestindo esta MESMA camiseta, em pé numa calçada urbana ao entardecer; plano médio frontal, a estampa inteira visível no peito, caimento masculino natural" },
  { key: "cmkv-ls-2-feminino", label: "Modelo feminino", code: "000048", variant: "Bege", layout: "left", headline: "Be Yourself, do seu jeito", body: "Para um café sem pressa", scene: "uma mulher jovem tomando café numa cafeteria com luz natural da manhã, vestindo esta MESMA camiseta; enquadramento da cintura para cima, frontal" },
  { key: "cmkv-ls-3-estampa", label: "Destaque da estampa", code: "000044", variant: "Preto", layout: "top", headline: "All we need is love", body: "A estampa é o recado", scene: "close-up editorial do peito de uma pessoa vestindo esta MESMA camiseta, a estampa ocupando boa parte da imagem e perfeitamente nítida, luz lateral suave que mostra a textura do tecido" },
  { key: "cmkv-ls-4-externo", label: "Lifestyle externo", code: "000043", variant: "Verde-Militar", layout: "top", headline: "Leve para o sábado", body: "Estampa leve, dia inteiro", scene: "uma mulher caminhando numa feira de rua ensolarada com frutas e toldos coloridos ao fundo desfocado, vestindo esta MESMA camiseta; plano americano frontal, estampa visível" },
  { key: "cmkv-ls-5-editorial", label: "Editorial de moda", code: "000047", variant: "Marrom", layout: "left", headline: "Love is all around", body: "Editorial outono", scene: "editorial de moda em estúdio com fundo de papel cor creme e luz de recorte, modelo em pose de revista vestindo esta MESMA camiseta com calça de alfaiataria; plano médio, estampa frontal" },
  { key: "cmkv-ls-6-produto", label: "Produto em destaque", code: "000033", variant: "Preto", layout: "bottom", headline: "No rain, no flowers", body: "Chegou na CMKV", scene: "foto publicitária de produto: esta MESMA camiseta vestida, enquadrada do ombro à cintura, centralizada sobre fundo de estúdio escuro com feixe de luz suave e algumas flores secas ao lado; a camiseta é a protagonista" },
];
const CONCEPTUAL = [
  { key: "conc-1-vorix", brand: vorix, businessKind: "software", headline: "Atendimento é trabalho em equipe", body: "Quem assume sabe o que foi combinado", scene: "duas pessoas de uma pequena empresa conversando e passando o atendimento de uma para a outra num escritório moderno com luz roxa suave; sem telas, sem papéis, sem texto" },
  { key: "conc-2-vorix", brand: vorix, businessKind: "software", headline: "Boa reunião termina com decisão", body: "E a decisão fica registrada", scene: "três pessoas numa sala de reunião moderna, apertando as mãos ao final de uma conversa produtiva, luz roxa e azulada; sem telas, sem papéis, sem texto" },
  { key: "conc-3-cmkv", brand: cmkv, businessKind: "services", headline: "Toda estampa conta uma história", body: "Feita para quem veste o que sente", scene: "close de mãos de uma artesã preparando tecidos e tintas num ateliê de estamparia com luz quente; nenhuma peça pronta, nenhuma estampa, nenhum logotipo, sem texto" },
  { key: "conc-4-aurum", brand: aurum, businessKind: "services", headline: "Notas de âmbar e madeira", body: "Uma fragrância para a noite", scene: "natureza-morta de resina de âmbar, lascas de madeira escura e fumaça suave sobre pedra, luz âmbar dramática, fundo escuro; nenhum frasco, nenhum texto" },
];

const report = [];
let redosLeft = 4;
const save = async (name, b64) => { if (b64) await writeFile(join(out, name), Buffer.from(b64, "base64")); };

const lifestyleState = new Map();

/** Fase 1: primeira tentativa. Fase 3: refação direcionada (se houver orçamento) e, sem aprovação, a foto original. */
async function lifestyleCase(item, phase) {
  if (FORBIDDEN_VARIANTS.has(`${item.code}:${item.variant}`)) throw new Error(`Variante proibida na amostra: ${item.code} ${item.variant}`);
  if (phase === 3) {
    const state = lifestyleState.get(item.key);
    if (state.entry.result?.approved) return state.entry;
    if (state.generatedOnce && redosLeft > 0) {
      redosLeft -= 1;
      if (await lifestyleAttempt(state, 2)) return state.entry;
    }
    return fallbackComposite(state);
  }
  const file = (await readFile(join(fixtures, "cmkv-photos", `${item.code}_${item.variant}.webp`)));
  const photoPng = (await sharp(file).resize({ height: 1024 }).png().toBuffer()).toString("base64");
  await save(`${item.key}-original.png`, photoPng);
  const signals = await catalogPhotoSignals(file, item.variant);
  if (signals.variantColorCheck?.consistent === false) throw new Error(`Foto inconsistente com a variante: ${item.code} ${item.variant}`);
  const reference = { id: `produto:${item.code}:${item.variant}`, source: "catalog", productCode: item.code, variantLabel: item.variant, ...signals };
  const plan = planEditorialCreative({ workspaceId: "cmkv", brandName: "CMKV Wears", businessKind: "physical_products", idea: { id: item.key, title: item.headline, format: "single_image", keyMessage: `${item.headline}\n\n${item.body}`, approach: "lifestyle, dia a dia, look" }, ideaReferences: [reference], history: [], allowAi: true });
  const planned = plan.screens[0];
  const entry = { case: item.key, label: item.label, kind: "lifestyle", product: `${item.code} · ${item.variant}`, original: `${item.key}-original.png`, mode: plan.decision.mode, archetype: planned.spec.composition.archetype, transmitted: planned.transmitted.map((ref) => ref.id), attempts: [] };
  if (planned.spec.composition.archetype !== "product_lifestyle") entry.note = `planejador escolheu ${planned.spec.composition.archetype}`;
  const fabric = await productColor(await cutoutProduct(file));
  const state = { item, file, photoPng, reference, planned, entry, fabric, correction: undefined, generatedOnce: false };
  lifestyleState.set(item.key, state);
  await lifestyleAttempt(state, 1);
  return entry;
}

async function lifestyleAttempt(state, attempt) {
  const { item, photoPng, reference, planned, entry, fabric, correction } = state;
  {
    const prompt = `${planned.instruction}\nCena: ${item.scene}. Fotografia publicitária realista, luz natural, pele e tecido com textura real. A camiseta da Imagem 1 é EXATAMENTE a mesma peça: mesma cor, mesma estampa com o mesmo desenho, as mesmas letras, as mesmas cores e na mesma posição e tamanho no peito. ${item.layout === "left" ? "Deixe os 45% da esquerda com fundo mais limpo para texto; a pessoa e a camiseta inteira no lado direito." : item.layout === "top" ? "Deixe o terço superior com fundo mais limpo para texto; a camiseta abaixo dele." : "Deixe o terço inferior com fundo mais limpo para texto; a camiseta acima dele."}${correction ? `\nCORREÇÃO DIRECIONADA: ${correction}` : ""}`;
    const generated = await paidCall("edit_high", { op: "edit", model: MODEL, prompt, size: SIZE, quality: "high", images: [photoPng] }, { case: item.key, attempt, endpoint: "/v1/images/edits", model: MODEL, inputs: [reference.id], promptChars: prompt.length });
    if (!generated?.image) { entry.attempts.push({ attempt, outcome: "not_generated" }); return false; }
    state.generatedOnce = true;
    const baseName = `${item.key}-ia-${attempt}.png`;
    await save(baseName, generated.image);
    const reviewPrompt = productReviewPrompt({ productCode: item.code, variantLabel: item.variant });
    const reviewed = await paidCall("review", { op: "review", model: REVIEW_MODEL, prompt: reviewPrompt, images: [photoPng, generated.image] }, { case: item.key, attempt, endpoint: "/v1/chat/completions", model: REVIEW_MODEL, inputs: [reference.id, baseName] });
    let review;
    try { review = reviewed ? JSON.parse(reviewed.content) : undefined; } catch { review = undefined; }
    const aiReview = aiReviewFromVerdict(review);
    const generatedBuffer = Buffer.from(generated.image, "base64");
    const meta = await sharp(generatedBuffer).metadata();
    const colorBox = await locateProductByColor(generatedBuffer, fabric);
    const reported = (generated.protectedAreas ?? []).filter((area) => area.kind === "product").sort((a, b) => b.width * b.height - a.width * a.height)[0];
    // Área do produto: a informada pelo gerador (Codex) ou, sem ela, a localizada pela cor original do tecido.
    const box = reported ? { x: reported.x / 100 * meta.width, y: reported.y / 100 * meta.height, w: reported.width / 100 * meta.width, h: reported.height / 100 * meta.height } : colorBox;
    const protectedAreas = [...(generated.protectedAreas ?? []).filter((area) => area.kind === "face"),
      ...(box ? [{ kind: "product", x: (box.x / meta.width) * 100, y: (box.y / meta.height) * 100, width: (box.w / meta.width) * 100, height: (box.h / meta.height) * 100 }] : [])];
    let rendered;
    try {
      rendered = await renderArt({ ...cmkv, headline: item.headline, body: item.body, cta: "Confira no catálogo", base: generated.image, layout: item.layout, logoPlacement: item.layout === "left" ? "top_left" : item.layout === "top" ? "bottom_right" : "top_right", protectedAreas,
        fidelity: { spec: planned.spec, operation: "ai_edit_with_reference", archetype: "product_lifestyle", transmittedReferenceIds: [reference.id], reference: photoPng, aiReview }, history: [] });
    } catch (error) { rendered = { error: error.message }; }
    const gate = rendered.gate;
    entry.attempts.push({ attempt, product: box ? { x: Math.round(box.x / meta.width * 100), y: Math.round(box.y / meta.height * 100), w: Math.round(box.w / meta.width * 100), h: Math.round(box.h / meta.height * 100) } : null, fingerprint: rendered.fingerprint ?? null, base: baseName, final: rendered.image ? `${item.key}-final-${attempt}.jpg` : null, review, located: Boolean(box), measure: rendered.evidence?.productMeasure, gate: gate && { approved: gate.approved, failures: gate.failures, passes: gate.passes }, error: rendered.error, ms: generated.ms, costUsd: generated.costUsd + (reviewed?.costUsd ?? 0) });
    if (rendered.image) await save(`${item.key}-final-${attempt}.jpg`, rendered.image);
    if (gate?.approved) { entry.result = { approved: true, by: "ia", file: `${item.key}-final-${attempt}.jpg` }; return true; }
    state.correction = [...(gate?.failures ?? []).map((failure) => failure.message), ...(review?.findings ?? [])].join(" ").slice(0, 500) || "Reproduza a estampa exatamente como na Imagem 1.";
    return false;
  }
}

async function fallbackComposite(state) {
  const { item, file, reference, planned, entry } = state;
  // A IA não preservou o produto: composição com a fotografia original (fidelidade por construção).
  const fallback = await renderArt({ ...cmkv, headline: item.headline, body: item.body, cta: "Confira no catálogo",
    composition: { mode: "physical_product", archetype: "product_editorial", products: [{ id: reference.id, data: file.toString("base64"), productCode: item.code, variantLabel: item.variant }] },
    fidelity: { spec: planned.spec, operation: "deterministic_composite", archetype: "product_editorial", transmittedReferenceIds: [reference.id] }, history: [] });
  await save(`${item.key}-fallback.jpg`, fallback.image);
  entry.result = { approved: fallback.gate.approved, by: "composicao_foto_original", file: `${item.key}-fallback.jpg`, gate: { approved: fallback.gate.approved, failures: fallback.gate.failures } };
  return entry;
}

async function conceptualCase(item) {
  const plan = planEditorialCreative({ workspaceId: item.key, brandName: item.brand.name, businessKind: item.businessKind, idea: { id: item.key, title: item.headline, format: "single_image", keyMessage: `${item.headline}\n\n${item.body}`, approach: "institucional, conceito" }, ideaReferences: [], history: [], allowAi: true, explicitMode: "conceptual" });
  const planned = plan.screens[0];
  const prompt = `${planned.instruction}\nCena: ${item.scene}. Fotografia realista e editorial. Deixe o terço superior com fundo mais limpo para o texto.`;
  const entry = { case: item.key, kind: "conceitual", brand: item.brand.name, mode: plan.decision.mode, archetype: planned.spec.composition.archetype, attempts: [] };
  const generated = await paidCall("generate_medium", { op: "generate", model: MODEL, prompt, size: SIZE, quality: "medium" }, { case: item.key, attempt: 1, endpoint: "/v1/images/generations", model: MODEL, inputs: [], promptChars: prompt.length });
  if (!generated?.image) { entry.result = { approved: false, by: "nao_gerada" }; return entry; }
  await save(`${item.key}-ia.png`, generated.image);
  const rendered = await renderArt({ ...item.brand, headline: item.headline, body: item.body, cta: "", base: generated.image, layout: generated.layout ?? "top", logoPlacement: "bottom_right", protectedAreas: generated.protectedAreas ?? [],
    fidelity: { spec: planned.spec, operation: "ai_generation", archetype: "concept_scene", transmittedReferenceIds: [] }, history: [] }).catch((error) => ({ error: error.message }));
  if (rendered.image) await save(`${item.key}-final.jpg`, rendered.image);
  entry.attempts.push({ attempt: 1, base: `${item.key}-ia.png`, final: rendered.image ? `${item.key}-final.jpg` : null, gate: rendered.gate && { approved: rendered.gate.approved, failures: rendered.gate.failures, passes: rendered.gate.passes }, error: rendered.error, ms: generated.ms, costUsd: generated.costUsd });
  entry.result = { approved: rendered.gate?.approved === true, by: "ia", file: rendered.image ? `${item.key}-final.jpg` : null };
  return entry;
}

void ARCHETYPES;
// Pré-checagem do saldo (≈ US$ 0,00001; sem crédito volta 429 e não cobra): sem saldo, nenhuma chamada paga.
if (!DRY && !CODEX) {
  const probe = await callGateway({ op: "probe" });
  ledger.operations.push({ kind: "probe", case: "saldo", endpoint: "/v1/chat/completions", model: "gpt-4o-mini", inputs: [], estimateUsd: 0.00001, outcome: probe.ok ? "ok" : `failed:${probe.status}:${probe.code ?? ""}`, ms: probe.ms, costUsd: probe.ok ? 0.00001 : 0 });
  if (!probe.ok) {
    console.log(`Saldo indisponível (${probe.status} ${probe.code ?? ""}): amostra NÃO executada, nenhuma chamada paga.`);
    await writeFile(join(out, "real-report.json"), JSON.stringify({ budgetUsd: BUDGET_USD, spentUsd: 0, preflight: probe, operations: ledger.operations, cases: [] }, null, 2));
    process.exit(0);
  }
  ledger.spentUsd += 0.00001;
}

/** Variedade entre as peças aprovadas: distância perceptual par a par + enquadramento e posição do produto. */
async function varietyReport() {
  const { hammingHex } = await dist("application/creative-engine/visual-variety.js");
  const pieces = report.filter((item) => item.kind === "lifestyle").map((item) => ({ key: item.case, attempt: item.attempts.find((attempt) => attempt.final && attempt.gate?.approved) ?? item.attempts.at(-1) })).filter((item) => item.attempt?.fingerprint);
  const pairs = [];
  for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) pairs.push({ a: pieces[i].key, b: pieces[j].key, distance: hammingHex(pieces[i].attempt.fingerprint.dHash, pieces[j].attempt.fingerprint.dHash) });
  return {
    pieces: pieces.map((item) => ({ key: item.key, textLayout: item.attempt.fingerprint.textLayout, palette: item.attempt.fingerprint.palette, product: item.attempt.product })),
    pairs, minDistance: pairs.length ? Math.min(...pairs.map((pair) => pair.distance)) : null, nearDuplicates: pairs.filter((pair) => pair.distance <= 10),
  };
}

// --rereview: revisão calibrada das imagens JÁ geradas (nenhuma geração nova), mantendo o veredito anterior ao lado.
if (REREVIEW) {
  const previous = JSON.parse(await readFile(join(out, "real-report.json"), "utf8"));
  for (const entry of previous.cases.filter((item) => item.kind === "lifestyle")) {
    const item = LIFESTYLE.find((candidate) => candidate.key === entry.case);
    const file = await readFile(join(fixtures, "cmkv-photos", `${item.code}_${item.variant}.webp`));
    const photoPng = (await sharp(file).resize({ height: 1024 }).png().toBuffer()).toString("base64");
    const reference = { id: `produto:${item.code}:${item.variant}`, source: "catalog", productCode: item.code, variantLabel: item.variant, ...(await catalogPhotoSignals(file, item.variant)) };
    const plan = planEditorialCreative({ workspaceId: "cmkv", brandName: "CMKV Wears", businessKind: "physical_products", idea: { id: item.key, title: item.headline, format: "single_image", keyMessage: `${item.headline}

${item.body}`, approach: "lifestyle, dia a dia, look", visualDirection: "lifestyle: a camiseta vestida na rotina, look do dia a dia" }, ideaReferences: [reference], history: [], allowAi: true });
    const fabric = await productColor(await cutoutProduct(file));
    let approvedFile;
    for (const attempt of entry.attempts.filter((candidate) => candidate.base)) {
      const generated = (await readFile(join(out, attempt.base))).toString("base64");
      console.log(`${entry.case} tentativa ${attempt.attempt}: revisão calibrada`);
      const reviewed = await paidCall("review", { op: "review", prompt: productReviewPrompt({ productCode: item.code, variantLabel: item.variant }), images: [photoPng, generated] }, { case: entry.case, attempt: attempt.attempt, endpoint: "codex (revisão calibrada)", inputs: [reference.id, attempt.base] });
      let review;
      try { review = reviewed ? JSON.parse(reviewed.content) : undefined; } catch { review = undefined; }
      const aiReview = aiReviewFromVerdict(review);
      const buffer = Buffer.from(generated, "base64");
      const meta = await sharp(buffer).metadata();
      const box = attempt.product ? { x: attempt.product.x / 100 * meta.width, y: attempt.product.y / 100 * meta.height, w: attempt.product.w / 100 * meta.width, h: attempt.product.h / 100 * meta.height } : await locateProductByColor(buffer, fabric);
      const protectedAreas = box ? [{ kind: "product", x: box.x / meta.width * 100, y: box.y / meta.height * 100, width: box.w / meta.width * 100, height: box.h / meta.height * 100 }] : [];
      const rendered = await renderArt({ ...cmkv, headline: item.headline, body: item.body, cta: "Confira no catálogo", base: generated, layout: item.layout, logoPlacement: item.layout === "left" ? "top_left" : item.layout === "top" ? "bottom_right" : "top_right", protectedAreas,
        fidelity: { spec: plan.screens[0].spec, operation: "ai_edit_with_reference", archetype: "product_lifestyle", transmittedReferenceIds: [reference.id], reference: photoPng, aiReview }, history: [] }).catch((error) => ({ error: error.message }));
      const finalName = `${entry.case}-final-${attempt.attempt}-calibrada.jpg`;
      if (rendered.image) await save(finalName, rendered.image);
      attempt.calibrated = { review, final: rendered.image ? finalName : null, gate: rendered.gate && { approved: rendered.gate.approved, failures: rendered.gate.failures, passes: rendered.gate.passes, warnings: rendered.gate.warnings }, fingerprint: rendered.fingerprint ?? null, error: rendered.error, ms: reviewed?.ms };
      if (rendered.gate?.approved && !approvedFile) approvedFile = finalName;
      await writeFile(join(out, "real-report.json"), JSON.stringify(previous, null, 2));
    }
    entry.calibratedResult = approvedFile ? { approved: true, by: "ia", file: approvedFile } : { approved: entry.result?.approved ?? false, by: entry.result?.by, file: entry.result?.file };
  }
  previous.rereviewOperations = ledger.operations;
  report.push(...previous.cases);
  previous.varietyCalibrated = await (async () => {
    const { hammingHex } = await dist("application/creative-engine/visual-variety.js");
    const pieces = previous.cases.filter((item) => item.kind === "lifestyle").map((item) => ({ key: item.case, attempt: item.attempts.find((attempt) => attempt.calibrated?.gate?.approved) ?? item.attempts.find((attempt) => attempt.calibrated) })).filter((item) => item.attempt?.calibrated?.fingerprint);
    const pairs = [];
    for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) pairs.push({ a: pieces[i].key, b: pieces[j].key, distance: hammingHex(pieces[i].attempt.calibrated.fingerprint.dHash, pieces[j].attempt.calibrated.fingerprint.dHash) });
    return { pieces: pieces.map((item) => ({ key: item.key, textLayout: item.attempt.calibrated.fingerprint.textLayout, palette: item.attempt.calibrated.fingerprint.palette, product: item.attempt.product })), pairs, minDistance: pairs.length ? Math.min(...pairs.map((pair) => pair.distance)) : null, nearDuplicates: pairs.filter((pair) => pair.distance <= 10) };
  })();
  await writeFile(join(out, "real-report.json"), JSON.stringify(previous, null, 2));
  console.log("revisão calibrada concluída");
  process.exit(0);
}

const persist = () => writeFile(join(out, "real-report.json"), JSON.stringify({ budgetUsd: BUDGET_USD, spentUsd: ledger.spentUsd, operations: ledger.operations, cases: report }, null, 2));
for (const item of LIFESTYLE) { console.log(item.key); report.push(await lifestyleCase(item, 1)); await persist(); }
for (const item of CONCEPTUAL) { console.log(item.key); report.push(await conceptualCase(item)); await persist(); }
for (const item of LIFESTYLE) { console.log(`${item.key} (fase final)`); await lifestyleCase(item, 3); await persist(); }
await writeFile(join(out, "real-report.json"), JSON.stringify({ budgetUsd: BUDGET_USD, spentUsd: ledger.spentUsd, operations: ledger.operations, cases: report, variety: await varietyReport() }, null, 2));
console.log(`\n${CODEX ? "Motor: Codex (plano ChatGPT, sem custo por imagem)" : "Motor: API OpenAI"} — gasto total: US$ ${ledger.spentUsd.toFixed(4)} de US$ ${BUDGET_USD}`);
