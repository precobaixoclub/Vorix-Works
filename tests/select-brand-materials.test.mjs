import test from "node:test";
import assert from "node:assert/strict";
import { materialTypeToAssetRole, selectRelevantBrandMaterials } from "../dist/application/creative-engine/select-brand-materials.js";

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — a seleção é
// determinística e explicável: cada resultado carrega `reason`, e "não enviar todos
// indiscriminadamente" é a regra central destes testes (materiais irrelevantes ao pedido atual
// nunca aparecem no resultado, mesmo existindo na biblioteca).

function material(overrides = {}) {
  return { id: "asset-1", name: "Material", url: "https://cdn.example.com/asset.png", ...overrides };
}

test("selectRelevantBrandMaterials: material sem URL real nunca é selecionado (nada pra enviar ao motor GPT)", () => {
  const result = selectRelevantBrandMaterials([material({ url: undefined, usagePriority: "required" })], { ideaText: "qualquer coisa", objective: "qualquer coisa" });
  assert.deepEqual(result, []);
});

test("selectRelevantBrandMaterials: prioridade 'required' é sempre incluída, independente do pedido atual", () => {
  const logo = material({ id: "logo-1", name: "Logo Oficial", materialType: "logo_principal", usagePriority: "required" });
  const result = selectRelevantBrandMaterials([logo], { ideaText: "Divulgar uma promoção de sapatos", objective: "Vender mais" });
  assert.equal(result.length, 1);
  assert.equal(result[0].material.id, "logo-1");
  assert.match(result[0].reason, /obrigatório/);
});

test("selectRelevantBrandMaterials: prioridade 'on_request' só entra quando o pedido atual menciona o nome do material", () => {
  const specialBadge = material({ id: "badge-1", name: "Selo Black Friday", usagePriority: "on_request" });
  const withoutMention = selectRelevantBrandMaterials([specialBadge], { ideaText: "Divulgar o site", objective: "Engajamento" });
  assert.deepEqual(withoutMention, []);

  const withMention = selectRelevantBrandMaterials([specialBadge], { ideaText: "Usar o Selo Black Friday nesta peça", objective: "Promoção" });
  assert.equal(withMention.length, 1);
  assert.equal(withMention[0].material.id, "badge-1");
});

test("selectRelevantBrandMaterials: screenshot do site só é selecionado quando o pedido atual menciona o site", () => {
  const screenshot = material({ id: "shot-1", name: "Screenshot do site", materialType: "screenshot_site" });
  const irrelevant = selectRelevantBrandMaterials([screenshot], { ideaText: "Divulgar um produto novo", objective: "Vender mais" });
  assert.deepEqual(irrelevant, [], "asset irrelevante ao pedido atual nunca deve ser selecionado");

  const relevant = selectRelevantBrandMaterials([screenshot], { ideaText: "Crie uma publicação divulgando nosso site", objective: "Mostrar o site" });
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0].material.id, "shot-1");
});

test("selectRelevantBrandMaterials: screenshot do app só é selecionado quando o pedido atual menciona o app", () => {
  const screenshot = material({ id: "shot-app-1", name: "Screenshot do app", materialType: "screenshot_app" });
  assert.deepEqual(selectRelevantBrandMaterials([screenshot], { ideaText: "Divulgar o site", objective: "" }), []);
  const selected = selectRelevantBrandMaterials([screenshot], { ideaText: "Baixe nosso aplicativo agora", objective: "" });
  assert.equal(selected.length, 1);
});

test("selectRelevantBrandMaterials: produto real é priorizado quando o pedido atual menciona o nome do produto", () => {
  const product = material({ id: "product-1", name: "Tênis RV", materialType: "produto" });
  const irrelevant = selectRelevantBrandMaterials([product], { ideaText: "Divulgar o site institucional", objective: "" });
  assert.deepEqual(irrelevant, []);
  const relevant = selectRelevantBrandMaterials([product], { ideaText: "Promoção do Tênis RV com 50% off", objective: "" });
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0].material.id, "product-1");
});

test("selectRelevantBrandMaterials: logo é sempre selecionada automaticamente, mesmo sem menção explícita no pedido", () => {
  const logo = material({ id: "logo-2", name: "Logo Secundária", materialType: "logo_secundaria" });
  const result = selectRelevantBrandMaterials([logo], { ideaText: "Divulgar uma promoção qualquer", objective: "Vender" });
  assert.equal(result.length, 1);
  assert.equal(result[0].material.id, "logo-2");
});

test("selectRelevantBrandMaterials: prioridade 'preferred' entra por padrão mesmo sem regra de relevância específica", () => {
  const reference = material({ id: "ref-1", name: "Referência de estilo", materialType: "referencia_visual", usagePriority: "preferred" });
  const result = selectRelevantBrandMaterials([reference], { ideaText: "Divulgar qualquer coisa", objective: "" });
  assert.equal(result.length, 1);
  assert.match(result[0].reason, /preferencial/);
});

test("selectRelevantBrandMaterials: prioridade ausente (tratada como 'automatic') sem correspondência de relevância fica de fora — nunca enviado indiscriminadamente", () => {
  const unrelated = material({ id: "unrelated-1", name: "Foto institucional antiga", materialType: "foto_institucional" });
  const result = selectRelevantBrandMaterials([unrelated], { ideaText: "Divulgar uma promoção de sapatos", objective: "Vender mais" });
  assert.deepEqual(result, []);
});

test("selectRelevantBrandMaterials: vários materiais, só os relevantes ao pedido atual são selecionados (mistura de casos)", () => {
  const materials = [
    material({ id: "logo-req", name: "Logo", materialType: "logo_principal", usagePriority: "required" }),
    material({ id: "shot-site", name: "Screenshot do site", materialType: "screenshot_site" }),
    material({ id: "shot-app", name: "Screenshot do app", materialType: "screenshot_app" }),
    material({ id: "produto-x", name: "Produto X", materialType: "produto" }),
    material({ id: "on-request", name: "Selo Especial", usagePriority: "on_request" }),
  ];
  const result = selectRelevantBrandMaterials(materials, { ideaText: "Crie uma publicação divulgando nosso site", objective: "" });
  const ids = result.map((r) => r.material.id).sort();
  assert.deepEqual(ids, ["logo-req", "shot-site"]);
});

test("materialTypeToAssetRole: mapeia tipos com papel de composição claro, e undefined para os demais", () => {
  assert.equal(materialTypeToAssetRole("logo_principal"), "logo");
  assert.equal(materialTypeToAssetRole("logo_secundaria"), "logo");
  assert.equal(materialTypeToAssetRole("screenshot_site"), "screenshot");
  assert.equal(materialTypeToAssetRole("screenshot_app"), "screenshot");
  assert.equal(materialTypeToAssetRole("produto"), "product_photo");
  assert.equal(materialTypeToAssetRole("referencia_visual"), "reference_style");
  assert.equal(materialTypeToAssetRole("selo"), undefined);
  assert.equal(materialTypeToAssetRole("icone"), undefined);
  assert.equal(materialTypeToAssetRole(undefined), undefined);
});
