import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreativeEngineGuardedPrompt,
  buildCreativeEngineImageGuard,
  CREATIVE_ENGINE_MAX_PROMPT_LENGTH,
} from "../dist/shared/utils/creative-engine-image-guard.js";

test("buildCreativeEngineImageGuard: nunca contém a cláusula de supressão de texto do motor legado", () => {
  const guard = buildCreativeEngineImageGuard({
    preservedAssetRoles: ["logo", "screenshot"],
    confirmedFacts: ["Preço atual: R$ 39,99"],
    forbiddenElements: ["Comente QUERO"],
  });

  assert.doesNotMatch(guard, /NÃO PODE conter nenhum texto/i);
  assert.doesNotMatch(guard, /\bIGNORE\b/);
  assert.doesNotMatch(guard, /CTA/i);
  assert.doesNotMatch(guard, /headline/i);
  assert.doesNotMatch(guard, /layout/i);
  assert.doesNotMatch(guard, /direção de arte/i);
});

test("buildCreativeEngineImageGuard: assets preservados geram regra de não redesenhar", () => {
  const guard = buildCreativeEngineImageGuard({
    preservedAssetRoles: ["screenshot", "logo"],
    confirmedFacts: [],
  });
  assert.match(guard, /screenshot real do site\/app/);
  assert.match(guard, /logo oficial da marca/);
  assert.match(guard, /Nunca desenhe, redesenhe ou substitua/);
});

test("buildCreativeEngineImageGuard: sem assets, nenhuma regra de preservação aparece", () => {
  const guard = buildCreativeEngineImageGuard({ preservedAssetRoles: [], confirmedFacts: [] });
  assert.doesNotMatch(guard, /ASSETS REAIS/);
});

test("buildCreativeEngineImageGuard: fatos confirmados viram a ÚNICA lista permitida de valores comerciais", () => {
  const guard = buildCreativeEngineImageGuard({
    preservedAssetRoles: [],
    confirmedFacts: ["Preço atual: R$ 39,99", "Desconto: 50%"],
  });
  assert.match(guard, /Preço atual: R\$ 39,99/);
  assert.match(guard, /Desconto: 50%/);
  assert.match(guard, /Nunca invente, arredonde ou adicione qualquer outro número/);
});

test("buildCreativeEngineImageGuard: sem fatos confirmados, proíbe qualquer número comercial", () => {
  const guard = buildCreativeEngineImageGuard({ preservedAssetRoles: [], confirmedFacts: [] });
  assert.match(guard, /nenhum fato comercial foi confirmado/i);
  assert.match(guard, /Não desenhe nenhum preço, desconto, percentual, prazo ou condição comercial/);
});

test("buildCreativeEngineImageGuard: sempre proíbe marca/logo inventada e substituição de referência obrigatória", () => {
  const guard = buildCreativeEngineImageGuard({ preservedAssetRoles: [], confirmedFacts: [] });
  assert.match(guard, /nunca invente, desenhe ou sugira uma logo, wordmark ou marca de terceiros/i);
  assert.match(guard, /nunca substitua um asset de referência obrigatório/i);
});

test("buildCreativeEngineImageGuard: elementos proibidos explícitos aparecem só quando fornecidos", () => {
  const withForbidden = buildCreativeEngineImageGuard({
    preservedAssetRoles: [],
    confirmedFacts: [],
    forbiddenElements: ["Comente QUERO", "marketplace fictício"],
  });
  assert.match(withForbidden, /Comente QUERO/);
  assert.match(withForbidden, /marketplace fictício/);

  const withoutForbidden = buildCreativeEngineImageGuard({ preservedAssetRoles: [], confirmedFacts: [] });
  assert.doesNotMatch(withoutForbidden, /PROIBIDO/);
});

test("buildCreativeEngineImageGuard: cropAwareHint (técnico, formato/proporção) é repassado quando presente", () => {
  const guard = buildCreativeEngineImageGuard({
    preservedAssetRoles: [],
    confirmedFacts: [],
    cropAwareHint: "A imagem final será cortada para 4:5.",
  });
  assert.match(guard, /ENQUADRAMENTO/);
  assert.match(guard, /cortada para 4:5/);
});

test("buildCreativeEngineGuardedPrompt: headline e CTA do creative_plan sobrevivem verbatim no corpo do prompt", () => {
  const planPrompt = [
    'Crie uma peça publicitária 4:5 para "Preço Baixo Club".',
    "Direção visual: fundo escuro com destaque neon.",
    'Headline (desenhar exatamente este texto, com destaque tipográfico forte): "Ofertas que somem rápido"',
    'CTA (desenhar exatamente este texto): "Confira agora"',
  ].join("\n");

  const guarded = buildCreativeEngineGuardedPrompt(planPrompt, {
    preservedAssetRoles: ["screenshot"],
    confirmedFacts: [],
  });

  assert.match(guarded, /Ofertas que somem rápido/);
  assert.match(guarded, /Confira agora/);
  assert.doesNotMatch(guarded, /IGNORE/);
  assert.doesNotMatch(guarded, /NÃO PODE conter nenhum texto/i);
});

test("buildCreativeEngineGuardedPrompt: repete a guarda no início e no fim (mesma técnica do motor legado)", () => {
  const guarded = buildCreativeEngineGuardedPrompt("corpo do prompt", {
    preservedAssetRoles: [],
    confirmedFacts: ["Preço atual: R$ 39,99"],
  });
  const guard = buildCreativeEngineImageGuard({ preservedAssetRoles: [], confirmedFacts: ["Preço atual: R$ 39,99"] });
  const occurrences = guarded.split(guard).length - 1;
  assert.equal(occurrences, 2, "a guarda deve aparecer exatamente 2 vezes (início e fim)");
});

test("buildCreativeEngineGuardedPrompt: corta o corpo (nunca a guarda) quando o prompt total excede o limite", () => {
  const hugePrompt = "x".repeat(CREATIVE_ENGINE_MAX_PROMPT_LENGTH * 2);
  const guarded = buildCreativeEngineGuardedPrompt(hugePrompt, { preservedAssetRoles: [], confirmedFacts: [] });
  assert.ok(guarded.length <= CREATIVE_ENGINE_MAX_PROMPT_LENGTH + 200, "o corte deve respeitar o orçamento de caracteres");
  assert.match(guarded, /\[\.\.\.\]/);
});
