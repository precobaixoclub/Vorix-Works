import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAssetPlacementOverlap,
  checkAssetSafeAreaCompliance,
  checkCommercialFactIntegrity,
  checkCreativeVisualIntegrity,
  checkProductionGuidelinesCompliance,
  checkOverdenseLayout,
  checkSafeAreaCompliance,
  checkTextZoneCollisions,
  combineCreativeQualityIssues,
  evaluateCreativeQualityGate,
  evaluateDeterministicCreativeChecks,
  isTextRegionInsideVerifiedLogo,
  normalizeRenderedText,
  measureRenderedTextProximity,
  VISION_BBOX_RESOLUTION_PCT,
  resolveVerifiedLogoRegions,
} from "../dist/application/creative-engine/evaluate-creative-quality-gate.js";

function basePlan(overrides = {}) {
  const merged = {
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
  // allowedRenderedTexts sempre eco literal de headline/subheadline/cta — recomputado DEPOIS dos
  // overrides pra nunca dessincronizar quando um teste sobrescreve headline/cta diretamente.
  if (!Object.prototype.hasOwnProperty.call(overrides, "allowedRenderedTexts")) {
    merged.allowedRenderedTexts = [merged.headline, merged.subheadline, merged.cta].filter(Boolean);
  }
  return merged;
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

test("checkCreativeVisualIntegrity: mapeia cada veredito verdadeiro para o issue code correto (com as três referências reais presentes)", async () => {
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
  const issues = await checkCreativeVisualIntegrity(icaro, {
    finalImageUrl: "https://x/final.jpg",
    specialistId: "gpt-creative-director",
    referenceProductImageUrl: "https://x/product.jpg",
    referenceLogoUrl: "https://x/logo.png",
    referenceScreenshotUrl: "https://x/screenshot.png",
    allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "ACESSE AGORA"],
  });
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

// Achado ao vivo em produção: uma peça sem NENHUM screenshot real cadastrado ainda assim recebeu
// "screenshotMischaracterized: true" da visão (alucinação, ou só não seguiu a regra do prompt de
// "só marque true com uma referência real") — reprovando por um problema que não existia. Mesma
// classe de bug já corrigida pra `colorPaletteViolated`: cada critério de referência só conta
// quando a referência correspondente de fato foi enviada, garantido no código, nunca só no prompt.

test("checkCreativeVisualIntegrity: sem nenhuma referência real, productMismatch/wrongLogo/screenshotMischaracterized=true no retorno da IA são ignorados", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: true, wrongLogo: true, screenshotMischaracterized: true, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues, []);
});

test("checkCreativeVisualIntegrity: com só a referência de screenshot presente, apenas screenshotMischaracterized é honrado (produto/logo continuam ignorados)", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: true, wrongLogo: true, screenshotMischaracterized: true, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", referenceScreenshotUrl: "https://x/screenshot.png", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues.map((issue) => issue.code), ["SCREENSHOT_MISCHARACTERIZED"]);
});

// Reforço da migração "Prompt Persistente de Produção" — achado ao vivo: uma peça podia passar o
// gate inteiro mesmo ignorando claramente uma diretriz configurada, porque nenhum check anterior
// olhava para `productionInstructions`/`behaviorPreferences`.

// Auditoria "motor de geração de criativos" — achado ao vivo: o modelo de imagem inventou texto
// não pedido em lugar nenhum ("TEXTO DE DESTAQUE", "SAIBA MAIS"), e o critério booleano antigo
// (`unexpectedDecorativeText`) não pegava isso de forma confiável — a mesma peça com esse defeito
// óbvio às vezes recebia `false`. Substituído por uma TRANSCRIÇÃO objetiva (`unauthorizedTexts`/
// `missingRequiredTexts`) comparada em CÓDIGO contra `allowedRenderedTexts`, nunca só o
// julgamento livre da IA.

// Achado ao vivo em produção (teste de regressão real, caso Preço Baixo Club): o CTA autorizado
// "ACESSE AGORA — precobaixoclub.com.br" quebrou em duas linhas na composição (comum quando um
// texto longo precisa caber numa caixa), e a visão reportou "ACESSE AGORA" sozinho como
// `unauthorizedTexts` — falso positivo, é só a primeira linha do MESMO texto autorizado. Gastou
// uma rodada de reparo corrigindo um problema que não existia.

test("checkCreativeVisualIntegrity: instrui a visão a NUNCA contar uma linha/fragmento de um texto autorizado que quebrou em várias linhas como não autorizado", async () => {
  let capturedPrompt;
  const icaro = {
    request: async ({ prompt }) => {
      capturedPrompt = prompt;
      return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }) };
    },
  };
  await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA — precobaixoclub.com.br"] });
  assert.match(capturedPrompt, /NUNCA inclua um FRAGMENTO\/LINHA\/TRECHO de um texto autorizado/);
});

test("checkCreativeVisualIntegrity: unauthorizedTexts vira UNAUTHORIZED_TEXT (um issue por item)", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, unauthorizedTexts: ["Destaque-se no mundo digital"], reasoning: "slogan extra no fundo" }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues.map((issue) => issue.code), ["UNAUTHORIZED_TEXT"]);
  assert.match(issues[0].message, /Destaque-se no mundo digital/);
});

// Achado ao vivo em produção: um texto não autorizado que é literalmente um NOME DE CAMPO do
// próprio creative_plan ("TEXTO DE DESTAQUE", "SOME HEADLINE TEXT", "CALL TO ACTION") indica uma
// causa diferente de um slogan qualquer — o modelo confundiu instrução interna com conteúdo real.

test("checkCreativeVisualIntegrity: unauthorizedTexts que parece placeholder/rótulo técnico (nome de campo do plano) vira PLACEHOLDER_RENDERED; um slogan genérico qualquer continua UNAUTHORIZED_TEXT", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, unauthorizedTexts: ["TEXTO DE DESTAQUE", "SAIBA MAIS"] }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues.map((issue) => issue.code), ["PLACEHOLDER_RENDERED", "UNAUTHORIZED_TEXT"]);
});

test("checkCreativeVisualIntegrity: missingRequiredTexts vira MISSING_REQUIRED_TEXT", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, missingRequiredTexts: ["ACESSE AGORA"] }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues.map((issue) => issue.code), ["MISSING_REQUIRED_TEXT"]);
  assert.match(issues[0].message, /ACESSE AGORA/);
});

// Rodada 4 (benchmark de qualidade criativa) — achado confirmado: um preço com textZone própria
// e presente em allowedRenderedTexts ainda assim saiu ausente da peça final, sem reprovação.
// REQUIRED_FACT_MISSING é um código dedicado, distinto de MISSING_REQUIRED_TEXT, para fatos
// comerciais que o PRÓPRIO plano marcou como obrigatórios (`requiredRenderedFacts`).
test("checkCreativeVisualIntegrity: missingRequiredFacts vira REQUIRED_FACT_MISSING (distinto de MISSING_REQUIRED_TEXT)", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, missingRequiredFacts: ["R$ 2.499,00"] }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, {
    finalImageUrl: "https://x/final.jpg",
    specialistId: "gpt-creative-director",
    allowedRenderedTexts: ["A partir de R$ 2.499,00"],
    requiredRenderedFacts: ["R$ 2.499,00"],
  });
  assert.deepEqual(issues.map((issue) => issue.code), ["REQUIRED_FACT_MISSING"]);
  assert.match(issues[0].message, /R\$ 2\.499,00/);
});

test("checkCreativeVisualIntegrity: sem requiredRenderedFacts declarado (campo ausente), nunca lança e não gera REQUIRED_FACT_MISSING mesmo se a IA devolver algo nesse campo", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, missingRequiredFacts: [] }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues, []);
});

test("checkCreativeVisualIntegrity: unauthorizedTexts/missingRequiredTexts vazios ou ausentes nunca geram issue", async () => {
  const icaro = {
    request: async () => ({
      status: "completed",
      content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, unauthorizedTexts: [], missingRequiredTexts: [] }),
    }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues, []);
});

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
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.deepEqual(issues, []);
});

test("checkCreativeVisualIntegrity: com brandColors configurado, veredito colorPaletteViolated=true vira COLOR_PALETTE_VIOLATED", async () => {
  const icaro = {
    request: async ({ prompt }) => {
      assert.match(prompt, /preto, verde, amarelo/);
      return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: true, reasoning: "fundo branco, sem nenhuma cor da paleta" }) };
    },
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", brandColors: ["preto", "verde", "amarelo"], allowedRenderedTexts: ["ACESSE AGORA"] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "COLOR_PALETTE_VIOLATED");
  assert.match(issues[0].message, /fundo branco/);
});

test("checkCreativeVisualIntegrity: com brandColors configurado, veredito 'false' não gera issue", async () => {
  const icaro = {
    request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, colorPaletteViolated: false }) }),
  };
  const issues = await checkCreativeVisualIntegrity(icaro, { finalImageUrl: "https://x/final.jpg", specialistId: "gpt-creative-director", brandColors: ["preto", "verde"], allowedRenderedTexts: ["ACESSE AGORA"] });
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

// Achado ao vivo em produção: o retângulo do headline (textZone) e o retângulo da logo
// (assetPlacement) se sobrepunham no mesmo plano real — a caixa semi-opaca do headline cobria
// parte da logo. A visão flagrou o sintoma vagamente por 3 rodadas seguidas ("texto sobreposto
// por fundo escuro"), sem nunca dizer QUAL zona colide com QUAL asset, então o diretor repetia a
// mesma colisão a cada gpt_replan. Geometria exata, sem custo de IA — mesmo princípio de
// checkSafeAreaCompliance.

