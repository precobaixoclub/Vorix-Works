import test from "node:test";
import assert from "node:assert/strict";
import { runGptParallelCreativePrototype } from "../dist/application/production/run-gpt-creative-prototype.js";

function creativePlanJson(overrides = {}) {
  return JSON.stringify({
    objective: "Comunicar clareza de proposta",
    angle: "Um site, todas as ofertas",
    targetAudience: "Caçadores de promoção",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    subheadline: "Shopee + Mercado Livre",
    cta: "ACESSE AGORA",
    visualDirection: "Fundo grafite, neon verde/amarelo",
    compositionIntent: "Mockup central de celular",
    assetUsage: {},
    requiredElements: ["logo", "headline", "cta"],
    forbiddenElements: ["Comente QUERO"],
    visualDensity: "clean",
    styleNotes: "tecnológico, imponente",
    rationale: "Diferenciar de grupo de WhatsApp",
    ...overrides,
  });
}

function fakeObjectStorage() {
  let count = 0;
  return {
    puts: [],
    put: async function (input) {
      count += 1;
      this.puts.push(input);
      return { url: `https://x/uploaded-${count}.jpg` };
    },
    delete: async () => undefined,
    resolvePublicUrl: (key) => `https://x/${key}`,
    health: async () => ({ ok: true }),
  };
}

function baseDeps(overrides = {}) {
  return {
    icaro: { request: async () => ({ status: "completed", content: "{}" }) },
    objectStorage: fakeObjectStorage(),
    compositeLogo: async ({ imageBuffer }) => Buffer.concat([imageBuffer, Buffer.from("logo")]),
    compositeScreenshot: async ({ imageBuffer }) => Buffer.concat([imageBuffer, Buffer.from("screenshot")]),
    computeAssetSuitability: async () => undefined,
    readImageDimensions: async () => ({ width: 1080, height: 1350 }),
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    tenantId: "tenant-1",
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    specialistId: "gpt-creative-prototype",
    ...overrides,
  };
}

test("runGptParallelCreativePrototype: fluxo completo sem assets — devolve creative_plan, imagem final e quality gate", async () => {
  let callCount = 0;
  const icaro = {
    request: async (request) => {
      callCount += 1;
      if (request.taskType === "analysis") return { status: "completed", content: creativePlanJson() };
      if (request.taskType === "image_generation") return { status: "completed", content: JSON.stringify({ images: [{ uri: "https://x/generated.png" }] }) };
      // Quality gate (taskType "review")
      return { status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: false, compositionBroken: false }) };
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer });

  try {
    const result = await runGptParallelCreativePrototype(baseDeps({ icaro }), baseInput());
    assert.equal(result.error, undefined);
    assert.ok(result.creativePlan);
    assert.equal(result.creativePlan.headline, "TODAS AS OFERTAS EM UM SÓ SITE");
    assert.equal(result.finalImageUrl, "https://x/uploaded-1.jpg");
    assert.equal(result.compositedAssetRoles.length, 0);
    assert.equal(result.qualityGate.verdict, "pass");
    assert.equal(callCount, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runGptParallelCreativePrototype: com logo e screenshot no contexto, compõe os dois determinísticamente e registra em compositedAssetRoles", async () => {
  const icaro = {
    request: async (request) => {
      if (request.taskType === "analysis") return { status: "completed", content: creativePlanJson() };
      if (request.taskType === "image_generation") return { status: "completed", content: JSON.stringify({ images: [{ uri: "https://x/generated.png" }] }) };
      return { status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: false, compositionBroken: false }) };
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer });

  try {
    const input = baseInput({
      assets: [
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial." },
        { url: "https://x/screenshot.png", role: "screenshot", description: "Home do site." },
      ],
    });
    const result = await runGptParallelCreativePrototype(baseDeps({ icaro }), input);
    assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "screenshot"]);
    assert.equal(result.qualityGate.verdict, "pass");
  } finally {
    global.fetch = originalFetch;
  }
});

test("runGptParallelCreativePrototype: creative_plan inválido (JSON malformado) devolve erro, nunca segue pra geração de imagem sem plano", async () => {
  const icaro = { request: async () => ({ status: "completed", content: "isto não é JSON" }) };
  const result = await runGptParallelCreativePrototype(baseDeps({ icaro }), baseInput());
  assert.match(result.error, /creative_plan/);
  assert.equal(result.finalImageUrl, undefined);
});

test("runGptParallelCreativePrototype: Ícaro falha ao gerar a imagem — devolve erro, mantém o creative_plan já obtido", async () => {
  const icaro = {
    request: async (request) => {
      if (request.taskType === "analysis") return { status: "completed", content: creativePlanJson() };
      return { status: "failed" };
    },
  };
  const result = await runGptParallelCreativePrototype(baseDeps({ icaro }), baseInput());
  assert.match(result.error, /Ícaro não devolveu/);
  assert.ok(result.creativePlan);
});

test("runGptParallelCreativePrototype: falha ao compor a logo vira warning, não interrompe a geração", async () => {
  const icaro = {
    request: async (request) => {
      if (request.taskType === "analysis") return { status: "completed", content: creativePlanJson() };
      if (request.taskType === "image_generation") return { status: "completed", content: JSON.stringify({ images: [{ uri: "https://x/generated.png" }] }) };
      return { status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: false, compositionBroken: false }) };
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer });

  try {
    const deps = baseDeps({ icaro, compositeLogo: async () => { throw new Error("logo quebrada"); } });
    const input = baseInput({ assets: [{ url: "https://x/logo.png", role: "logo", description: "" }] });
    const result = await runGptParallelCreativePrototype(deps, input);
    assert.equal(result.error, undefined);
    assert.ok(result.warnings.some((warning) => warning.includes("logo real")));
    // Sem composição bem-sucedida, o gate determinístico deve acusar REQUIRED_ASSET_MISSING.
    assert.ok(result.qualityGate.issues.some((issue) => issue.code === "REQUIRED_ASSET_MISSING"));
  } finally {
    global.fetch = originalFetch;
  }
});
