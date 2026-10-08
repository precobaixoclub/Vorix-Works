import test from "node:test";
import assert from "node:assert/strict";
import {
  findEditorialRequiredTextsMissingFromZones,
  findEditorialRequiredTextsWithoutContent,
  resolveEditorialConfirmedPrice,
  resolveEditorialRequiredTexts,
} from "../dist/application/creative-engine/editorial-text-contract.js";

function plan(overrides = {}) {
  return {
    headline: "Kit Noivos Sem Correria",
    subheadline: "Organize presentes, lista de presentes e RSVP em um só lugar.",
    cta: "Comprar agora",
    requiredElements: ["headline", "subheadline", "cta", "logo", "price"],
    requiredRenderedFacts: [],
    ...overrides,
  };
}

const context = { confirmedFacts: ["Preço atual: R$ 149,00 BRL"] };

function zone(kind, text) {
  return { kind, text };
}

test("resolveEditorialRequiredTexts: plano do Smoke A exige headline, subheadline, preço confirmado e CTA", () => {
  assert.deepEqual(resolveEditorialRequiredTexts(plan(), context), [
    { kind: "headline", text: "Kit Noivos Sem Correria" },
    { kind: "subheadline", text: "Organize presentes, lista de presentes e RSVP em um só lugar." },
    { kind: "price", text: "R$ 149,00" },
    { kind: "cta", text: "Comprar agora" },
  ]);
});

test("resolveEditorialRequiredTexts: subheadline escrita pelo diretor é obrigatória mesmo fora de requiredElements", () => {
  const required = resolveEditorialRequiredTexts(plan({ requiredElements: ["headline", "cta"] }), context);
  assert.ok(required.some((item) => item.kind === "subheadline"));
});

test("resolveEditorialRequiredTexts: sem subheadline e sem exigência, subheadline é opcional (ausente é válido)", () => {
  const required = resolveEditorialRequiredTexts(plan({ subheadline: undefined, requiredElements: ["headline", "cta"] }), context);
  assert.ok(!required.some((item) => item.kind === "subheadline"));
  assert.deepEqual(findEditorialRequiredTextsWithoutContent(required), []);
});

test("findEditorialRequiredTextsWithoutContent: subheadline exigida sem texto é lacuna antes do renderer", () => {
  const gaps = findEditorialRequiredTextsWithoutContent(resolveEditorialRequiredTexts(plan({ subheadline: "  " }), context));
  assert.deepEqual(gaps, [{ kind: "subheadline", text: undefined }]);
});

test("findEditorialRequiredTextsWithoutContent: preço exigido sem fato confirmado é lacuna", () => {
  const gaps = findEditorialRequiredTextsWithoutContent(resolveEditorialRequiredTexts(plan(), { confirmedFacts: [] }));
  assert.deepEqual(gaps, [{ kind: "price", text: undefined }]);
});

test("resolveEditorialRequiredTexts: preço exigido via requiredRenderedFacts também conta; preço nunca vem do texto do plano", () => {
  const required = resolveEditorialRequiredTexts(plan({ requiredElements: ["headline"], requiredRenderedFacts: ["R$ 999,00"] }), context);
  assert.deepEqual(required.find((item) => item.kind === "price"), { kind: "price", text: "R$ 149,00" });
  assert.equal(resolveEditorialConfirmedPrice(context), "R$ 149,00");
});

test("findEditorialRequiredTextsMissingFromZones: reproduz o Smoke A — zonas sem subheadline são rejeitadas", () => {
  const required = resolveEditorialRequiredTexts(plan(), context);
  const smokeZones = [zone("headline", "Kit Noivos Sem Correria"), zone("price", "R$ 149,00"), zone("cta", "Comprar agora")];
  assert.deepEqual(findEditorialRequiredTextsMissingFromZones(required, smokeZones).map((item) => item.kind), ["subheadline"]);
});

test("findEditorialRequiredTextsMissingFromZones: todas as zonas presentes passa (CTA comparado sem caixa)", () => {
  const required = resolveEditorialRequiredTexts(plan(), context);
  const zones = [
    zone("headline", "Kit Noivos Sem Correria"),
    zone("subheadline", "Organize presentes, lista de presentes e RSVP em um só lugar."),
    zone("price", "R$ 149,00"),
    zone("cta", "COMPRAR AGORA"),
  ];
  assert.deepEqual(findEditorialRequiredTextsMissingFromZones(required, zones), []);
});

test("resolveEditorialRequiredTexts: plano legado sem requiredRenderedFacts/requiredElements não quebra", () => {
  const required = resolveEditorialRequiredTexts({ headline: "Oferta", cta: "Ver" }, context);
  assert.deepEqual(required.map((item) => item.kind), ["headline", "cta"]);
});
