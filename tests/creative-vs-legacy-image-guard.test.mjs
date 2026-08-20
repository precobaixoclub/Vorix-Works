import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiIcaroImageProvider } from "../dist/infrastructure/ai-providers/openai-icaro-image-provider.js";
import { OpenAiCreativeImageProvider } from "../dist/infrastructure/ai-providers/openai-creative-image-provider.js";

/**
 * Prova direta de que a escolha de guarda (legado vs motor GPT) é sempre EXPLÍCITA por qual
 * provider é instanciado, nunca inferida em runtime a partir do conteúdo da requisição — mesmo
 * prompt, mesmo `AiMediaProviderAdapterPort` fake, dois providers diferentes, dois resultados
 * deliberadamente diferentes.
 */

function fakeMediaProvider() {
  const calls = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return { ok: true, mediaUrl: "https://example.com/out.png" };
    },
  };
}

const PLAN_DERIVED_PROMPT = [
  'Crie uma peça publicitária 4:5 para "Preço Baixo Club".',
  "Direção visual: fundo escuro, tipografia neon, produto centralizado.",
  'Headline (desenhar exatamente este texto, com destaque tipográfico forte): "Ofertas que somem rápido"',
  'CTA (desenhar exatamente este texto): "Confira agora"',
].join("\n");

test("provider.profile.id difere entre os dois motores — a escolha nunca é ambígua", () => {
  const legacy = new OpenAiIcaroImageProvider(fakeMediaProvider());
  const creative = new OpenAiCreativeImageProvider(fakeMediaProvider());
  assert.equal(legacy.profile.id, "openai-icaro-image");
  assert.equal(creative.profile.id, "openai-creative-image");
  assert.notEqual(legacy.profile.id, creative.profile.id);
});

test("motor LEGADO (sem authorizedVisibleTitle): comportamento inalterado — ainda suprime headline/CTA do prompt do creative_plan-like", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute({
    taskType: "image_generation",
    prompt: PLAN_DERIVED_PROMPT,
    model: "gpt-image-1",
    context: {},
  });

  const sentPrompt = media.calls[0].prompt;
  // Comportamento herdado, preservado bit a bit: sem authorizedVisibleTitle, a guarda legada
  // continua instruindo "NENHUM texto" e mandando IGNORAR qualquer pedido de CTA/headline —
  // exatamente como antes da extração (ver tests/openai-icaro-image-provider.test.mjs).
  assert.match(sentPrompt, /NÃO PODE conter nenhum texto/i);
  assert.match(sentPrompt, /IGNORE essa instrução/);
});

test("motor GPT (mesmo prompt, mesmo tipo de dado): preserva headline/CTA verbatim, nunca suprime", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);

  await provider.execute({
    taskType: "image_generation",
    prompt: PLAN_DERIVED_PROMPT,
    model: "gpt-image-1",
    context: {
      creativeGuard: { preservedAssetRoles: [], confirmedFacts: [] },
    },
  });

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /Ofertas que somem rápido/);
  assert.match(sentPrompt, /Confira agora/);
  assert.doesNotMatch(sentPrompt, /NÃO PODE conter nenhum texto/i);
  assert.doesNotMatch(sentPrompt, /IGNORE/);
});

test("negativo: o motor GPT nunca aplica a guarda legada mesmo se o caller tentar passar campos do contrato antigo", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);

  await assert.rejects(
    () =>
      provider.execute({
        taskType: "image_generation",
        prompt: PLAN_DERIVED_PROMPT,
        model: "gpt-image-1",
        context: {
          creativeGuard: { preservedAssetRoles: [], confirmedFacts: [] },
          authorizedVisibleTitle: "Ofertas que somem rápido",
        },
      }),
    /CREATIVE_ENGINE_LEGACY_GUARD_CONTEXT_FORBIDDEN/,
  );
  assert.equal(media.calls.length, 0, "nunca chega a chamar o mediaProvider com a guarda errada");
});

test("negativo: o motor legado nunca lê context.creativeGuard (não teria efeito nenhum, prova que os dois contratos são independentes)", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute({
    taskType: "image_generation",
    prompt: PLAN_DERIVED_PROMPT,
    model: "gpt-image-1",
    context: {
      creativeGuard: { preservedAssetRoles: ["logo"], confirmedFacts: ["Preço atual: R$ 39,99"] },
    },
  });

  const sentPrompt = media.calls[0].prompt;
  // Mesmo com creativeGuard presente, o motor legado ignora-o por completo e ainda aplica a
  // supressão de texto padrão — prova de que não há inferência cruzada entre os dois contratos.
  assert.match(sentPrompt, /NÃO PODE conter nenhum texto/i);
});
