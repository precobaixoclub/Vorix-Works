import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { classifyReference, resolveReferencesForMode } from "../dist/application/creative-engine/reference-roles.js";
import { classifyVisualIntent, inferBusinessKind } from "../dist/application/creative-engine/visual-intent.js";
import { buildImageInstruction, chooseComposition, COMPOSITION_ARCHETYPES } from "../dist/application/creative-engine/creative-spec.js";
import { assessVariety } from "../dist/application/creative-engine/visual-variety.js";
import { evaluateFidelityGate } from "../dist/application/creative-engine/creative-fidelity-gate.js";
import { planRevision } from "../dist/application/creative-engine/targeted-revision.js";
import { planEditorialCreative, rotationOrder, screensForIdea } from "../dist/application/creative-engine/plan-editorial-creative.js";
import { redactSecrets } from "../dist/application/creative-engine/creative-trace.js";
import { checkVariantColor, dHash, siteCaptureScore, textureStats } from "../dist/infrastructure/media/creative/image-analysis.js";
import { applyHomography, homography, warpIntoQuad } from "../dist/infrastructure/media/creative/perspective-warp.js";
import { composeProduct, composeSoftware } from "../dist/infrastructure/media/creative/compositions.js";
import { measureProductFidelity } from "../dist/infrastructure/media/creative/measure-fidelity.js";
import { cutoutProduct } from "../dist/infrastructure/media/creative/product-cutout.js";
import { produceScreen } from "../scripts/editorial/creative-pipeline.mjs";

// Reestruturação do motor criativo (25/11/2026). Achados da auditoria fixados aqui com imagens
// sintéticas — nenhuma IA paga, nenhum dado de cliente:
// - CMKV: colagem do catálogo no lugar do produto, rodízio que repetia a mesma estampa, cabides vazios;
// - Vorix: monitores vazios (o prompt proibia letras e nenhuma captura real era usada);
// - Quality Gate que aprovava produto errado porque a paleta estava certa.

const ARCHETYPES = Object.fromEntries(COMPOSITION_ARCHETYPES.map((item) => [item.id, { operation: item.operation, mode: item.mode }]));
const svgPng = async (body, width = 1050, height = 1400) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)).png().toBuffer();
// "Foto de estúdio": fundo cinza uniforme + peça colorida com uma "estampa".
const studioShirt = (fabric, print = `<circle cx="525" cy="520" r="120" fill="#F2C94C"/>`) => svgPng(`<rect width="100%" height="100%" fill="#E8E6E6"/><path d="M250 250 L400 180 L650 180 L800 250 L860 520 L740 560 L740 1250 L310 1250 L310 560 L190 520 Z" fill="${fabric}"/>${print}`);
// "Captura de interface": barras, colunas e cartões chapados.
const uiCapture = (width = 1280, height = 800) => svgPng(`<rect width="100%" height="100%" fill="#0B0F19"/><rect width="220" height="${height}" fill="#121224"/><rect x="220" width="${width - 220}" height="64" fill="#161628"/>${Array.from({ length: 6 }, (_, index) => `<rect x="260" y="${100 + index * 110}" width="${width - 320}" height="80" rx="10" fill="#1F2937"/><rect x="280" y="${120 + index * 110}" width="${300 + index * 40}" height="14" fill="#E5E7EB"/><rect x="280" y="${145 + index * 110}" width="${500 - index * 30}" height="10" fill="#9CA3AF"/>`).join("")}`, width, height);
const TONES = { surface: "#F5F2EB", accent: "#C9A227", foreground: "#19151A", light: true };
const IDEA = (over = {}) => ({ id: "idea-1", title: "Pauta", format: "single_image", keyMessage: "Mensagem principal", ...over });

test("biblioteca de referências: cada arquivo tem um papel; captura de site nunca vira foto do produto", () => {
  assert.equal(classifyReference({ id: "a", source: "brand_library", materialType: "logo_principal" }, "physical_products").role, "logo");
  assert.equal(classifyReference({ id: "b", source: "brand_library", materialType: "screenshot_site" }, "physical_products").role, "site_capture");
  assert.equal(classifyReference({ id: "c", source: "brand_library", materialType: "screenshot_site" }, "software").role, "software_capture");
  assert.equal(classifyReference({ id: "d", source: "catalog", productCode: "000033", variantLabel: "Preto" }, "physical_products").role, "product_photo");
  assert.equal(classifyReference({ id: "e", source: "catalog", productCode: "000033", siteCaptureScore: 0.9 }, "physical_products").role, "site_capture");
  assert.equal(classifyReference({ id: "f", source: "idea_upload", explicitRole: "product_photo", siteCaptureScore: 0.8 }, "physical_products").role, "site_capture");
  assert.equal(classifyReference({ id: "g", source: "idea_upload" }, "physical_products").role, "inspiration");
  assert.equal(classifyReference({ id: "h", source: "brand_library", materialType: "campanha" }, "physical_products").role, "past_creative");
});

