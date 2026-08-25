import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCommercialFactIntegrity,
  checkCreativeVisualIntegrity,
  checkProductionGuidelinesCompliance,
  checkSafeAreaCompliance,
  combineCreativeQualityIssues,
  evaluateCreativeQualityGate,
  evaluateDeterministicCreativeChecks,
} from "../dist/application/creative-engine/evaluate-creative-quality-gate.js";

function basePlan(overrides = {}) {
  return {
    objective: "x",
    angle: "x",
    targetAudience: "x",
    title: "",
    description: "",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    cta: "ACESSE AGORA",
    visualDirection: "x",
    compositionIntent: "x",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    requiredElements: [],
    forbiddenElements: [],
    visualDensity: "clean",
    styleNotes: "",
    rationale: "",
    ...overrides,
  };
}

function baseContext(overrides = {}) {
  return {
    brandName: "Preço Baixo Club",
    objective: "x",
    channel: "instagram",
    format: "4:5",
    ideaText: "",
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

test("evaluateDeterministicCreativeChecks: aspect ratio dentro da tolerância não gera issue", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: [],
  });
  assert.equal(issues.length, 0);
});

test("evaluateDeterministicCreativeChecks: aspect ratio fora da tolerância gera WRONG_ASPECT_RATIO", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1080,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: [],
  });
  assert.ok(issues.some((issue) => issue.code === "WRONG_ASPECT_RATIO"));
});

test("evaluateDeterministicCreativeChecks: logo/screenshot no contexto sem composição vira REQUIRED_ASSET_MISSING", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: ["logo", "screenshot"],
  });
  assert.equal(issues.filter((issue) => issue.code === "REQUIRED_ASSET_MISSING").length, 2);
});

test("evaluateDeterministicCreativeChecks: nonPublishableSource vira NON_PUBLISHABLE_SOURCE", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: [],
    nonPublishableSource: true,
  });
  assert.ok(issues.some((issue) => issue.code === "NON_PUBLISHABLE_SOURCE"));
});

test("checkCommercialFactIntegrity: preço mencionado que bate com o fato confirmado não gera issue", () => {
  const plan = basePlan({ headline: "R$ 39,99 hoje!" });
  const context = baseContext({ confirmedFacts: ["Preço atual: R$ 39,99"] });
  assert.deepEqual(checkCommercialFactIntegrity(plan, context), []);
});

test("checkCommercialFactIntegrity: preço mencionado SEM nenhum fato confirmado do tipo vira INVENTED_COMMERCIAL_FACT", () => {
  const plan = basePlan({ headline: "R$ 39,99 hoje!" });
  const context = baseContext({ confirmedFacts: [] });
  const issues = checkCommercialFactIntegrity(plan, context);
  assert.ok(issues.some((issue) => issue.code === "INVENTED_COMMERCIAL_FACT"));
});

test("checkCommercialFactIntegrity: preço mencionado DIFERENTE do fato confirmado do mesmo tipo vira WRONG_PRICE", () => {
  const plan = basePlan({ headline: "R$ 29,99 hoje!" });
  const context = baseContext({ confirmedFacts: ["Preço atual: R$ 39,99"] });
  const issues = checkCommercialFactIntegrity(plan, context);
  assert.ok(issues.some((issue) => issue.code === "WRONG_PRICE"));
});

test("checkCommercialFactIntegrity: também varre textZones, não só headline/cta", () => {
  const plan = basePlan({ textZones: [{ kind: "price", text: "R$ 99,99", rect: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }] });
  const context = baseContext({ confirmedFacts: ["Preço atual: R$ 39,99"] });
  const issues = checkCommercialFactIntegrity(plan, context);
  assert.ok(issues.some((issue) => issue.code === "WRONG_PRICE"));
});

test("combineCreativeQualityIssues: pass quando não há issues, fail quando há", () => {
  assert.equal(combineCreativeQualityIssues([], []).verdict, "pass");
  assert.equal(combineCreativeQualityIssues([{ code: "WRONG_ASPECT_RATIO", message: "x" }]).verdict, "fail");
});

test("checkCreativeVisualIntegrity: best-effort — resposta 'failed' do Ícaro nunca reprova por conta própria", async () => {
  const icaro = { request: async () => ({ status: "failed" }) };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
});

test("checkCreativeVisualIntegrity: mapeia cada veredito verdadeiro para o issue code correto", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({
        productMismatch: true,
        wrongLogo: true,
        screenshotMischaracterized: true,
        textIllegibleOrCut: true,
        elementCutOff: true,
        criticalOverlap: true,
        compositionBroken: true,
        reasoning: "motivo",
      }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director" });
  const codes = issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, [
    "COMPOSITION_BROKEN",
    "CRITICAL_OVERLAP",
    "ELEMENT_CUT_OFF",
    "PRODUCT_MISMATCH",
    "SCREENSHOT_MISCHARACTERIZED",
    "TEXT_ILLEGIBLE_OR_CUT",
    "WRONG_LOGO",
  ]);
});

