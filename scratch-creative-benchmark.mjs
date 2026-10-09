// Harness de benchmark de qualidade criativa (RODADA 3) — roda DENTRO do container da API de
// produção (reaproveita OPENAI key real via PostgresSecretManager + providers reais), mas nunca
// toca em dados de workspace/tenant real: object storage é um servidor HTTP local efêmero,
// servindo arquivos de /tmp/creative-benchmark, nunca o bucket real de clientes.
import pg from "pg";
import sharp from "sharp";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

import { PostgresSecretManager } from "/app/dist/infrastructure/operations/postgres-secret-manager.js";
import { OpenAiImageProviderAdapter } from "/app/dist/infrastructure/ai-providers/openai-image-provider-adapter.js";
import { OpenAiIcaroTextProvider } from "/app/dist/infrastructure/ai-providers/openai-icaro-text-provider.js";
import { OpenAiCreativeImageProvider } from "/app/dist/infrastructure/ai-providers/openai-creative-image-provider.js";
import { IcaroAIBrain } from "/app/dist/application/ai/icaro-brain.js";
import { runGptCreativeEngine } from "/app/dist/application/creative-engine/run-gpt-creative-engine.js";
import { compositeLogoOntoImage } from "/app/dist/infrastructure/media/logo-compositor.js";
import { compositeScreenshotIntoDeviceMockup } from "/app/dist/infrastructure/media/screenshot-mockup-compositor.js";
import { renderCreativePlanTextZones } from "/app/dist/infrastructure/rendering/render-creative-plan-text-zones.js";
import { computeAssetSuitabilityScore } from "/app/dist/infrastructure/image-processing/product-background.js";
import { resolveOpenAiImageSize } from "/app/dist/infrastructure/ai-providers/openai-image-technical-helpers.js";
import { estimateGptImage1CostUsd } from "/app/dist/infrastructure/ai-providers/gpt-image-1-pricing.js";

const { Pool } = pg;
const OUT_DIR = "/tmp/creative-benchmark";
const ASSET_DIR = path.join(OUT_DIR, "_assets");
const HTTP_PORT = 9897;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;
const PACING_MS = 4000; // espaçamento conservador entre chamadas de imagem (nunca mais o incidente de quota, mas RPM normal ainda existe)

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