test("checkAssetPlacementOverlap: headline e logo com retângulos sobrepostos (caso real de produção) vira TEXT_ZONE_OVERLAPS_ASSET", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 5, yPct: 5, widthPct: 30, heightPct: 15 }, frame: "none", treatment: "original" }],
  });
  const issues = checkAssetPlacementOverlap(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "TEXT_ZONE_OVERLAPS_ASSET");
  assert.match(issues[0].message, /headline/);
  assert.match(issues[0].message, /logo/);
});

test("checkAssetPlacementOverlap: retângulos que não se tocam não geram issue", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "OFERTA", rect: { xPct: 40, yPct: 10, widthPct: 50, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 5, yPct: 5, widthPct: 30, heightPct: 15 }, frame: "none", treatment: "original" }],
  });
  assert.deepEqual(checkAssetPlacementOverlap(plan), []);
});

test("checkAssetPlacementOverlap: sem nenhum assetPlacement, nunca gera issue", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
    assetPlacements: [],
  });
  assert.deepEqual(checkAssetPlacementOverlap(plan), []);
});

// Revisão preventiva (mesmo princípio de checkAssetPlacementOverlap): nada verificava DUAS zonas
// de texto se sobrepondo entre si (ex.: headline cobrindo o subheadline) — mesma consequência
// visual já vista repetidas vezes em produção, cobertura simétrica à de textZone-vs-asset.

test("checkTextZoneCollisions: headline e subheadline com retângulos sobrepostos vira TEXT_ZONE_OVERLAPS_TEXT_ZONE", () => {
  const plan = basePlan({
    textZones: [
      { kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: "Detalhes", rect: { xPct: 10, yPct: 25, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
  });
  const issues = checkTextZoneCollisions(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "TEXT_ZONE_OVERLAPS_TEXT_ZONE");
  assert.match(issues[0].message, /headline/);
  assert.match(issues[0].message, /subheadline/);
});

test("checkTextZoneCollisions: zonas de texto que não se tocam não geram issue", () => {
  const plan = basePlan({
    textZones: [
      { kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "cta", text: "ACESSE", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
    ],
  });
  assert.deepEqual(checkTextZoneCollisions(plan), []);
});

test("checkTextZoneCollisions: com menos de duas textZones, nunca gera issue", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
  });
  assert.deepEqual(checkTextZoneCollisions(plan), []);
});

// ---------------------------------------------------------------------------------------------
// ETAPA 3.3 (Rodada 4) — checkOverdenseLayout: sinal de densidade, só dispara QUANDO já sobra uma
// sobreposição geométrica real (o motor já tentou descartar conteúdo opcional antes — ver
// `manage-text-budget.ts`) E o número de elementos já é alto — nunca substitui
// TEXT_ZONE_OVERLAPS_ASSET/TEXT_ZONE_OVERLAPS_TEXT_ZONE, só se soma a eles.
// ---------------------------------------------------------------------------------------------

test("checkOverdenseLayout: sobreposição real + muitos elementos (>=5) vira OVERDENSE_LAYOUT", () => {
  const plan = basePlan({
    textZones: [
      { kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: "Detalhes", rect: { xPct: 10, yPct: 25, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "price", text: "R$ 10", rect: { xPct: 10, yPct: 60, widthPct: 30, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 70, yPct: 5, widthPct: 20, heightPct: 20 } }],
  });
  const issues = checkOverdenseLayout(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "OVERDENSE_LAYOUT");
});

test("checkOverdenseLayout: sobreposição real mas POUCOS elementos nunca gera OVERDENSE_LAYOUT (continua só TEXT_ZONE_OVERLAPS_TEXT_ZONE)", () => {
  const plan = basePlan({
    textZones: [
      { kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: "Detalhes", rect: { xPct: 10, yPct: 25, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
  });
  assert.deepEqual(checkOverdenseLayout(plan), []);
  assert.equal(checkTextZoneCollisions(plan).length, 1);
});

test("checkOverdenseLayout: muitos elementos mas SEM nenhuma sobreposição geométrica real nunca gera issue (densidade sozinha não é defeito)", () => {
  const plan = basePlan({
    textZones: [
      { kind: "headline", text: "OFERTA", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 5, yPct: 85, widthPct: 90, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "price", text: "R$ 10", rect: { xPct: 5, yPct: 25, widthPct: 40, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "badge", text: "NOVO", rect: { xPct: 55, yPct: 25, widthPct: 20, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 5, yPct: 40, widthPct: 20, heightPct: 20 } }],
  });
  assert.deepEqual(checkOverdenseLayout(plan), []);
});

// Auditoria "motor de geração de criativos" — achado ao revisar checkSafeAreaCompliance: aquele
// check cobre só textZones de propósito ("assetPlacements não teria caminho de reparo"), premissa
// desatualizada por TEXT_ZONE_OVERLAPS_ASSET (que já prova que um código fora de
// RENDERER_REFLOW_CODES sempre tem gpt_replan como caminho real). Um produto/screenshot
// encostando na borda tem o mesmo risco de corte destrutivo que um texto.

test("checkAssetSafeAreaCompliance: assetPlacement tocando a borda do canvas vira CRITICAL_ASSET_CROP", () => {
  const plan = basePlan({
    assetPlacements: [{ role: "product_photo", url: "https://x/produto.png", rect: { xPct: 0, yPct: 10, widthPct: 40, heightPct: 40 }, frame: "none", treatment: "original" }],
  });
  const issues = checkAssetSafeAreaCompliance(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "CRITICAL_ASSET_CROP");
  assert.match(issues[0].message, /product_photo/);
});

test("checkAssetSafeAreaCompliance: assetPlacement dentro da margem de segurança não gera issue", () => {
  const plan = basePlan({
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 5, yPct: 5, widthPct: 20, heightPct: 10 }, frame: "none", treatment: "original" }],
  });
  assert.deepEqual(checkAssetSafeAreaCompliance(plan), []);
});

test("checkAssetSafeAreaCompliance: sem nenhum assetPlacement, nunca gera issue", () => {
  assert.deepEqual(checkAssetSafeAreaCompliance(basePlan({ assetPlacements: [] })), []);
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
test("checkAssetPlacementOverlap: Smoke A final geometry with product on the right does not fail on stale planned placement", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "Kit Noivos Sem Correria", rect: { xPct: 8.984, yPct: 26.563, widthPct: 32.813, heightPct: 20.313 }, emphasis: "primary", renderedBy: "renderer" }],
    assetPlacements: [{ role: "product_photo", url: "https://x/product.png", rect: { xPct: 43.889, yPct: 6.37, widthPct: 49.074, heightPct: 58.519 }, frame: "none", treatment: "final rendered product frame" }],
  });
  assert.deepEqual(checkAssetPlacementOverlap(plan), []);
});

test("checkAssetPlacementOverlap: Smoke A final geometry with product invading headline fails real overlap", () => {
  const plan = basePlan({
    textZones: [{ kind: "headline", text: "Kit Noivos Sem Correria", rect: { xPct: 8.984, yPct: 26.563, widthPct: 32.813, heightPct: 20.313 }, emphasis: "primary", renderedBy: "renderer" }],
    assetPlacements: [{ role: "product_photo", url: "https://x/product.png", rect: { xPct: 30, yPct: 20, widthPct: 36, heightPct: 45 }, frame: "none", treatment: "deliberate overlap fixture" }],
  });
  const issues = checkAssetPlacementOverlap(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "TEXT_ZONE_OVERLAPS_ASSET");
});

// Smoke A (cer-runtime-muyx4qzs-hoinur): bbox do produto declarada, pixels ausentes. Com prova em
// pixel disponível, o gate não confia mais só na bbox.

test("evaluateDeterministicCreativeChecks: prova em pixel visível para todo asset composto não gera issue", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1024,
    finalImageHeight: 1280,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["product_photo", "logo"],
    contextAssetRoles: ["product_photo", "logo"],
    assetPixelEvidence: [{ role: "product_photo", visible: true }, { role: "logo", visible: true }],
  });
  assert.deepEqual(issues, []);
});

test("evaluateDeterministicCreativeChecks: product_photo declarado mas sem pixels (frame vazio do Smoke A) vira REQUIRED_ASSET_MISSING", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1024,
    finalImageHeight: 1280,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["product_photo", "logo"],
    contextAssetRoles: ["product_photo", "logo"],
    assetPixelEvidence: [{ role: "product_photo", visible: false, reason: "asset indistinguível do frame vazio" }, { role: "logo", visible: true }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "REQUIRED_ASSET_MISSING");
  assert.match(issues[0].message, /product_photo/);
  assert.match(issues[0].message, /frame vazio/);
});

test("evaluateDeterministicCreativeChecks: asset composto sem nenhuma prova em pixel também reprova", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1024,
    finalImageHeight: 1280,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["product_photo"],
    contextAssetRoles: ["product_photo"],
    assetPixelEvidence: [],
  });
  assert.equal(issues[0]?.code, "REQUIRED_ASSET_MISSING");
});

test("evaluateDeterministicCreativeChecks: sem assetPixelEvidence (caminho padrão) o comportamento legado é preservado", () => {
  const issues = evaluateDeterministicCreativeChecks({
    finalImageWidth: 1024,
    finalImageHeight: 1280,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["product_photo"],
    contextAssetRoles: ["product_photo"],
  });
  assert.deepEqual(issues, []);
});

test("checkAssetSafeAreaCompliance: product frame perto da borda mas dentro dos 2% passa", () => {
  const plan = basePlan({
    assetPlacements: [{ role: "product_photo", url: "https://x/produto.jpg", rect: { xPct: 43.519, yPct: 6.222, widthPct: 50.741, heightPct: 64.593 }, frame: "none", treatment: "final rendered product photo" }],
  });
  assert.deepEqual(checkAssetSafeAreaCompliance(plan), []);
});

