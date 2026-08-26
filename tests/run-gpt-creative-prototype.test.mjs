import test from "node:test";
import assert from "node:assert/strict";
import { runGptParallelCreativePrototype } from "../dist/application/production/run-gpt-creative-prototype.js";

function creativePlanJson(overrides = {}) {
  const merged = {
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
  };
  // allowedRenderedTexts sempre eco literal de headline/subheadline/cta — recomputado DEPOIS dos
  // overrides pra nunca dessincronizar quando um teste sobrescreve headline/cta diretamente.
  if (!Object.prototype.hasOwnProperty.call(overrides, "allowedRenderedTexts")) {
    merged.allowedRenderedTexts = [merged.headline, merged.subheadline, merged.cta].filter(Boolean);
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "artDirection")) {
    merged.artDirection = sampleArtDirection();
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "layoutPlan")) {
    merged.layoutPlan = sampleLayoutPlan();
  }
  return JSON.stringify(merged);
}

// Achado ao vivo — auditoria "qualidade visual e direção de arte": `artDirection` é validada
// contra uma lista de frases vagas banidas, então o fixture de teste precisa ser CONCRETA de
// verdade (mesmo padrão exigido do Director real), nunca "visual moderno".
function sampleArtDirection(overrides = {}) {
  return {
    concept: "Fundo grafite quase preto com feixe de luz verde neon diagonal, produto centralizado",
    visualFocus: "Mockup do celular exibindo o site, ocupando o terço central da peça",
    elementHierarchy: ["mockup do site", "headline", "cta", "logo"],
    primaryMassPct: 45,
    contrastStrategy: "Texto branco sólido sobre faixa preta semi-opaca, nunca direto sobre o fundo grafite",
    chromaticDirection: "Grafite quase preto dominante, verde neon como único acento, amarelo só no CTA",
    atmosphere: "Tecnológico e direto, sem elementos decorativos soltos",
    backgroundTreatment: "Gradiente sutil de grafite para preto, sem textura ou ruído",
    productTextRelationship: "Texto sempre acima ou abaixo do mockup, nunca sobreposto a ele",
    avoidedCliches: ["cards flutuantes", "elementos 3D aleatórios"],
    justifiedCliches: [],
    ...overrides,
  };
}

function sampleLayoutPlan(overrides = []) {
  if (Array.isArray(overrides) && overrides.length > 0) return overrides;
  return [
    { kind: "headline", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, priority: 1, rationale: "Mensagem principal no topo, primeira coisa lida" },
    { kind: "hero", rect: { xPct: 15, yPct: 30, widthPct: 70, heightPct: 40 }, priority: 2, rationale: "Mockup do site como foco visual central" },
    { kind: "cta", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, priority: 3, rationale: "Ação no terço inferior, fácil de alcançar visualmente" },
    { kind: "negativeSpace", rect: { xPct: 10, yPct: 72, widthPct: 80, heightPct: 6 }, priority: 4, rationale: "Respiro entre o mockup e o CTA" },
  ];
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

test("runGptParallelCreativePrototype: com logo e screenshot no contexto E geometria no creative_plan, compõe os dois determinísticamente e registra em compositedAssetRoles", async () => {
  const icaro = {
    request: async (request) => {
      if (request.taskType === "analysis") {
        return {
          status: "completed",
          content: creativePlanJson({
            assetPlacements: [
              { role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 18, heightPct: 10 } },
              { role: "screenshot", url: "https://x/screenshot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 }, frame: "phone" },
            ],
          }),
        };
      }
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
    assert.equal(result.error, undefined);
    assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "screenshot"]);
    assert.equal(result.qualityGate.verdict, "pass");
  } finally {
    global.fetch = originalFetch;
  }
});

test("runGptParallelCreativePrototype: screenshot no contexto SEM geometria no creative_plan é HARD FAILURE (migração GPT/PR 4) — nunca improvisa uma posição", async () => {
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
    const input = baseInput({ assets: [{ url: "https://x/screenshot.png", role: "screenshot", description: "Home do site." }] });
    const result = await runGptParallelCreativePrototype(baseDeps({ icaro }), input);
    assert.match(result.error, /CREATIVE_PLAN_MISSING_ASSET_PLACEMENT/);
    assert.equal(result.finalImageUrl, undefined);
    assert.equal(result.compositedAssetRoles.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runGptParallelCreativePrototype: falha ao compor o screenshot (mesmo com geometria válida) é HARD FAILURE — nunca publica com possível interface fictícia visível", async () => {
  const icaro = {
    request: async (request) => {
      if (request.taskType === "analysis") {
        return {
          status: "completed",
          content: creativePlanJson({
            assetPlacements: [{ role: "screenshot", url: "https://x/screenshot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 } }],
          }),
        };
      }
      if (request.taskType === "image_generation") return { status: "completed", content: JSON.stringify({ images: [{ uri: "https://x/generated.png" }] }) };
      return { status: "completed", content: JSON.stringify({ productMismatch: false, textIllegibleOrCut: false, compositionBroken: false }) };
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer });

  try {
    const deps = baseDeps({ icaro, compositeScreenshot: async () => { throw new Error("screenshot mutilado — SCREENSHOT_COMPOSITE_SOURCE_ASPECT_MISMATCH"); } });
    const input = baseInput({ assets: [{ url: "https://x/screenshot.png", role: "screenshot", description: "" }] });
    const result = await runGptParallelCreativePrototype(deps, input);
    assert.match(result.error, /Falha ao compor o screenshot real/);
    assert.match(result.error, /interface fictícia/);
    assert.equal(result.finalImageUrl, undefined);
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

test("runGptParallelCreativePrototype: falha ao compor a logo é HARD FAILURE (migração GPT/PR 4) — nunca um warning que deixa a peça seguir sem a marca", async () => {
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
    assert.match(result.error, /Falha ao compor a logo real/);
    assert.equal(result.finalImageUrl, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
