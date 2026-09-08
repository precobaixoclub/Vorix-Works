import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — CRM/Comercial, Fase 1. `crm` (Contato 360°/Timeline/negócios/propostas)
 * é um bounded context deliberadamente separado de `inbox` (WhatsApp) e `instagram-dm` — a única
 * ligação entre eles é via `contact_identities`/`inbox_contacts.contact_id` a nível de BANCO
 * (migration 0092), nunca um import direto de código. Ver
 * `docs/crm-omnichannel-architecture-audit.md`, seção 4/14. Mesmo padrão de
 * `check-inbox-conversation-isolation.mjs`.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const CRM_FILE_PATTERNS = [
  /\/domain\/crm\//,
  /\/application\/crm\//,
  /\/ports\/contact-.*\.port\.ts$/,
  /\/ports\/timeline-event-repository\.port\.ts$/,
  /\/ports\/pipeline-repository\.port\.ts$/,
  /\/ports\/deal-repository\.port\.ts$/,
  /\/infrastructure\/storage\/postgres\/postgres-contact.*\.ts$/,
  /\/infrastructure\/storage\/postgres\/postgres-timeline-event-repository\.ts$/,
  /\/infrastructure\/storage\/postgres\/postgres-pipeline-repository\.ts$/,
  /\/infrastructure\/storage\/postgres\/postgres-deal-repository\.ts$/,
  /\/interfaces\/api\/routes\/v1\/contacts\.route\.ts$/,
  /\/interfaces\/api\/routes\/v1\/pipelines\.route\.ts$/,
  /\/interfaces\/api\/routes\/v1\/deals\.route\.ts$/,
];

const MESSAGING_FILE_PATTERNS = [
  /\/domain\/inbox\//,
  /\/application\/inbox\//,
  /\/application\/instagram-dm\//,
  /\/infrastructure\/messaging\//,
];

const CRM_IMPORT_MARKERS = ["/domain/crm/", "/application/crm/", "/ports/contact-", "/ports/timeline-event-repository", "/ports/pipeline-repository", "/ports/deal-repository", "/contacts.route.js", "/pipelines.route.js", "/deals.route.js"];
const MESSAGING_IMPORT_MARKERS = ["/domain/inbox/", "/application/inbox/", "/application/instagram-dm/", "/infrastructure/messaging/"];

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
    const isCrm = matchesAny(relPath, CRM_FILE_PATTERNS);
    const isMessaging = matchesAny(relPath, MESSAGING_FILE_PATTERNS);
    if (!isCrm && !isMessaging) continue;

    const content = await readFile(file, "utf8");
    const forbiddenMarkers = isCrm ? MESSAGING_IMPORT_MARKERS : CRM_IMPORT_MARKERS;

    for (const line of importLinesOf(content)) {
      const marker = forbiddenMarkers.find((candidate) => line.includes(candidate));
      if (marker) {
        violations.push(`${relPath}: ${isCrm ? "crm" : "inbox/instagram-dm"} importando "${marker}" (bounded context proibido — ver docs/crm-omnichannel-architecture-audit.md).`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-crm-isolation] Dependência cruzada entre crm e inbox/instagram-dm encontrada:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[check-crm-isolation] OK — crm permanece arquiteturalmente separado de inbox/instagram-dm (${files.length} arquivos verificados).`);
}

main().catch((error) => {
  console.error("[check-crm-isolation] Erro inesperado.", error);
  process.exitCode = 1;
});