test("checkAssetSafeAreaCompliance: product frame do Smoke A (borda direita em 98,047%) continua reprovando", () => {
  const plan = basePlan({
    assetPlacements: [{ role: "product_photo", url: "https://x/produto.jpg", rect: { xPct: 46.289, yPct: 6.719, widthPct: 51.758, heightPct: 61.719 }, frame: "none", treatment: "final rendered product frame" }],
  });
  const issues = checkAssetSafeAreaCompliance(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "CRITICAL_ASSET_CROP");
});

// ---------------------------------------------------------------------------------------------
// Logo oficial: isenção ESPACIAL baseada em proveniência (Smoke A cer-runtime-muzle2ms-1wftsl,
// "Rumo ao Altar" do wordmark da logo composta foi reprovado como UNAUTHORIZED_TEXT).
// ---------------------------------------------------------------------------------------------

const LOGO_URL = "https://api.vorixworks.com/uploads/qa-assets/editorial/logo.png";
const LOGO_RECT = { xPct: 6.667, yPct: 6.222, widthPct: 27.778, heightPct: 4.741 };
const LOGO_TEXT_REGION = { xPct: 11, yPct: 6.5, widthPct: 20, heightPct: 4 };
const OUTSIDE_REGION = { xPct: 55, yPct: 70, widthPct: 25, heightPct: 5 };

function logoGateInput(overrides = {}) {
  return {
    finalImageUrl: "https://x/final.jpg",
    finalImageWidth: 1024,
    finalImageHeight: 1280,
    expectedAspectRatio: "4:5",
    compositedAssetRoles: ["product_photo", "logo"],
    context: baseContext({ assets: [{ url: LOGO_URL, role: "logo", description: "Logo oficial" }] }),
    plan: basePlan({ assetPlacements: [{ role: "logo", url: LOGO_URL, rect: LOGO_RECT, frame: "none", treatment: "final rendered logo" }] }),
    specialistId: "gpt-creative-director",
    assetPixelEvidence: [
      { role: "product_photo", visible: true, fidelityPass: true },
      { role: "logo", visible: true, fidelityPass: true },
    ],
    ...overrides,
  };
}

function visionReturning(unauthorizedTexts, extra = {}) {
  const prompts = [];
  return {
    prompts,
    request: async (request) => {
      prompts.push(request.prompt);
      return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, unauthorizedTexts, ...extra }) };
    },
  };
}

test("logo A: texto DENTRO da logo oficial verificada é isentado (e registrado), sem whitelist de palavra", async () => {
  const icaro = visionReturning([{ text: "Rumo ao Altar", region: LOGO_TEXT_REGION }]);
  const exempted = [];
  const result = await evaluateCreativeQualityGate(icaro, { ...logoGateInput(), onVerifiedLogoTextExempted: (item) => exempted.push(item) });
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.deepEqual(exempted.map((item) => item.text), ["Rumo ao Altar"]);
  assert.match(icaro.prompts[0], /"region"/, "com logo verificada a visão precisa devolver a região de cada texto");
});

test("logo B: o MESMO texto fora da região da logo continua UNAUTHORIZED_TEXT", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: OUTSIDE_REGION }]), logoGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT" && /Rumo ao Altar/.test(issue.message)));
});

test("logo B2: texto sem região informada nunca é isentado (falha fechada)", async () => {
  for (const item of ["Rumo ao Altar", { text: "Rumo ao Altar" }, { text: "Rumo ao Altar", region: { xPct: "x" } }]) {
    const result = await evaluateCreativeQualityGate(visionReturning([item]), logoGateInput());
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), JSON.stringify(item));
  }
});

test("logo B3: wordmark/logo falso inventado pela base fora da logo oficial continua reprovando", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([
    { text: "Rumo ao Altar", region: LOGO_TEXT_REGION },
    { text: "RUMO AO ALTAR", region: { xPct: 60, yPct: 20, widthPct: 30, heightPct: 6 } },
  ]), logoGateInput());
  assert.equal(result.issues.filter((issue) => issue.code === "UNAUTHORIZED_TEXT").length, 1);
});

test("logo C: bbox declarada como logo sem prova em pixel/proveniência válida NÃO isenta", async () => {
  const cases = {
    "sem prova em pixel": { assetPixelEvidence: undefined },
    "logo não visível": { assetPixelEvidence: [{ role: "logo", visible: false, fidelityPass: false }] },
    "fidelidade não comprovada": { assetPixelEvidence: [{ role: "logo", visible: true }] },
    "logo não composta pelo renderer": { compositedAssetRoles: ["product_photo"], assetPixelEvidence: [{ role: "product_photo", visible: true, fidelityPass: true }] },
    "placement aponta para outro asset": { plan: basePlan({ assetPlacements: [{ role: "logo", url: "https://evil.example/logo.png", rect: LOGO_RECT, frame: "none" }] }) },
    "logo não fornecida no contexto": { context: baseContext({ assets: [] }) },
  };
  for (const [label, overrides] of Object.entries(cases)) {
    const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: LOGO_TEXT_REGION }]), logoGateInput(overrides));
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), label);
  }
});

test("logo D: logo real diferente da referência continua WRONG_LOGO", async () => {
  const result = await evaluateCreativeQualityGate(
    visionReturning([], { wrongLogo: true, reasoning: "símbolo diferente" }),
    logoGateInput({ context: baseContext({ assets: [{ url: LOGO_URL, role: "logo", description: "Logo oficial" }] }) }),
  );
  assert.ok(result.issues.some((issue) => issue.code === "WRONG_LOGO"));
});

test("motor padrão (sem prova em pixel): prompt e parse de texto inalterados", async () => {
  const icaro = visionReturning(["SAIBA MAIS"]);
  const result = await evaluateCreativeQualityGate(icaro, { ...logoGateInput(), assetPixelEvidence: undefined, compositedAssetRoles: ["logo"] });
  assert.doesNotMatch(icaro.prompts[0], /"region"/);
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT" && /SAIBA MAIS/.test(issue.message)));
});

test("resolveVerifiedLogoRegions / isTextRegionInsideVerifiedLogo: geometria e tolerância", () => {
  const regions = resolveVerifiedLogoRegions({ plan: logoGateInput().plan, context: logoGateInput().context, compositedAssetRoles: ["logo"], assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }] });
  assert.deepEqual(regions, [LOGO_RECT]);
  assert.equal(isTextRegionInsideVerifiedLogo(LOGO_TEXT_REGION, regions), true);
  assert.equal(isTextRegionInsideVerifiedLogo({ xPct: 8, yPct: 5, widthPct: 25, heightPct: 6 }, regions), true, "estimativa um pouco maior que a logo ainda é a logo");
  assert.equal(isTextRegionInsideVerifiedLogo({ xPct: 8, yPct: 20, widthPct: 30, heightPct: 20 }, regions), false, "headline logo abaixo não é a logo");
  assert.equal(isTextRegionInsideVerifiedLogo({ xPct: 20, yPct: 6, widthPct: 40, heightPct: 5 }, regions), false, "texto que transborda muito a logo não é isentado");
  assert.equal(isTextRegionInsideVerifiedLogo({ xPct: 10, yPct: 7, widthPct: 0, heightPct: 0 }, regions), false);
});

// ---------------------------------------------------------------------------------------------
// Autorização textual REGIONAL e normalizada (cenário B execution-muzqmi4q-f7qx3f: CTA desenhado em
// caixa alta reprovado como UNAUTHORIZED_TEXT + MISSING_REQUIRED_TEXT, e "Rumo ao Altar" do próprio
// CTA reprovado). Nunca whitelist: equivalência só dentro da bbox FINAL do elemento.
// ---------------------------------------------------------------------------------------------

const B_CTA = "Conheça o Rumo ao Altar";
const B_CTA_RECT = { xPct: 7.778, yPct: 85.185, widthPct: 30.37, heightPct: 4.741 };
const B_HEAD_RECT = { xPct: 6.667, yPct: 60, widthPct: 86.667, heightPct: 14 };
const SHOT_URL = "https://api.vorixworks.com/uploads/qa-assets/editorial/site.png";
const SHOT_RECT = { xPct: 5.926, yPct: 12, widthPct: 88.148, heightPct: 45 };
const CTA_UPPER_REGION = { xPct: 9, yPct: 85.6, widthPct: 27, heightPct: 3.8 };

function regionalGateInput(overrides = {}) {
  const base = logoGateInput();
  return {
    ...base,
    compositedAssetRoles: ["logo"],
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }],
    plan: basePlan({
      headline: "O casamento organizado como vocês sonharam",
      cta: B_CTA,
      assetPlacements: base.plan.assetPlacements,
      textZones: [
        { kind: "headline", text: "O casamento organizado como vocês sonharam", rect: B_HEAD_RECT, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: B_CTA, rect: B_CTA_RECT, emphasis: "secondary", renderedBy: "renderer" },
      ],
    }),
    ...overrides,
  };
}

test("normalizeRenderedText: caixa, NFC, espaços e pontuação simples — NUNCA remove acento", () => {
  assert.equal(normalizeRenderedText("Conheça o Rumo ao Altar"), normalizeRenderedText("CONHEÇA O RUMO AO ALTAR"));
  assert.equal(normalizeRenderedText("Conheça o Rumo ao Altar"), normalizeRenderedText("Conheça  o Rumo ao Altar."), "NFD e espaço/ponto final equivalem");
  assert.equal(normalizeRenderedText("“Sem Correria!”"), "sem correria");
  assert.notEqual(normalizeRenderedText("Conheca o Rumo ao Altar"), normalizeRenderedText("Conheça o Rumo ao Altar"), "acento ausente nunca é mascarado");
  assert.equal(normalizeRenderedText("R$ 149,00"), "r$ 149,00", "vírgula decimal (sem espaço depois) é preservada");
});