test("produto físico: a foto selecionada é a principal e a única que manda; captura/logo/peça anterior ficam de fora", () => {
  const refs = [
    classifyReference({ id: "logo", source: "brand_library", materialType: "logo_principal" }, "physical_products"),
    classifyReference({ id: "site", source: "brand_library", materialType: "screenshot_site" }, "physical_products"),
    classifyReference({ id: "produto:000048:Azul-Marinho", source: "catalog", productCode: "000048", variantLabel: "Azul-Marinho" }, "physical_products"),
    classifyReference({ id: "produto:000048:Bege", source: "catalog", productCode: "000048", variantLabel: "Bege", explicitRole: "product_variant" }, "physical_products"),
    classifyReference({ id: "outro", source: "catalog", productCode: "000033", variantLabel: "Preto", explicitRole: "product_variant" }, "physical_products"),
    classifyReference({ id: "antiga", source: "brand_library", materialType: "campanha" }, "physical_products"),
  ];
  const resolved = resolveReferencesForMode("physical_product", refs, { productCode: "000048" });
  assert.equal(resolved.primary.id, "produto:000048:Azul-Marinho");
  assert.deepEqual(resolved.transmitted.map((item) => item.id), ["produto:000048:Azul-Marinho", "produto:000048:Bege"]);
  assert.deepEqual(resolved.excluded.map((item) => item.reference.id).sort(), ["antiga", "logo", "outro", "site"]);
  assert.equal(resolved.missing.length, 0);
});

test("sem foto original: só captura do site → bloqueia com orientação (nunca usa a captura no lugar)", () => {
  const onlySite = resolveReferencesForMode("physical_product", [classifyReference({ id: "site", source: "brand_library", materialType: "screenshot_site" }, "physical_products")]);
  assert.equal(onlySite.primary, undefined);
  assert.deepEqual(onlySite.transmitted, []);
  assert.equal(onlySite.missing[0].code, "SITE_CAPTURE_NOT_PRODUCT");
  assert.equal(onlySite.missing[0].blocking, true);
  const nothing = resolveReferencesForMode("physical_product", []);
  assert.equal(nothing.missing[0].code, "PRODUCT_PHOTO_MISSING");
});

test("foto da variante com outra cor (erro de catálogo): excluída; se for a anunciada, bloqueia", () => {
  assert.equal(checkVariantColor("Azul-Marinho", [12, 213, 218]).consistent, false);
  assert.equal(checkVariantColor("Azul-Marinho - Logo Branca", [26, 42, 69]).consistent, true);
  assert.equal(checkVariantColor("Preto", [23, 22, 24]).consistent, true);
  assert.equal(checkVariantColor("Cor inventada", [0, 0, 0]), undefined);
  const wrong = classifyReference({ id: "navy", source: "catalog", productCode: "000033", variantLabel: "Azul-Marinho", variantColorCheck: { consistent: false, measured: "#0CD5DA", expected: "azul-marinho", closest: "azul-claro" } }, "physical_products");
  const ok = classifyReference({ id: "marrom", source: "catalog", productCode: "000033", variantLabel: "Marrom", explicitRole: "product_variant" }, "physical_products");
  const resolved = resolveReferencesForMode("physical_product", [wrong, ok]);
  assert.ok(resolved.excluded.some((item) => item.reference.id === "navy"));
  assert.ok(resolved.missing.some((item) => item.code === "VARIANT_PHOTO_MISMATCH" && item.blocking));
});

test("modo é decidido por pauta, não por empresa: a mesma marca de software tem peça de software e peça conceitual", () => {
  const features = [{ key: "reunioes", label: "Gravação de reuniões", keywords: ["reuniao", "transcricao", "resumo"] }];
  const demo = classifyVisualIntent({ businessKind: "software", idea: { title: "Como a transcrição da reunião vira resumo" }, references: [], softwareFeatures: features });
  assert.equal(demo.mode, "software");
  assert.equal(demo.feature.feature.key, "reunioes");
  const institutional = classifyVisualIntent({ businessKind: "software", idea: { title: "Nossos valores: manifesto da equipe" }, references: [], softwareFeatures: features });
  assert.equal(institutional.mode, "conceptual");
  const shirt = classifyVisualIntent({ businessKind: "physical_products", idea: { title: "Nova estampa da coleção" }, references: [] });
  assert.equal(shirt.mode, "physical_product");
  assert.equal(classifyVisualIntent({ businessKind: "physical_products", idea: { title: "x" }, references: [], explicitMode: "conceptual" }).mode, "conceptual");
  assert.equal(inferBusinessKind({ physicalCatalogCount: 57 }), "physical_products");
  assert.equal(inferBusinessKind({ brandNotes: "Plataforma SaaS de atendimento" }), "software");
});

