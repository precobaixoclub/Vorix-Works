import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCreativeQualityGate, reconcileOccurrencesWithLedger } from "../dist/application/creative-engine/evaluate-creative-quality-gate.js";
import {
  aggregateScreenshotTexts,
  matchScreenshotInventoryText,
  resolveScreenshotTextInventory,
  SCREENSHOT_TEXT_INVENTORY_VERSION,
  sha256Hex,
} from "../dist/application/creative-engine/screenshot-text-inventory.js";
import { InMemoryScreenshotTextInventoryStore } from "../dist/infrastructure/storage/in-memory-screenshot-text-inventory-store.js";

// Geometria no formato do C 4:5 (screenshot grande embaixo, CTA à direita, logo no topo). Textos
// fictícios — nenhuma regra depende de string específica.
const TENANT = "tenant-a";
const WORKSPACE = "workspace-a";
const SHOT_URL = "https://x/shot.png";
const LOGO_URL = "https://x/logo.png";
const SHOT_RECT = { xPct: 2.593, yPct: 42.815, widthPct: 94.815, heightPct: 53.333 };
const LOGO_RECT = { xPct: 5.185, yPct: 6.667, widthPct: 17.037, heightPct: 2.963 };
const CTA_TEXT = "Criar meu site";
const CTA_RECT = { xPct: 74.537, yPct: 26, widthPct: 18.426, heightPct: 4.296 };
const HEAD_TEXT = "Sua loja pronta em minutos";
const HEAD_RECT = { xPct: 5.185, yPct: 11.852, widthPct: 59.259, heightPct: 12.72 };
const INSIDE_SHOT = { xPct: 15, yPct: 60, widthPct: 30, heightPct: 5 };
const ABOVE_SHOT = { xPct: 10, yPct: 30, widthPct: 30, heightPct: 5 }; // grade grosseira de 5 pt, fora do screenshot
const TOP_RIGHT = { xPct: 80, yPct: 5, widthPct: 15, heightPct: 10 };

function inventory(texts, overrides = {}) {
  return {
    source: "VERIFIED_SCREENSHOT",
    inventorySource: "VISION_ASSET_SCAN",
    status: "AVAILABLE",
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    assetUrl: SHOT_URL,
    assetSha256: "a".repeat(64),
    version: SCREENSHOT_TEXT_INVENTORY_VERSION,
    scannedAt: "2026-10-10T00:00:00.000Z",
    texts: aggregateScreenshotTexts(texts),
    ...overrides,
  };
}

const SHOT_TEXTS = ["Demonstração Loja Exemplo", "Você está navegando como convidado na loja de demonstração.", "Criar meu site", "Lista de produtos", "Presentear", "Presentear", "Presentear", "R$ 79,90"];

function gateInput(overrides = {}) {
  return {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["screenshot", "logo"],
    context: {
      brandName: "Loja Exemplo", objective: "x", channel: "instagram", format: "4:5", ideaText: "", confirmedFacts: [],
      assets: [{ url: SHOT_URL, role: "screenshot", description: "screenshot real" }, { url: LOGO_URL, role: "logo", description: "Logo oficial Loja Exemplo" }],
    },
    plan: {
      objective: "x", angle: "x", targetAudience: "x", title: HEAD_TEXT, description: "", headline: HEAD_TEXT, cta: CTA_TEXT,
      visualDirection: "x", compositionIntent: "x", assetUsage: {}, requiredElements: [], forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "",
      allowedRenderedTexts: [HEAD_TEXT, CTA_TEXT], requiredRenderedFacts: [],
      assetPlacements: [{ role: "screenshot", url: SHOT_URL, rect: SHOT_RECT, frame: "none" }, { role: "logo", url: LOGO_URL, rect: LOGO_RECT, frame: "none" }],
      textZones: [
        { kind: "headline", text: HEAD_TEXT, rect: HEAD_RECT, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: CTA_TEXT, rect: CTA_RECT, emphasis: "secondary", renderedBy: "renderer" },
      ],
    },
    specialistId: "gpt-creative-director",
    assetPixelEvidence: [{ role: "screenshot", visible: true, fidelityPass: true }, { role: "logo", visible: true, fidelityPass: true }],
    screenshotTextInventory: inventory(SHOT_TEXTS),
    ownership: { tenantId: TENANT, workspaceId: WORKSPACE },
    ...overrides,
  };
}

