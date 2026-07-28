import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HelenaSkillManager } from "../dist/application/skills/helena.manager.js";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { SkillRegistry } from "../dist/application/skills/skill-registry.js";
import { FileSystemSkillDiscovery } from "../dist/infrastructure/skills/file-system-skill-discovery.js";
import { FileSystemSkillModuleLoader } from "../dist/infrastructure/skills/file-system-skill-module-loader.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(projectRoot, "dist", "skills");

const EXPECTED_SKILLS = [
  { id: "eduardo-editorial-planning", capability: "editorial_planning" },
  { id: "maria-copywriting", capability: "copywriting" },
  { id: "joao-marketing-strategy", capability: "strategy" },
  { id: "joao-marketing-strategy", capability: "marketing_strategy" },
  { id: "sofia-art-direction", capability: "art_direction" },
  { id: "bianca-social-media-design", capability: "social_media_design" },
  { id: "pedro-image-generation", capability: "image_generation" },
  { id: "lucas-quality-review", capability: "quality_review" },
  { id: "ana-social-publishing", capability: "social_publishing" },
  { id: "bruno-video-script", capability: "video_script" },
  { id: "vanessa-video-direction", capability: "video_direction" },
  { id: "diego-video-editing", capability: "video_editing" },
  { id: "nora-video-narration", capability: "video_narration" },
  { id: "rafa-video-rendering", capability: "video_rendering" },
];

async function main() {
  const failures = [];
  const registry = new SkillRegistry();
  const helena = new HelenaSkillManager({
    discovery: new FileSystemSkillDiscovery({ rootDirectories: [skillsRoot] }),
    loader: new FileSystemSkillModuleLoader({ runtimeDependencies: {} }),
    validator: new SkillManifestValidator(),
    registry,
  });

  const records = await helena.discoverAndLoadSkills();
  console.log(`[verify-skills-discovery] ${records.length} Skill(s) descoberta(s) em dist/skills.`);
  for (const record of records) {
    console.log(`  - ${record.manifest?.id ?? record.source.sourceId}: estado=${record.state}, capabilities=${record.manifest?.capabilities?.join(", ") ?? "-"}`);
  }

  if (records.length === 0) {
    failures.push("Nenhuma Skill foi descoberta em dist/skills. Rode \"npm run build\" antes de validar.");
  }

  for (const record of records) {
    if (record.manifest?.id === "future-skill-id" || record.manifest?.id?.startsWith("_")) {
      failures.push(`Skill de template não deveria ter sido carregada: ${record.manifest?.id ?? record.source.sourceId}.`);
    }
    if (record.state === "FAILED") {
      failures.push(`Skill ${record.manifest?.id ?? record.source.sourceId} falhou ao carregar: ${record.validationErrors.join("; ")}`);
    }
  }

  for (const expected of EXPECTED_SKILLS) {
    const found = await helena.findSkillByCapability(expected.capability);
    if (found?.manifest?.id !== expected.id) {
      failures.push(`Esperava encontrar "${expected.id}" pela capability "${expected.capability}", mas encontrou "${found?.manifest?.id ?? "nenhuma Skill"}".`);
      continue;
    }
    console.log(`[verify-skills-discovery] capability "${expected.capability}" -> ${found.manifest.id} (OK)`);
  }

  if (failures.length > 0) {
    console.error("\n[verify-skills-discovery] Falhas encontradas:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("\n[verify-skills-discovery] Descoberta real de Skills validada com sucesso.");
}

main().catch((error) => {
  console.error("[verify-skills-discovery] Erro inesperado ao validar a descoberta de Skills.", error);
  process.exitCode = 1;
});