test("planejamento: pauta de software sem captura anexada usa a captura real da Biblioteca; sem nenhuma, bloqueia", () => {
  const features = [{ key: "continuidade", label: "Continuidade", keywords: ["historico", "continuidade"] }];
  const captures = [
    { id: "cap-calendario", source: "brand_library", materialType: "screenshot_app", name: "Calendário", tags: ["calendario", "conteudo"], form: "desktop" },
    { id: "cap-historico", source: "brand_library", materialType: "screenshot_app", name: "Histórico da conversa", tags: ["historico", "continuidade"], form: "desktop" },
  ];
  const base = { workspaceId: "ws", brandName: "Vorix", businessKind: "software", softwareFeatures: features, ideaReferences: [], history: [], allowAi: false };
  const plan = planEditorialCreative({ ...base, idea: IDEA({ title: "O histórico continua quando o atendimento muda de pessoa" }), libraryCaptures: captures });
  assert.equal(plan.decision.mode, "software");
  assert.equal(plan.blocked, false);
  assert.deepEqual(plan.screens[0].transmitted.map((item) => item.id), ["cap-historico"]);
  assert.match(plan.screens[0].instruction, /Não desenhe telas/);
  const blocked = planEditorialCreative({ ...base, idea: IDEA({ title: "O histórico continua quando o atendimento muda de pessoa" }), libraryCaptures: [] });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.resolved.missing[0].code, "SOFTWARE_CAPTURE_MISSING");
});

test("planejamento: produto físico sem foto na pauta usa o rodízio dos produtos liberados — e o rodízio não repete o último", () => {
  assert.deepEqual(rotationOrder(["000033", "000035", "000037"], []), ["000033", "000035", "000037"]);
  assert.deepEqual(rotationOrder(["000033", "000035", "000037"], [{ codes: ["000033"] }]), ["000035", "000037", "000033"]);
  assert.deepEqual(rotationOrder(["000033", "000035", "000037"], [{ codes: ["000037"] }, { codes: ["000033"] }, { codes: ["000035"] }]), ["000035", "000033", "000037"]);
  const plan = planEditorialCreative({
    workspaceId: "ws", brandName: "CMKV", businessKind: "physical_products", idea: IDEA({ title: "Camiseta nova na coleção" }), ideaReferences: [], history: [], allowAi: false,
    editorialProducts: [{ code: "000035", photos: [{ id: "produto:000035:Preto", variantLabel: "Preto" }, { id: "produto:000035:Bege", variantLabel: "Bege" }] }],
  });
  assert.equal(plan.decision.mode, "physical_product");
  assert.equal(plan.resolved.primary.id, "produto:000035:Preto");
  assert.match(plan.autoSelected[0].reason, /rodízio/);
});

test("composição: arquétipos variam com o histórico e entre telas do carrossel; sem IA autorizada, só composição controlada", () => {
  const references = { primary: { id: "p", role: "product_photo" }, variants: [{ id: "v", role: "product_variant" }], logos: [], complementary: [], transmitted: [], excluded: [], missing: [] };
  const idea = { title: "Novidade" };
  const first = chooseComposition({ mode: "physical_product", idea, references, history: [], allowAi: false, seed: "a" });
  assert.equal(ARCHETYPES[first.archetype.id].operation, "deterministic_composite");
  const history = [{ archetype: first.archetype.id, textLayout: "top", productCount: 1, palette: [], dHash: "0".repeat(16) }];
  const second = chooseComposition({ mode: "physical_product", idea, references, history, allowAi: false, seed: "a" });
  assert.notEqual(second.archetype.id, first.archetype.id);
  const withAi = chooseComposition({ mode: "physical_product", idea: { title: "Look para o dia a dia, rotina e passeio" }, references, history: [], allowAi: true, seed: "a" });
  assert.equal(withAi.archetype.id, "product_lifestyle");
  const phone = chooseComposition({ mode: "software", idea: { title: "Responda o cliente no WhatsApp" }, references: { ...references, primary: { id: "c", role: "software_capture", form: "desktop" }, variants: [] }, history: [], allowAi: false, seed: "a" });
  assert.notEqual(phone.archetype.id, "phone_conversation");
  const plan = planEditorialCreative({ workspaceId: "ws", brandName: "CMKV", businessKind: "physical_products", idea: IDEA({ format: "carousel", carouselScript: [{ headline: "1" }, { headline: "2" }, { headline: "3" }] }), history: [], allowAi: false,
    ideaReferences: [{ id: "produto:1:Preto", source: "catalog", productCode: "1", variantLabel: "Preto" }, { id: "produto:1:Bege", source: "catalog", productCode: "1", variantLabel: "Bege", explicitRole: "product_variant" }] });
  const archetypes = plan.screens.map((item) => item.spec.composition.archetype);
  assert.equal(new Set(archetypes).size, 3, `telas diferentes: ${archetypes}`);
  assert.equal(plan.screens[0].spec.seriesKey, "ideia:idea-1");
});

