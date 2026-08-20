import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCommercialFactIntegrity,
  checkCreativeVisualIntegrity,
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
