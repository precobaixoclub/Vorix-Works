import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_FILE_NAME = "skill.manifest.json";
// Mesmo prefixo padrão ignorado por FileSystemSkillDiscovery, para que uma pasta de
// template nunca vire uma Skill "real" em dist mesmo que ganhe um manifesto no futuro.
const IGNORE_DIRECTORIES_STARTING_WITH = "_";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "src", "skills");
const targetRoot = join(projectRoot, "dist", "skills");

async function copyManifestsRecursively(sourceDir, targetDir) {
  const copiedFiles = [];
  let entries;

  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return copiedFiles;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(IGNORE_DIRECTORIES_STARTING_WITH)) continue;
      const nested = await copyManifestsRecursively(join(sourceDir, entry.name), join(targetDir, entry.name));
      copiedFiles.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name === MANIFEST_FILE_NAME) {
      await mkdir(targetDir, { recursive: true });
      const targetFile = join(targetDir, entry.name);
      await copyFile(join(sourceDir, entry.name), targetFile);
      copiedFiles.push(targetFile);
    }
  }

  return copiedFiles;
}

async function main() {
  const copied = await copyManifestsRecursively(sourceRoot, targetRoot);
  console.log(`[copy-skill-manifests] ${copied.length} manifesto(s) copiado(s) para dist/skills.`);
  for (const file of copied) {
    console.log(`  - ${relative(projectRoot, file)}`);
  }
}

main().catch((error) => {
  console.error("[copy-skill-manifests] Falha ao copiar manifestos de Skills.", error);
  process.exitCode = 1;
});