test("repetição: imagem quase idêntica ou mesma estrutura seguida é reprovada; na mesma série só a tela idêntica reprova", () => {
  const item = (dHashValue, archetype = "product_studio", seriesKey) => ({ archetype, textLayout: "top", productCount: 1, palette: [], dHash: dHashValue, ...(seriesKey ? { seriesKey } : {}) });
  assert.equal(assessVariety(item("ffff0000ffff0000"), [item("ffff0000ffff0001")]).ok, false);
  assert.equal(assessVariety(item("ffff0000ffff0000"), [item("0000ffff0000ffff")]).ok, true);
  // Mesma série: unidade visual permitida (parecidas passam), mas tela idêntica não.
  assert.equal(assessVariety(item("ffff0000ffff0000", "x", "s"), [item("ffff0000ff0f00f0", "x", "s")]).ok, true);
  assert.equal(assessVariety(item("ffff0000ffff0000", "x", "s"), [item("ffff0000ffff0000", "x", "s")]).ok, false);
  const layout = assessVariety(item("aaaa0000aaaa0000", "print_detail"), [item("0000ffff0000ffff", "print_detail"), item("ffffffff00000000", "print_detail")]);
  assert.ok(layout.findings.some((finding) => finding.code === "REPETITION_LAYOUT"));
});

test("Quality Gate: produto errado não passa por ter a paleta certa; tela fictícia/vazia reprova; composição fiel aprova", () => {
  const productSpec = { mode: "physical_product", subject: { kind: "product", productCode: "000048", variant: "Azul-Marinho" }, requiredReferences: [{ id: "p", role: "product_photo" }], blockers: [] };
  const goodText = { contrast: 9, issues: [], marginOk: true };
  const wrong = evaluateFidelityGate(productSpec, { operation: "ai_edit_with_reference", transmittedReferenceIds: ["p"], product: { composited: false, shapeDistance: 30, colorDeltaE: 4, printDistance: 32, coverage: 0.3 }, text: goodText, logo: { ok: true } });
  assert.equal(wrong.approved, false);
  assert.ok(wrong.failures.some((failure) => failure.code === "PRODUCT_MISMATCH"));
  assert.ok(wrong.failures.some((failure) => failure.code === "PRINT_ALTERED"));
  const ignored = evaluateFidelityGate(productSpec, { operation: "ai_generation", transmittedReferenceIds: [], text: goodText });
  assert.ok(ignored.failures.some((failure) => failure.code === "REFERENCE_IGNORED"));
  const variant = evaluateFidelityGate(productSpec, { operation: "deterministic_composite", transmittedReferenceIds: ["p"], product: { composited: true, coverage: 0.3, usedProductCode: "000048", usedVariant: "Marrom" } });
  assert.ok(variant.failures.some((failure) => failure.code === "VARIANT_WRONG"));
  const fine = evaluateFidelityGate(productSpec, { operation: "deterministic_composite", transmittedReferenceIds: ["p"], product: { composited: true, coverage: 0.3, touchesEdge: false, usedProductCode: "000048", usedVariant: "Azul-Marinho" }, text: goodText, logo: { ok: true } });
  assert.equal(fine.approved, true, JSON.stringify(fine.failures));
  const softwareSpec = { mode: "software", subject: { kind: "feature", key: "reunioes" }, requiredReferences: [{ id: "c", role: "software_capture" }], blockers: [] };
  const fictional = evaluateFidelityGate(softwareSpec, { operation: "ai_generation", transmittedReferenceIds: ["c"], screen: { composited: false, luminanceStd: 0.01, edgeDensity: 0.001 } });
  assert.deepEqual(fictional.failures.map((failure) => failure.code).sort(), ["SCREEN_EMPTY", "UI_FICTIONAL"]);
  assert.ok(evaluateFidelityGate(softwareSpec, { operation: "ai_generation", transmittedReferenceIds: ["c"] }).failures.some((failure) => failure.code === "UI_MISSING"));
  const tiny = evaluateFidelityGate(softwareSpec, { operation: "deterministic_composite", transmittedReferenceIds: ["c"], screen: { composited: true, luminanceStd: 0.2, edgeDensity: 0.2, renderedTextPx: 4, captureFeature: "conversas" } });
  assert.deepEqual(tiny.failures.map((failure) => failure.code).sort(), ["FEATURE_MISMATCH", "UI_ILLEGIBLE"]);
});

