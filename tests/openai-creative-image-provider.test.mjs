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

// Auditoria de custo urgente — achado crítico: antes desta correção, `response.cost.estimated`
// era SEMPRE 0 aqui, nunca contabilizando o passo mais caro do pipeline em nenhum total de custo
// do motor (confirmado em produção: 47 chamadas reais de image_generation, custo médio $0.000000).

test("OpenAiCreativeImageProvider: response.cost.estimated NUNCA é zero — geração de imagem é o passo mais caro do pipeline", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);
  const response = await provider.execute(baseRequest({ imageAspectRatio: "4:5" }));
  assert.ok(response.cost.estimated > 0, `esperava custo > 0, veio ${response.cost.estimated}`);
});

test("OpenAiCreativeImageProvider: qualidade configurável (preset econômico) reduz o custo estimado sem mudar o padrão 'high'", async () => {
  const highQuality = new OpenAiCreativeImageProvider(fakeMediaProvider());
  const economicQuality = new OpenAiCreativeImageProvider(fakeMediaProvider(), { quality: "medium" });

  const highResponse = await highQuality.execute(baseRequest({ imageAspectRatio: "4:5" }));
  const economicResponse = await economicQuality.execute(baseRequest({ imageAspectRatio: "4:5" }));

  assert.ok(economicResponse.cost.estimated < highResponse.cost.estimated);
});

test("OpenAiCreativeImageProvider: com imageCount > 1, o custo estimado é multiplicado pelo número real de imagens geradas", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);
  const oneImage = await provider.execute(baseRequest({ imageAspectRatio: "4:5", imageCount: 1 }));
  const threeImages = await provider.execute(baseRequest({ imageAspectRatio: "4:5", imageCount: 3 }));
  assert.ok(Math.abs(threeImages.cost.estimated - oneImage.cost.estimated * 3) < 0.0001);
});

test("OpenAiCreativeImageProvider: propaga falha do mediaProvider.generate() como erro explícito", async () => {
  const media = fakeMediaProvider(() => ({ ok: false, category: "provider_error", message: "falha simulada" }));
  const provider = new OpenAiCreativeImageProvider(media);
  await assert.rejects(() => provider.execute(baseRequest()), /falha simulada/);
});
