import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — Sprint 10 (decisões obrigatórias 1/2/3/4). O domínio `Runtime`
 * (`src/domain/runtime/*`, `src/application/runtime/*`, `src/infrastructure/runtime/*`) é
 * TOTALMENTE independente do pipeline legado de execução (`src/application/orchestration/*`
 * — Arthur/ExecutionPlan —, `src/application/workflows/*` — Caio —, `src/application/skills/*`
 * — Helena —, `src/domain/skills/*` — contrato de Skill/SkillCapability). Nenhum dos dois lados
 * pode importar do outro — nunca. Runtime PODE importar do domínio Planning (Sprint 09) — isso é
 * intencional (Runtime traduz um Planning), só o lado legado é proibido dos dois lados. Este
 * script falha o build se isso acontecer.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const RUNTIME_FILE_PATTERNS = [/\/domain\/runtime\//, /\/application\/runtime\//, /\/infrastructure\/runtime\//];

const LEGACY_FILE_PATTERNS = [/\/application\/orchestration\//, /\/application\/workflows\//, /\/application\/skills\//, /\/domain\/skills\//];

const LEGACY_IMPORT_MARKERS = ["/application/orchestration/", "/application/workflows/", "/application/skills/", "/domain/skills/"];

const RUNTIME_IMPORT_MARKERS = ["/domain/runtime/", "/application/runtime/", "/infrastructure/runtime/"];

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
    const isRuntime = matchesAny(relPath, RUNTIME_FILE_PATTERNS);
    const isLegacy = matchesAny(relPath, LEGACY_FILE_PATTERNS);
    if (!isRuntime && !isLegacy) continue;

    const content = await readFile(file, "utf8");
    const forbiddenMarkers = isRuntime ? LEGACY_IMPORT_MARKERS : RUNTIME_IMPORT_MARKERS;

    for (const line of importLinesOf(content)) {
      const marker = forbiddenMarkers.find((candidate) => line.includes(candidate));
      if (marker) {
        violations.push(`${relPath}: ${isRuntime ? "Runtime" : "pipeline legado"} importando "${marker}" (nunca permitido — ver decisões obrigatórias da Sprint 10).`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-runtime-isolation] Dependência cruzada entre Runtime e o pipeline legado (Arthur/Helena/Caio/Skills) encontrada:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[check-runtime-isolation] OK — Runtime e o pipeline legado (Arthur/Helena/Caio/Skills) permanecem totalmente separados (${files.length} arquivos verificados).`);
}

main().catch((error) => {
  console.error("[check-runtime-isolation] Erro inesperado.", error);
  process.exitCode = 1;
});
