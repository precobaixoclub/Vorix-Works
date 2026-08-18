import test from "node:test";
import assert from "node:assert/strict";
import { parseReferenceIntelligence, hasStrongCommercialFact } from "../dist/shared/utils/reference-intelligence.types.js";
import { OpenAiReferenceIntelligenceExtractor } from "../dist/infrastructure/ai-providers/openai-reference-intelligence-extractor.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test("parseReferenceIntelligence: undefined/vazio vira undefined (comportamento idêntico a antes desta funcionalidade existir)", () => {
  assert.equal(parseReferenceIntelligence(undefined), undefined);
  assert.equal(parseReferenceIntelligence(null), undefined);
  assert.equal(parseReferenceIntelligence(""), undefined);
  assert.equal(parseReferenceIntelligence("   "), undefined);
});

test("parseReferenceIntelligence: JSON malformado nunca lança, vira undefined", () => {
  assert.equal(parseReferenceIntelligence("{isso nao e json"), undefined);
  assert.equal(parseReferenceIntelligence("não é json de jeito nenhum"), undefined);
});

test("parseReferenceIntelligence: extrai fatos comerciais completos (caso do tênis RV)", () => {
  const raw = JSON.stringify({
    imagesAnalyzed: 2,
    primaryImageIndex: 0,
    multiImageRelationship: "same_product",
    relationshipReasoning: "Ambas mostram o mesmo tênis casual unissex skatista, em ângulos diferentes.",
    verifiedFacts: { productType: "tênis", productName: "Tênis Casual Unissex Skatista", category: "calçados", brand: "RV" },
    visualFacts: {
      colors: ["preto", "branco"],
      visualCharacteristics: ["design skatista", "cadarços brancos"],
      relevantText: ["R$ 39,99", "R$ 79,99", "-50%", "Oferta Relâmpago", "7x R$6,41", "Frete grátis com cupom"],
      ctaPresent: true,
      imageContext: "Página de produto de e-commerce",
      elementsToPreserve: ["cor preta e branca", "logo RV no cadarço"],
    },
    commercialFacts: {
      currentPrice: "R$ 39,99",
      previousPrice: "R$ 79,99",
      discountPercent: "50%",
      promotion: "Oferta Relâmpago",
      commercialConditions: ["até 7x de R$6,41", "frete grátis com cupom"],
      shippingInfo: "grátis com cupom",
    },
    uncertainFacts: ["se o cupom de frete grátis ainda está ativo"],
    claimSourceMap: { "R$ 39,99": "imagem 1", "50%": "imagem 1" },
  });

  const result = parseReferenceIntelligence(raw);
  assert.ok(result);
  assert.equal(result.multiImageRelationship, "same_product");
  assert.equal(result.commercialFacts.currentPrice, "R$ 39,99");
  assert.equal(result.commercialFacts.discountPercent, "50%");
  assert.equal(result.commercialFacts.commercialConditions.length, 2);
  assert.equal(result.claimSourceMap["R$ 39,99"], "imagem 1");
  assert.ok(hasStrongCommercialFact(result.commercialFacts), "preço + desconto + promoção deveriam contar como fato comercial forte");
});

test("parseReferenceIntelligence: campos ausentes/tipo errado nunca quebram, só ficam vazios", () => {
  const result = parseReferenceIntelligence(JSON.stringify({ multiImageRelationship: "algo-invalido", commercialFacts: { currentPrice: 123 } }));
  assert.ok(result);
  assert.equal(result.multiImageRelationship, "unknown");
  assert.equal(result.commercialFacts.currentPrice, undefined);
  assert.deepEqual(result.commercialFacts.commercialConditions, []);
});

test("hasStrongCommercialFact: sem preço/desconto/promoção não é fato comercial forte", () => {
  assert.equal(hasStrongCommercialFact(undefined), false);
  assert.equal(hasStrongCommercialFact({ commercialConditions: [] }), false);
  assert.equal(hasStrongCommercialFact({ commercialConditions: ["frete grátis"] }), false);
});

test("OpenAiReferenceIntelligenceExtractor: sem chave configurada devolve undefined sem chamar HTTP", async () => {
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => undefined }, async () => {
    throw new Error("não deveria chamar HTTP sem chave");
  });
  assert.equal(await extractor.extract(["https://x/img.png"]), undefined);
});

test("OpenAiReferenceIntelligenceExtractor: lista vazia de imagens devolve undefined sem chamar HTTP", async () => {
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => "sk-test" }, async () => {
    throw new Error("não deveria chamar HTTP sem imagens");
  });
  assert.equal(await extractor.extract([]), undefined);
});

test("OpenAiReferenceIntelligenceExtractor: envia uma única chamada com todas as imagens em blocos image_url + json_object", async () => {
  let capturedBody;
  const httpClient = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({ imagesAnalyzed: 2, primaryImageIndex: 0, multiImageRelationship: "same_product", commercialFacts: { currentPrice: "R$ 39,99" } }) } }],
    });
  };
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => "sk-test" }, httpClient);

  const result = await extractor.extract(["https://x/img1.png", "https://x/img2.png"]);

  assert.equal(capturedBody.response_format.type, "json_object");
  const imageBlocks = capturedBody.messages[0].content.filter((block) => block.type === "image_url");
  assert.equal(imageBlocks.length, 2);
  assert.equal(imageBlocks[0].image_url.url, "https://x/img1.png");
  assert.equal(imageBlocks[1].image_url.url, "https://x/img2.png");
  assert.equal(result.multiImageRelationship, "same_product");
  assert.equal(result.commercialFacts.currentPrice, "R$ 39,99");
});

test("OpenAiReferenceIntelligenceExtractor: HTTP não-ok devolve undefined, nunca lança", async () => {
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => "sk-test" }, async () => jsonResponse(500, { error: "boom" }));
  assert.equal(await extractor.extract(["https://x/img.png"]), undefined);
});

test("OpenAiReferenceIntelligenceExtractor: resposta sem conteúdo devolve undefined, nunca lança", async () => {
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => "sk-test" }, async () => jsonResponse(200, { choices: [] }));
  assert.equal(await extractor.extract(["https://x/img.png"]), undefined);
});

test("OpenAiReferenceIntelligenceExtractor: exceção de rede devolve undefined, nunca lança", async () => {
  const extractor = new OpenAiReferenceIntelligenceExtractor({ getApiKey: async () => "sk-test" }, async () => {
    throw new Error("ECONNRESET");
  });
  await assert.doesNotReject(() => extractor.extract(["https://x/img.png"]));
  assert.equal(await extractor.extract(["https://x/img.png"]), undefined);
});
