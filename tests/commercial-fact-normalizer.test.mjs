import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCommercialFactsFromText,
  commercialFactsFromReferenceIntelligence,
  normalizeCommercialFacts,
  findCommercialFact,
  mergeCommercialFacts,
  parseCommercialFacts,
} from "../dist/shared/utils/commercial-fact-normalizer.js";

function referenceCommercialFacts(overrides = {}) {
  return {
    currentPrice: undefined,
    previousPrice: undefined,
    discountPercent: undefined,
    promotion: undefined,
    commercialConditions: [],
    shippingInfo: undefined,
    ...overrides,
  };
}

function referenceIntelligence(commercialFacts) {
  return {
    imagesAnalyzed: 1,
    primaryImageIndex: 0,
    multiImageRelationship: "same_product",
    verifiedFacts: {},
    visualFacts: { colors: [], visualCharacteristics: [], relevantText: [], ctaPresent: false, elementsToPreserve: [] },
    commercialFacts,
    uncertainFacts: [],
    claimSourceMap: {},
  };
}

// ---------------------------------------------------------------------------------------------
// extractCommercialFactsFromText
// ---------------------------------------------------------------------------------------------

test("extractCommercialFactsFromText: padrão 'de R$X por R$Y' extrai previous_price e current_price com alta confiança", () => {
  const facts = extractCommercialFactsFromText("Tênis de corrida, de R$ 79,90 por R$ 39,99 só hoje.");

  const previous = facts.find((f) => f.type === "previous_price");
  const current = facts.find((f) => f.type === "current_price");
  assert.equal(previous.value, "R$ 79,90");
  assert.equal(previous.confidence, "high");
  assert.equal(previous.source, "user_text");
  assert.equal(previous.verified, true);
  assert.equal(current.value, "R$ 39,99");
  assert.equal(current.confidence, "high");
});

test("extractCommercialFactsFromText: um único preço mencionado vira current_price", () => {
  const facts = extractCommercialFactsFromText("Fone bluetooth por R$ 129,90.");

  assert.equal(facts.length >= 1, true);
  const current = facts.find((f) => f.type === "current_price");
  assert.equal(current.value, "R$ 129,90");
  assert.equal(current.confidence, "high");
  assert.equal(facts.some((f) => f.type === "previous_price"), false);
});

test("extractCommercialFactsFromText: dois preços sem padrão 'de...por' explícito assume o menor como current_price", () => {
  const facts = extractCommercialFactsFromText("Camiseta R$ 99,90 ou R$ 59,90 no pix.");

  const current = facts.find((f) => f.type === "current_price");
  const previous = facts.find((f) => f.type === "previous_price");
  assert.equal(current.value, "R$ 59,90");
  assert.equal(current.confidence, "medium");
  assert.equal(previous.value, "R$ 99,90");
});

test("extractCommercialFactsFromText: preço com milhar (R$ 1.239,99) é reconhecido", () => {
  const facts = extractCommercialFactsFromText("Notebook por R$ 1.239,99.");

  const current = facts.find((f) => f.type === "current_price");
  assert.equal(current.value, "R$ 1.239,99");
});

test("extractCommercialFactsFromText: nenhum preço mencionado não extrai nenhum fato de preço", () => {
  const facts = extractCommercialFactsFromText("Consultoria de carreira para profissionais de tecnologia.");

  assert.equal(facts.some((f) => f.type === "current_price" || f.type === "previous_price"), false);
});

test("extractCommercialFactsFromText: três ou mais preços é ambíguo demais, não extrai nenhum (nunca inventa qual é o certo)", () => {
  const facts = extractCommercialFactsFromText("Kit com R$ 10,00, R$ 20,00 e R$ 30,00 de itens.");

  assert.equal(facts.some((f) => f.type === "current_price" || f.type === "previous_price"), false);
});

test("extractCommercialFactsFromText: '37% de desconto' vira discount_percent", () => {
  const facts = extractCommercialFactsFromText("Tênis com 37% de desconto por tempo limitado.");

  const discount = facts.find((f) => f.type === "discount_percent");
  assert.equal(discount.value, "37%");
  assert.equal(discount.confidence, "high");
});

test("extractCommercialFactsFromText: '50% OFF' e '-50%' também são reconhecidos", () => {
  assert.equal(extractCommercialFactsFromText("Liquidação 50% OFF hoje.").find((f) => f.type === "discount_percent").value, "50%");
  assert.equal(extractCommercialFactsFromText("Só -50% nesta semana.").find((f) => f.type === "discount_percent").value, "50%");
});

test("extractCommercialFactsFromText: 'agora está R$X' marca explicitOverride no preço extraído (Bloco 0.4)", () => {
  const facts = extractCommercialFactsFromText("O tênis agora está R$ 34,90.");

  const price = facts.find((f) => f.type === "current_price");
  assert.equal(price.value, "R$ 34,90");
  assert.equal(price.explicitOverride, true);
});

