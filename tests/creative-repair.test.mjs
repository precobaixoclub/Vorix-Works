import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativePlanRepairPrompt, MAX_CREATIVE_REPAIR_ROUNDS, routeCreativeRepair } from "../dist/application/creative-engine/creative-repair.js";

function issue(code, message = "motivo") {
  return { code, message };
}

test("routeCreativeRepair: só issues geométricas-de-renderer (TEXT_ILLEGIBLE_OR_CUT/ELEMENT_CUT_OFF) vira renderer_reflow", () => {
  const result = routeCreativeRepair([issue("TEXT_ILLEGIBLE_OR_CUT"), issue("ELEMENT_CUT_OFF")], 0);
  assert.equal(result.route, "renderer_reflow");
});

test("routeCreativeRepair: qualquer issue criativa/factual manda a rodada inteira pro GPT (gpt_replan), mesmo misturada com uma geométrica", () => {
  const result = routeCreativeRepair([issue("TEXT_ILLEGIBLE_OR_CUT"), issue("PRODUCT_MISMATCH")], 0);
  assert.equal(result.route, "gpt_replan");
});

for (const code of ["PRODUCT_MISMATCH", "WRONG_LOGO", "SCREENSHOT_MISCHARACTERIZED", "INVENTED_COMMERCIAL_FACT", "WRONG_PRICE", "CRITICAL_OVERLAP", "COMPOSITION_BROKEN", "WRONG_ASPECT_RATIO", "REQUIRED_ASSET_MISSING", "NON_PUBLISHABLE_SOURCE", "TEXT_ZONE_OVERLAPS_ASSET", "UNEXPECTED_DECORATIVE_TEXT"]) {
  test(`routeCreativeRepair: "${code}" sozinho sempre vai para gpt_replan — nunca ao motor/renderer legado`, () => {
    const result = routeCreativeRepair([issue(code)], 0);
    assert.equal(result.route, "gpt_replan");
  });
}

test("routeCreativeRepair: no limite de tentativas, vira unrecoverable independente do tipo de issue", () => {
  const result = routeCreativeRepair([issue("TEXT_ILLEGIBLE_OR_CUT")], MAX_CREATIVE_REPAIR_ROUNDS);
  assert.equal(result.route, "unrecoverable");
});

test("routeCreativeRepair: instructions carregam a mensagem literal de cada issue", () => {
  const result = routeCreativeRepair([issue("PRODUCT_MISMATCH", "o produto não bate"), issue("WRONG_PRICE", "preço errado")], 0);
  assert.deepEqual(result.instructions, ["o produto não bate", "preço errado"]);
});

test("buildCreativePlanRepairPrompt: inclui o plano anterior completo, as instruções de correção e os fatos confirmados", () => {
  const previousPlan = { headline: "Título antigo", cta: "CTA antigo" };
  const context = { brandName: "Preço Baixo Club", confirmedFacts: ["Preço atual: R$ 39,99"], assets: [] };
  const prompt = buildCreativePlanRepairPrompt(previousPlan, context, ["produto não corresponde à referência"]);

  assert.match(prompt, /"headline":"Título antigo"|"headline": ?"Título antigo"/);
  assert.match(prompt, /produto não corresponde à referência/);
  assert.match(prompt, /Preço atual: R\$ 39,99/);
  assert.match(prompt, /Preço Baixo Club/);
});

test("buildCreativePlanRepairPrompt: sem fatos confirmados, instrui explicitamente a não mencionar nenhum", () => {
  const prompt = buildCreativePlanRepairPrompt({ headline: "x" }, { brandName: "X", confirmedFacts: [], assets: [] }, ["x"]);
  assert.match(prompt, /Nenhum fato comercial confirmado disponível/);
});

// Achado ao vivo numa autorrevisão: o reparo (gpt_replan) reenvia o MESMO modelo diretor, mas
// antes desta correção só recebia brandName/confirmedFacts — o Prompt de Produção e os materiais
// de marca selecionados desapareciam silenciosamente exatamente na chamada que mais precisa
// continuar respeitando-os.
test("buildCreativePlanRepairPrompt: inclui productionInstructions/behaviorPreferences/brandMaterials — o reparo NUNCA esquece as diretrizes do workspace", () => {
  const context = {
    brandName: "Preço Baixo Club",
    confirmedFacts: [],
    assets: [],
    productionInstructions: "Priorize fundo preto/grafite, verde neon, amarelo e branco.",
    behaviorPreferences: ["NUNCA invente uma interface fictícia de site/app."],
    brandMaterials: [
      { id: "logo-1", name: "Logo Oficial", type: "logo_principal", priority: "required", aiInstructions: "Sempre no canto superior.", source: "asset_library", selectionReason: "Prioridade obrigatória." },
    ],
  };
  const prompt = buildCreativePlanRepairPrompt({ headline: "x" }, context, ["problema x"]);
  assert.match(prompt, /Priorize fundo preto\/grafite, verde neon, amarelo e branco\./);
  assert.match(prompt, /NUNCA invente uma interface fictícia de site\/app\./);
  assert.match(prompt, /Logo Oficial/);
});
