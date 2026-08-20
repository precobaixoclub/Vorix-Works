import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeContext } from "../dist/application/creative-engine/build-creative-context.js";

function baseInput(overrides = {}) {
  return {
    workspaceId: "workspace-1",
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    ...overrides,
  };
}

test("buildCreativeContext: sem dependências injetadas, devolve contexto mínimo com brandName do input", async () => {
  const context = await buildCreativeContext({}, baseInput());
  assert.equal(context.brandName, "Preço Baixo Club");
  assert.deepEqual(context.confirmedFacts, []);
  assert.equal(context.audience, undefined);
  assert.equal(context.recentHistory, undefined);
});

test("buildCreativeContext: extrai fatos comerciais do texto livre do usuário (achado da auditoria — o protótipo original nunca fazia isso)", async () => {
  const context = await buildCreativeContext({}, baseInput({ ideaText: "Tênis RV de R$79,99 por apenas R$39,99, 50% de desconto." }));
  assert.ok(context.confirmedFacts.some((fact) => fact.includes("R$ 39,99")));
  assert.ok(context.confirmedFacts.some((fact) => fact.includes("R$ 79,99")));
  assert.ok(context.confirmedFacts.some((fact) => fact.includes("50%")));
});

test("buildCreativeContext: mescla fatos de Reference Intelligence (imagem) com fatos do texto — imagem vence por padrão em conflito", async () => {
  const deps = {
    referenceIntelligenceExtractor: {
      extract: async () => ({
        commercialFacts: { currentPrice: "R$ 39,99", previousPrice: undefined, discountPercent: undefined, promotion: undefined, shippingInfo: undefined, commercialConditions: [] },
      }),
    },
  };
  const input = baseInput({
    ideaText: "Agora está R$ 34,90 (atualizado).",
    assets: [{ url: "https://x/produto.png", role: "product_photo", description: "" }],
  });
  const context = await buildCreativeContext(deps, input);
  // Texto tem linguagem de atualização explícita ("agora está" + "atualizado") — deveria vencer.
  assert.ok(context.confirmedFacts.some((fact) => fact.includes("R$ 34,90")));
});

test("buildCreativeContext: resolveBrandProfile popula posicionamento/negócio/público/produtos/identidade visual", async () => {
  const deps = {
    resolveBrandProfile: async () => ({
      brandName: "Nome Oficial da Marca",
      positioning: "Referência em economia doméstica",
      businessDescription: "Marketplace de ofertas agregadas",
      targetAudience: "Caçadores de promoção 25-45 anos",
      productsOrServices: ["Eletrônicos", "Moda"],
      brandColors: ["#000000", "#39FF6A"],
      visualIdentityNotes: "Tipografia condensada, alto contraste",
    }),
  };
  const context = await buildCreativeContext(deps, baseInput());
  assert.equal(context.brandName, "Nome Oficial da Marca");
  assert.equal(context.brandPositioning, "Referência em economia doméstica");
  assert.equal(context.businessDescription, "Marketplace de ofertas agregadas");
  assert.equal(context.audience, "Caçadores de promoção 25-45 anos");
  assert.deepEqual(context.productsOrServices, ["Eletrônicos", "Moda"]);
  assert.deepEqual(context.brandColors, ["#000000", "#39FF6A"]);
  assert.equal(context.visualIdentityNotes, "Tipografia condensada, alto contraste");
});

test("buildCreativeContext: brandColors explícito do input tem prioridade sobre o do perfil de marca", async () => {
  const deps = { resolveBrandProfile: async () => ({ brandColors: ["#PERFIL"] }) };
  const context = await buildCreativeContext(deps, baseInput({ brandColors: ["#INPUT"] }));
  assert.deepEqual(context.brandColors, ["#INPUT"]);
});

test("buildCreativeContext: resolveRecentHistory popula recentHistory; lista vazia vira undefined", async () => {
  const withHistory = await buildCreativeContext(
    { resolveRecentHistory: async () => [{ headline: "Oferta X", cta: "Confira", visualConcept: "Neon" }] },
    baseInput(),
  );
  assert.equal(withHistory.recentHistory.length, 1);
  assert.equal(withHistory.recentHistory[0].headline, "Oferta X");

  const withoutHistory = await buildCreativeContext({ resolveRecentHistory: async () => [] }, baseInput());
  assert.equal(withoutHistory.recentHistory, undefined);
});

test("buildCreativeContext: falhas em resolveBrandProfile/resolveRecentHistory nunca derrubam a montagem do contexto", async () => {
  const deps = {
    resolveBrandProfile: async () => { throw new Error("Clara indisponível"); },
    resolveRecentHistory: async () => { throw new Error("histórico indisponível"); },
  };
  const context = await buildCreativeContext(deps, baseInput());
  assert.equal(context.brandName, "Preço Baixo Club");
});

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT"