let fileCounter = 0;
async function writeAsset(buffer, ext = "png") {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const name = `f${Date.now().toString(36)}-${++fileCounter}.${ext}`;
  await fs.writeFile(path.join(ASSET_DIR, name), buffer);
  return `${BASE_URL}/${name}`;
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const filePath = path.join(ASSET_DIR, decodeURIComponent(req.url.replace(/^\//, "")));
      const buffer = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(buffer);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------- Synthetic brand assets (zero/low cost) ----------

// Achado ao vivo nesta própria rodada: assets em `context.assets[].url` precisam ser alcançáveis
// de FORA do container (o diretor manda essa URL pra visão da OpenAI analisar, via `imageUrls`) —
// uma URL `127.0.0.1` do servidor estático local do harness nunca funciona (só alcançável de
// dentro do próprio processo), derrubando o plano inteiro (`CREATIVE_PLAN_INVALID`) em TODO
// cenário com asset. `placehold.co` é um serviço público estável, sem nenhum dado sensível/real —
// só um quadrado colorido com uma letra, suficiente pra exercitar o caminho real de composição de
// logo/screenshot sem precisar hospedar nada.
async function makeLogoAsset(label, bgHex) {
  return `https://placehold.co/400x400/${bgHex}/ffffff.png?text=${encodeURIComponent(label)}`;
}

async function makeScreenshotAsset() {
  return "https://placehold.co/1200x800/0f172a/94a3b8.png?text=Dashboard";
}

// ---------- Providers reais (OpenAI de verdade, via secret do painel admin) ----------

async function buildRealProviders() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const secretManager = new PostgresSecretManager(pool, process.env.JWT_SECRET);
  const getApiKey = async () => {
    const stored = await secretManager.get("ai-provider:openai").catch(() => undefined);
    return stored?.value?.apiKey;
  };
  const apiKeyProbe = await getApiKey();
  if (!apiKeyProbe) throw new Error("Nenhuma chave OpenAI configurada em ai-provider:openai — benchmark não pode rodar.");

  const imageAdapter = new OpenAiImageProviderAdapter({
    enabled: true,
    getApiKey,
    persistGeneratedImage: async ({ base64 }) => writeAsset(Buffer.from(base64, "base64")),
  });
  const creativeImageProvider = new OpenAiCreativeImageProvider(imageAdapter); // default quality = "medium" (Rodada 1)
  const textProvider = new OpenAiIcaroTextProvider({ getApiKey, modelId: "gpt-4o" });
  const creativeBrain = new IcaroAIBrain({ providers: [creativeImageProvider, textProvider] });

  return { pool, imageAdapter, creativeBrain };
}

const objectStorage = {
  async put({ body }) { return { url: await writeAsset(body) }; },
  async delete() {},
  resolvePublicUrl(key) { return `${BASE_URL}/${key}`; },
  async health() { return { ok: true }; },
};

async function readImageDimensions(buffer) {
  const metadata = await sharp(buffer).metadata();
  return { width: metadata.width, height: metadata.height };
}

async function fetchAsBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function runScenario(scenario, deps, scenarioDir) {
  await fs.mkdir(scenarioDir, { recursive: true });
  await fs.writeFile(path.join(scenarioDir, "creative-context.json"), JSON.stringify(scenario.context, null, 2));

  let preOverlaySnapshot;
  const hasScreenshot = scenario.context.assets.some((a) => a.role === "screenshot");
  const hasLogo = scenario.context.assets.some((a) => a.role === "logo");

  const instrumentedDeps = {
    creativeBrain: deps.creativeBrain,
    objectStorage,
    readImageDimensions,
    computeAssetSuitability: computeAssetSuitabilityScore,
    compositeScreenshot: async (input) => {
      preOverlaySnapshot = input.imageBuffer;
      return compositeScreenshotIntoDeviceMockup(input);
    },
    compositeLogo: async (input) => {
      if (!hasScreenshot) preOverlaySnapshot = input.imageBuffer;
      return compositeLogoOntoImage(input);
    },
    renderTextZones: async (input) => {
      if (!hasScreenshot && !hasLogo) preOverlaySnapshot = input.baseImageBuffer;
      return renderCreativePlanTextZones(input);
    },
  };

  const startedAt = Date.now();
  let engineResult;
  let engineError;
  try {
    engineResult = await runGptCreativeEngine(instrumentedDeps, {
      executionRunId: `bench-${scenario.id}`,
      creativeEngineRunId: `bench-${scenario.id}`,
      tenantId: "benchmark-tenant",
      workspaceId: "benchmark-workspace",
      creativeContext: scenario.context,
      maxBudgetUsd: 1.5,
    });
  } catch (error) {
    engineError = error instanceof Error ? error.message : String(error);
  }
  const vorixLatencyMs = Date.now() - startedAt;

  if (preOverlaySnapshot) {
    await fs.writeFile(path.join(scenarioDir, "A-model-only.png"), preOverlaySnapshot);
  }
  if (engineResult?.finalImageUrl) {
    try {
      const buf = await fetchAsBuffer(engineResult.finalImageUrl);
      await fs.writeFile(path.join(scenarioDir, "B-vorix-full.png"), buf);
    } catch (e) {
      console.error(`[${scenario.id}] falha ao baixar B-vorix-full:`, e.message);
    }
  }

  await sleep(PACING_MS);

  let directResult;
  let directError;
  let directCostUsd;
  const directSize = resolveOpenAiImageSize(scenario.context.format);
  const directStartedAt = Date.now();
  try {
    directResult = await deps.imageAdapter.generate({
      operationTypeCode: "image_generation",
      modelId: "gpt-image-1",
      prompt: scenario.directPrompt,
      tenantId: "benchmark-tenant",
      workspaceId: "benchmark-workspace",
      params: { size: directSize, quality: "medium", targetAspectRatio: scenario.context.format },
      timeoutMs: 60_000,
    });
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error);
  }
  const directLatencyMs = Date.now() - directStartedAt;
  if (directResult?.ok) {
    directCostUsd = estimateGptImage1CostUsd({ size: directSize, quality: "medium", promptChars: scenario.directPrompt.length, hasReferenceImage: false });
    try {
      const buf = await fetchAsBuffer(directResult.mediaUrl);
      await fs.writeFile(path.join(scenarioDir, "C-direct-gpt.png"), buf);
    } catch (e) {
      console.error(`[${scenario.id}] falha ao baixar C-direct-gpt:`, e.message);
    }
  } else if (directResult && !directResult.ok) {
    directError = `${directResult.category}: ${directResult.message}`;
  }

  const summary = {
    id: scenario.id,
    label: scenario.label,
    vorix: {
      error: engineError,
      publishable: engineResult?.publishable,
      errorCode: engineResult?.errorCode,
      repairRounds: engineResult?.repairRounds?.length ?? 0,
      costBreakdown: engineResult?.costBreakdown,
      estimatedCostUsd: engineResult?.estimatedCostUsd,
      latencyMs: vorixLatencyMs,
      directorModel: engineResult?.directorModel,
      imageModel: engineResult?.imageModel,
    },
    direct: {
      error: directError,
      estimatedCostUsd: directCostUsd,
      latencyMs: directLatencyMs,
    },
  };

  await fs.writeFile(
    path.join(scenarioDir, "result-meta.json"),
    JSON.stringify({ ...summary, creativePlan: engineResult?.creativePlan, finalImagePrompt: engineResult?.finalImagePrompt, qualityGate: engineResult?.qualityGate, visualQualityScore: engineResult?.visualQualityScore }, null, 2),
  );
  console.log(`[${scenario.id}] OK — vorix.publishable=${engineResult?.publishable} errorCode=${engineResult?.errorCode} custo=${engineResult?.estimatedCostUsd?.toFixed(4)} direct.custo=${directCostUsd?.toFixed?.(4)} direct.error=${directError ?? "-"}`);
  return summary;
}

async function buildScenarios() {
  const logoDark = await makeLogoAsset("N", "111827");
  const logoLux = await makeLogoAsset("A", "b45309");
  const logoStreet = await makeLogoAsset("V", "dc2626");
  const screenshotUrl = await makeScreenshotAsset();

  return {
    scenarios: [
      {
        id: "01-produto-fisico-preco",
        label: "Produto físico + preço (e-commerce)",
        context: {
          brandName: "Nortrail",
          objective: "Vender o novo tênis de corrida com desconto de lançamento",
          channel: "feed Instagram",
          format: "4:5",
          ideaText: "Anúncio de lançamento do tênis de corrida Nortrail Flow, leve e respirável, com desconto de estreia.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial Nortrail" }],
          confirmedFacts: ["Preço: R$ 349,90", "Desconto de lançamento: 15%", "Frete grátis para todo o Brasil"],
          brandColors: ["preto", "verde-limão", "branco"],
          audience: "Corredores amadores de 25 a 45 anos",
          toneOfVoice: "Direto, enérgico, focado em performance",
        },
        directPrompt:
          "Crie um anúncio de Instagram (proporção 4:5) para o lançamento do tênis de corrida Nortrail Flow. Cores da marca: preto, verde-limão e branco. Inclua o headline \"NORTRAIL FLOW CHEGOU\", o preço R$ 349,90 com 15% de desconto de lançamento, e um CTA \"Garanta o seu\". Estilo esportivo, direto, enérgico, foco em performance.",
      },
      {
        id: "02-servico-consultoria",
        label: "Serviço (consultoria financeira)",
        context: {
          brandName: "Âncora Capital",
          objective: "Divulgar sessão de diagnóstico financeiro gratuita",
          channel: "feed Instagram",
          format: "1:1",
          ideaText: "Convite para uma sessão gratuita de diagnóstico financeiro pessoal com um consultor Âncora Capital.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial Âncora Capital" }],
          confirmedFacts: ["Sessão de diagnóstico 100% gratuita", "Duração de 30 minutos", "Vagas limitadas nesta semana"],
          brandColors: ["azul-marinho", "dourado", "branco"],
          audience: "Profissionais liberais de 30 a 55 anos buscando organizar as finanças",
          toneOfVoice: "Confiável, sóbrio, consultivo — nunca querendo parecer corretora de investimento agressiva",
        },
        directPrompt:
          "Crie um post de Instagram (proporção 1:1) para a Âncora Capital, uma consultoria financeira. Cores: azul-marinho, dourado e branco. Headline \"Diagnóstico Financeiro Gratuito\", subheadline \"30 minutos, vagas limitadas\", CTA \"Agende agora\". Estilo confiável, sóbrio, profissional, nunca agressivo ou chamativo demais.",
      },
      {
        id: "03-promocao-sem-preco-story",
        label: "Promoção sem preço fixo (story)",
        context: {
          brandName: "Casa Viva",
          objective: "Divulgar a Semana do Cliente com desconto progressivo",
          channel: "Instagram Stories",
          format: "9:16",
          ideaText: "Semana do Cliente Casa Viva: quanto mais o cliente compra, maior o desconto progressivo.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial Casa Viva" }],
          confirmedFacts: ["Desconto progressivo de até 30%", "Válido de segunda a domingo"],
          brandColors: ["terracota", "bege", "verde-oliva"],
          audience: "Famílias decorando a casa",
          toneOfVoice: "Acolhedor, caseiro, caloroso",
        },
        directPrompt:
          "Crie um story de Instagram (proporção 9:16) para a Semana do Cliente da Casa Viva, uma loja de decoração. Cores terracota, bege e verde-oliva. Headline \"Semana do Cliente\", subheadline \"Desconto progressivo de até 30%\", CTA \"Aproveite agora\". Estilo acolhedor, caseiro, caloroso.",
      },
      {
        id: "04-institucional-premium-luxo",
        label: "Institucional premium A (joalheria de luxo, minimalista)",
        context: {
          brandName: "Lumière Joias",
          objective: "Fortalecer o posicionamento premium da marca, sem venda direta",
          channel: "feed Instagram",
          format: "1:1",
          ideaText: "Peça institucional celebrando a herança artesanal da Lumière Joias, sem preço, só posicionamento de marca.",
          assets: [{ url: logoLux, role: "logo", description: "Logo oficial Lumière Joias" }],
          confirmedFacts: [],
          brandColors: ["preto", "dourado"],
          audience: "Público de alto poder aquisitivo, 35+",
          toneOfVoice: "Sóbrio, minimalista, exclusivo, nunca gritado",
          visualIdentityNotes: "Muito espaço negativo, tipografia serifada fina, fotografia de altíssimo contraste, nunca denso ou colorido",
        },
        directPrompt:
          "Crie uma peça institucional de Instagram (proporção 1:1) para a Lumière Joias, uma joalheria de altíssimo luxo. Cores preto e dourado. Headline curta e elegante \"Lumière Joias\" ou um conceito equivalente. Estilo extremamente minimalista, muito espaço negativo, tipografia serifada fina, fotografia de alto contraste, sóbrio, exclusivo, nunca gritado ou colorido.",
      },
      {
        id: "05-institucional-premium-streetwear",
        label: "Institucional premium B (MESMO objetivo, marca visual oposta — teste de Brand Visual Profile)",
        context: {
          brandName: "Riot Wear",
          objective: "Fortalecer o posicionamento premium da marca, sem venda direta",
          channel: "feed Instagram",
          format: "1:1",
          ideaText: "Peça institucional celebrando a atitude streetwear da Riot Wear, sem preço, só posicionamento de marca.",
          assets: [{ url: logoStreet, role: "logo", description: "Logo oficial Riot Wear" }],
          confirmedFacts: [],
          brandColors: ["vermelho", "preto", "branco"],
          audience: "Jovens de 16 a 28 anos, cultura urbana",
          toneOfVoice: "Ousado, rebelde, barulhento, cheio de atitude",
          visualIdentityNotes: "Composição densa, tipografia grande e impactante, alto contraste, grafite/textura urbana, nunca minimalista ou contido",
        },
        directPrompt:
          "Crie uma peça institucional de Instagram (proporção 1:1) para a Riot Wear, uma marca streetwear jovem e urbana. Cores vermelho, preto e branco. Headline curta e impactante \"Riot Wear\" ou um conceito equivalente. Estilo ousado, rebelde, denso, tipografia grande, alto contraste, textura urbana/grafite, cheio de atitude, nunca minimalista ou contido.",
      },
      {
        id: "06-anuncio-saas-screenshot",
        label: "Anúncio SaaS B2B (com screenshot)",
        context: {
          brandName: "Fluxly",
          objective: "Converter visitantes em teste grátis do dashboard de gestão",
          channel: "anúncio LinkedIn",
          format: "1:1",
          ideaText: "Anúncio do dashboard Fluxly de gestão financeira para pequenas empresas, com captura de tela real do produto.",
          assets: [
            { url: logoDark, role: "logo", description: "Logo oficial Fluxly" },
            { url: screenshotUrl, role: "screenshot", description: "Captura de tela real do dashboard Fluxly" },
          ],
          confirmedFacts: ["Teste grátis de 14 dias", "Sem necessidade de cartão de crédito"],
          brandColors: ["azul-petróleo", "verde-água", "branco"],
          audience: "Gestores financeiros de pequenas e médias empresas",
          toneOfVoice: "Profissional, direto, confiável, sem jargão técnico",
        },
        directPrompt:
          "Crie um anúncio de LinkedIn (proporção 1:1) para o Fluxly, um dashboard SaaS de gestão financeira. Cores azul-petróleo, verde-água e branco. Mostre um mockup de notebook ou celular com uma tela de dashboard genérica (sem texto legível dentro da tela). Headline \"Gestão financeira sem complicação\", CTA \"Teste grátis por 14 dias\". Estilo profissional, direto, confiável.",
      },
      {
        id: "07-publicacao-educativa",
        label: "Publicação educativa (sem venda direta)",
        context: {
          brandName: "Sorriso Pleno Odontologia",
          objective: "Educar sobre saúde bucal, gerar autoridade (sem venda direta)",
          channel: "feed Instagram",
          format: "4:5",
          ideaText: "Dica educativa sobre a importância do uso do fio dental, assinado pela clínica Sorriso Pleno.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial Sorriso Pleno Odontologia" }],
          confirmedFacts: [],
          brandColors: ["azul-claro", "branco", "verde-menta"],
          audience: "Famílias buscando cuidado odontológico preventivo",
          toneOfVoice: "Acolhedor, didático, nunca clínico/frio demais",
        },
        directPrompt:
          "Crie um post educativo de Instagram (proporção 4:5) para a clínica Sorriso Pleno Odontologia. Cores azul-claro, branco e verde-menta. Headline \"Por que usar fio dental todos os dias?\", com um visual ilustrativo e acolhedor sobre saúde bucal. Estilo didático, acolhedor, nunca clínico ou frio.",
      },
      {
        id: "08-story-urgencia-blackfriday",
        label: "Story urgência (Black Friday, preço+desconto)",
        context: {
          brandName: "TechBox",
          objective: "Gerar urgência de compra na Black Friday",
          channel: "Instagram Stories",
          format: "9:16",
          ideaText: "Oferta relâmpago de Black Friday da TechBox em fones de ouvido bluetooth, por tempo limitado.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial TechBox" }],
          confirmedFacts: ["Preço: R$ 199,90", "Desconto: 40%", "Oferta válida só hoje"],
          brandColors: ["preto", "amarelo", "branco"],
          audience: "Consumidores caçando ofertas de eletrônicos",
          toneOfVoice: "Urgente, vibrante, chamativo",
        },
        directPrompt:
          "Crie um story de Instagram (proporção 9:16) de Black Friday para a TechBox, uma loja de eletrônicos. Cores preto, amarelo e branco. Headline \"BLACK FRIDAY\", subheadline \"Só hoje\", preço R$ 199,90 com 40% de desconto, CTA \"Compre agora\". Estilo urgente, vibrante, chamativo, senso de escassez.",
      },
      {
        id: "09-produto-fisico-lifestyle",
        label: "Produto físico sem preço, lifestyle",
        context: {
          brandName: "Grão Raiz",
          objective: "Fortalecer a percepção de qualidade do café especial, sem foco em venda direta",
          channel: "feed Instagram",
          format: "4:5",
          ideaText: "Peça lifestyle celebrando o ritual de preparo do café especial Grão Raiz.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial Grão Raiz" }],
          confirmedFacts: [],
          brandColors: ["marrom-café", "bege", "verde-musgo"],
          audience: "Apreciadores de café especial, 25-45 anos",
          toneOfVoice: "Caloroso, sensorial, artesanal",
        },
        directPrompt:
          "Crie uma peça lifestyle de Instagram (proporção 4:5) para a Grão Raiz, uma marca de café especial. Cores marrom-café, bege e verde-musgo. Mostre uma cena de preparo de café artesanal, atmosfera aconchegante. Headline curta e sensorial \"Grão Raiz\" ou equivalente. Estilo caloroso, artesanal, sensorial, sem foco em venda direta.",
      },
      {
        id: "10-oferta-densa-moveis",
        label: "Oferta densa (preço + parcelamento)",
        context: {
          brandName: "MadeiraViva Móveis",
          objective: "Vender móveis planejados com condição facilitada de pagamento",
          channel: "feed Instagram",
          format: "4:5",
          ideaText: "Oferta de móveis planejados sob medida da MadeiraViva, com parcelamento facilitado.",
          assets: [{ url: logoDark, role: "logo", description: "Logo oficial MadeiraViva Móveis" }],
          confirmedFacts: ["A partir de R$ 2.499,00", "Em até 12x sem juros", "Projeto 3D grátis"],
          brandColors: ["marrom-amadeirado", "bege", "branco"],
          audience: "Famílias reformando ou mobiliando a casa",
          toneOfVoice: "Confiável, caseiro, prático",
        },
        directPrompt:
          "Crie um anúncio de Instagram (proporção 4:5) para a MadeiraViva Móveis, móveis planejados sob medida. Cores marrom-amadeirado, bege e branco. Headline \"Móveis planejados sob medida\", preço \"A partir de R$ 2.499,00 em até 12x sem juros\", CTA \"Peça seu projeto 3D grátis\". Estilo confiável, caseiro, prático.",
      },
    ],
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const server = await startStaticServer();
  console.log("Servidor estático local ativo em", BASE_URL);

  const deps = await buildRealProviders();
  const { scenarios } = await buildScenarios();

  const results = [];
  for (const scenario of scenarios) {
    const scenarioDir = path.join(OUT_DIR, scenario.id);
    try {
      const summary = await runScenario(scenario, deps, scenarioDir);
      results.push(summary);
    } catch (error) {
      console.error(`[${scenario.id}] FALHA INESPERADA:`, error);
      results.push({ id: scenario.id, label: scenario.label, fatalError: error instanceof Error ? error.message : String(error) });
    }
    await fs.writeFile(path.join(OUT_DIR, "SUMMARY.json"), JSON.stringify(results, null, 2));
    await sleep(PACING_MS);
  }

  console.log("\n===== BENCHMARK CONCLUÍDO =====");
  console.log(JSON.stringify(results, null, 2));

  await deps.pool.end();
  server.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("ERRO FATAL NO BENCHMARK:", error);
  process.exit(1);
});
