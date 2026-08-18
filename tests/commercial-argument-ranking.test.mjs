import test from "node:test";
import assert from "node:assert/strict";
import { rankCommercialArguments } from "../dist/shared/utils/commercial-argument-ranking.js";

test("rankCommercialArguments: só inclui argumentos realmente presentes, na ordem fixa de força", () => {
  const result = rankCommercialArguments({ cta: "Compre agora", price: "R$39,99", rating: "4.8" });
  assert.deepEqual(result, ["price", "rating", "cta"]);
});

test("rankCommercialArguments: nunca inventa um argumento ausente", () => {
  const result = rankCommercialArguments({});
  assert.deepEqual(result, []);
});

test("rankCommercialArguments: string vazia/só espaço não conta como presente", () => {
  const result = rankCommercialArguments({ price: "  ", discount: "50%" });
  assert.deepEqual(result, ["discount"]);
});

test("rankCommercialArguments: ordem completa respeita a hierarquia declarada", () => {
  const result = rankCommercialArguments({
    cta: "Compre",
    differentiator: "Único no mercado",
    specification: "500W",
    paymentTerms: "12x sem juros",
    shipping: "Frete grátis",
    salesCount: "10 mil vendidos",
    rating: "4.9",
    socialProof: "Aprovado por especialistas",
    mainBenefit: "Economiza tempo",
    promotion: "Black Friday",
    discount: "30%",
    price: "R$99",
  });
  assert.deepEqual(result, [
    "price", "discount", "promotion", "mainBenefit", "socialProof", "rating",
    "salesCount", "shipping", "paymentTerms", "specification", "differentiator", "cta",
  ]);
});