test("buildCreativeContext: workspace sem prompt persistente configurado -> productionInstructions/behaviorPreferences ausentes (nunca inventados)", async () => {
  const context = await buildCreativeContext({ resolveProductionSettings: async () => undefined }, baseInput());
  assert.equal(context.productionInstructions, undefined);
  assert.equal(context.productionInstructionsVersion, undefined);
  assert.equal(context.behaviorPreferences, undefined);
});

test("buildCreativeContext: workspace com prompt persistente configurado -> productionInstructions/version/behaviorPreferences populados verbatim", async () => {
  const settings = {
    workspaceId: "workspace-1",
    productionPrompt: "Crie peças modernas e de alto impacto, priorize fundo preto/grafite.",
    version: 3,
    preferRealAssets: true,
    allowFictionalInterfaces: false,
    allowGeneratedPeople: true,
    textDensity: "minimal",
    creativeFreedom: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const context = await buildCreativeContext({ resolveProductionSettings: async () => settings }, baseInput());
  assert.equal(context.productionInstructions, settings.productionPrompt);
  assert.equal(context.productionInstructionsVersion, 3);
  assert.ok(context.behaviorPreferences.length > 0);
});

test("buildCreativeContext: allowFictionalInterfaces=false adiciona proibição explícita de interface fictícia em forbiddenElements", async () => {
  const settings = { workspaceId: "w1", version: 1, preferRealAssets: true, allowFictionalInterfaces: false, allowGeneratedPeople: true, textDensity: "balanced", creativeFreedom: "medium", createdAt: "x", updatedAt: "x" };
  const context = await buildCreativeContext({ resolveProductionSettings: async () => settings }, baseInput());
  assert.ok(context.forbiddenElements.some((item) => /interface.*fictícia/.test(item)));
});

test("buildCreativeContext: allowFictionalInterfaces=true NÃO adiciona a proibição de interface fictícia", async () => {
  const settings = { workspaceId: "w1", version: 1, preferRealAssets: true, allowFictionalInterfaces: true, allowGeneratedPeople: true, textDensity: "balanced", creativeFreedom: "medium", createdAt: "x", updatedAt: "x" };
  const context = await buildCreativeContext({ resolveProductionSettings: async () => settings }, baseInput());
  assert.equal(context.forbiddenElements, undefined);
});

test("buildCreativeContext: logo obrigatória da Asset Library é selecionada e entra em brandMaterials E na lista plana assets[] com role 'logo'", async () => {
  const deps = {
    resolveBrandMaterials: async () => [
      { id: "logo-1", name: "Logo Oficial", materialType: "logo_principal", usagePriority: "required", aiInstructions: "Nunca redesenhar.", url: "https://cdn.example.com/logo.png" },
    ],
  };
  const context = await buildCreativeContext(deps, baseInput());
  assert.equal(context.brandMaterials.length, 1);
  assert.equal(context.brandMaterials[0].priority, "required");
  assert.match(context.brandMaterials[0].selectionReason, /obrigatório/);
  assert.ok(context.assets.some((asset) => asset.url === "https://cdn.example.com/logo.png" && asset.role === "logo"));
});

test("buildCreativeContext: screenshot preferencial só entra quando o pedido atual menciona o site (seleção explicável, registrada em selectionReason)", async () => {
  const deps = {
    resolveBrandMaterials: async () => [
      { id: "shot-1", name: "Screenshot do site", materialType: "screenshot_site", url: "https://cdn.example.com/shot.png" },
    ],
  };
  const irrelevant = await buildCreativeContext(deps, baseInput({ objective: "Vender mais", ideaText: "Divulgar um produto qualquer" }));
  assert.equal(irrelevant.brandMaterials, undefined);

  const relevant = await buildCreativeContext(deps, baseInput({ objective: "Vender mais", ideaText: "Crie uma publicação divulgando nosso site" }));
  assert.equal(relevant.brandMaterials.length, 1);
  assert.ok(relevant.brandMaterials[0].selectionReason.length > 0);
});

test("buildCreativeContext: asset irrelevante ao pedido atual não é selecionado (biblioteca inteira nunca despejada sem critério)", async () => {
  const deps = {
    resolveBrandMaterials: async () => [
      { id: "old-photo", name: "Foto institucional antiga", materialType: "foto_institucional", url: "https://cdn.example.com/old.png" },
    ],
  };
  const context = await buildCreativeContext(deps, baseInput({ ideaText: "Divulgar uma promoção de sapatos" }));
  assert.equal(context.brandMaterials, undefined);
  assert.equal(context.assets.length, 0);
});

test("buildCreativeContext: produto real cadastrado é priorizado quando o pedido atual menciona o nome do produto", async () => {
  const deps = {
    resolveBrandMaterials: async () => [
      { id: "product-1", name: "Tênis RV", materialType: "produto", url: "https://cdn.example.com/tenis-rv.png" },
    ],
  };
  const context = await buildCreativeContext(deps, baseInput({ ideaText: "Promoção do Tênis RV com 50% off" }));
  assert.equal(context.brandMaterials.length, 1);
  assert.ok(context.assets.some((asset) => asset.role === "product_photo" && asset.url === "https://cdn.example.com/tenis-rv.png"));
});