function vision(payload) {
  let calls = 0;
  return {
    get calls() { return calls; },
    request: async () => { calls += 1; return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, unauthorizedTexts: [], ...payload }) }; },
  };
}

const codes = (result) => result.issues.map((issue) => issue.code);

test("A: texto do screenshot com bbox correta (dentro da região) → PASS", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Lista de produtos", region: INSIDE_SHOT }] }), gateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].matchDecision, "MATCHED_VERIFIED_SCREENSHOT_REGION");
  assert.equal(result.screenshotInventoryDecision.status, "USED");
});

test("B: texto do screenshot com bbox errada, inventário contém, fidelity PASS → PASS (MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY)", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [
    { text: "Demonstração Loja Exemplo", region: ABOVE_SHOT },
    { text: "Você está navegando como convidado na loja de demonstração.", region: { xPct: 10, yPct: 35, widthPct: 50, heightPct: 5 } },
  ] }), gateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.deepEqual(result.textDiagnostics.map((item) => item.matchDecision), ["MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY", "MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY"]);
  assert.ok(result.textProvenanceLedger.entries.some((entry) => entry.sourceType === "SCREENSHOT_TEXT_INVENTORY" && entry.normalizedText === "presentear" && entry.occurrenceCount === 3));
});

test("C: texto que não existe no screenshot com bbox SOBRE o screenshot → FAIL", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Frete grátis hoje", region: INSIDE_SHOT }] }), gateInput());
  assert.deepEqual(codes(result), ["UNAUTHORIZED_TEXT"]);
  assert.match(result.textDiagnostics[0].reason, /não existe no inventário do screenshot/);
});

test("D: screenshot tem 1 ocorrência, visão reporta 2 sem outra origem legítima → FAIL", async () => {
  const shotOnly = gateInput({ screenshotTextInventory: inventory(["Ver catálogo completo"]) });
  // duas leituras soltas do mesmo texto: a 2ª estoura o orçamento
  const loose = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Ver catálogo completo", region: ABOVE_SHOT }, { text: "Ver catálogo completo", region: TOP_RIGHT }] }), shotOnly);
  assert.deepEqual(codes(loose), ["UNAUTHORIZED_TEXT"]);
  assert.match(loose.textDiagnostics[1].reason, /orçamento do inventário do screenshot esgotado/);
  // duplicidade: uma dentro do screenshot + uma fora → a de fora não tem orçamento
  const dup = await evaluateCreativeQualityGate(vision({ duplicatedTexts: [{ text: "Ver catálogo completo", occurrences: [{ region: INSIDE_SHOT }, { region: ABOVE_SHOT }] }] }), shotOnly);
  assert.deepEqual(codes(dup), ["DUPLICATED_TEXT"]);
});

test("E: screenshot + CTA do renderer com a mesma string = 2 origens legítimas → PASS; 3ª ocorrência continua suspeita", async () => {
  const two = await evaluateCreativeQualityGate(vision({ duplicatedTexts: [{ text: CTA_TEXT, occurrences: [{ region: TOP_RIGHT }, { region: { xPct: 75, yPct: 26, widthPct: 15, heightPct: 4 } }] }] }), gateInput());
  assert.equal(two.verdict, "pass", JSON.stringify(two.issues));
  assert.deepEqual(two.occurrenceDiagnostics.map((item) => item.provenance).sort(), ["RENDERER_TEXT_ZONE", "VERIFIED_SCREENSHOT_TEXT_INVENTORY"]);
  const three = await evaluateCreativeQualityGate(vision({ duplicatedTexts: [{ text: CTA_TEXT, occurrences: [{ region: TOP_RIGHT }, { region: { xPct: 75, yPct: 26, widthPct: 15, heightPct: 4 } }, { region: { xPct: 40, yPct: 20, widthPct: 15, heightPct: 5 } }] }] }), gateInput());
  assert.deepEqual(codes(three), ["DUPLICATED_TEXT"]);
});

