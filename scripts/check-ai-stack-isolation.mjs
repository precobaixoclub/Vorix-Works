import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — Sprint 08 (decisão obrigatória 4). O Zuno tem DUAS pilhas de IA
 * independentes por design:
 *
 * - ÍCARO (`src/application/ai/*`, `src/application/ports/ai-provider.port.ts`,
 *   `src/infrastructure/ai/developer-assisted-icaro-provider.ts`/`deterministic-fake-icaro-
 *   provider.ts`) — serve as 11 Skills de conteúdo (Maria, Pedro, Sofia...). Continua 100%
 *   fake/developer-assisted nesta sprint; NÃO foi tocado.
 * - AI GATEWAY (`src/application/ai-gateway/*`, `src/infrastructure/ai-gateway/*`,
 *   `src/application/ports/ai-gateway.port.ts` e portas irmãs, `src/infrastructure/ai/anthropic-
 *   ai-model-provider.ts`/`fake-ai-model-provider.ts`/`not-configured-ai-gateway.ts`) — serve
 *   Conversation/Briefing. Ganhou o primeiro provider real (Anthropic) nesta sprint.
 *
 * Nenhuma das duas pode importar da outra — nunca. Este script falha o build se isso acontecer.
 * Ver `src/application/ai-gateway/README.md` para o raciocínio completo.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const ICARO_FILE_PATTERNS = [/\/application\/ai\//, /\/ports\/ai-provider\.port\.ts$/, /\/infrastructure\/ai\/developer-assisted-icaro-provider\.ts$/, /\/infrastructure\/ai\/deterministic-fake-icaro-provider\.ts$/];

const GATEWAY_FILE_PATTERNS = [
  /\/application\/ai-gateway\//,
  /\/infrastructure\/ai-gateway\//,
  /\/ports\/ai-gateway\.port\.ts$/,
  /\/ports\/ai-model-provider\.port\.ts$/,
  /\/ports\/ai-circuit-breaker\.port\.ts$/,
  /\/ports\/ai-rate-limiter\.port\.ts$/,
  /\/ports\/ai-telemetry\.port\.ts$/,
  /\/ports\/ai-execution-repository\.port\.ts$/,
  /\/infrastructure\/ai\/anthropic-ai-model-provider\.ts$/,
  /\/infrastructure\/ai\/fake-ai-model-provider\.ts$/,
  /\/infrastructure\/ai\/not-configured-ai-gateway\.ts$/,
];

const ICARO_IMPORT_MARKERS = ["/application/ai/", "/ports/ai-provider.port.js", "/developer-assisted-icaro-provider.js", "/deterministic-fake-icaro-provider.js"];

const GATEWAY_IMPORT_MARKERS = [
  "/application/ai-gateway/",
  "/infrastructure/ai-gateway/",
  "/ports/ai-gateway.port.js",
  "/ports/ai-model-provider.port.js",
  "/ports/ai-circuit-breaker.port.js",
  "/ports/ai-rate-limiter.port.js",
  "/ports/ai-telemetry.port.js",
  "/ports/ai-execution-repository.port.js",
  "/anthropic-ai-model-provider.js",
  "/fake-ai-model-provider.js",
  "/not-configured-ai-gateway.js",
];

async function listTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listTsFiles(fullPath)));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path.replace(/\\/g, "/")));
}

function importLinesOf(content) {
  return content.split("\n").filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line));
}

async function main() {
  const files = await listTsFiles(srcRoot);
  const violations = [];

  for (const file of files) {
    const relPath = relative(projectRoot, file).replace(/\\/g, "/");
    const isIcaro = matchesAny(relPath, ICARO_FILE_PATTERNS);
    const isGateway = matchesAny(relPath, GATEWAY_FILE_PATTERNS);
    if (!isIcaro && !isGateway) continue;

    const content = await readFile(file, "utf8");
    const forbiddenMarkers = isIcaro ? GATEWAY_IMPORT_MARKERS : ICARO_IMPORT_MARKERS;

    for (const line of importLinesOf(content)) {
      const marker = forbiddenMarkers.find((candidate) => line.includes(candidate));
      if (marker) {
        violations.push(`${relPath}: ${isIcaro ? "Ícaro" : "AI Gateway"} importando "${marker}" (pilha de IA proibida — ver src/application/ai-gateway/README.md).`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-ai-stack-isolation] Dependência cruzada entre as duas pilhas de IA encontrada:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[check-ai-stack-isolation] OK — Ícaro e AI Gateway permanecem arquiteturalmente separados (${files.length} arquivos verificados).`);
}

main().catch((error) => {
  console.error("[check-ai-stack-isolation] Erro inesperado.", error);
  process.exitCode = 1;
});
