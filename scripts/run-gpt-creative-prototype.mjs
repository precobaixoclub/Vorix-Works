// Protótipo Paralelo — GPT/OpenAI como motor criativo principal (validação isolada, Rodada 3).
// Script standalone (mesmo padrão de scripts/apply-content-brief-migration.mjs) — NUNCA chamado
// pela API/pipeline principal. Roda dentro do container de produção (via `docker exec`) ou
// localmente, desde que OPENAI_API_KEY e OBJECT_STORAGE_* estejam configurados.
//
// Uso: node scripts/run-gpt-creative-prototype.mjs <caminho-do-json-de-entrada>
//
// Formato do JSON de entrada:
// {
//   "tenantId": "tenant-prototype",
//   "brandName": "...",
//   "objective": "...",
//   "channel": "instagram",
//   "format": "4:5",
//   "ideaText": "...",
//   "brandColors": ["#0a0a0a", "#39ff6a"],
//   "forbiddenElements": ["Comente QUERO"],
//   "assets": [
//     { "role": "product_photo" | "screenshot" | "logo" | "reference_style" | "other",
//       "description": "...",
//       "filePath": "./caminho/local.png"   // OU "url": "https://já-público/..."
//     }
//   ]
// }
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

import { IcaroAIBrain } from "../dist/application/ai/icaro-brain.js";
import { OpenAiIcaroImageProvider } from "../dist/infrastructure/ai-providers/openai-icaro-image-provider.js";
import { OpenAiIcaroTextProvider } from "../dist/infrastructure/ai-providers/openai-icaro-text-provider.js";
import { OpenAiImageProviderAdapter } from "../dist/infrastructure/ai-providers/openai-image-provider-adapter.js";
import { OpenAiReferenceIntelligenceExtractor } from "../dist/infrastructure/ai-providers/openai-reference-intelligence-extractor.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { compositeLogoOntoImage } from "../dist/infrastructure/media/logo-compositor.js";
import { compositeScreenshotIntoDeviceMockup } from "../dist/infrastructure/media/screenshot-mockup-compositor.js";
import { computeAssetSuitabilityScore } from "../dist/infrastructure/image-processing/product-background.js";
import { runGptParallelCreativePrototype } from "../dist/application/production/run-gpt-creative-prototype.js";