test("revisão direcionada: corrige pelo motivo, não repete a mesma solicitação, respeita limites", () => {
  const base = { operation: "ai_edit_with_reference", attempt: 1, maxAttempts: 3, spentUsd: 0, budgetUsd: 1, aiAttemptCostUsd: 0.2 };
  assert.equal(planRevision({ ...base, failures: [{ code: "PRINT_ALTERED", message: "x" }] }).action, "switch_to_controlled_composite");
  assert.equal(planRevision({ ...base, failures: [{ code: "SCREEN_EMPTY", message: "x" }] }).action, "insert_real_capture");
  assert.equal(planRevision({ ...base, operation: "deterministic_composite", failures: [{ code: "REPETITION", message: "x" }] }).action, "switch_archetype");
  assert.equal(planRevision({ ...base, operation: "deterministic_composite", failures: [{ code: "TEXT_OVERFLOW", message: "x" }] }).action, "recompose_text");
  assert.equal(planRevision({ ...base, failures: [{ code: "REFERENCE_MISSING", message: "x" }] }).action, "manual_review");
  assert.equal(planRevision({ ...base, attempt: 3, failures: [{ code: "PRINT_ALTERED", message: "x" }] }).action, "manual_review");
  assert.equal(planRevision({ ...base, operation: "ai_generation", spentUsd: 0.9, failures: [{ code: "AI_REVIEW_REJECTED", message: "x" }] }).action, "manual_review");
});

test("captura de tela x fotografia: interface pontua alto, foto de produto em estúdio pontua baixo", async () => {
  const ui = await siteCaptureScore(await uiCapture());
  const photo = await siteCaptureScore(await sharp(await studioShirt("#1A2A45")).blur(2).png().toBuffer());
  assert.ok(ui >= 0.62, `interface ${ui}`);
  assert.ok(photo < 0.62, `foto ${photo}`);
});

test("perspectiva: homografia leva os cantos certos e a captura cai dentro do quadrilátero", async () => {
  const quad = [{ x: 100, y: 120 }, { x: 900, y: 80 }, { x: 920, y: 600 }, { x: 90, y: 640 }];
  const h = homography([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 250 }, { x: 0, y: 250 }], quad);
  const corner = applyHomography(h, { x: 400, y: 250 });
  assert.ok(Math.abs(corner.x - 920) < 0.01 && Math.abs(corner.y - 600) < 0.01);
  const source = { data: Buffer.alloc(400 * 250 * 4, 255), width: 400, height: 250 };
  const layer = warpIntoQuad(source, quad, 1080, 1350);
  const alphaAt = (x, y) => layer[(y * 1080 + x) * 4 + 3];
  assert.equal(alphaAt(500, 360), 255);
  assert.equal(alphaAt(20, 20), 0);
});

test("composição controlada: o produto na arte são os pixels da foto original; a tela é a captura real", async () => {
  const photo = await studioShirt("#1A2A45");
  const result = await composeProduct("product_studio", { photos: [{ id: "produto:000048:Azul-Marinho", data: photo, productCode: "000048", variantLabel: "Azul-Marinho" }], tones: TONES });
  assert.equal(result.evidence.product.composited, true);
  assert.equal(result.evidence.product.sourceId, "produto:000048:Azul-Marinho");
  const { rect } = result.evidence.product;
  const { data, info } = await sharp(result.base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const index = (Math.round(y) * info.width + Math.round(x)) * 3; return [data[index], data[index + 1], data[index + 2]]; };
  const fabric = at(rect.x + rect.w * 0.5, rect.y + rect.h * 0.8);
  assert.ok(Math.hypot(fabric[0] - 0x1a, fabric[1] - 0x2a, fabric[2] - 0x45) < 6, `tecido ${fabric}`);
  assert.equal(result.evidence.product.touchesEdge, false);
  const capture = await uiCapture();
  const screen = await composeSoftware("browser_window", { capture: { id: "cap", data: capture, devicePixelRatio: 1 }, tones: { ...TONES, light: false, surface: "#0B0F19" } });
  assert.equal(screen.evidence.screen.captureId, "cap");
  const stats = await textureStats(screen.base, screen.evidence.screen.screenRect);
  assert.ok(stats.edgeDensity > 0.035 || stats.luminanceStd > 0.04, "tela com conteúdo real");
});

