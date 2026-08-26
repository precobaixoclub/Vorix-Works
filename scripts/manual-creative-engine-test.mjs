// Script de verificação manual, standalone — roda dentro do container de produção (docker exec)
// reusando os MESMOS componentes reais do container.ts (nunca reimplementa nada), pra confirmar
// se a geração volta a funcionar depois de recarregar os créditos da OpenAI, sem depender de o
// usuário clicar em "gerar" na UI. Nunca integrado ao pipeline principal, nunca lê/imprime chave
// de API (a chave só passa pela função getApiKey, resolvida via PostgresSecretManager, igual ao
// container.ts real).
//
// Uso: docker exec zuno-zuno-api-1 node scripts/manual-creative-engine-test.mjs <workspaceId>
import sharp from "sharp";
import pg from "pg";

import { PostgresSecretManager } from "../dist/infrastructure/operations/postgres-secret-manager.js";
import { IcaroAIBrain } from "../dist/application/ai/icaro-brain.js";
import { OpenAiCreativeImageProvider } from "../dist/infrastructure/ai-providers/openai-creative-image-provider.js";
import { OpenAiIcaroTextProvider } from "../dist/infrastructure/ai-providers/openai-icaro-text-provider.js";
import { OpenAiImageProviderAdapter } from "../dist/infrastructure/ai-providers/openai-image-provider-adapter.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { compositeLogoOntoImage } from "../dist/infrastructure/media/logo-compositor.js";
import { compositeScreenshotIntoDeviceMockup } from "../dist/infrastructure/media/screenshot-mockup-compositor.js";
import { renderCreativePlanTextZones } from "../dist/infrastructure/rendering/render-creative-plan-text-zones.js";
import { computeAssetSuitabilityScore } from "../dist/infrastructure/image-processing/product-background.js";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";

async function main() {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    console.error("Uso: node scripts/manual-creative-engine-test.mjs <workspaceId>");
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Mesmo shape real de CreativeContext já usado nas execuções reais deste workspace — lido
  // diretamente da última execução real (nunca inventado), pra reproduzir fielmente.
  const { rows } = await pool.query(
    `select creative_context from creative_engine_runs where workspace_id = $1 order by created_at desc limit 1`,
    [workspaceId],
  );
  if (rows.length === 0) {
    console.error(`Nenhum creative_engine_runs encontrado para workspaceId=${workspaceId}.`);
    process.exitCode = 1;
    return;
  }
  const creativeContext = rows[0].creative_context;
  const tenantId = "tenant-vorix";

  const secretManager = new PostgresSecretManager(pool, process.env.JWT_SECRET);
  const getApiKey = async () => {
    const stored = await secretManager.get("ai-provider:openai").catch(() => undefined);
    return stored?.value?.apiKey;
  };

  const objectStorage = new LocalObjectStorage({
    rootDir: process.env.OBJECT_STORAGE_LOCAL_DIR?.trim() || "/app/uploads",
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim() || "https://api.vorixworks.com/uploads",
  });

  const openaiImageProvider = new OpenAiImageProviderAdapter({
    enabled: true,
    getApiKey,
    persistGeneratedImage: async ({ base64, tenantId: t }) => {
      const result = await objectStorage.put({
        key: `manual-creative-engine-test/${t}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`,
        body: Buffer.from(base64, "base64"),
        contentType: "image/png",
      });
      return result.url;
    },
  });

  const creativeIcaro = new IcaroAIBrain({
    providers: [
      new OpenAiCreativeImageProvider(openaiImageProvider),
      new OpenAiIcaroTextProvider({ getApiKey, modelId: "gpt-4o" }),
    ],
  });

  const deps = {
    creativeBrain: creativeIcaro,
    objectStorage,
    compositeLogo: compositeLogoOntoImage,
    compositeScreenshot: compositeScreenshotIntoDeviceMockup,
    renderTextZones: renderCreativePlanTextZones,
    computeAssetSuitability: computeAssetSuitabilityScore,
    readImageDimensions: async (buffer) => {
      const meta = await sharp(buffer).metadata();
      return { width: meta.width, height: meta.height };
    },
  };

  const runId = `manual-test-${Date.now().toString(36)}`;
  console.log(`[manual-creative-engine-test] Iniciando — workspaceId=${workspaceId} runId=${runId}`);
  const startedAt = Date.now();
  const result = await runGptCreativeEngine(deps, {
    executionRunId: runId,
    creativeEngineRunId: `cer-${runId}`,
    tenantId,
    workspaceId,
    creativeContext,
  });
  const durationMs = Date.now() - startedAt;

  console.log("\n=== creative_plan ===");
  console.log(JSON.stringify(result.creativePlan, null, 2));

  console.log("\n=== resultado ===");
  console.log(JSON.stringify({
    publishable: result.publishable,
    error: result.error,
    errorCode: result.errorCode,
    finalImageUrl: result.finalImageUrl,
    repairRoundsCount: result.repairRounds.length,
    qualityGateVerdict: result.qualityGate?.verdict,
    qualityGateIssues: result.qualityGate?.issues,
    estimatedCostUsd: result.estimatedCostUsd,
    durationMs,
  }, null, 2));

  await pool.end();
  if (!result.publishable) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[manual-creative-engine-test] Falha inesperada:", error);
  process.exitCode = 1;
});
