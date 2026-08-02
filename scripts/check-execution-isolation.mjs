import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — Sprint 12. O domínio/application de Execution e os repositórios de
 * persistência não podem importar o pipeline legado nem qualquer camada capaz de efeitos externos
 * reais. Adaptadores reais ficam restritos a infrastructure/execution.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const EXECUTION_FILE_PATTERNS = [/\/domain\/execution\//, /\/application\/execution\//, /\/infrastructure\/storage\/in-memory-execution-repository\.ts$/, /\/infrastructure\/storage\/postgres\/postgres-execution-repository\.ts$/];

const FORBIDDEN_IMPORT_MARKERS = [
  "/application/orchestration/",
  "/application/workflows/",
  "/application/skills/",
  "/domain/skills/",
  "/application/ai-gateway/",
  "/infrastructure/ai-gateway/",
  "/infrastructure/ai/",
  "/skills/",
  "@anthropic-ai/sdk",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:child_process",
];

const FORBIDDEN_RUNTIME_MARKERS = ["fetch(", "http://", "https://", "executeSkill", "CaioWorkflowExecutor", "HelenaSkillManager", "SocialPublisher", ".publish(", "publishContent"];

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

function isExecutionFile(path) {
  const normalized = path.replace(/\\/g, "/");
  return EXECUTION_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function importLinesOf(content) {
  return content.split("\n").filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line));
}

async function main() {
  const files = await listTsFiles(srcRoot);
  const violations = [];

  for (const file of files) {
    const relPath = relative(projectRoot, file).replace(/\\/g, "/");
    if (!isExecutionFile(relPath)) continue;
    const content = await readFile(file, "utf8");

    for (const line of importLinesOf(content)) {
      const marker = FORBIDDEN_IMPORT_MARKERS.find((candidate) => line.includes(candidate));
      if (marker) violations.push(`${relPath}: import proibido "${marker}" em Execution.`);
    }

    for (const marker of FORBIDDEN_RUNTIME_MARKERS) {
      if (content.includes(marker)) violations.push(`${relPath}: marcador proibido "${marker}" em Execution.`);
    }
  }

  if (violations.length > 0) {
    console.error("[check-execution-isolation] Violação de isolamento do Execution:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log("[check-execution-isolation] OK — Execution permanece isolado de Caio/Helena/Skills/AI/rede/publicação fora dos adaptadores de infrastructure.");
}

main().catch((error) => {
  console.error("[check-execution-isolation] Erro inesperado.", error);
  process.exitCode = 1;
});