test("fidelidade medida: mesma peça passa; estampa trocada ou cor trocada são detectadas", async () => {
  const reference = await studioShirt("#1A2A45");
  const canvas = async (shirt) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#30343A" } }).composite([{ input: await sharp(shirt).resize(750, 1000).png().toBuffer(), left: 165, top: 300 }]).png().toBuffer();
  // A região informada pelo gerador é a da peça (não a foto inteira com o fundo de estúdio).
  const { bbox, width } = await cutoutProduct(reference);
  const k = 750 / width;
  const rect = { x: 165 + bbox.x * k, y: 300 + bbox.y * k, w: bbox.w * k, h: bbox.h * k };
  const same = await measureProductFidelity(reference, await canvas(reference), rect);
  const otherPrint = await measureProductFidelity(reference, await canvas(await studioShirt("#1A2A45", `<rect x="380" y="380" width="290" height="60" fill="#E04848"/><rect x="380" y="560" width="290" height="60" fill="#E04848"/>`)), rect);
  const otherColor = await measureProductFidelity(reference, await canvas(await studioShirt("#0CD5DA")), rect);
  assert.ok(same.colorDeltaE < 8, `mesma cor ${same.colorDeltaE}`);
  assert.ok(otherPrint.printDistance > same.printDistance + 8, `estampa ${same.printDistance} → ${otherPrint.printDistance}`);
  assert.ok(otherColor.colorDeltaE > 18, `cor ${otherColor.colorDeltaE}`);
});

test("associação referência → entrada: 100% das telas recebem exatamente a referência selecionada (composição e IA)", async () => {
  const photo = (await studioShirt("#1A2A45")).toString("base64");
  const assets = { "produto:000048:Azul-Marinho": { data: photo }, "produto:000048:Bege": { data: photo } };
  const plan = planEditorialCreative({ workspaceId: "ws", brandName: "CMKV", businessKind: "physical_products", idea: IDEA({ title: "Look do dia a dia na rotina", format: "carousel", carouselScript: [{ headline: "1" }, { headline: "2" }, { headline: "3" }, { headline: "4" }] }), history: [], allowAi: true,
    ideaReferences: [{ id: "produto:000048:Azul-Marinho", source: "catalog", productCode: "000048", variantLabel: "Azul-Marinho" }, { id: "produto:000048:Bege", source: "catalog", productCode: "000048", variantLabel: "Bege", explicitRole: "product_variant" }] });
  const renders = [];
  const aiCalls = [];
  const render = async (request) => {
    renders.push(request);
    const ai = !request.composition;
    // Simula o gate: IA que não preservou a estampa reprova; composição controlada aprova.
    return ai
      ? { image: "x", quality: {}, gate: { approved: false, failures: [{ code: "PRINT_ALTERED", message: "estampa alterada" }] }, revision: { action: "switch_to_controlled_composite", reason: "estampa alterada" } }
      : { image: "x", quality: {}, gate: { approved: true, failures: [], passes: [] }, fingerprint: { archetype: request.composition.archetype, textLayout: "top", productCount: 1, palette: [], dHash: "0".repeat(16) } };
  };
  const generateAi = async ({ transmitted }) => { aiCalls.push(transmitted.map((item) => item.id)); return { base: photo, layout: "left", protectedAreas: [] }; };
  for (const planned of plan.screens) {
    const result = await produceScreen({ planned, brand: { name: "CMKV", logos: [] }, assets, history: [], render, generateAi, archetypes: ARCHETYPES, seriesKey: planned.spec.seriesKey });
    assert.equal(result.ok, true);
  }
  for (const call of aiCalls) assert.equal(call[0], "produto:000048:Azul-Marinho");
  const compositions = renders.filter((request) => request.composition);
  assert.ok(compositions.length >= plan.screens.length);
  for (const request of compositions) {
    assert.equal(request.composition.products[0].id, "produto:000048:Azul-Marinho");
    assert.equal(request.composition.products[0].data, photo);
  }
  for (const request of renders.filter((item) => !item.composition)) assert.equal(request.fidelity.reference, photo, "a IA é medida contra a foto original");
  assert.ok(aiCalls.length >= 1, "o lifestyle passou pela edição com a foto original");
});

test("telas e rastreamento: texto exato da arte respeitado; assinaturas nunca vão para o registro", () => {
  assert.deepEqual(screensForIdea(IDEA({ keyMessage: "Título\n\nApoio", cta: "Ver" })), [{ headline: "Título", body: "Apoio", cta: "Ver" }]);
  assert.equal(screensForIdea(IDEA({ creativePrompt: "TEXTO EXATO DA ARTE: 'Chegou'", keyMessage: "Outro" }))[0].headline, "Chegou");
  assert.equal(redactSecrets("https://x/y.png?sig=abc123&exp=1"), "https://x/y.png?sig=[redacted]&exp=1");
  const spec = { brand: "CMKV", modeLabel: "Produto físico", composition: { label: "L", intent: "I" }, mainMessage: "M", mode: "physical_product", immutable: ["estampa"], desiredElements: ["cenário"], avoid: ["prints"] };
  const instruction = buildImageInstruction(spec, [{ id: "p", role: "product_photo", productCode: "000048", variantLabel: "Bege" }]);
  assert.match(instruction, /Imagem 1: FOTO ORIGINAL do produto anunciado \(000048, Bege\)/);
  assert.match(instruction, /PRODUTO IMUTÁVEL/);
});