test("F: só o screenshot contém o texto do CTA — CTA obrigatório não detectado continua MISSING_REQUIRED_TEXT", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: CTA_TEXT, region: TOP_RIGHT }], missingRequiredTexts: [CTA_TEXT] }), gateInput());
  assert.ok(codes(result).includes("MISSING_REQUIRED_TEXT"), JSON.stringify(result.issues));
  assert.ok(result.textDiagnostics.some((item) => item.decision === "missing"));
});

test("G: screenshot com fidelity FAIL → inventário não autoriza", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ assetPixelEvidence: [{ role: "screenshot", visible: true, fidelityPass: false }, { role: "logo", visible: true, fidelityPass: true }] }));
  assert.ok(codes(result).includes("UNAUTHORIZED_TEXT"));
  assert.equal(result.screenshotInventoryDecision.status, "NOT_USED");
  assert.match(result.screenshotInventoryDecision.reason, /fidelidade/);
});

test("H: inventário de outro workspace (ou de outro asset) → não autoriza", async () => {
  const other = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ screenshotTextInventory: inventory(SHOT_TEXTS, { workspaceId: "workspace-b" }) }));
  assert.deepEqual(codes(other), ["UNAUTHORIZED_TEXT"]);
  assert.match(other.screenshotInventoryDecision.reason, /outro tenant\/workspace/);
  const otherTenant = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ screenshotTextInventory: inventory(SHOT_TEXTS, { tenantId: "tenant-b" }) }));
  assert.deepEqual(codes(otherTenant), ["UNAUTHORIZED_TEXT"]);
  const otherAsset = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ screenshotTextInventory: inventory(SHOT_TEXTS, { assetUrl: "https://x/other.png" }) }));
  assert.deepEqual(codes(otherAsset), ["UNAUTHORIZED_TEXT"]);
  const noOwnership = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ ownership: undefined }));
  assert.deepEqual(codes(noOwnership), ["UNAUTHORIZED_TEXT"]);
});

test("H2: cache do inventário é isolado por tenant/workspace — outro workspace nunca recebe HIT", async () => {
  const store = new InMemoryScreenshotTextInventoryStore();
  const buffer = Buffer.from("same-screenshot-bytes");
  const icaro = vision({});
  icaro.request = async () => ({ status: "completed", provider: { id: "openai" }, model: { id: "gpt-4o" }, content: JSON.stringify({ texts: ["Criar meu site", "Presentear", "Presentear"] }) });
  let scans = 0;
  const counted = { request: async (request) => { scans += 1; return icaro.request(request); } };
  const first = await resolveScreenshotTextInventory({ icaro: counted, store }, { tenantId: TENANT, workspaceId: WORKSPACE, assetUrl: SHOT_URL, buffer, specialistId: "s" });
  const second = await resolveScreenshotTextInventory({ icaro: counted, store }, { tenantId: TENANT, workspaceId: WORKSPACE, assetUrl: "https://x/shot-renamed.png", buffer, specialistId: "s" });
  assert.equal(first.cache, "MISS");
  assert.equal(second.cache, "HIT");
  assert.equal(second.assetUrl, "https://x/shot-renamed.png");
  assert.equal(scans, 1, "mesmo arquivo no mesmo workspace reaproveita a leitura");
  assert.equal(first.assetSha256, sha256Hex(buffer));
  assert.deepEqual(first.texts.map((entry) => [entry.normalizedText, entry.occurrenceCount]), [["criar meu site", 1], ["presentear", 2]]);
  const otherWorkspace = await resolveScreenshotTextInventory({ icaro: counted, store }, { tenantId: TENANT, workspaceId: "workspace-b", assetUrl: SHOT_URL, buffer, specialistId: "s" });
  assert.equal(otherWorkspace.cache, "MISS");
  assert.equal(scans, 2);
  assert.equal(await store.get({ tenantId: "tenant-b", workspaceId: WORKSPACE, assetSha256: sha256Hex(buffer), version: SCREENSHOT_TEXT_INVENTORY_VERSION }), undefined);
  // leitura falha nunca vira cache
  const failing = { request: async () => ({ status: "failed" }) };
  const failed = await resolveScreenshotTextInventory({ icaro: failing, store }, { tenantId: TENANT, workspaceId: "workspace-c", assetUrl: SHOT_URL, buffer, specialistId: "s" });
  assert.equal(failed.status, "NOT_AVAILABLE");
  assert.equal(await store.get({ tenantId: TENANT, workspaceId: "workspace-c", assetSha256: sha256Hex(buffer), version: SCREENSHOT_TEXT_INVENTORY_VERSION }), undefined);
});

