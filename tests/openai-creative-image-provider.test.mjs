import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiCreativeImageProvider } from "../dist/infrastructure/ai-providers/openai-creative-image-provider.js";

function fakeMediaProvider(generateImpl) {
  const calls = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return generateImpl ? generateImpl(request) : { ok: true, mediaUrl: "https://example.com/out.png" };
    },
  };
}

function baseRequest(context = {}) {
  return {
    taskType: "image_generation",
    prompt: 'Headline (desenhar exatamente este texto): "Ofertas imperdíveis"\nCTA (desenhar exatamente este texto): "Confira agora"',
    model: "gpt-image-1",
    context: {
      creativeGuard: { preservedAssetRoles: [], confirmedFacts: [] },
      ...context,
    },
  };
}

test("OpenAiCreativeImageProvider: modelo padrão é gpt-image-1, profile.id é openai-creative-image", () => {
  const provider = new OpenAiCreativeImageProvider(fakeMediaProvider());
  assert.equal(provider.profile.id, "openai-creative-image");
  assert.equal(provider.profile.models[0].id, "gpt-image-1");
});

test("OpenAiCreativeImageProvider: só suporta image_generation", async () => {
  const provider = new OpenAiCreativeImageProvider(fakeMediaProvider());
  await assert.rejects(() => provider.execute({ ...baseRequest(), taskType: "analysis" }), /só suporta "image_generation"/);
});

test("OpenAiCreativeImageProvider: exige context.creativeGuard — nunca gera sem a guarda factual mínima", async () => {
  const provider = new OpenAiCreativeImageProvider(fakeMediaProvider());
  await assert.rejects(
    () => provider.execute({ taskType: "image_generation", prompt: "x", context: {} }),
    /CREATIVE_ENGINE_GUARD_MISSING/,
  );
});

for (const legacyKey of [
  "authorizedVisibleTitle",
  "authorizedBrandColors",
  "referenceProductFidelity",
  "authorizedCleanZones",
  "authorizedBackgroundOnly",
]) {
  test(`OpenAiCreativeImageProvider: rejeita explicitamente o campo legado "${legacyKey}" — escolha de guarda nunca é inferida`, async () => {
    const provider = new OpenAiCreativeImageProvider(fakeMediaProvider());
    await assert.rejects(
      () => provider.execute(baseRequest({ [legacyKey]: legacyKey === "authorizedBrandColors" ? ["#000000"] : "qualquer valor" })),
      /CREATIVE_ENGINE_LEGACY_GUARD_CONTEXT_FORBIDDEN/,
    );
  });
}

test("OpenAiCreativeImageProvider: envia o prompt guardado (guarda factual) preservando headline/CTA do creative_plan", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);

  await provider.execute(
    baseRequest({
      creativeGuard: {
        preservedAssetRoles: ["logo"],
        confirmedFacts: ["Preço atual: R$ 39,99"],
      },
      imageAspectRatio: "4:5",
    }),
  );

  assert.equal(media.calls.length, 1);
  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /Ofertas imperdíveis/);
  assert.match(sentPrompt, /Confira agora/);
  assert.match(sentPrompt, /Preço atual: R\$ 39,99/);
  assert.doesNotMatch(sentPrompt, /IGNORE/);
  assert.doesNotMatch(sentPrompt, /NÃO PODE conter nenhum texto/i);
  assert.equal(media.calls[0].params.size, "1024x1536");
  assert.equal(media.calls[0].params.targetAspectRatio, "4:5");
});

test("OpenAiCreativeImageProvider: propaga falha do mediaProvider.generate() como erro explícito", async () => {
  const media = fakeMediaProvider(() => ({ ok: false, category: "provider_error", message: "falha simulada" }));
  const provider = new OpenAiCreativeImageProvider(media);
  await assert.rejects(() => provider.execute(baseRequest()), /falha simulada/);
});