test("regional A: CTA em CAIXA ALTA dentro da bbox final do CTA é autorizado e o ausente contraditório é reconciliado", async () => {
  const icaro = visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: CTA_UPPER_REGION }], { missingRequiredTexts: [B_CTA] });
  const result = await evaluateCreativeQualityGate(icaro, regionalGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.match(icaro.prompts[0], /"region"/);
  assert.match(icaro.prompts[0], /MAIÚSCULAS\/minúsculas/);
  const authorized = result.textDiagnostics.find((item) => item.decision === "authorized");
  assert.equal(authorized.matchedElement, "cta");
  assert.equal(authorized.normalizedDetected, "conheça o rumo ao altar");
  assert.equal(authorized.normalizedExpected, "conheça o rumo ao altar");
  assert.ok(result.textDiagnostics.some((item) => item.decision === "missing_reconciled" && item.detectedText === B_CTA));
});

test("regional B: o MESMO texto do CTA fora da bbox do CTA continua UNAUTHORIZED_TEXT (com motivo no diagnóstico)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: { xPct: 50, yPct: 20, widthPct: 30, heightPct: 5 } }]), regionalGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  const rejected = result.textDiagnostics.find((item) => item.decision === "rejected");
  assert.match(rejected.reason, /bbox longe da zona final/);
  assert.equal(rejected.matchDecision, "REJECTED");
  assert.equal(rejected.normalizedExpected, "conheça o rumo ao altar");
});

test("regional C: Rumo ao Altar dentro do CTA autorizado é legítimo; fora do CTA e da logo, não", async () => {
  const inside = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: { xPct: 20, yPct: 85.6, widthPct: 16, heightPct: 3.6 } }]), regionalGateInput());
  assert.equal(inside.verdict, "pass", JSON.stringify(inside.issues));
  assert.equal(inside.textDiagnostics[0].matchedElement, "cta");
  const outside = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: OUTSIDE_REGION }]), regionalGateInput());
  assert.ok(outside.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT" && /Rumo ao Altar/.test(issue.message)));
});

test("regional D: logo continua isentando só dentro da bbox da logo, com diagnóstico", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: LOGO_TEXT_REGION }]), regionalGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].matchedElement, "logo");
});

test("regional E: copy SEM acento detectada no CTA acentuado não é equivalente (rejeitada)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHECA O RUMO AO ALTAR", region: CTA_UPPER_REGION }]), regionalGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("regional F: ausência real (sem equivalente na região) continua MISSING_REQUIRED_TEXT", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], { missingRequiredTexts: [B_CTA] }), regionalGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_TEXT"));
  assert.ok(result.textDiagnostics.some((item) => item.decision === "missing"));
});

test("regional G: sem prova em pixel (motor padrão) não há autorização regional", async () => {
  const icaro = visionReturning(["CONHEÇA O RUMO AO ALTAR"]);
  const result = await evaluateCreativeQualityGate(icaro, regionalGateInput({ assetPixelEvidence: undefined }));
  assert.doesNotMatch(icaro.prompts[0], /"region"/);
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("regional H: diagnóstico é sanitizado (só campos estruturados, sem resposta bruta da visão)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: CTA_UPPER_REGION }], { reasoning: "RAW" }), regionalGateInput());
  for (const item of result.textDiagnostics) {
    for (const key of Object.keys(item)) assert.ok(["detectedText", "bbox", "matchedElement", "normalizedExpected", "normalizedDetected", "decision", "reason"].includes(key), key);
  }
  assert.doesNotMatch(JSON.stringify(result.textDiagnostics), /RAW/);
});

test("screenshot real verificado: texto da interface dentro da bbox do screenshot é isentado; fora não; sem fidelidade não", async () => {
  const input = (evidence) => regionalGateInput({
    compositedAssetRoles: ["screenshot", "logo"],
    context: baseContext({ assets: [{ url: LOGO_URL, role: "logo", description: "Logo" }, { url: SHOT_URL, role: "screenshot", description: "Site real" }] }),
    plan: { ...regionalGateInput().plan, assetPlacements: [...regionalGateInput().plan.assetPlacements, { role: "screenshot", url: SHOT_URL, rect: SHOT_RECT, frame: "none" }] },
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }, evidence],
  });
  const uiTexts = [{ text: "Lista de presentes", region: { xPct: 12, yPct: 20, widthPct: 20, heightPct: 2.5 } }, { text: "R$ 79,90", region: { xPct: 13, yPct: 45, widthPct: 6, heightPct: 1.8 } }];
  const inside = await evaluateCreativeQualityGate(visionReturning(uiTexts), input({ role: "screenshot", visible: true, fidelityPass: true }));
  assert.equal(inside.verdict, "pass", JSON.stringify(inside.issues));
  assert.ok(inside.textDiagnostics.every((item) => item.matchedElement === "screenshot"));
  const outside = await evaluateCreativeQualityGate(visionReturning([{ text: "Lista de presentes", region: { xPct: 12, yPct: 90, widthPct: 20, heightPct: 3 } }]), input({ role: "screenshot", visible: true, fidelityPass: true }));
  assert.ok(outside.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  const unverified = await evaluateCreativeQualityGate(visionReturning([uiTexts[0]]), input({ role: "screenshot", visible: true, fidelityPass: false }));
  assert.ok(unverified.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

// ---------------------------------------------------------------------------------------------
// Duplicidade por OCORRÊNCIA (região + proveniência), não por string: o screenshot real do site
// contém "Criar meu site" e o CTA determinístico também (cenário C).
// ---------------------------------------------------------------------------------------------

const C_CTA = "Criar meu site";
const C_CTA_RECT = { xPct: 8.148, yPct: 85.333, widthPct: 21.111, heightPct: 5.333 };
const C_HEAD_RECT = { xPct: 6.667, yPct: 13, widthPct: 86.667, heightPct: 12 };
const C_OUTSIDE = { xPct: 55, yPct: 91, widthPct: 30, heightPct: 3 };
const C_SHOT_RECT = { xPct: 5.926, yPct: 34.5, widthPct: 88.148, heightPct: 46 };
const SHOT_CTA_REGION = { xPct: 82, yPct: 36.2, widthPct: 8, heightPct: 1.6 };
const CTA_REGION = { xPct: 9.5, yPct: 86, widthPct: 18, heightPct: 3.8 };

function cGateInput(screenshotEvidence = { role: "screenshot", visible: true, fidelityPass: true }, overrides = {}) {
  return {
    ...logoGateInput(),
    compositedAssetRoles: ["screenshot", "logo"],
    context: baseContext({ assets: [{ url: LOGO_URL, role: "logo", description: "Logo" }, { url: SHOT_URL, role: "screenshot", description: "Site real" }] }),
    plan: basePlan({
      headline: "Sua lista de presentes, linda e sem planilha",
      cta: C_CTA,
      assetPlacements: [
        { role: "logo", url: LOGO_URL, rect: LOGO_RECT, frame: "none" },
        { role: "screenshot", url: SHOT_URL, rect: C_SHOT_RECT, frame: "none" },
      ],
      textZones: [
        { kind: "headline", text: "Sua lista de presentes, linda e sem planilha", rect: C_HEAD_RECT, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: C_CTA, rect: C_CTA_RECT, emphasis: "secondary", renderedBy: "renderer" },
      ],
    }),
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }, screenshotEvidence],
    ...overrides,
  };
}

function duplicated(text, regions) {
  return { duplicatedTexts: [{ text, occurrences: regions.map((region) => ({ region })) }] };
}

test("duplicidade C: Criar meu site no screenshot fiel + no CTA = duas ocorrências legítimas (PASS)", async () => {
  const icaro = visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION]));
  const result = await evaluateCreativeQualityGate(icaro, cGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.match(icaro.prompts[0], /"occurrences"/);
  assert.deepEqual(result.occurrenceDiagnostics.map((item) => [item.matchedRegion, item.provenance, item.decision]), [
    ["SCREENSHOT_CONTENT", "VERIFIED_SCREENSHOT", "allowed"],
    ["cta", "RENDERER_TEXT_ZONE", "allowed"],
  ]);
  assert.ok(result.occurrenceDiagnostics.every((item) => item.reason.startsWith("ALLOWED_TWO_LEGITIMATE_OCCURRENCES")));
});

test("duplicidade C: CTA renderizado em CAIXA ALTA + screenshot com caixa original continuam legítimos", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated("CRIAR MEU SITE", [SHOT_CTA_REGION, CTA_REGION])), cGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.occurrenceDiagnostics[1].matchedRegion, "cta");
  assert.equal(result.occurrenceDiagnostics[1].normalizedText, "criar meu site");
});

test("duplicidade C: terceira ocorrência em região desconhecida reprova", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION, { xPct: 60, yPct: 26, widthPct: 25, heightPct: 4 }])), cGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  const rejected = result.occurrenceDiagnostics.find((item) => item.decision === "rejected");
  assert.equal(rejected.provenance, "UNVERIFIED");
  assert.equal(rejected.occurrenceId, "dup-0-2");
});

test("duplicidade C: screenshot SEM prova de fidelidade/visibilidade não concede isenção", async () => {
  for (const evidence of [{ role: "screenshot", visible: true, fidelityPass: false }, { role: "screenshot", visible: false, fidelityPass: true }]) {
    const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION])), cGateInput(evidence));
    assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), JSON.stringify(evidence));
  }
});