test("I: preço dentro do screenshot NÃO vira fato comercial", async () => {
  const input = gateInput();
  input.plan = { ...input.plan, subheadline: "A partir de R$ 79,90", allowedRenderedTexts: [...input.plan.allowedRenderedTexts, "A partir de R$ 79,90"] };
  const result = await evaluateCreativeQualityGate(vision({}), input);
  assert.ok(codes(result).includes("INVENTED_COMMERCIAL_FACT"), JSON.stringify(result.issues));
  assert.deepEqual(input.context.confirmedFacts, []);
});

test("J: texto desconhecido fora do screenshot → FAIL", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Promoção relâmpago", region: ABOVE_SHOT }] }), gateInput());
  assert.deepEqual(codes(result), ["UNAUTHORIZED_TEXT"]);
});

test("K: logo + screenshot + renderer — ledger de ocorrências continua correto", async () => {
  const result = await evaluateCreativeQualityGate(vision({
    unauthorizedTexts: [{ text: "Loja Exemplo", region: { xPct: 6, yPct: 6.8, widthPct: 14, heightPct: 2.6 } }, { text: "Lista de produtos", region: INSIDE_SHOT }],
    duplicatedTexts: [{ text: CTA_TEXT, occurrences: [{ region: { xPct: 75, yPct: 26, widthPct: 15, heightPct: 4 } }, { region: { xPct: 80, yPct: 44, widthPct: 12, heightPct: 3 } }] }],
  }), gateInput({ baseTextDiagnostic: { status: "AVAILABLE", texts: [] } }));
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const ledger = result.textProvenanceLedger;
  assert.deepEqual([...new Set(ledger.entries.map((entry) => entry.sourceType))].sort(), ["LOGO_ASSET", "RENDERER_TEXT", "SCREENSHOT_ASSET", "SCREENSHOT_TEXT_INVENTORY"]);
  assert.equal(reconcileOccurrencesWithLedger("criar meu site", 2, ledger).reconciled, true, "CTA + 1 no screenshot");
  assert.equal(reconcileOccurrencesWithLedger("criar meu site", 3, ledger).reconciled, false, "3ª ocorrência sem origem");
  assert.equal(reconcileOccurrencesWithLedger("presentear", 3, ledger).reconciled, true);
  assert.equal(reconcileOccurrencesWithLedger("presentear", 4, ledger).reconciled, false);
  assert.equal(reconcileOccurrencesWithLedger("frete grátis", 1, ledger).reconciled, false);
});

