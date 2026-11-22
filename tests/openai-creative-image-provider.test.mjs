import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiCreativeImageProvider } from "../dist/infrastructure/ai-providers/openai-creative-image-provider.js";

function fakeMediaProvider(generateImpl) {
  const calls = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return generateImpl
        ? generateImpl(request)
        : {
            ok: true,
            mediaUrl: "https://example.com/out.png",
            audit: {
              model: request.modelId,
              endpoint: "generations",
              params: { size: request.params.size, quality: request.params.quality },
              usage: { inputTextTokens: 1000, inputImageTokens: 0, outputImageTokens: 6000, outputTextTokens: 0, totalTokens: 7000 },
              costUsd: 0.185,
            },
          };
    },
  };
}

function baseRequest(context = {}) {
  return {
    taskType: "image_generation",
    prompt: 'Headline (desenhar exatamente este texto): "Ofertas imperdíveis"\nCTA (desenhar exatamente este texto): "Confira agora"',
    model: "gpt-image-2.6-sunburst",
    context: {
      creativeGuard: { preservedAssetRoles: [], confirmedFacts: [] },
      ...context,
    },
  };
}

test("OpenAiCreativeImageProvider: modelo padrão é gpt-image-2.6-sunburst (catálogo), profile.id é openai-creative-image", () => {
  const provider = new OpenAiCreativeImageProvider(fakeMediaProvider());
  assert.equal(provider.profile.id, "openai-creative-image");
  assert.equal(provider.profile.models[0].id, "gpt-image-2.6-sunburst");
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
  // Canvas EXATO 4:5 (1088x1360): nada é cortado depois e o prompt não fala em corte.
  assert.equal(media.calls[0].params.size, "1088x1360");
  assert.equal(media.calls[0].params.targetAspectRatio, "4:5");
  assert.doesNotMatch(sentPrompt, /cortada automaticamente/);
});

// Custo REAL: soma do `usage` devolvido pela OpenAI × preço oficial do catálogo (nunca 0 fixo,
// nunca a tabela estimada do antigo gpt-image-1).
test("OpenAiCreativeImageProvider: custo e tokens vêm do consumo real informado pelo adaptador", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);
  const response = await provider.execute(baseRequest({ imageAspectRatio: "4:5" }));
  assert.equal(response.cost.estimated, 0.185);
  assert.deepEqual(response.tokens, { input: 1000, output: 6000, total: 7000 });
  const content = JSON.parse(response.content);
  assert.equal(content.imageAudit.model, "gpt-image-2.6-sunburst");
  assert.deepEqual(content.imageAudit.canvas, { size: "1088x1360", width: 1088, height: 1360, exact: true });
});

test("OpenAiCreativeImageProvider: qualidade padrão é 'high' e a configuração manda (quality/complexity)", async () => {
  const media = fakeMediaProvider();
  await new OpenAiCreativeImageProvider(media).execute(baseRequest({ imageAspectRatio: "1:1" }));
  assert.equal(media.calls[0].params.quality, "high");
  assert.equal("complexity" in media.calls[0].params, false);
  assert.equal(media.calls[0].params.size, "1088x1088", "1:1 nunca vira 4:5 em silêncio");
  const configured = fakeMediaProvider();
  await new OpenAiCreativeImageProvider(configured, { quality: "xhigh", complexity: "medium" }).execute(baseRequest({ imageAspectRatio: "9:16" }));
  assert.equal(configured.calls[0].params.quality, "xhigh");
  assert.equal(configured.calls[0].params.complexity, "medium");
  assert.equal(configured.calls[0].params.size, "1152x2048");
});

test("OpenAiCreativeImageProvider: com imageCount > 1, o custo é a soma real de cada imagem gerada", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);
  const threeImages = await provider.execute(baseRequest({ imageAspectRatio: "4:5", imageCount: 3 }));
  assert.ok(Math.abs(threeImages.cost.estimated - 0.185 * 3) < 0.000001);
  assert.equal(media.calls.length, 3);
});

test("OpenAiCreativeImageProvider: nível rápido usa o modelo rápido da configuração; modelo fora do catálogo falha sem trocar", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media, { fastModelId: "gpt-image-2.6-flare" });
  await provider.execute({ ...baseRequest({ imageModelTier: "fast" }), model: undefined });
  assert.equal(media.calls[0].modelId, "gpt-image-2.6-flare");
  const unknown = fakeMediaProvider();
  await assert.rejects(() => new OpenAiCreativeImageProvider(unknown).execute({ ...baseRequest(), model: "gpt-image-1" }), /não está no catálogo/);
  assert.equal(unknown.calls.length, 0, "nenhuma chamada sai com modelo desconhecido");
});

test("OpenAiCreativeImageProvider: propaga falha do mediaProvider.generate() como erro explícito", async () => {
  const media = fakeMediaProvider(() => ({ ok: false, category: "provider_error", message: "falha simulada" }));
  const provider = new OpenAiCreativeImageProvider(media);
  await assert.rejects(() => provider.execute(baseRequest()), /falha simulada/);
});

test("OpenAiCreativeImageProvider: repassa background explícito (opaque) só quando o motor pede; sem pedido não envia nada", async () => {
  const media = fakeMediaProvider();
  const provider = new OpenAiCreativeImageProvider(media);
  await provider.execute(baseRequest({ imageAspectRatio: "4:5", imageBackground: "opaque" }));
  await provider.execute(baseRequest({ imageAspectRatio: "4:5" }));
  await provider.execute(baseRequest({ imageAspectRatio: "4:5", imageBackground: "qualquer-coisa" }));
  assert.equal(media.calls[0].params.background, "opaque");
  assert.equal("background" in media.calls[1].params, false);
  assert.equal("background" in media.calls[2].params, false);
});
