import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — Sprint 07 (Fase 16). O domínio `Chat` (Sprint 02, nunca ligado a um
 * endpoint real) foi substituído por `Conversation`/`Briefing` (Sprint 06/07) e está marcado
 * `@deprecated`. Este script falha o build se QUALQUER arquivo fora da allowlist abaixo importar
 * um dos módulos legados — a única forma de garantir "nenhum consumidor novo" sem depender de
 * revisão manual em toda PR futura.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const LEGACY_IMPORT_MARKERS = ["/domain/chat/chat.model.js", "/ports/chat-repository.port.js", "/in-memory-chat-repository.js", "/postgres-chat-repository.js"];

const ALLOWLIST = new Set([
  "src/domain/chat/chat.model.ts",
  "src/application/ports/chat-repository.port.ts",
  "src/infrastructure/storage/in-memory-chat-repository.ts",
  "src/infrastructure/storage/postgres/postgres-chat-repository.ts",
  "src/infrastructure/storage/build-platform-repositories.ts",
  "src/interfaces/api/di/container.ts",
]);

async function listTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const files = await listTsFiles(srcRoot);
  const violations = [];

  for (const file of files) {
    const relPath = relative(projectRoot, file).replace(/\\/g, "/");
    if (ALLOWLIST.has(relPath)) continue;

    const content = await readFile(file, "utf8");
    const importLines = content.split("\n").filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line));

    for (const line of importLines) {
      const marker = LEGACY_IMPORT_MARKERS.find((candidate) => line.includes(candidate));
      if (marker) {
        violations.push(`${relPath}: importa "${marker}" fora da allowlist do Chat legado.`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-legacy-chat-imports] Novos consumidores do domínio Chat (deprecated) encontrados:");
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error('\nO domínio Chat foi substituído por Conversation/Briefing (Sprint 06/07). Se isto é intencional, adicione o arquivo à ALLOWLIST em scripts/check-legacy-chat-imports.mjs com uma justificativa.');
    process.exitCode = 1;
    return;
  }

  console.log(`[check-legacy-chat-imports] OK — nenhum consumidor novo do Chat legado (${files.length} arquivos verificados).`);
}

main().catch((error) => {
  console.error("[check-legacy-chat-imports] Erro inesperado.", error);
  process.exitCode = 1;
});