test("L: bbox em grade grosseira — posição não invalida a proveniência soberana do screenshot", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Presentear", region: { xPct: 15, yPct: 35, widthPct: 20, heightPct: 5 } }, { text: "Presentear", region: { xPct: 40, yPct: 35, widthPct: 20, heightPct: 5 } }, { text: "Presentear", region: { xPct: 65, yPct: 35, widthPct: 20, heightPct: 5 } }] }), gateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const fourth = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [1, 2, 3, 4].map((index) => ({ text: "Presentear", region: { xPct: 5 * index, yPct: 35, widthPct: 20, heightPct: 5 } })) }), gateInput());
  assert.deepEqual(codes(fourth), ["UNAUTHORIZED_TEXT"], "4 leituras > 3 ocorrências no screenshot");
});

test("base escaneada contendo o texto: o inventário não absorve a ocorrência solta", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Lista de produtos", region: ABOVE_SHOT }] }), gateInput({ baseTextDiagnostic: { status: "AVAILABLE", texts: [{ text: "Lista de produtos", normalizedText: "lista de produtos" }] } }));
  assert.deepEqual(codes(result), ["UNAUTHORIZED_TEXT"]);
  assert.match(result.textDiagnostics[0].reason, /imagem base escaneada contém o texto/);
});

test("base scan NOT_AVAILABLE não autoriza texto desconhecido; inventário segue independente", async () => {
  const notAvailable = { status: "NOT_AVAILABLE", texts: [] };
  const unknown = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Promoção relâmpago", region: ABOVE_SHOT }] }), gateInput({ baseTextDiagnostic: notAvailable }));
  assert.deepEqual(codes(unknown), ["UNAUTHORIZED_TEXT"]);
  const known = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ baseTextDiagnostic: notAvailable }));
  assert.equal(known.verdict, "pass", JSON.stringify(known.issues));
});

test("sem inventário (ou NOT_AVAILABLE): comportamento anterior — região do screenshot autoriza, fora dela não", async () => {
  for (const screenshotTextInventory of [undefined, inventory([], { status: "NOT_AVAILABLE", reason: "x" })]) {
    const inside = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Qualquer texto da interface", region: INSIDE_SHOT }] }), gateInput({ screenshotTextInventory }));
    assert.equal(inside.verdict, "pass", JSON.stringify(inside.issues));
    const outside = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Demonstração Loja Exemplo", region: ABOVE_SHOT }] }), gateInput({ screenshotTextInventory }));
    assert.deepEqual(codes(outside), ["UNAUTHORIZED_TEXT"]);
  }
});

test("matchScreenshotInventoryText: palavras inteiras, crop nas pontas, leitura com 1 caractere diferente, orçamento somado", () => {
  const inv = { texts: aggregateScreenshotTexts(["Cota para o noivo não esquecer a aliança", "Presentear", "Presentear", "Você está navegando como convidado"]) };
  assert.equal(matchScreenshotInventoryText("cota para o noivo não esquecer a aliança", inv).budget, 1);
  assert.equal(matchScreenshotInventoryText("esquecer a aliança", inv).budget, 1, "linha quebrada lida em partes");
  assert.equal(matchScreenshotInventoryText("presentear", inv).budget, 2);
  assert.equal(matchScreenshotInventoryText("ta para o noivo", inv).budget, 1, "primeira palavra cortada pelo crop");
  assert.equal(matchScreenshotInventoryText("você está navegando como convidad", inv).budget, 1, "última palavra cortada");
  assert.equal(matchScreenshotInventoryText("voce está navegando como convidado", inv).budget, 1, "1 caractere diferente em frase longa");
  assert.equal(matchScreenshotInventoryText("noi", inv), undefined, "pedaço de palavra sozinho não casa");
  assert.equal(matchScreenshotInventoryText("a", inv), undefined, "texto curto demais nunca casa");
  assert.equal(matchScreenshotInventoryText("frete grátis", inv), undefined);
  assert.equal(matchScreenshotInventoryText("presentear agora", inv), undefined, "texto maior que o do screenshot não casa");
});
