import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativePlanPrompt, buildImageGenerationPromptFromPlan, parseCreativePlan } from "../dist/shared/utils/gpt-creative-plan.types.js";

function sampleContext(overrides = {}) {
  return {
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas Shopee + Mercado Livre",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

function samplePlanJson(overrides = {}) {
  return JSON.stringify({
    objective: "Comunicar clareza de proposta",
    angle: "Um site, todas as ofertas",
    targetAudience: "Caçadores de promoção",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    subheadline: "Shopee + Mercado Livre",
    cta: "ACESSE AGORA",
    visualDirection: "Fundo grafite, neon verde/amarelo",
    compositionIntent: "Mockup central de celular",
    assetUsage: { "https://x/logo.png": "logo no canto superior" },
    requiredElements: ["logo", "headline", "cta"],
    forbiddenElements: ["Comente QUERO"],
    visualDensity: "clean",
    styleNotes: "tecnológico, imponente",
    rationale: "Diferenciar de grupo de WhatsApp",
    ...overrides,
  });
}

test("parseCreativePlan: parseia um JSON completo e bem formado", () => {
  const plan = parseCreativePlan(samplePlanJson());
  assert.ok(plan);
  assert.equal(plan.headline, "TODAS AS OFERTAS EM UM SÓ SITE");
  assert.equal(plan.cta, "ACESSE AGORA");
  assert.deepEqual(plan.requiredElements, ["logo", "headline", "cta"]);
  assert.deepEqual(plan.forbiddenElements, ["Comente QUERO"]);
  assert.equal(plan.assetUsage["https://x/logo.png"], "logo no canto superior");
  assert.equal(plan.visualDensity, "clean");
});

test("parseCreativePlan: devolve undefined sem headline/cta (campos mínimos obrigatórios)", () => {
  assert.equal(parseCreativePlan(JSON.stringify({ objective: "x" })), undefined);
});

test("parseCreativePlan: devolve undefined para JSON inválido, nunca lança", () => {
  assert.equal(parseCreativePlan("isto não é JSON"), undefined);
});

test("parseCreativePlan: densidade inválida cai pro neutro 'balanced', nunca inventa um valor da lista", () => {
  const plan = parseCreativePlan(samplePlanJson({ visualDensity: "extremamente denso" }));
  assert.equal(plan.visualDensity, "balanced");
});

test("parseCreativePlan: subheadline vazia vira undefined, nunca string vazia", () => {
  const plan = parseCreativePlan(samplePlanJson({ subheadline: "" }));
  assert.equal(plan.subheadline, undefined);
});

test("buildCreativePlanPrompt: inclui marca, objetivo, formato e ideia literalmente", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /Preço Baixo Club/);
  assert.match(prompt, /4:5/);
  assert.match(prompt, /Arte institucional divulgando o site\./);
});

test("buildCreativePlanPrompt: sem fatos comerciais, instrui explicitamente a não inventar preço/desconto", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ confirmedFacts: [] }));
  assert.match(prompt, /Não mencione preço, desconto/);
});

test("buildCreativePlanPrompt: com fatos comerciais, lista exatamente os fatos confirmados", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ confirmedFacts: ["Preço atual: R$ 149,90", "Desconto: 20%"] }));
  assert.match(prompt, /Preço atual: R\$ 149,90/);
  assert.match(prompt, /Desconto: 20%/);
});

test("buildCreativePlanPrompt: descreve o papel de cada asset (produto real vs. screenshot vs. logo)", () => {
  const prompt = buildCreativePlanPrompt(
    sampleContext({
      assets: [
        { url: "https://x/produto.png", role: "product_photo", description: "Tênis RV azul." },
        { url: "https://x/screenshot.png", role: "screenshot", description: "Home do site." },
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial." },
      ],
    }),
  );
  assert.match(prompt, /PRODUTO REAL/);
  assert.match(prompt, /SCREENSHOT REAL DO SITE\/APP/);
  assert.match(prompt, /LOGO OFICIAL DA MARCA/);
});

test("buildCreativePlanPrompt: elementos proibidos aparecem no prompt", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ forbiddenElements: ["Comente QUERO"] }));
  assert.match(prompt, /Comente QUERO/);
});

test("buildImageGenerationPromptFromPlan: instrui deixar espaço pra logo/screenshot em vez de desenhá-los, quando presentes no contexto", () => {
  const context = sampleContext({
    assets: [
      { url: "https://x/logo.png", role: "logo", description: "" },
      { url: "https://x/screenshot.png", role: "screenshot", description: "" },
    ],
  });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /NÃO desenhe uma logo/);
  assert.match(imagePrompt, /NÃO desenhe a interface do site/);
});

test("buildImageGenerationPromptFromPlan: sem logo/screenshot no contexto, não menciona deixar espaço pra eles", () => {
  const context = sampleContext({ assets: [] });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /NÃO desenhe uma logo/);
  assert.doesNotMatch(imagePrompt, /NÃO desenhe a interface do site/);
});

test("buildImageGenerationPromptFromPlan: inclui headline/cta literalmente entre aspas", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
  assert.match(imagePrompt, /"ACESSE AGORA"/);
});
