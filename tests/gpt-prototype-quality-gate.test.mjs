import test from "node:test";
import assert from "node:assert/strict";
import {
  checkGptPrototypeVisualIntegrity,
  combineGptPrototypeQualityIssues,
  evaluateDeterministicGptPrototypeChecks,
  evaluateGptPrototypeQualityGate,
} from "../dist/application/production/evaluate-gpt-prototype-quality-gate.js";

test("evaluateDeterministicGptPrototypeChecks: proporção correta (dentro da tolerância) não gera issue", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: [],
  });
  assert.deepEqual(issues, []);
});

test("evaluateDeterministicGptPrototypeChecks: proporção claramente errada gera WRONG_ASPECT_RATIO", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1080,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: [],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "WRONG_ASPECT_RATIO");
});

test("evaluateDeterministicGptPrototypeChecks: logo obrigatória no contexto mas não composta gera REQUIRED_ASSET_MISSING", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: ["logo"],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "REQUIRED_ASSET_MISSING");
  assert.match(issues[0].message, /logo/);
});

test("evaluateDeterministicGptPrototypeChecks: logo obrigatória E composta não gera issue", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["logo"],
    contextAssetRoles: ["logo"],
  });
  assert.deepEqual(issues, []);
});

test("evaluateDeterministicGptPrototypeChecks: produto real presente NÃO exige composição determinística (pode ter sido tratado por edição)", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: ["product_photo"],
  });
  assert.deepEqual(issues, []);
});

test("evaluateDeterministicGptPrototypeChecks: screenshot e logo faltando ao mesmo tempo gera 2 issues", () => {
  const issues = evaluateDeterministicGptPrototypeChecks({
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    contextAssetRoles: ["logo", "screenshot"],
  });
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.code).sort(), ["REQUIRED_ASSET_MISSING", "REQUIRED_ASSET_MISSING"]);
});

test("combineGptPrototypeQualityIssues: sem nenhuma issue, veredito 'pass'", () => {
  const result = combineGptPrototypeQualityIssues([], []);
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.issues, []);
});

test("combineGptPrototypeQualityIssues: qualquer issue (de qualquer grupo) força veredito 'fail'", () => {
  const result = combineGptPrototypeQualityIssues([{ code: "WRONG_ASPECT_RATIO", message: "x" }], []);
  assert.equal(result.verdict, "fail");
  assert.equal(result.issues.length, 1);
});

test("checkGptPrototypeVisualIntegrity: veredito best-effort — falha na chamada de IA devolve lista vazia, nunca reprova por ausência de sinal", async () => {
  const failingIcaro = { request: async () => { throw new Error("timeout"); } };
  const issues = await checkGptPrototypeVisualIntegrity(failingIcaro, { finalImageUrl: "https://x/final.png", specialistId: "gpt-prototype" });
  assert.deepEqual(issues, []);
});

test("checkGptPrototypeVisualIntegrity: status não-completed devolve lista vazia", async () => {
  const icaro = { request: async () => ({ status: "failed" }) };
  const issues = await checkGptPrototypeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.png", specialistId: "gpt-prototype" });
  assert.deepEqual(issues, []);
});

test("checkGptPrototypeVisualIntegrity: veredito explícito de defeito grave vira issue com o código certo", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: true, textIllegibleOrCut: false, compositionBroken: false, reasoning: "Produto errado na peça." }),
    }),
  };
  const issues = await checkGptPrototypeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.png", referenceProductImageUrl: "https://x/ref.png", specialistId: "gpt-prototype" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "PRODUCT_MISMATCH");
  assert.equal(issues[0].message, "Produto errado na peça.");
});

test("checkGptPrototypeVisualIntegrity: sem referência de produto, ainda inclui a imagem final na chamada", async () => {
  let capturedImageUrls;
  const icaro = {
    request: async (request) => {
      capturedImageUrls = request.imageUrls;
      return { status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: false, compositionBroken: false }) };
    },
  };
  await checkGptPrototypeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.png", specialistId: "gpt-prototype" });
  assert.deepEqual(capturedImageUrls, ["https://x/final.png"]);
});

test("evaluateGptPrototypeQualityGate: combina falhas determinísticas e de visão no mesmo veredito", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: true, compositionBroken: false, reasoning: "CTA cortado." }) }),
  };
  const result = await evaluateGptPrototypeQualityGate(icaro, {
    finalImageUrl: "https://x/final.png",
    finalImageWidth: 1080,
    finalImageHeight: 1080,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: [],
    context: { brandName: "x", objective: "x", channel: "instagram", format: "4:5", ideaText: "x", assets: [{ url: "https://x/logo.png", role: "logo", description: "" }], confirmedFacts: [] },
    specialistId: "gpt-prototype",
  });
  assert.equal(result.verdict, "fail");
  const codes = result.issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, ["REQUIRED_ASSET_MISSING", "TEXT_ILLEGIBLE_OR_CUT", "WRONG_ASPECT_RATIO"]);
});
