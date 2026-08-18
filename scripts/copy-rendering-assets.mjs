import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Copia os assets do Performance Creative Engine (fontes .ttf usadas pelo Satori pra calcular
// layout de texto — ver `src/infrastructure/rendering/ad-creative-renderer.ts`) de `src/` para
// `dist/`, mesmo espírito de `copy-skill-manifests.mjs`/`copy-remotion-assets.mjs`. `tsc` nunca
// copia arquivos binários; sem este passo, `dist/infrastructure/rendering/assets/` ficaria vazio e
// o renderer não encontraria a fonte em tempo de execução.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "src", "infrastructure", "rendering", "assets");
const targetDir = join(projectRoot, "dist", "infrastructure", "rendering", "assets");

async function main() {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("[copy-rendering-assets] Nenhuma pasta de assets de renderização encontrada; nada a copiar.");
      return;
    }
    throw error;
  }

  await mkdir(targetDir, { recursive: true });
  const copied = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ttf")) continue;
    const targetFile = join(targetDir, entry.name);
    await copyFile(join(sourceDir, entry.name), targetFile);
    copied.push(targetFile);
  }

  console.log(`[copy-rendering-assets] ${copied.length} fonte(s) .ttf copiada(s) para dist/infrastructure/rendering/assets.`);
  for (const file of copied) {
    console.log(`  - ${relative(projectRoot, file)}`);
  }
}

main().catch((error) => {
  console.error("[copy-rendering-assets] Falha ao copiar assets de renderização.", error);
  process.exitCode = 1;
});