// Reforço da migração "Prompt Persistente de Produção" — achado ao vivo: uma peça podia passar o
// gate inteiro mesmo ignorando claramente uma diretriz configurada, porque nenhum check anterior
// olhava para `productionInstructions`/`behaviorPreferences`.

test("checkProductionGuidelinesCompliance: sem nenhuma diretriz configurada, nunca chama o Ícaro nem reprova", async () => {
  let called = false;
  const icaro = { request: async () => { called = true; return { status: "completed", content: "{}" }; } };
  const plan = basePlan({ headline: "Compre agora" });
  const context = baseContext();
  const issues = await checkProductionGuidelinesCompliance(icaro, { context, plan, specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
  assert.equal(called, false);
});

test("checkProductionGuidelinesCompliance: sem nenhum texto na peça, nunca chama o Ícaro nem reprova", async () => {
  let called = false;
  const icaro = { request: async () => { called = true; return { status: "completed", content: "{}" }; } };
  const plan = basePlan({ headline: "", subheadline: undefined, cta: "", title: "", description: "" });
  const context = baseContext({ productionInstructions: "Nunca use a palavra 'grátis'." });
  const issues = await checkProductionGuidelinesCompliance(icaro, { context, plan, specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
  assert.equal(called, false);
});

test("checkProductionGuidelinesCompliance: veredito explícito 'true' vira PRODUCTION_GUIDELINES_VIOLATED", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ violatesGuidelines: true, reasoning: "Usa a palavra proibida 'grátis' no CTA." }) }),
  };
  const plan = basePlan({ cta: "Ganhe grátis hoje" });
  const context = baseContext({ productionInstructions: "Nunca use a palavra 'grátis'." });
  const issues = await checkProductionGuidelinesCompliance(icaro, { context, plan, specialistId: "gpt-creative-director" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "PRODUCTION_GUIDELINES_VIOLATED");
  assert.match(issues[0].message, /grátis/);
});

test("checkProductionGuidelinesCompliance: veredito 'false' não gera issue", async () => {
  const icaro = { request: async () => ({ status: "completed", content: JSON.stringify({ violatesGuidelines: false }) }) };
  const plan = basePlan({ cta: "Compre já" });
  const context = baseContext({ behaviorPreferences: ["Tom de voz sempre informal."] });
  const issues = await checkProductionGuidelinesCompliance(icaro, { context, plan, specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
});

test("checkProductionGuidelinesCompliance: best-effort — resposta 'failed' do Ícaro nunca reprova por conta própria", async () => {
  const icaro = { request: async () => ({ status: "failed" }) };
  const plan = basePlan({ cta: "Compre já" });
  const context = baseContext({ productionInstructions: "Regra qualquer." });
  const issues = await checkProductionGuidelinesCompliance(icaro, { context, plan, specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
});

// Achado ao vivo em produção: uma peça saiu com fundo branco e cores ciano/magenta quando a marca
// tinha paleta configurada (preto/grafite + verde + amarelo) — passou pelo gate inteiro "limpa"
// porque nenhum critério de visão perguntava sobre cor.

test("checkCreativeVisualIntegrity: sem brandColors configurado, colorPaletteViolated=true no retorno da IA é ignorado (nunca reprova sem paleta oficial)", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: true }) }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director" });
  assert.deepEqual(issues, []);
});

test("checkCreativeVisualIntegrity: com brandColors configurado, veredito colorPaletteViolated=true vira COLOR_PALETTE_VIOLATED", async () => {
  const icaro = {
    request: async ({ prompt }) => {
      assert.match(prompt, /preto, verde, amarelo/);
      return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: true, reasoning: "fundo branco, sem nenhuma cor da paleta" }) };
    },
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", brandColors: ["preto", "verde", "amarelo"] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "COLOR_PALETTE_VIOLATED");
  assert.match(issues[0].message, /fundo branco/);
});

test("checkCreativeVisualIntegrity: com brandColors configurado, veredito 'false' não gera issue", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: false }) }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", brandColors: ["preto", "verde"] });
  assert.deepEqual(issues, []);
});

