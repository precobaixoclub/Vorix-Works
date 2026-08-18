import test from "node:test";
import assert from "node:assert/strict";
import { selectLayoutFamily, resolveCompatibleDensity, LAYOUT_FAMILY_RULES } from "../dist/shared/utils/layout-family-rules.js";
import { LAYOUT_FAMILIES } from "../dist/shared/utils/ad-layout.types.js";

function baseInput(overrides = {}) {
  return {
    objective: "promocao_oferta",
    infoQuantity: 3,
    hasStrongPrice: false,
    hasDiscount: false,
    hasSocialProof: false,
    hasUrgency: false,
    hasManyBenefits: false,
    format: "4:5",
    hasReferenceImage: true,
    ...overrides,
  };
}

test("selectLayoutFamily: sempre devolve uma família válida (nunca undefined/vazio)", () => {
  const family = selectLayoutFamily(baseInput());
  assert.ok(LAYOUT_FAMILIES.includes(family));
});

test("selectLayoutFamily: preço + desconto + urgência escolhe flash_sale (caso do tênis RV)", () => {
  const family = selectLayoutFamily(baseInput({ hasStrongPrice: true, hasDiscount: true, hasUrgency: true }));
  assert.equal(family, "flash_sale");
});

test("selectLayoutFamily: só preço forte (sem desconto/urgência) escolhe price_dominant", () => {
  const family = selectLayoutFamily(baseInput({ hasStrongPrice: true, hasDiscount: false, hasUrgency: false, objective: "venda_conversao" }));
  assert.equal(family, "price_dominant");
});

test("selectLayoutFamily: prova social forte escolhe social_proof", () => {
  const family = selectLayoutFamily(baseInput({ hasSocialProof: true, hasStrongPrice: false, objective: "prova_social" }));
  assert.equal(family, "social_proof");
});

test("selectLayoutFamily: poucos argumentos e objetivo não-comercial escolhe premium_product (densidade clean)", () => {
  const family = selectLayoutFamily(baseInput({ infoQuantity: 1, objective: "reconhecimento_marca", hasStrongPrice: false }));
  assert.equal(family, "premium_product");
});

test("selectLayoutFamily: muitos benefícios sem preço forte escolhe benefit_grid", () => {
  const family = selectLayoutFamily(baseInput({ hasManyBenefits: true, hasStrongPrice: false }));
  assert.equal(family, "benefit_grid");
});

test("selectLayoutFamily: é determinístico — mesma entrada sempre devolve a mesma família", () => {
  const input = baseInput({ hasStrongPrice: true, hasDiscount: true });
  const first = selectLayoutFamily(input);
  const second = selectLayoutFamily(input);
  assert.equal(first, second);
});

test("resolveCompatibleDensity: densidade preferida quando compatível com a família", () => {
  assert.equal(resolveCompatibleDensity("flash_sale", "max_performance"), "max_performance");
});

test("resolveCompatibleDensity: cai pra densidade compatível quando a preferida não é suportada pela família", () => {
  // premium_product só suporta "clean" — pedir max_performance deve cair pra uma densidade que a família aceita.
  const resolved = resolveCompatibleDensity("premium_product", "max_performance");
  assert.ok(LAYOUT_FAMILY_RULES.premium_product.densityCompatibility.includes(resolved));
});

test("LAYOUT_FAMILY_RULES: toda família tem pelo menos uma zona obrigatória e uma densidade compatível", () => {
  for (const family of LAYOUT_FAMILIES) {
    const rule = LAYOUT_FAMILY_RULES[family];
    assert.ok(rule.requiredZoneTypes.length > 0, `${family} sem requiredZoneTypes`);
    assert.ok(rule.densityCompatibility.length > 0, `${family} sem densityCompatibility`);
    for (const required of rule.requiredZoneTypes) {
      assert.ok(rule.allowedZoneTypes.includes(required), `${family}: zona obrigatória "${required}" não está em allowedZoneTypes`);
    }
  }
});