test("duplicidade C: placement do screenshot apontando para outro asset não isenta", async () => {
  const input = cGateInput();
  input.plan = { ...input.plan, assetPlacements: [input.plan.assetPlacements[0], { role: "screenshot", url: "https://evil.example/site.png", rect: C_SHOT_RECT, frame: "none" }] };
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION])), input);
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
});

test("duplicidade real: duas vezes como CTA, ou duas vezes fora das regiões, continua reprovando", async () => {
  const twiceCta = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [CTA_REGION, { ...CTA_REGION, xPct: 10 }])), cGateInput());
  assert.ok(twiceCta.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.match(twiceCta.occurrenceDiagnostics[1].reason, /segunda ocorrência dentro da mesma zona cta/);
  const twiceOutside = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [{ xPct: 60, yPct: 26, widthPct: 25, heightPct: 4 }, C_OUTSIDE])), cGateInput());
  assert.ok(twiceOutside.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
});

test("duplicidade: screenshot não isenta globalmente (texto do site fora da bbox do screenshot é UNAUTHORIZED)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Voltar ao site", region: C_OUTSIDE }]), cGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("duplicidade: sem regiões por ocorrência a regra antiga vale (string repetida reprova)", async () => {
  const stringOnly = await evaluateCreativeQualityGate(visionReturning([], { duplicatedTexts: [C_CTA] }), cGateInput());
  assert.ok(stringOnly.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  const standard = await evaluateCreativeQualityGate(visionReturning([], { duplicatedTexts: [C_CTA] }), cGateInput(undefined, { assetPixelEvidence: undefined }));
  assert.ok(standard.issues.some((issue) => issue.code === "DUPLICATED_TEXT" && !/\(/.test(issue.message.split("Remova a duplicata.")[1] ?? "")));
});

test("duplicidade: logo continua legítima só dentro da bbox da logo", async () => {
  const inside = await evaluateCreativeQualityGate(visionReturning([], duplicated("Rumo ao Altar", [LOGO_TEXT_REGION, SHOT_CTA_REGION])), cGateInput());
  assert.equal(inside.verdict, "pass", JSON.stringify(inside.issues));
  assert.equal(inside.occurrenceDiagnostics[0].provenance, "VERIFIED_LOGO");
  const outside = await evaluateCreativeQualityGate(visionReturning([], duplicated("Rumo ao Altar", [LOGO_TEXT_REGION, C_OUTSIDE])), cGateInput());
  assert.ok(outside.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
});

test("duplicidade: diagnóstico de ocorrência é sanitizado", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], { ...duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION]), reasoning: "RAW" }), cGateInput());
  for (const item of result.occurrenceDiagnostics) {
    for (const key of Object.keys(item)) assert.ok(["occurrenceId", "normalizedText", "bbox", "matchedRegion", "provenance", "decision", "reason"].includes(key), key);
  }
  assert.doesNotMatch(JSON.stringify(result.occurrenceDiagnostics), /RAW/);
});

// ---------------------------------------------------------------------------------------------
// Jitter espacial da visão (cenário B real execution-mv03bie3-i7op5z): CTA lido certo e em caixa
// alta, mas a bbox estimada ficou ~1 altura de CTA acima da bbox FINAL. A geometria do renderer é a
// verdade; a visão só localiza aproximadamente. Alta confiança só para texto INTEIRO, ocorrência
// única no manifesto, sem outra ocorrência equivalente, base sem a frase e perto pela faixa de jitter.
// ---------------------------------------------------------------------------------------------

const REAL_B = {
  headline: { xPct: 6.667, yPct: 70.074, widthPct: 86.667, heightPct: 10.169 },
  subheadline: { xPct: 12.037, yPct: 81.852, widthPct: 75.926, heightPct: 5.52 },
  cta: { xPct: 33.796, yPct: 89.926, widthPct: 32.5, heightPct: 4.741 },
  logo: { xPct: 40.185, yPct: 64.148, widthPct: 19.63, heightPct: 3.407 },
  visionCta: { xPct: 36, yPct: 85, widthPct: 28, heightPct: 5 },
};
const B_HEADLINE = "O casamento organizado como vocês sonharam";
const B_SUB = "Site, lista de presentes e confirmação de presença em um só lugar.";

function realBGateInput(overrides = {}) {
  return {
    ...logoGateInput(),
    compositedAssetRoles: ["logo"],
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }],
    plan: basePlan({
      headline: B_HEADLINE,
      subheadline: B_SUB,
      cta: B_CTA,
      assetPlacements: [{ role: "logo", url: LOGO_URL, rect: REAL_B.logo, frame: "none" }],
      textZones: [
        { kind: "headline", text: B_HEADLINE, rect: REAL_B.headline, emphasis: "primary", renderedBy: "renderer" },
        { kind: "subheadline", text: B_SUB, rect: REAL_B.subheadline, emphasis: "secondary", renderedBy: "renderer" },
        { kind: "cta", text: B_CTA, rect: REAL_B.cta, emphasis: "secondary", renderedBy: "renderer" },
      ],
    }),
    ...overrides,
  };
}
const ctaAt = (region) => visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region }]);

test("jitter: medida de proximidade é proporcional à altura da zona", () => {
  const near = measureRenderedTextProximity(REAL_B.visionCta, REAL_B.cta);
  assert.equal(near.near, true, JSON.stringify(near));
  assert.ok(near.overlap < 0.6, "pela regra estrita antiga (overlap) seria reprovado");
  assert.equal(near.band, REAL_B.cta.heightPct);
  const bigZone = { xPct: 6, yPct: 40, widthPct: 88, heightPct: 20 };
  assert.equal(measureRenderedTextProximity({ xPct: 10, yPct: 25, widthPct: 80, heightPct: 12 }, bigZone).near, true, "zona grande tolera deslocamento proporcionalmente maior");
  assert.equal(measureRenderedTextProximity({ xPct: 36, yPct: 75, widthPct: 28, heightPct: 5 }, REAL_B.cta).near, false, "o mesmo deslocamento absoluto não vale para uma zona pequena");
});

test("jitter B real: bbox deslocada como no run real → PASS como MATCHED_RENDERED_CTA", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(REAL_B.visionCta), realBGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const diag = result.textDiagnostics.find((item) => item.matchDecision);
  assert.equal(diag.matchDecision, "MATCHED_RENDERED_CTA");
  assert.equal(diag.reason, "exact_text_single_occurrence_no_second_occurrence_in_final_spatially_near");
  assert.equal(diag.expectedRole, "cta");
  assert.deepEqual(diag.expectedBBox, REAL_B.cta);
  for (const key of ["occurrenceId", "overlap", "centerDistance", "toleranceApplied"]) assert.ok(diag[key] !== undefined, key);
});

test("jitter B real com base diagnosticada limpa → razão base_clean", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(REAL_B.visionCta), realBGateInput({ baseImageTexts: [] }));
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].reason, "exact_text_single_occurrence_base_clean_spatially_near");
});

test("jitter pequeno e moderado → PASS; limite aceitável → PASS; logo além do limite → FAIL", async () => {
  for (const region of [
    { xPct: 34.5, yPct: 90.2, widthPct: 31, heightPct: 4.3 },
    { xPct: 35, yPct: 87.5, widthPct: 30, heightPct: 5 },
    { xPct: 36, yPct: 84, widthPct: 28, heightPct: 4 },
  ]) {
    const result = await evaluateCreativeQualityGate(ctaAt(region), realBGateInput());
    assert.equal(result.verdict, "pass", `${JSON.stringify(region)} ${JSON.stringify(result.issues)}`);
  }
  const beyond = await evaluateCreativeQualityGate(ctaAt({ xPct: 36, yPct: 82, widthPct: 28, heightPct: 4 }), realBGateInput());
  assert.ok(beyond.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  assert.match(beyond.textDiagnostics[0].reason, /bbox longe da zona final/);
});

test("jitter: texto exato longe da zona (topo da peça) continua UNAUTHORIZED_TEXT", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt({ xPct: 36, yPct: 8, widthPct: 28, heightPct: 5 }), realBGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  assert.equal(result.textDiagnostics[0].matchDecision, "REJECTED");
});

test("jitter: duas ocorrências (uma perto do CTA + uma desconhecida) → FAIL, sem fundir", async () => {
  const twoDetections = await evaluateCreativeQualityGate(visionReturning([
    { text: "CONHEÇA O RUMO AO ALTAR", region: REAL_B.visionCta },
    { text: "CONHEÇA O RUMO AO ALTAR", region: { xPct: 30, yPct: 20, widthPct: 30, heightPct: 5 } },
  ]), realBGateInput());
  assert.equal(twoDetections.issues.filter((issue) => issue.code === "UNAUTHORIZED_TEXT").length, 2);
  assert.match(twoDetections.textDiagnostics[0].reason, /outra ocorrência equivalente/);
  const duplicated = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: REAL_B.visionCta }], { duplicatedTexts: [{ text: B_CTA, occurrences: [{ region: REAL_B.visionCta }, { region: { xPct: 30, yPct: 20, widthPct: 30, heightPct: 5 } }] }] }), realBGateInput());
  assert.ok(duplicated.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.ok(duplicated.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), "a ocorrência perto do CTA não ganha alta confiança com duplicata não resolvida");
});

test("jitter: base que já contém a frase nunca usa a regra de alta confiança", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(REAL_B.visionCta), realBGateInput({ baseImageTexts: ["Conheça o Rumo ao Altar"] }));
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  assert.match(result.textDiagnostics[0].reason, /a imagem base já contém a frase/);
});

