import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Copia os arquivos-fonte da composição Remotion (.jsx — deliberadamente fora do `include` do
// tsconfig principal, ver `src/infrastructure/motion-rendering/remotion-motion-render-provider.ts`)
// de `src/` para `dist/`, no mesmo espírito de `copy-skill-manifests.mjs` para `skill.manifest.json`.
// O `tsc` nunca compila/copia `.jsx`; sem este passo, `dist/infrastructure/motion-rendering/remotion/`
// ficaria vazio e o adapter Remotion não encontraria seu próprio entry point em tempo de execução.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "src", "infrastructure", "motion-rendering", "remotion");
const targetDir = join(projectRoot, "dist", "infrastructure", "motion-rendering", "remotion");

async function main() {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("[copy-remotion-assets] Nenhuma pasta de composição Remotion encontrada; nada a copiar.");
      return;
    }
    throw error;
  }

  await mkdir(targetDir, { recursive: true });
  const copied = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsx")) continue;
    const targetFile = join(targetDir, entry.name);
    await copyFile(join(sourceDir, entry.name), targetFile);
    copied.push(targetFile);
  }

  console.log(`[copy-remotion-assets] ${copied.length} arquivo(s) .jsx copiado(s) para dist/infrastructure/motion-rendering/remotion.`);
  for (const file of copied) {
    console.log(`  - ${relative(projectRoot, file)}`);
  }
}

main().catch((error) => {
  console.error("[copy-remotion-assets] Falha ao copiar composição Remotion.", error);
  process.exitCode = 1;
});
