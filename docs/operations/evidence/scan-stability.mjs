// Estabilidade do BASE_TEXT_SCAN em bases digitais PERSISTIDAS — nenhuma geração de imagem.
// Roda DENTRO do zuno-api com o código deployado: mesmo caminho do runtime (flattenImageForVision →
// data URL → IcaroAIBrain/gpt-4o → novas tentativas espaçadas). Uso: node /tmp/scan-stability.mjs <urls.txt>
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const [listPath] = process.argv.slice(2);
const { loadApiConfig } = await import("/app/dist/interfaces/api/config/api-config.js");
const { buildApiContainer } = await import("/app/dist/interfaces/api/di/container.js");
const { IcaroAIBrain } = await import("/app/dist/application/ai/icaro-brain.js");
const { OpenAiIcaroTextProvider } = await import("/app/dist/infrastructure/ai-providers/openai-icaro-text-provider.js");
const { scanEditorialBaseText } = await import("/app/dist/application/creative-engine/editorial-base-checks.js");
const { flattenImageForVision } = await import("/app/dist/infrastructure/image-processing/image-alpha-coverage.js");
const config = loadApiConfig();
const container = buildApiContainer(config);
const getApiKey = async () => (await container.secretManager.get("ai-provider:openai").catch(() => undefined))?.value?.apiKey ?? config.mediaProviders.openaiApiKey;
// Mesmo cérebro de leitura do runtime (visionTextBrain, gpt-4.1), não uma instância própria.
const brain = container.visionTextBrain;
const base = config.objectStorage.publicBaseUrl.replace(/\/$/, "");
const urls = (await readFile(listPath, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean);
const rows = [];
for (const url of urls) {
  const key = decodeURIComponent(url.slice(base.length + 1));
  const bytes = await container.objectStorage.read(key, { maxBytes: 20 * 1024 * 1024 });
  const attempts = [];
  let cost = 0;
  const icaro = {
    request: async (request) => {
      const response = await brain.request(request);
      const message = response.error?.message ?? "";
      attempts.push(response.status === "completed" ? "COMPLETED" : /recusou/i.test(message) ? "PROVIDER_REFUSAL" : /não retornou conteúdo/i.test(message) ? "EMPTY_RESPONSE" : `TRANSIENT_OR_OTHER:${response.error?.kind ?? "?"}`);
      return response;
    },
  };
  const started = Date.now();
  const flat = await flattenImageForVision(bytes);
  const scan = await scanEditorialBaseText(icaro, { baseImageUrl: url, baseImageBuffer: flat, specialistId: "gpt-creative-director", onCost: (r) => { cost += r?.cost?.estimated ?? 0; } });
  const row = {
    asset: key.split("/").pop(),
    sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    status: scan.status,
    latencyMs: Date.now() - started,
    attempts,
    classification: scan.status === "AVAILABLE" ? (attempts.length > 1 ? "AVAILABLE_AFTER_RETRY" : "AVAILABLE") : attempts.at(-1),
    detectedTexts: scan.texts.length,
    providerRefusals: attempts.filter((a) => a === "PROVIDER_REFUSAL").length,
    emptyMisclassified: attempts.filter((a) => a === "EMPTY_RESPONSE").length,
    costUsd: Number(cost.toFixed(5)),
    ...(scan.reason ? { reason: scan.reason.slice(0, 160) } : {}),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const available = rows.filter((row) => row.status === "AVAILABLE").length;
console.log(JSON.stringify({ SUMMARY: true, samples: rows.length, available, notAvailable: rows.length - available, providerRefusals: rows.reduce((n, r) => n + r.providerRefusals, 0), emptyMisclassified: rows.reduce((n, r) => n + r.emptyMisclassified, 0), successRate: Number((available / rows.length).toFixed(3)), totalCostUsd: Number(rows.reduce((n, r) => n + r.costUsd, 0).toFixed(4)) }));
process.exit(0);