test("jitter: manifesto com duas zonas do mesmo texto não é ocorrência única → FAIL", async () => {
  const input = realBGateInput();
  input.plan = { ...input.plan, textZones: [...input.plan.textZones, { kind: "badge", text: B_CTA, rect: { xPct: 10, yPct: 5, widthPct: 30, heightPct: 4 }, emphasis: "secondary", renderedBy: "renderer" }] };
  const result = await evaluateCreativeQualityGate(ctaAt(REAL_B.visionCta), input);
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  assert.match(result.textDiagnostics[0].reason, /mais de uma zona/);
});

test("jitter: acento continua relevante e trecho parcial não ganha tolerância", async () => {
  const noAccent = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHECA O RUMO AO ALTAR", region: REAL_B.visionCta }]), realBGateInput());
  assert.ok(noAccent.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  const partial = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: { xPct: 45, yPct: 85.5, widthPct: 18, heightPct: 4 } }]), realBGateInput());
  assert.ok(partial.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), "marca dentro do CTA exige a bbox estrita do CTA");
});

test("jitter: ausência contraditória do CTA é reconciliada quando o casamento de alta confiança passa", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: REAL_B.visionCta }], { missingRequiredTexts: [B_CTA] }), realBGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.ok(result.textDiagnostics.some((item) => item.decision === "missing_reconciled"));
});

test("jitter: duplicidade legítima screenshot + CTA deslocado continua aceita (uma ocorrência por zona)", async () => {
  const jitteredCta = { xPct: 9.5, yPct: 82.5, widthPct: 18, heightPct: 3.8 };
  const ok = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, jitteredCta])), cGateInput());
  assert.equal(ok.verdict, "pass", JSON.stringify(ok.issues));
  const twiceCta = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [CTA_REGION, jitteredCta])), cGateInput());
  assert.ok(twiceCta.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), "duas ocorrências no mesmo CTA nunca se fundem");
});

// ---------------------------------------------------------------------------------------------
// Ledger de proveniência textual (cenário B real execution-mv0ayw83-a0iw8l): a visão inventou 2×
// "Rumo ao Altar" em posições que não existem; as ocorrências reais eram a logo e o CTA. A contagem
// de texto conhecido passa a ser reconciliada com renderer + assets + diagnóstico da base.
// ---------------------------------------------------------------------------------------------

const CLEAN_BASE = { status: "AVAILABLE", texts: [] };
const BRAND_CONTEXT = baseContext({ brandName: "Rumo ao Altar", assets: [{ url: LOGO_URL, role: "logo", description: "Logo oficial Rumo ao Altar" }] });
const HALLUCINATED = { duplicatedTexts: [{ text: "Rumo ao Altar", occurrences: [{ region: { xPct: 44, yPct: 48, widthPct: 12, heightPct: 3 } }, { region: { xPct: 44, yPct: 5, widthPct: 12, heightPct: 3 } }] }] };

function ledgerGateInput(overrides = {}) {
  return realBGateInput({ context: BRAND_CONTEXT, baseTextDiagnostic: CLEAN_BASE, ...overrides });
}

test("ledger: B real — duplicidade inventada pela visão é reconciliada com logo + CTA (sem DUPLICATED_TEXT)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], HALLUCINATED), ledgerGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.ok(result.occurrenceDiagnostics.every((item) => item.decision === "allowed" && /LEDGER_RECONCILED/.test(item.reason)), JSON.stringify(result.occurrenceDiagnostics));
  assert.match(result.occurrenceDiagnostics[0].reason, /RENDERER_TEXT\/cta \+ LOGO_ASSET\/logo|LOGO_ASSET\/logo \+ RENDERER_TEXT\/cta/);
  const ledger = result.textProvenanceLedger;
  assert.equal(ledger.baseTextStatus, "AVAILABLE");
  assert.ok(ledger.entries.some((entry) => entry.sourceType === "RENDERER_TEXT" && entry.role === "cta" && entry.normalizedText === "conheça o rumo ao altar" && entry.deterministic));
  assert.ok(ledger.entries.some((entry) => entry.sourceType === "LOGO_ASSET" && entry.alternatives.includes("rumo ao altar")));
  assert.ok(!ledger.entries.some((entry) => entry.sourceType === "BASE_IMAGE"));
});

test("ledger: sem diagnóstico da base o ledger não reconcilia (falha fechada)", async () => {
  for (const baseTextDiagnostic of [undefined, { status: "NOT_AVAILABLE", texts: [] }]) {
    const result = await evaluateCreativeQualityGate(visionReturning([], HALLUCINATED), ledgerGateInput({ baseTextDiagnostic }));
    assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), JSON.stringify(baseTextDiagnostic));
    assert.match(result.issues[0].message, /sem diagnóstico de texto da base/);
  }
});

test("ledger: base que já contém a marca NÃO é absorvida pelo ledger do renderer", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], HALLUCINATED), ledgerGateInput({ baseTextDiagnostic: { status: "AVAILABLE", texts: [{ text: "Rumo ao Altar", normalizedText: "rumo ao altar", bbox: { xPct: 40, yPct: 10, widthPct: 20, heightPct: 4 } }] } }));
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.match(result.issues.find((issue) => issue.code === "DUPLICATED_TEXT").message, /imagem base já contém o texto/);
  assert.ok(result.textProvenanceLedger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.deterministic === false));
});

test("ledger: mais ocorrências do que origens explicáveis continua duplicidade", async () => {
  const three = { duplicatedTexts: [{ text: "Rumo ao Altar", occurrences: [{ region: { xPct: 44, yPct: 48, widthPct: 12, heightPct: 3 } }, { region: { xPct: 44, yPct: 5, widthPct: 12, heightPct: 3 } }, { region: { xPct: 10, yPct: 30, widthPct: 12, heightPct: 3 } }] }] };
  const result = await evaluateCreativeQualityGate(visionReturning([], three), ledgerGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.match(result.issues[0].message, /3 ocorrências reportadas > 2 origens explicáveis/);
});

test("ledger: texto realmente desconhecido continua bloqueado (não é whitelist)", async () => {
  const unauthorized = await evaluateCreativeQualityGate(visionReturning([{ text: "DESCONTO 90%", region: { xPct: 30, yPct: 20, widthPct: 30, heightPct: 5 } }]), ledgerGateInput());
  assert.ok(unauthorized.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT" && /DESCONTO 90%/.test(issue.message)));
  const duplicatedUnknown = await evaluateCreativeQualityGate(visionReturning([], { duplicatedTexts: [{ text: "PROMOÇÃO 70%", occurrences: [{ region: { xPct: 10, yPct: 10, widthPct: 20, heightPct: 4 } }, { region: { xPct: 50, yPct: 30, widthPct: 20, heightPct: 4 } }] }] }), ledgerGateInput());
  assert.ok(duplicatedUnknown.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.match(duplicatedUnknown.issues[0].message, /texto sem origem no ledger/);
});

test("ledger: texto exato do CTA longe da zona continua UNAUTHORIZED (ledger só reconcilia contagem de duplicatas)", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt({ xPct: 36, yPct: 8, widthPct: 28, heightPct: 5 }), ledgerGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("ledger: CTA com jitter continua MATCHED_RENDERED_CTA e agora com razão base_clean", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(REAL_B.visionCta), ledgerGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].matchDecision, "MATCHED_RENDERED_CTA");
  assert.equal(result.textDiagnostics[0].reason, "exact_text_single_occurrence_base_clean_spatially_near");
});

test("ledger: screenshot + CTA continuam duas provenances distintas (dcc8599)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated("CRIAR MEU SITE", [SHOT_CTA_REGION, CTA_REGION])), cGateInput(undefined, { baseTextDiagnostic: CLEAN_BASE }));
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.deepEqual(result.occurrenceDiagnostics.map((item) => item.provenance), ["VERIFIED_SCREENSHOT", "RENDERER_TEXT_ZONE"]);
  assert.ok(result.textProvenanceLedger.entries.some((entry) => entry.sourceType === "SCREENSHOT_ASSET"));
});

test("ledger: logo sem prova em pixel não entra no ledger (não explica texto)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], HALLUCINATED), ledgerGateInput({ assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: false }] }));
  assert.ok(!result.textProvenanceLedger.entries.some((entry) => entry.sourceType === "LOGO_ASSET"));
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), "só o CTA explica 1 ocorrência; 2 reportadas");
});

// ---------------------------------------------------------------------------------------------
// VISION_ZONE_CONTRADICTION (cenário B real execution-mv1ipciu-jociy4): a visão achou o CTA real
// e mais uma "ocorrência" do CTA dentro da zona onde o renderer desenhou OUTRO texto (subheadline),
// com a base limpa. Só vale para adjudicar duplicidade de texto com origem no ledger.
// ---------------------------------------------------------------------------------------------

const SUB_FALSE_REGION = { xPct: 14, yPct: 82.2, widthPct: 30, heightPct: 4.5 };
const HEAD_FALSE_REGION = { xPct: 10, yPct: 72, widthPct: 40, heightPct: 6 };
const REAL_CTA_REGION = { xPct: 34, yPct: 90, widthPct: 32, heightPct: 4.5 };
const contradictions = (result) => result.occurrenceDiagnostics.filter((item) => item.decision === "VISION_ZONE_CONTRADICTION");

test("zona A: CTA real + CTA falso sobre a subheadline, base limpa → PASS com diagnóstico", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const [flagged] = contradictions(result);
  assert.ok(flagged, JSON.stringify(result.occurrenceDiagnostics));
  assert.equal(flagged.ignoredForDuplicateCount, true);
  assert.equal(flagged.normalizedText, "conheça o rumo ao altar");
  assert.equal(flagged.conflictingRendererRole, "subheadline");
  assert.equal(flagged.conflictingRendererText, "site lista de presentes e confirmação de presença em um só lugar");
  assert.deepEqual(flagged.conflictingRendererBBox, REAL_B.subheadline);
  assert.equal(flagged.expectedLedgerRole, "cta");
  assert.ok(flagged.expectedLedgerSourceId);
  assert.equal(flagged.baseTextScanStatus, "AVAILABLE");
  assert.equal(flagged.baseContainsDetectedText, false);
  assert.match(flagged.reason, /^detected_text_conflicts_with_verified_subheadline_zone_base_clean_and_legitimate_cta_exists/);
  assert.ok(result.occurrenceDiagnostics.some((item) => item.decision === "allowed" && item.matchedRegion === "cta"));
});