test("evaluateCreativeQualityGate: peça que ignora a paleta de cores configurada reprova o gate mesmo com tudo mais aprovado", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: true, reasoning: "usa ciano e magenta, nenhuma cor da marca aparece" }) }),
  };
  const plan = basePlan();
  const context = baseContext({ brandColors: ["preto", "verde", "amarelo"] });
  const result = await evaluateCreativeQualityGate(icaro, {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    context,
    plan,
    specialistId: "gpt-creative-director",
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.issues.some((issue) => issue.code === "COLOR_PALETTE_VIOLATED"));
});

test("evaluateCreativeQualityGate: orquestra as três camadas (determinística + fatos + visão)", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }) }),
  };
  const plan = basePlan({ headline: "R$ 999,99 imperdível" });
  const context = baseContext({ confirmedFacts: ["Preço atual: R$ 39,99"] });
  const result = await evaluateCreativeQualityGate(icaro, {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    context,
    plan,
    specialistId: "gpt-creative-director",
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.issues.some((issue) => issue.code === "WRONG_PRICE"));
});

test("evaluateCreativeQualityGate: peça que contraria uma diretriz permanente configurada reprova o gate mesmo com visão/geometria/fatos todos aprovados", async () => {
  const icaro = {
    request: async ({ prompt }) => {
      if (prompt.includes("INSTRUÇÕES PERMANENTES DESTE WORKSPACE")) {
        return { status: "completed", content: JSON.stringify({ violatesGuidelines: true, reasoning: "Promete frete grátis, proibido pela diretriz do workspace." }) };
      }
      return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }) };
    },
  };
  const plan = basePlan({ cta: "Frete grátis para todo o Brasil" });
  const context = baseContext({ productionInstructions: "Nunca prometa frete grátis — a loja não oferece esse benefício." });
  const result = await evaluateCreativeQualityGate(icaro, {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    context,
    plan,
    specialistId: "gpt-creative-director",
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.issues.some((issue) => issue.code === "PRODUCTION_GUIDELINES_VIOLATED"));
});

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — hard failure de
// acabamento: achado ao vivo em produção, CTA/texto cortado na borda inferior de peças reais.
// Determinístico, roda sobre a geometria já declarada no creative_plan, ANTES mesmo de compor a
// peça — nunca depende do julgamento do check de visão (`checkCreativeVisualIntegrity`).

test("checkSafeAreaCompliance: zona de texto dentro da margem de segurança não gera issue", () => {
  const plan = basePlan({ textZones: [{ kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }] });
  assert.deepEqual(checkSafeAreaCompliance(plan), []);
});

test("checkSafeAreaCompliance: CTA tocando a borda inferior do canvas (caso real observado em produção) vira TEXT_ILLEGIBLE_OR_CUT quando renderedBy='renderer'", () => {
  const plan = basePlan({ textZones: [{ kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 90, widthPct: 50, heightPct: 9 }, emphasis: "secondary", renderedBy: "renderer" }] });
  const issues = checkSafeAreaCompliance(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "TEXT_ILLEGIBLE_OR_CUT");
  assert.match(issues[0].message, /margem de segurança/);
});

test("checkSafeAreaCompliance: mesma violação com renderedBy='image_model' vira ELEMENT_CUT_OFF (não TEXT_ILLEGIBLE_OR_CUT)", () => {
  const plan = basePlan({ textZones: [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 90, widthPct: 50, heightPct: 9 }, emphasis: "primary", renderedBy: "image_model" }] });
  const issues = checkSafeAreaCompliance(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "ELEMENT_CUT_OFF");
});

test("checkSafeAreaCompliance: URL fora da área útil (encostando na borda direita) também é detectada", () => {
  const plan = basePlan({ textZones: [{ kind: "url", text: "precobaixoclub.com.br", rect: { xPct: 60, yPct: 40, widthPct: 39, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" }] });
  const issues = checkSafeAreaCompliance(plan);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /url/i);
});

test("checkSafeAreaCompliance: várias zonas violando ao mesmo tempo produzem uma issue por zona", () => {
  const plan = basePlan({
    textZones: [
      { kind: "cta", text: "ACESSE", rect: { xPct: 0, yPct: 95, widthPct: 30, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "price", text: "R$ 39,99", rect: { xPct: 0, yPct: 0, widthPct: 20, heightPct: 5 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
  });
  assert.equal(checkSafeAreaCompliance(plan).length, 2);
});

test("evaluateCreativeQualityGate: violação de safe area reprova o gate (fail) mesmo quando o check de visão aprova tudo", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }) }),
  };
  const plan = basePlan({ textZones: [{ kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 91, widthPct: 50, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" }] });
  const result = await evaluateCreativeQualityGate(icaro, {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    context: baseContext(),
    plan,
    specialistId: "gpt-creative-director",
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.issues.some((issue) => issue.code === "TEXT_ILLEGIBLE_OR_CUT"));
});
