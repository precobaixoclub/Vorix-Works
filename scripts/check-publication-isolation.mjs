import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DOMAIN_DIR = path.join(ROOT, "src", "domain", "publication");
const APPLICATION_DIR = path.join(ROOT, "src", "application", "publication");
const EXECUTION_DIRS = [path.join(ROOT, "src", "domain", "execution"), path.join(ROOT, "src", "application", "execution")];

const FORBIDDEN_PUBLICATION_MARKERS = [
  "helena",
  "skills",
  "ai-gateway",
  "@anthropic-ai",
  "MetaInstagramSocialPublisherAdapter",
  "fetch(",
  "SocialPublisherPort",
  "execution-engine",
];

function walk(dir) {
  if (!statExists(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") || full.endsWith(".mjs") ? [full] : [];
  });
}

function statExists(file) {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

const violations = [];

for (const file of walk(DOMAIN_DIR)) {
  const text = readFileSync(file, "utf8");
  if (text.includes("../execution") || text.includes("/execution/")) {
    violations.push(`${path.relative(ROOT, file)}: domínio Publication não pode importar Execution.`);
  }
}

for (const file of walk(APPLICATION_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const marker of FORBIDDEN_PUBLICATION_MARKERS) {
    if (text.includes(marker)) violations.push(`${path.relative(ROOT, file)}: application Publication contém marcador proibido "${marker}".`);
  }
}

for (const dir of EXECUTION_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    if (text.includes("../publication") || text.includes("/publication/")) {
      violations.push(`${path.relative(ROOT, file)}: Execution não pode importar Publication.`);
    }
  }
}

if (violations.length > 0) {
  console.error("[check-publication-isolation] Violações encontradas:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[check-publication-isolation] OK — Publication isolado de Execution/Helena/Skills/AI/providers reais.");
