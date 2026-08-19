import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiIcaroImageProvider } from "../dist/infrastructure/ai-providers/openai-icaro-image-provider.js";

function fakeMediaProvider(generateImpl) {
  const calls = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return generateImpl(request);
    },
  };
}

function baseRequest(context = {}) {
  return {
    taskType: "image_generation",
    prompt: "Prompt base de geração de imagem.",
    model: "gpt-image-1",
    timeoutMs: 30_000,
    context: { clientId: "tenant-1", workspaceId: "workspace-1", imageCount: 1, ...context },
  };
}

test("OpenAiIcaroImageProvider: sem nenhuma guarda extra, o prompt final só tem a regra de 'sem texto nenhum' repetida no início e no fim", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest());

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /NÃO PODE conter nenhum texto/);
  // a guarda aparece 2 vezes (início e fim) — dual-guard pattern
  assert.equal(sentPrompt.split("NÃO PODE conter nenhum texto").length - 1, 2);
  assert.equal(sentPrompt.includes("PRODUCT FIDELITY"), false);
});

test("OpenAiIcaroImageProvider: authorizedVisibleTitle vira a única regra de texto permitido, repetida 2x", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ authorizedVisibleTitle: "R$ 39,99 -50%" }));

  const sentPrompt = media.calls[0].prompt;
  assert.equal(sentPrompt.split('"R$ 39,99 -50%"').length - 1, 2);
  assert.equal(sentPrompt.includes("NÃO PODE conter nenhum texto"), false);
});

test("OpenAiIcaroImageProvider: authorizedBrandColors vira regra de paleta obrigatória", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ authorizedBrandColors: ["verde neon", "preto"] }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /REGRA DE PALETA IGUALMENTE OBRIGATÓRIA/);
  assert.match(sentPrompt, /verde neon, preto/);
});

test("OpenAiIcaroImageProvider: referenceProductFidelity vira regra de fidelidade ao produto (PRODUCT FIDELITY = CRITICAL), repetida 2x", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ referenceProductFidelity: "o produto é: Tênis Casual Unissex Skatista RV; cores reais: preto, branco" }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /PRODUCT FIDELITY = CRITICAL/);
  assert.match(sentPrompt, /NUNCA pode redesenhar, substituir ou alterar o produto em si/);
  assert.equal(sentPrompt.split("Tênis Casual Unissex Skatista RV").length - 1, 2);
});

test("OpenAiIcaroImageProvider: sem referenceProductFidelity, nenhuma menção a PRODUCT FIDELITY aparece (regressão)", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ authorizedVisibleTitle: "Título qualquer" }));

  assert.equal(media.calls[0].prompt.includes("PRODUCT FIDELITY"), false);
});

test("OpenAiIcaroImageProvider: imageAspectRatio 9:16 vira regra de enquadramento (regressão do pillarboxing achado ao vivo), repetida 2x", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ imageAspectRatio: "9:16" }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /REGRA DE ENQUADRAMENTO IGUALMENTE OBRIGATÓRIA/);
  assert.match(sentPrompt, /cortada automaticamente.*1024x1536/);
  assert.equal(sentPrompt.split("REGRA DE ENQUADRAMENTO IGUALMENTE OBRIGATÓRIA").length - 1, 2);
  assert.equal(media.calls[0].params.targetAspectRatio, "9:16");
});

test("OpenAiIcaroImageProvider: imageAspectRatio 1:1 (já compatível com o tamanho nativo) não gera regra de enquadramento", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ imageAspectRatio: "1:1" }));

  assert.equal(media.calls[0].prompt.includes("REGRA DE ENQUADRAMENTO"), false);
});

test("OpenAiIcaroImageProvider: sem imageAspectRatio, nenhuma regra de enquadramento e targetAspectRatio undefined", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest());

  assert.equal(media.calls[0].prompt.includes("REGRA DE ENQUADRAMENTO"), false);
  assert.equal(media.calls[0].params.targetAspectRatio, undefined);
});

test("OpenAiIcaroImageProvider: authorizedCleanZones proíbe explicitamente rosto/cabeça/mãos nessas áreas (Fatia 2, Bloco 0.3 — regressão do achado ao vivo de produto sobrepondo rosto)", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ authorizedCleanZones: "o produto na região central-central" }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /REGRA DE ÁREA LIMPA IGUALMENTE OBRIGATÓRIA/);
  assert.match(sentPrompt, /NUNCA posicione rosto, cabeça ou mãos de pessoa/);
});

test("OpenAiIcaroImageProvider: authorizedBackgroundOnly vira regra de produto obrigatória (Product Asset Pipeline, Rodada 2, Prioridade 2), repetida 2x", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({ authorizedBackgroundOnly: "NÃO desenhe o produto — gere apenas cenário e fundo." }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /REGRA DE PRODUTO IGUALMENTE OBRIGATÓRIA/);
  assert.match(sentPrompt, /NÃO desenhe o produto — gere apenas cenário e fundo\./);
  assert.equal(sentPrompt.split("REGRA DE PRODUTO IGUALMENTE OBRIGATÓRIA").length - 1, 2);
});

test("OpenAiIcaroImageProvider: sem authorizedBackgroundOnly, nenhuma regra de produto aparece (regressão — comportamento de sempre)", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest());

  assert.equal(media.calls[0].prompt.includes("REGRA DE PRODUTO IGUALMENTE OBRIGATÓRIA"), false);
});

test("OpenAiIcaroImageProvider: as três guardas (texto, cor, fidelidade) coexistem no mesmo prompt final", async () => {
  const media = fakeMediaProvider(async () => ({ ok: true, mediaUrl: "https://x/img.png", billableUnits: 1, latencyMs: 1 }));
  const provider = new OpenAiIcaroImageProvider(media);

  await provider.execute(baseRequest({
    authorizedVisibleTitle: "R$ 39,99",
    authorizedBrandColors: ["preto", "branco"],
    referenceProductFidelity: "o produto é: Tênis RV",
  }));

  const sentPrompt = media.calls[0].prompt;
  assert.match(sentPrompt, /R\$ 39,99/);
  assert.match(sentPrompt, /REGRA DE PALETA IGUALMENTE OBRIGATÓRIA/);
  assert.match(sentPrompt, /PRODUCT FIDELITY = CRITICAL/);
});
