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