test("zona B: CTA real + segunda ocorrência vinda da base → FAIL", async () => {
  const base = { status: "AVAILABLE", texts: [{ text: B_CTA, normalizedText: "conheça o rumo ao altar", bbox: SUB_FALSE_REGION }] };
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput({ baseTextDiagnostic: base }));
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.equal(contradictions(result).length, 0);
});

test("zona C: texto desconhecido sobre a subheadline → FAIL (não é whitelist)", async () => {
  const dup = await evaluateCreativeQualityGate(visionReturning([], duplicated("DESCONTO 90%", [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput());
  assert.ok(dup.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.equal(contradictions(dup).length, 0);
  const unauthorized = await evaluateCreativeQualityGate(visionReturning([{ text: "DESCONTO 90%", region: SUB_FALSE_REGION }]), ledgerGateInput());
  assert.ok(unauthorized.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("zona D: só o CTA falso sobre a subheadline, CTA real não detectado → regras de texto obrigatório valem", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: B_CTA, region: SUB_FALSE_REGION }], { missingRequiredTexts: [B_CTA] }), ledgerGateInput());
  assert.notEqual(result.verdict, "pass");
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_TEXT" || issue.code === "UNAUTHORIZED_TEXT"), JSON.stringify(result.issues));
});

test("zona E: duas ocorrências falsas sem a legítima → nenhuma PASS fabricada", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [SUB_FALSE_REGION, HEAD_FALSE_REGION])), ledgerGateInput());
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.equal(contradictions(result).length, 0);
});

test("zona F/G: logo + CTA e screenshot + CTA continuam PASS", async () => {
  const logo = await evaluateCreativeQualityGate(visionReturning([], HALLUCINATED), ledgerGateInput());
  assert.equal(logo.verdict, "pass", JSON.stringify(logo.issues));
  assert.equal(contradictions(logo).length, 0);
  const shot = await evaluateCreativeQualityGate(visionReturning([], duplicated(C_CTA, [SHOT_CTA_REGION, CTA_REGION])), cGateInput(undefined, { baseTextDiagnostic: CLEAN_BASE }));
  assert.equal(shot.verdict, "pass", JSON.stringify(shot.issues));
  assert.ok(shot.occurrenceDiagnostics.every((item) => item.reason.startsWith("ALLOWED_TWO_LEGITIMATE_OCCURRENCES")));
});

test("zona H: scan da base NOT_AVAILABLE desliga a regra", async () => {
  for (const baseTextDiagnostic of [undefined, { status: "NOT_AVAILABLE", texts: [] }]) {
    const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput({ baseTextDiagnostic }));
    assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), JSON.stringify(baseTextDiagnostic));
    assert.equal(contradictions(result).length, 0);
  }
});

test("zona I/J: caixa alta equivalente → PASS; acentuação diferente → FAIL", async () => {
  const upper = await evaluateCreativeQualityGate(visionReturning([], duplicated("CONHEÇA O RUMO AO ALTAR", [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput());
  assert.equal(upper.verdict, "pass", JSON.stringify(upper.issues));
  const noAccent = await evaluateCreativeQualityGate(visionReturning([], duplicated("CONHECA O RUMO AO ALTAR", [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput());
  assert.ok(noAccent.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  assert.equal(contradictions(noAccent).length, 0);
});

test("zona defensivo: asset soberano sobre a zona nunca vira contradição (a geometria já reprova)", async () => {
  const input = ledgerGateInput();
  input.plan = { ...input.plan, assetPlacements: [{ role: "logo", url: LOGO_URL, rect: REAL_B.subheadline, frame: "none" }] };
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [REAL_CTA_REGION, SUB_FALSE_REGION])), input);
  assert.notEqual(result.verdict, "pass");
  assert.equal(contradictions(result).length, 0, JSON.stringify(result.occurrenceDiagnostics));
});

test("zona defensivo: base com trecho do texto sobre a zona (evidência independente) → FAIL", async () => {
  const base = { status: "AVAILABLE", texts: [{ text: "Rumo ao Altar", normalizedText: "rumo ao altar", bbox: SUB_FALSE_REGION }] };
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [REAL_CTA_REGION, SUB_FALSE_REGION])), ledgerGateInput({ baseTextDiagnostic: base }));
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATED_TEXT"), JSON.stringify(result.issues));
  assert.equal(contradictions(result).length, 0);
});

// ---------------------------------------------------------------------------------------------
// VISION_ZONE_CONTRADICTION no caminho de texto (cenário B real execution-mv29jftt-v4haee): a visão
// leu o CTA exato, uma única vez, mas com bbox DENTRO da zona onde o renderer desenhou o subtítulo
// (base limpa). A posição da visão é que está errada; texto solto/duplicado continua reprovando.
// ---------------------------------------------------------------------------------------------

const B8 = {
  headline: { xPct: 5.926, yPct: 87.407, widthPct: 51.852, heightPct: 7.52 },
  subheadline: { xPct: 63.519, yPct: 83.778, widthPct: 30.556, heightPct: 5.68 },
  cta: { xPct: 63.056, yPct: 91.111, widthPct: 31.019, heightPct: 3.852 },
  logo: { xPct: 78.704, yPct: 79.481, widthPct: 15.37, heightPct: 2.667 },
  visionCta: { xPct: 70, yPct: 85, widthPct: 20, heightPct: 5 },
};

function b8GateInput(overrides = {}) {
  const input = ledgerGateInput(overrides);
  input.plan = {
    ...input.plan,
    assetPlacements: [{ role: "logo", url: LOGO_URL, rect: B8.logo, frame: "none" }],
    textZones: [
      { kind: "headline", text: B_HEADLINE, rect: B8.headline, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: B_SUB, rect: B8.subheadline, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "cta", text: B_CTA, rect: B8.cta, emphasis: "secondary", renderedBy: "renderer" },
    ],
  };
  return input;
}

test("zona texto: B real — CTA exato lido dentro da zona do subtítulo, base limpa → PASS com VISION_ZONE_CONTRADICTION", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(B8.visionCta), b8GateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const diag = result.textDiagnostics.find((item) => item.matchDecision);
  assert.equal(diag.matchDecision, "VISION_ZONE_CONTRADICTION");
  assert.equal(diag.decision, "authorized");
  assert.equal(diag.expectedRole, "cta");
  assert.equal(diag.conflictingRendererRole, "subheadline");
  assert.equal(diag.baseTextScanStatus, "AVAILABLE");
  assert.equal(diag.baseContainsDetectedText, false);
  assert.match(diag.reason, /^detected_text_conflicts_with_verified_subheadline_zone_base_clean_single_cta_origin/);
});

test("zona texto: sem scan da base (ou NOT_AVAILABLE) a contradição não vale → UNAUTHORIZED_TEXT", async () => {
  for (const baseTextDiagnostic of [undefined, { status: "NOT_AVAILABLE", texts: [] }]) {
    const result = await evaluateCreativeQualityGate(ctaAt(B8.visionCta), b8GateInput({ baseTextDiagnostic }));
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), JSON.stringify(baseTextDiagnostic));
  }
});

test("zona texto: base que contém a frase → UNAUTHORIZED_TEXT", async () => {
  const base = { status: "AVAILABLE", texts: [{ text: B_CTA, normalizedText: "conheça o rumo ao altar", bbox: B8.visionCta }] };
  const result = await evaluateCreativeQualityGate(ctaAt(B8.visionCta), b8GateInput({ baseTextDiagnostic: base }));
  assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("zona texto: contradição não fabrica presença — CTA dado como ausente continua MISSING_REQUIRED_TEXT", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "CONHEÇA O RUMO AO ALTAR", region: B8.visionCta }], { missingRequiredTexts: [B_CTA] }), b8GateInput());
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_TEXT"), JSON.stringify(result.issues));
});