test("dHash: mesma imagem = mesma impressão; layouts opostos = distantes", async () => {
  const a = await uiCapture();
  assert.equal(await dHash(a), await dHash(a));
  const b = await svgPng(`<rect width="100%" height="100%" fill="#fff"/><rect x="600" width="680" height="800" fill="#000"/>`, 1280, 800);
  const c = await svgPng(`<rect width="100%" height="100%" fill="#000"/><rect x="600" width="680" height="800" fill="#fff"/>`, 1280, 800);
  assert.notEqual(await dHash(b), await dHash(c));
});

test("renderizador do piloto: composição + Quality Gate na mesma chamada (como o agendador envia)", async () => {
  const { renderArt } = await import("../scripts/editorial/codex-social-render.mjs");
  const logo = (await svgPng(`<rect x="20" y="40" width="460" height="120" rx="16" fill="#111"/>`, 500, 200)).toString("base64");
  const profile = { identity: { colors: [{ name: "Preto principal", hex: "#0A0A0A", role: "PRIMARY" }, { name: "Dourado", hex: "#C9A227", role: "ACCENT" }, { name: "Off-white", hex: "#F5F2EB" }], typography: { family: "SANS" }, notes: "Fundo sempre claro." } };
  const photo = (await studioShirt("#1A2A45")).toString("base64");
  const spec = { mode: "physical_product", subject: { kind: "product", productCode: "000048", variant: "Azul-Marinho" }, requiredReferences: [{ id: "p", role: "product_photo" }], blockers: [] };
  const result = await renderArt({
    profile, logos: [{ data: logo, variant: "PRIMARY", backgrounds: ["LIGHT"] }], headline: "Be Yourself, do seu jeito", body: "Algodão macio", cta: "Confira",
    composition: { mode: "physical_product", archetype: "product_studio", products: [{ id: "p", data: photo, productCode: "000048", variantLabel: "Azul-Marinho" }] },
    fidelity: { spec, operation: "deterministic_composite", archetype: "product_studio", transmittedReferenceIds: ["p"] }, history: [],
  });
  assert.equal(result.gate.approved, true, JSON.stringify(result.gate.failures));
  assert.equal(result.evidence.product.composited, true);
  assert.equal(result.fingerprint.archetype, "product_studio");
  assert.equal(result.fingerprint.dHash.length, 16);
  // A mesma arte de novo, logo em seguida: repetição reprovada e revisão pede outro arquétipo.
  const again = await renderArt({
    profile, logos: [{ data: logo, variant: "PRIMARY", backgrounds: ["LIGHT"] }], headline: "Be Yourself, do seu jeito", body: "Algodão macio", cta: "Confira",
    composition: { mode: "physical_product", archetype: "product_studio", products: [{ id: "p", data: photo, productCode: "000048", variantLabel: "Azul-Marinho" }] },
    fidelity: { spec, operation: "deterministic_composite", archetype: "product_studio", transmittedReferenceIds: ["p"] }, history: [result.fingerprint],
  });
  assert.equal(again.gate.approved, false);
  assert.equal(again.revision.action, "switch_archetype");
});