function contentTypeFor(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function main() {
  // Fail-closed deliberado — evita custo real acidental (chamadas pagas à OpenAI) se alguém
  // rodar este script sem querer. Nunca integrado a `ExecutionFeatureFlags` (o protótipo
  // deliberadamente não passa pelo execution engine).
  if (process.env.GPT_PARALLEL_PROTOTYPE_ENABLED !== "true") {
    console.error("[gpt-creative-prototype] GPT_PARALLEL_PROTOTYPE_ENABLED != \"true\" — recusando rodar (evita custo acidental de OpenAI). Defina a variável para prosseguir.");
    process.exitCode = 1;
    return;
  }

  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Uso: node scripts/run-gpt-creative-prototype.mjs <caminho-do-json-de-entrada>");
    process.exitCode = 1;
    return;
  }

  const rawInput = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const tenantId = rawInput.tenantId ?? "tenant-prototype";

  const objectStorage = new LocalObjectStorage({
    rootDir: process.env.OBJECT_STORAGE_LOCAL_DIR?.trim() || "/app/uploads",
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim() || `${(process.env.ZUNO_API_ORIGIN || "http://localhost:3000").replace(/\/$/, "")}/uploads`,
  });

  const getApiKey = async () => process.env.OPENAI_API_KEY?.trim() || undefined;
  const apiBaseUrl = process.env.OPENAI_API_BASE_URL?.trim() || undefined;

  const openaiImageProvider = new OpenAiImageProviderAdapter({
    enabled: true,
    apiBaseUrl,
    getApiKey,
    persistGeneratedImage: async ({ base64, tenantId: providerTenantId }) => {
      const result = await objectStorage.put({
        key: `gpt-creative-prototype-base/${providerTenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`,
        body: Buffer.from(base64, "base64"),
        contentType: "image/png",
      });
      return result.url;
    },
  });

  const icaro = new IcaroAIBrain({
    providers: [
      new OpenAiIcaroImageProvider(openaiImageProvider),
      new OpenAiIcaroTextProvider({ apiBaseUrl, getApiKey }),
    ],
  });

  const referenceIntelligenceExtractor = new OpenAiReferenceIntelligenceExtractor({ apiBaseUrl, getApiKey });

  const deps = {
    icaro,
    objectStorage,
    referenceIntelligenceExtractor,
    compositeLogo: compositeLogoOntoImage,
    compositeScreenshot: compositeScreenshotIntoDeviceMockup,
    computeAssetSuitability: computeAssetSuitabilityScore,
    readImageDimensions: async (buffer) => {
      const meta = await sharp(buffer).metadata();
      return { width: meta.width, height: meta.height };
    },
  };

  // Assets do input podem vir como caminho de arquivo local (o usuário enviou um arquivo real —
  // logo oficial, screenshot do site) ou já como URL pública. Arquivo local é enviado ao object
  // storage primeiro, pra virar uma referência real que o GPT consegue "ver" (multimodal) e que o
  // compositor determinístico consegue baixar depois.
  const assets = [];
  for (const asset of rawInput.assets ?? []) {
    let url = asset.url;
    if (!url && asset.filePath) {
      const buffer = await readFile(resolve(asset.filePath));
      const uploaded = await objectStorage.put({
        key: `gpt-creative-prototype-input/${tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${asset.role}`,
        body: buffer,
        contentType: contentTypeFor(asset.filePath),
      });
      url = uploaded.url;
      console.log(`[gpt-creative-prototype] Asset "${asset.role}" enviado a partir de ${asset.filePath}: ${url}`);
    }
    if (!url) throw new Error(`Asset "${asset.role}" não tem "url" nem "filePath" válido.`);
    assets.push({ url, role: asset.role, description: asset.description ?? "" });
  }

  console.log(`[gpt-creative-prototype] Iniciando geração — marca="${rawInput.brandName}" formato="${rawInput.format}" assets=${assets.length}`);
  const startedAt = Date.now();
  const result = await runGptParallelCreativePrototype(deps, {
    tenantId,
    brandName: rawInput.brandName,
    objective: rawInput.objective,
    channel: rawInput.channel,
    format: rawInput.format,
    ideaText: rawInput.ideaText,
    assets,
    brandColors: rawInput.brandColors,
    forbiddenElements: rawInput.forbiddenElements,
    specialistId: "gpt-creative-prototype",
  });
  const durationMs = Date.now() - startedAt;

  console.log("\n=== creative_plan ===");
  console.log(JSON.stringify(result.creativePlan, null, 2));
  console.log("\n=== quality_gate ===");
  console.log(JSON.stringify(result.qualityGate, null, 2));
  console.log("\n=== resultado ===");
  console.log(JSON.stringify(
    {
      finalImageUrl: result.finalImageUrl,
      finalImageWidth: result.finalImageWidth,
      finalImageHeight: result.finalImageHeight,
      compositedAssetRoles: result.compositedAssetRoles,
      productRenderDecision: result.productRenderDecision,
      warnings: result.warnings,
      error: result.error,
      durationMs,
    },
    null,
    2,
  ));

  const outDir = resolve("scratch-gpt-prototype-output");
  await mkdir(outDir, { recursive: true });
  const outJsonPath = resolve(outDir, `result-${Date.now()}.json`);
  await writeFile(outJsonPath, JSON.stringify({ ...result, durationMs }, null, 2));
  console.log(`\n[gpt-creative-prototype] Resultado completo salvo em ${outJsonPath}`);

  if (result.error) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[gpt-creative-prototype] Falha inesperada:", error);
  process.exitCode = 1;
});