test("extractCommercialFactsFromText: 'atualizado'/'preço correto'/'correção:' também marcam explicitOverride", () => {
  assert.equal(extractCommercialFactsFromText("Valor atualizado: R$ 89,90.").find((f) => f.type === "current_price").explicitOverride, true);
  assert.equal(extractCommercialFactsFromText("Preço correto é R$ 89,90.").find((f) => f.type === "current_price").explicitOverride, true);
  assert.equal(extractCommercialFactsFromText("Correção: R$ 89,90.").find((f) => f.type === "current_price").explicitOverride, true);
});

test("extractCommercialFactsFromText: preço mencionado SEM linguagem de atualização nunca marca explicitOverride", () => {
  const facts = extractCommercialFactsFromText("Tênis por R$ 89,90, aproveite.");

  const price = facts.find((f) => f.type === "current_price");
  assert.equal(price.explicitOverride, undefined);
});

test("extractCommercialFactsFromText: explicitOverride nunca se aplica a shipping/promotion (só preço/desconto)", () => {
  const facts = extractCommercialFactsFromText("Frete grátis, agora está com estoque limitado.");

  const shipping = facts.find((f) => f.type === "shipping");
  assert.equal(shipping.explicitOverride, undefined);
});

test("extractCommercialFactsFromText: 'frete grátis' vira fato de shipping", () => {
  const facts = extractCommercialFactsFromText("Compre agora com frete grátis para todo o Brasil.");

  const shipping = facts.find((f) => f.type === "shipping");
  assert.equal(shipping.value, "Frete grátis");
});

test("extractCommercialFactsFromText: 'só hoje'/'estoque limitado' viram fato de promotion (urgência)", () => {
  assert.ok(extractCommercialFactsFromText("Só hoje com esse preço.").find((f) => f.type === "promotion"));
  assert.ok(extractCommercialFactsFromText("Estoque limitado, aproveite.").find((f) => f.type === "promotion"));
});

test("extractCommercialFactsFromText: texto vazio ou ausente nunca lança, devolve lista vazia", () => {
  assert.deepEqual(extractCommercialFactsFromText(""), []);
  assert.deepEqual(extractCommercialFactsFromText(undefined), []);
});

// ---------------------------------------------------------------------------------------------
// commercialFactsFromReferenceIntelligence
// ---------------------------------------------------------------------------------------------

test("commercialFactsFromReferenceIntelligence: mapeia todos os campos presentes com source reference_image e alta confiança", () => {
  const facts = commercialFactsFromReferenceIntelligence(referenceCommercialFacts({
    currentPrice: "R$ 39,99",
    previousPrice: "R$ 79,99",
    discountPercent: "50%",
    promotion: "Oferta Relâmpago",
    shippingInfo: "Frete grátis",
    commercialConditions: ["12x sem juros"],
  }));

  assert.equal(facts.length, 6);
  for (const fact of facts) {
    assert.equal(fact.source, "reference_image");
    assert.equal(fact.confidence, "high");
    assert.equal(fact.verified, true);
  }
  assert.equal(findFactByType(facts, "payment_terms").value, "12x sem juros");
});

test("commercialFactsFromReferenceIntelligence: undefined/campos ausentes nunca lança, devolve só o que existe", () => {
  assert.deepEqual(commercialFactsFromReferenceIntelligence(undefined), []);
  assert.deepEqual(commercialFactsFromReferenceIntelligence(referenceCommercialFacts()), []);
});

function findFactByType(facts, type) {
  return facts.find((f) => f.type === type);
}

// ---------------------------------------------------------------------------------------------
// normalizeCommercialFacts
// ---------------------------------------------------------------------------------------------

test("normalizeCommercialFacts: sem imagem de referência, usa só o que o texto livre confirma", () => {
  const normalized = normalizeCommercialFacts({ ideaText: "Fone SoundMax de R$ 189,90 por R$ 129,90, frete grátis." });

  assert.equal(findCommercialFact(normalized, "current_price").value, "R$ 129,90");
  assert.equal(findCommercialFact(normalized, "previous_price").value, "R$ 189,90");
  assert.equal(findCommercialFact(normalized, "shipping").value, "Frete grátis");
});

test("normalizeCommercialFacts: quando imagem E texto trazem o mesmo tipo de fato, reference_image sempre vence", () => {
  const normalized = normalizeCommercialFacts({
    referenceIntelligence: referenceIntelligence(referenceCommercialFacts({ currentPrice: "R$ 39,99" })),
    ideaText: "Compre por R$ 45,00 hoje.",
  });

  const current = findCommercialFact(normalized, "current_price");
  assert.equal(current.value, "R$ 39,99");
  assert.equal(current.source, "reference_image");
});