test("motor da Produção: várias referências reais vão ao /edits na ordem; referência obrigatória que falha interrompe (sem gerar só por texto)", async () => {
  const { OpenAiImageProviderAdapter } = await import("../dist/infrastructure/ai-providers/openai-image-provider-adapter.js");
  const { OpenAiCreativeImageProvider } = await import("../dist/infrastructure/ai-providers/openai-creative-image-provider.js");
  let body;
  const adapter = new OpenAiImageProviderAdapter({ enabled: true, getApiKey: async () => "sk-test", persistGeneratedImage: async () => "https://x/out.png" },
    async (_url, init) => { body = init.body; return new Response(JSON.stringify({ data: [{ url: "https://x/out.png" }] }), { status: 200, headers: { "content-type": "application/json" } }); });
  const first = Buffer.from("produto-principal");
  const second = Buffer.from("variacao-bege");
  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-2.6-sunburst", prompt: "p", tenantId: "t", params: { referenceImageBuffer: first, referenceImageBuffers: [second] }, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  const images = body.getAll("image[]");
  assert.equal(images.length, 2);
  assert.equal(Buffer.from(await images[0].arrayBuffer()).toString(), "produto-principal");
  assert.equal(result.audit.endpoint, "edits");
  assert.equal(result.audit.referenceImages.length, 2);

  const calls = [];
  const media = { async generate(request) { calls.push(request); return { ok: true, mediaUrl: "https://x/out.png" }; } };
  const provider = new OpenAiCreativeImageProvider(media);
  const request = (context) => ({ taskType: "image_generation", prompt: "p", model: "gpt-image-2.6-sunburst", context: { creativeGuard: { preservedAssetRoles: ["product_photo"], confirmedFacts: [] }, ...context } });
  await assert.rejects(provider.execute(request({ referenceImageUrl: "http://127.0.0.1:9/produto.png", referenceRequired: true })), /REFERENCE_IMAGE_UNAVAILABLE/);
  assert.equal(calls.length, 0, "nenhuma geração sem a referência obrigatória");
  const data = (text) => `data:image/png;base64,${Buffer.from(text).toString("base64")}`;
  await provider.execute(request({ referenceImageUrl: data("principal"), referenceImageUrls: [data("bege")], referenceRequired: true }));
  assert.equal(calls[0].params.referenceImageBuffer.toString(), "principal");
  assert.equal(calls[0].params.referenceImageBuffers[0].toString(), "bege");
});

test("API do Bolsão: prévia de como a arte será produzida (modo, materiais, papel de cada um, o que falta) — só leitura, isolada por tenant", async () => {
  const Fastify = (await import("fastify")).default;
  const { InMemoryEditorialIdeaRepository } = await import("../dist/infrastructure/storage/in-memory-editorial-idea-repository.js");
  const { InMemoryWorkspaceRepository } = await import("../dist/infrastructure/storage/in-memory-workspace-repository.js");
  const { registerErrorHandler } = await import("../dist/interfaces/api/http/error-handler.js");
  const { registerEditorialIdeasRoutes } = await import("../dist/interfaces/api/routes/v1/editorial-ideas.route.js");
  let seq = 0;
  const workspaceRepository = new InMemoryWorkspaceRepository({ idGenerator: () => ["ws-cmkv", "ws-outro"][seq++] });
  const cmkv = await workspaceRepository.create({ tenantId: "tenant-a", name: "CMKV Wears" });
  const other = await workspaceRepository.create({ tenantId: "tenant-b", name: "Outro" });
  const editorialIdeaRepository = new InMemoryEditorialIdeaRepository();
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (request) => { request.zunoContext = { principal: { userId: "u", tenantId: "tenant-a", role: "owner", sessionId: "s", isPlatformAdmin: false } }; });
  const seen = [];
  await registerEditorialIdeasRoutes(app, {
    editorialIdeaRepository, workspaceRepository,
    loadCreativeContext: async (input) => {
      seen.push(input);
      return {
        businessKind: "physical_products", libraryCaptures: [], urls: { "produto:000048:Azul-Marinho": "https://cdn/p.webp", site: "https://cdn/site.png" },
        ideaReferences: [{ id: "produto:000048:Azul-Marinho", source: "catalog", productCode: "000048", variantLabel: "Azul-Marinho" }, { id: "site", source: "brand_library", materialType: "screenshot_site", name: "Home da loja" }],
      };
    },
  });
  const created = await app.inject({ method: "POST", url: "/editorial-ideas", payload: { workspaceId: cmkv.id, idea: { title: "Nova estampa Be Yourself", format: "single_image", keyMessage: "Be Yourself", referenceImages: [] } } });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().data.id;
  const preview = await app.inject({ method: "GET", url: `/editorial-ideas/${id}/creative-plan?workspaceId=${cmkv.id}` });
  assert.equal(preview.statusCode, 200, preview.body);
  const data = preview.json().data;
  assert.equal(data.mode, "physical_product");
  assert.equal(data.blocked, false);
  const product = data.references.find((item) => item.id === "produto:000048:Azul-Marinho");
  assert.equal(product.principal, true);
  assert.equal(product.used, true);
  assert.equal(product.roleLabel, "Fotografia do produto");
  const site = data.references.find((item) => item.id === "site");
  assert.equal(site.used, false);
  assert.match(site.excludedReason, /não substitui a fotografia/);
  assert.equal(data.screens.length, 1);
  assert.ok(data.screens[0].compositionLabel);
  assert.equal(seen[0].tenantId, "tenant-a");
  assert.equal((await app.inject({ method: "GET", url: `/editorial-ideas/${id}/creative-plan?workspaceId=${other.id}` })).statusCode, 404);
});