test("zona texto: duas leituras do CTA (zona real + subtítulo) → FAIL; texto exato em área vazia → FAIL", async () => {
  const twice = await evaluateCreativeQualityGate(visionReturning([
    { text: "CONHEÇA O RUMO AO ALTAR", region: { xPct: 65, yPct: 91.5, widthPct: 25, heightPct: 3.5 } },
    { text: "CONHEÇA O RUMO AO ALTAR", region: B8.visionCta },
  ]), b8GateInput());
  assert.ok(twice.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  const empty = await evaluateCreativeQualityGate(ctaAt({ xPct: 40, yPct: 30, widthPct: 25, heightPct: 5 }), b8GateInput());
  assert.ok(empty.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("zona texto: desconhecido, trecho parcial ou acento diferente dentro do subtítulo → FAIL", async () => {
  for (const text of ["DESCONTO 90%", "Rumo ao Altar", "CONHECA O RUMO AO ALTAR"]) {
    const result = await evaluateCreativeQualityGate(visionReturning([{ text, region: B8.visionCta }]), b8GateInput());
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), text);
  }
});

// ---------------------------------------------------------------------------------------------
// Resolução de localização da visão (cenário B real execution-mv2a2bp0-g974f2): CTA de 2,7% de altura,
// bbox da visão na grade de 5 pt (60/85/30/5) — 59,9% dentro da faixa de "uma altura". Com base
// escaneada e limpa, a faixa nunca é menor que a resolução do sensor; sem scan continua proporcional.
// ---------------------------------------------------------------------------------------------

const B9 = {
  headline: { xPct: 9.259, yPct: 81.333, widthPct: 51.852, heightPct: 6.08 },
  subheadline: { xPct: 9.259, yPct: 88.444, widthPct: 48.148, heightPct: 3.366 },
  cta: { xPct: 66.852, yPct: 89.185, widthPct: 23.889, heightPct: 2.667 },
  logo: { xPct: 77.13, yPct: 81.333, widthPct: 13.611, heightPct: 2.37 },
  visionCta: { xPct: 60, yPct: 85, widthPct: 30, heightPct: 5 },
};

function b9GateInput(overrides = {}) {
  const input = ledgerGateInput(overrides);
  input.plan = {
    ...input.plan,
    assetPlacements: [{ role: "logo", url: LOGO_URL, rect: B9.logo, frame: "none" }],
    textZones: [
      { kind: "headline", text: B_HEADLINE, rect: B9.headline, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: B_SUB, rect: B9.subheadline, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "cta", text: B_CTA, rect: B9.cta, emphasis: "secondary", renderedBy: "renderer" },
    ],
  };
  return input;
}

test("resolução: piso da faixa é a resolução da visão só quando pedido; zona alta continua proporcional", () => {
  assert.equal(VISION_BBOX_RESOLUTION_PCT, 5);
  assert.equal(measureRenderedTextProximity(B9.visionCta, B9.cta).near, false, "sem piso: 59,9% dentro da faixa");
  const floored = measureRenderedTextProximity(B9.visionCta, B9.cta, VISION_BBOX_RESOLUTION_PCT);
  assert.equal(floored.near, true);
  assert.equal(floored.band, 5);
  assert.equal(measureRenderedTextProximity({ xPct: 10, yPct: 20, widthPct: 80, heightPct: 10 }, { xPct: 6, yPct: 25, widthPct: 88, heightPct: 12 }, VISION_BBOX_RESOLUTION_PCT).band, 12);
});

test("resolução: B real — CTA pequeno com bbox na grade de 5 pt e base limpa → PASS (MATCHED_RENDERED_CTA)", async () => {
  const result = await evaluateCreativeQualityGate(ctaAt(B9.visionCta), b9GateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const diag = result.textDiagnostics.find((item) => item.matchDecision);
  assert.equal(diag.matchDecision, "MATCHED_RENDERED_CTA");
  assert.equal(diag.toleranceApplied, 5);
});

test("resolução: sem scan da base, base com a frase, segunda leitura ou bbox realmente longe → FAIL", async () => {
  for (const baseTextDiagnostic of [undefined, { status: "NOT_AVAILABLE", texts: [] }, { status: "AVAILABLE", texts: [{ text: B_CTA, normalizedText: "conheça o rumo ao altar", bbox: { xPct: 40, yPct: 10, widthPct: 20, heightPct: 4 } }] }]) {
    const result = await evaluateCreativeQualityGate(ctaAt(B9.visionCta), b9GateInput({ baseTextDiagnostic }));
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), JSON.stringify(baseTextDiagnostic));
  }
  const twice = await evaluateCreativeQualityGate(visionReturning([{ text: B_CTA, region: B9.visionCta }, { text: B_CTA, region: { xPct: 60, yPct: 40, widthPct: 30, heightPct: 5 } }]), b9GateInput());
  assert.ok(twice.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  const far = await evaluateCreativeQualityGate(ctaAt({ xPct: 60, yPct: 75, widthPct: 30, heightPct: 5 }), b9GateInput());
  assert.ok(far.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

test("resolução duplicidade: CTA pequeno legítimo (grade de 5 pt) + leitura falsa no headline → PASS", async () => {
  const falseInHeadline = { xPct: 10, yPct: 82, widthPct: 30, heightPct: 5 };
  const result = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [B9.visionCta, falseInHeadline])), b9GateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.deepEqual(result.occurrenceDiagnostics.map((item) => item.decision), ["allowed", "VISION_ZONE_CONTRADICTION"]);
  assert.match(result.occurrenceDiagnostics[0].reason, /^MATCHED_RENDERED_CTA pela faixa com piso/);
  assert.equal(result.occurrenceDiagnostics[1].conflictingRendererRole, "headline");
});

test("resolução duplicidade: sem scan da base, ou duas leituras perto do CTA, continua DUPLICATED_TEXT", async () => {
  const falseInHeadline = { xPct: 10, yPct: 82, widthPct: 30, heightPct: 5 };
  const noScan = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [B9.visionCta, falseInHeadline])), b9GateInput({ baseTextDiagnostic: { status: "NOT_AVAILABLE", texts: [] } }));
  assert.ok(noScan.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
  const twiceNear = await evaluateCreativeQualityGate(visionReturning([], duplicated(B_CTA, [B9.visionCta, { xPct: 62, yPct: 88, widthPct: 28, heightPct: 5 }])), b9GateInput());
  assert.ok(twiceNear.issues.some((issue) => issue.code === "DUPLICATED_TEXT"));
});

// ---------------------------------------------------------------------------------------------
// Logo verificada x resolução da visão (cenário A 9:16 real execution-mv2ifqf0-vtl4ov): a logo tem
// 2,4% de altura no canvas vertical e a visão leu "Rumo ao Altar" na grade de 5 pt (5/5/20/5), fora
// da regra estrita. Só o literal exato da marca, uma leitura, base escaneada e limpa, perto da logo.
// ---------------------------------------------------------------------------------------------

const A916_LOGO = { xPct: 6.667, yPct: 10.99, widthPct: 19.63, heightPct: 2.396 };
const A916_VISION = { xPct: 5, yPct: 5, widthPct: 20, heightPct: 5 };
function a916GateInput(overrides = {}) {
  const input = ledgerGateInput(overrides);
  input.plan = { ...input.plan, assetPlacements: [{ role: "logo", url: LOGO_URL, rect: A916_LOGO, frame: "none" }] };
  return input;
}

test("logo 9:16: literal da marca na grade de 5 pt perto da logo verificada, base limpa → PASS (MATCHED_VERIFIED_LOGO)", async () => {
  const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: A916_VISION }]), a916GateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  const diag = result.textDiagnostics.find((item) => item.matchDecision === "MATCHED_VERIFIED_LOGO");
  assert.ok(diag, JSON.stringify(result.textDiagnostics));
  assert.equal(diag.toleranceApplied, 5);
  assert.equal(diag.reason, "brand_literal_single_reading_base_clean_near_verified_logo_within_vision_resolution");
});

test("logo 9:16: sem scan, base com a marca, longe da logo, texto não-literal ou duas leituras → UNAUTHORIZED_TEXT", async () => {
  for (const baseTextDiagnostic of [undefined, { status: "NOT_AVAILABLE", texts: [] }, { status: "AVAILABLE", texts: [{ text: "Rumo ao Altar", normalizedText: "rumo ao altar", bbox: { xPct: 40, yPct: 50, widthPct: 20, heightPct: 4 } }] }]) {
    const result = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: A916_VISION }]), a916GateInput({ baseTextDiagnostic }));
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), JSON.stringify(baseTextDiagnostic));
  }
  const far = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: { xPct: 5, yPct: 40, widthPct: 20, heightPct: 5 } }]), a916GateInput());
  assert.ok(far.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
  for (const text of ["Promoção", "Rumo ao Altar Oficial", "Rumo"]) {
    const result = await evaluateCreativeQualityGate(visionReturning([{ text, region: A916_VISION }]), a916GateInput());
    assert.ok(result.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"), text);
  }
  const twice = await evaluateCreativeQualityGate(visionReturning([{ text: "Rumo ao Altar", region: A916_VISION }, { text: "Rumo ao Altar", region: { xPct: 60, yPct: 30, widthPct: 20, heightPct: 5 } }]), a916GateInput());
  assert.ok(twice.issues.some((issue) => issue.code === "UNAUTHORIZED_TEXT"));
});

// ---------------------------------------------------------------------------------------------
// Brand Profile x paleta (homologação real execution-mv2rf3ac-br7a57): a visão julgou a "cor
// predominante" da imagem inteira — dominada pelo screenshot REAL, que nunca pode ser recolorido —
// apesar de o renderer ter aplicado deterministicamente a paleta da marca nas superfícies e no CTA.
// ---------------------------------------------------------------------------------------------

test("paleta: veredito da visão vira diagnóstico quando o renderer comprovou a paleta da marca; sem prova, reprova", async () => {
  const vision = () => visionReturning([], { colorPaletteViolated: true, reasoning: "cores predominantes diferentes" });
  const input = cGateInput(undefined, { context: { ...cGateInput().context, brandColors: ["#2340FF", "#7C3AED"] } });
  const proven = await evaluateCreativeQualityGate(vision(), { ...input, brandPaletteRenderedDeterministically: true });
  assert.equal(proven.verdict, "pass", JSON.stringify(proven.issues));
  assert.deepEqual(proven.paletteDiagnostics.map((item) => item.decision), ["VISION_PALETTE_OVERRIDDEN_BY_RENDERER"]);
  const unproven = await evaluateCreativeQualityGate(vision(), input);
  assert.ok(unproven.issues.some((issue) => issue.code === "COLOR_PALETTE_VIOLATED"));
  const prompts = [];
  await evaluateCreativeQualityGate({ request: async (request) => { prompts.push(request.prompt); return { status: "completed", content: JSON.stringify({ unauthorizedTexts: [] }) }; } }, input);
  assert.match(prompts[0], /IGNORE as cores do conteúdo de assets reais/);
});
