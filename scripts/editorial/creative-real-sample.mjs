// Amostra CONTROLADA de geração real pela API da OpenAI (autorizada em 25/11/2026, teto de US$ 3,50).
// Nada é publicado. Para cada caso: plano com os materiais originais → registro da operação prevista →
// checagem do orçamento ANTES da chamada → geração/edição (via openai-image-gateway.mjs no container) →
// localização da peça pela cor original → revisão visual contra a foto original → Quality Gate no
// renderizador → refação direcionada (se houver orçamento) → senão, composição com a foto original.
//
// Uso: node scripts/editorial/creative-real-sample.mjs <fixtures> <saída> [--dry]
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { renderArt } from "./codex-social-render.mjs";
import { aiReviewFromVerdict, productReviewPrompt } from "./creative-pipeline.mjs";

const [fixtures, out, flag] = process.argv.slice(2);
const DRY = flag === "--dry";
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

const reviewCost = (usage) => usage ? (usage.prompt_tokens * 0.15 + usage.completion_tokens * 0.6) / 1_000_000 : 0;

/** Registra a operação prevista, confere o orçamento e só então chama a API. */
async function paidCall(kind, request, meta) {
  const estimate = ESTIMATE[kind];
  const planned = { kind, ...meta, estimateUsd: estimate, spentBeforeUsd: Math.round(ledger.spentUsd * 10000) / 10000 };
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

const LIFESTYLE = [
  { key: "cmkv-ls-1", code: "000048", variant: "Azul-Marinho", headline: "Be Yourself, do seu jeito", body: "Pra um café sem pressa no fim de semana", scene: "uma mulher jovem tomando café numa cafeteria de rua com luz natural da manhã, vestindo a camiseta; enquadramento da cintura para cima, frontal" },
  { key: "cmkv-ls-2", code: "000033", variant: "Preto", headline: "No rain, no flowers", body: "Leve para o passeio de domingo", scene: "uma mulher caminhando num parque arborizado ao fim da tarde, vestindo a camiseta; plano médio frontal, a estampa voltada para a câmera" },
  { key: "cmkv-ls-3", code: "000043", variant: "Verde-Militar", headline: "Estilo leve, o ano todo", body: "Estampa delicada, caimento confortável", scene: "uma mulher numa cozinha clara e aconchegante, sorrindo, vestindo a camiseta; plano médio frontal" },
  { key: "cmkv-ls-4", code: "000044", variant: "Preto", headline: "All we need is love", body: "Para o look do dia a dia", scene: "uma mulher numa rua urbana com muros de tijolo e luz de fim de tarde, vestindo a camiseta com jeans; plano médio frontal" },
  { key: "cmkv-ls-5", code: "000047", variant: "Marrom", headline: "Love is all around", body: "A camiseta que combina com a rotina", scene: "uma mulher sentada num sofá de sala com plantas e luz suave, vestindo a camiseta; plano médio frontal, estampa visível" },
  { key: "cmkv-ls-6", code: "000035", variant: "Preto", headline: "Coração em destaque", body: "Básica com personalidade", scene: "uma mulher num estúdio fotográfico urbano com fundo de concreto e luz lateral, vestindo a camiseta; plano médio frontal" },
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
  const reference = { id: `produto:${item.code}:${item.variant}`, source: "catalog", productCode: item.code, variantLabel: item.variant, ...signals };
  const plan = planEditorialCreative({ workspaceId: "cmkv", brandName: "CMKV Wears", businessKind: "physical_products", idea: { id: item.key, title: item.headline, format: "single_image", keyMessage: `${item.headline}\n\n${item.body}`, approach: "lifestyle, dia a dia, look" }, ideaReferences: [reference], history: [], allowAi: true });
  const planned = plan.screens[0];
  const entry = { case: item.key, kind: "lifestyle", product: `${item.code} · ${item.variant}`, original: `${item.key}-original.png`, mode: plan.decision.mode, archetype: planned.spec.composition.archetype, transmitted: planned.transmitted.map((ref) => ref.id), attempts: [] };
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
    const prompt = `${planned.instruction}\nCena: ${item.scene}. Fotografia publicitária realista, luz natural, pele e tecido com textura real. A camiseta da Imagem 1 é EXATAMENTE a mesma peça: mesma cor, mesma estampa com o mesmo desenho, as mesmas letras, as mesmas cores e na mesma posição e tamanho no peito. Deixe os 45% da esquerda com fundo mais limpo para texto; a pessoa e a camiseta inteira no lado direito.${correction ? `\nCORREÇÃO DIRECIONADA: ${correction}` : ""}`;
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
    const box = await locateProductByColor(generatedBuffer, fabric);
    const protectedAreas = box ? [{ kind: "product", x: (box.x / meta.width) * 100, y: (box.y / meta.height) * 100, width: (box.w / meta.width) * 100, height: (box.h / meta.height) * 100 }] : [];
    let rendered;
    try {
      rendered = await renderArt({ ...cmkv, headline: item.headline, body: item.body, cta: "Confira no catálogo", base: generated.image, layout: "left", logoPlacement: "top_left", protectedAreas,
        fidelity: { spec: planned.spec, operation: "ai_edit_with_reference", archetype: "product_lifestyle", transmittedReferenceIds: [reference.id], reference: photoPng, aiReview }, history: [] });
    } catch (error) { rendered = { error: error.message }; }
    const gate = rendered.gate;
    entry.attempts.push({ attempt, base: baseName, final: rendered.image ? `${item.key}-final-${attempt}.jpg` : null, review, located: Boolean(box), measure: rendered.evidence?.productMeasure, gate: gate && { approved: gate.approved, failures: gate.failures, passes: gate.passes }, error: rendered.error, ms: generated.ms, costUsd: generated.costUsd + (reviewed?.costUsd ?? 0) });
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
  const rendered = await renderArt({ ...item.brand, headline: item.headline, body: item.body, cta: "", base: generated.image, layout: "top", logoPlacement: "bottom_right", protectedAreas: [],
    fidelity: { spec: planned.spec, operation: "ai_generation", archetype: "concept_scene", transmittedReferenceIds: [] }, history: [] }).catch((error) => ({ error: error.message }));
  if (rendered.image) await save(`${item.key}-final.jpg`, rendered.image);
  entry.attempts.push({ attempt: 1, base: `${item.key}-ia.png`, final: rendered.image ? `${item.key}-final.jpg` : null, gate: rendered.gate && { approved: rendered.gate.approved, failures: rendered.gate.failures, passes: rendered.gate.passes }, error: rendered.error, ms: generated.ms, costUsd: generated.costUsd });
  entry.result = { approved: rendered.gate?.approved === true, by: "ia", file: rendered.image ? `${item.key}-final.jpg` : null };
  return entry;
}

void ARCHETYPES;
const persist = () => writeFile(join(out, "real-report.json"), JSON.stringify({ budgetUsd: BUDGET_USD, spentUsd: ledger.spentUsd, operations: ledger.operations, cases: report }, null, 2));
for (const item of LIFESTYLE) { console.log(item.key); report.push(await lifestyleCase(item, 1)); await persist(); }
for (const item of CONCEPTUAL) { console.log(item.key); report.push(await conceptualCase(item)); await persist(); }
for (const item of LIFESTYLE) { console.log(`${item.key} (fase final)`); await lifestyleCase(item, 3); await persist(); }
console.log(`\nGasto total: US$ ${ledger.spentUsd.toFixed(4)} de US$ ${BUDGET_USD}`);