test("normalizeCommercialFacts: fatos de tipos diferentes de fontes diferentes coexistem (imagem dá preço, texto dá frete)", () => {
  const normalized = normalizeCommercialFacts({
    referenceIntelligence: referenceIntelligence(referenceCommercialFacts({ currentPrice: "R$ 39,99" })),
    ideaText: "Aproveite com frete grátis.",
  });

  assert.equal(findCommercialFact(normalized, "current_price").source, "reference_image");
  assert.equal(findCommercialFact(normalized, "shipping").source, "user_text");
});

test("normalizeCommercialFacts: nem imagem nem texto com fato comercial devolve lista vazia (nunca inventa)", () => {
  const normalized = normalizeCommercialFacts({ ideaText: "Consultoria de carreira, sem oferta." });

  assert.deepEqual(normalized.facts, []);
});

test("normalizeCommercialFacts: entradas totalmente ausentes nunca lança", () => {
  assert.deepEqual(normalizeCommercialFacts({}), { facts: [], resolutions: [] });
});

// ---------------------------------------------------------------------------------------------
// mergeCommercialFacts / parseCommercialFacts (usados nos limites do pipeline: João -> Bianca)
// ---------------------------------------------------------------------------------------------

test("mergeCommercialFacts: sem override explícito, imagem vence por padrão para o mesmo tipo; tipos exclusivos de cada lado coexistem", () => {
  const imageFacts = [{ type: "current_price", value: "R$ 39,99", source: "reference_image", confidence: "high", verified: true }];
  const textFacts = [
    { type: "current_price", value: "R$ 45,00", source: "user_text", confidence: "medium", verified: true },
    { type: "shipping", value: "Frete grátis", source: "user_text", confidence: "high", verified: true },
  ];

  const { facts, resolutions } = mergeCommercialFacts(imageFacts, textFacts);

  assert.equal(facts.length, 2);
  assert.equal(facts.find((f) => f.type === "current_price").source, "reference_image");
  assert.equal(facts.find((f) => f.type === "shipping").source, "user_text");
  // Bloco 0.4: todo conflito real vira uma resolução registrada, mesmo quando a imagem vence por padrão.
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].type, "current_price");
  assert.equal(resolutions[0].selectedFact.source, "reference_image");
  assert.equal(resolutions[0].supersededFacts[0].source, "user_text");
  assert.match(resolutions[0].resolutionReason, /padrão/);
});

test("mergeCommercialFacts: texto com override explícito vence a imagem (Bloco 0.4 — caso do pedido: 'agora está R$34,90')", () => {
  const imageFacts = [{ type: "current_price", value: "R$ 39,99", source: "reference_image", confidence: "high", verified: true }];
  const textFacts = [{ type: "current_price", value: "R$ 34,90", source: "user_text", confidence: "high", verified: true, explicitOverride: true }];

  const { facts, resolutions } = mergeCommercialFacts(imageFacts, textFacts);

  assert.equal(facts.length, 1);
  assert.equal(facts[0].value, "R$ 34,90");
  assert.equal(facts[0].source, "user_text");
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].selectedFact.value, "R$ 34,90");
  assert.equal(resolutions[0].supersededFacts[0].value, "R$ 39,99");
  assert.match(resolutions[0].resolutionReason, /explícita/);
});

test("mergeCommercialFacts: sem conflito real (só um lado traz o tipo), nenhuma resolução é registrada", () => {
  const imageFacts = [{ type: "current_price", value: "R$ 39,99", source: "reference_image", confidence: "high", verified: true }];

  const { facts, resolutions } = mergeCommercialFacts(imageFacts, []);

  assert.equal(facts.length, 1);
  assert.deepEqual(resolutions, []);
});

test("parseCommercialFacts: reidrata um array JSON válido de volta em CommercialFact[]", () => {
  const json = JSON.stringify([{ type: "current_price", value: "R$ 39,99", source: "user_text", confidence: "high", verified: true }]);

  const facts = parseCommercialFacts(json);

  assert.equal(facts.length, 1);
  assert.equal(facts[0].value, "R$ 39,99");
});

test("parseCommercialFacts: JSON inválido, não-array, ou entrada ausente nunca lança, devolve lista vazia", () => {
  assert.deepEqual(parseCommercialFacts(undefined), []);
  assert.deepEqual(parseCommercialFacts(""), []);
  assert.deepEqual(parseCommercialFacts("não é json"), []);
  assert.deepEqual(parseCommercialFacts(JSON.stringify({ not: "an array" })), []);
});

test("parseCommercialFacts: filtra itens malformados dentro do array, mantém só os válidos", () => {
  const json = JSON.stringify([
    { type: "current_price", value: "R$ 39,99", source: "user_text", confidence: "high", verified: true },
    { type: "not_a_real_type", value: "x", source: "user_text", confidence: "high", verified: true },
    { value: "faltando type e source" },
  ]);

  const facts = parseCommercialFacts(json);

  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, "current_price");
});
