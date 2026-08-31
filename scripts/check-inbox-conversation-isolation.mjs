import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guarda de arquitetura — Módulo Conversas, Fase 5. `inbox` (WhatsApp via WuzAPI) e `conversation`/
 * `chat` (chat interno do Arthur/briefing) são bounded contexts deliberadamente separados desde a
 * Fase 1 (ver o comentário no topo de `src/domain/inbox/inbox.model.ts`) — mas, até a Fase 5,
 * nenhum script automatizado verificava isso; era só convenção. Espelha exatamente o padrão de
 * `check-ai-stack-isolation.mjs`: classifica arquivo por caminho, grepa linhas de import, falha o
 * build se um lado importar o outro.
 *
 * A IA de Atendimento (Fase 5) tornou essa checagem mais importante, não menos: `inbox` ganhou uma
 * dependência NOVA e LEGÍTIMA em `InboxAiResponderPort`/AI Gateway — o risco real é alguém, sob
 * pressão de prazo, "resolver rápido" reaproveitando algo de `conversation` (ex.: o motor de
 * intenção do Arthur) em vez de generalizar via porta própria. Este script continua sem restringir
 * nada sobre `inbox` ↔ AI Gateway (essa composição é esperada e correta).
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

const INBOX_FILE_PATTERNS = [
  /\/domain\/inbox\//,
  /\/application\/inbox\//,
  /\/ports\/inbox-.*\.port\.ts$/,
  /\/ports\/messaging-connection-repository\.port\.ts$/,
  /\/ports\/messaging-provider\.port\.ts$/,
  /\/ports\/outbound-message-queue\.port\.ts$/,
  /\/infrastructure\/messaging\//,
  /\/infrastructure\/storage\/.*inbox.*\.ts$/,
  /\/infrastructure\/storage\/.*messaging-connection.*\.ts$/,
  /\/interfaces\/worker\/inbox-worker\.ts$/,
  /\/interfaces\/api\/routes\/v1\/inbox\.route\.ts$/,
];

const CONVERSATION_FILE_PATTERNS = [/\/domain\/conversation\//, /\/application\/conversation\//, /\/domain\/chat\//, /\/application\/chat\//, /\/ports\/conversation-.*\.port\.ts$/];

const INBOX_IMPORT_MARKERS = ["/domain/inbox/", "/application/inbox/", "/ports/inbox-", "/infrastructure/messaging/", "inbox-worker.js", "/inbox.route.js"];

const CONVERSATION_IMPORT_MARKERS = ["/domain/conversation/", "/application/conversation/", "/domain/chat/", "/application/chat/", "/ports/conversation-"];

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
    const isInbox = matchesAny(relPath, INBOX_FILE_PATTERNS);
    const isConversation = matchesAny(relPath, CONVERSATION_FILE_PATTERNS);
    if (!isInbox && !isConversation) continue;

    const content = await readFile(file, "utf8");
    const forbiddenMarkers = isInbox ? CONVERSATION_IMPORT_MARKERS : INBOX_IMPORT_MARKERS;

    for (const line of importLinesOf(content)) {
      const marker = forbiddenMarkers.find((candidate) => line.includes(candidate));
      if (marker) {
        violations.push(`${relPath}: ${isInbox ? "inbox" : "conversation/chat"} importando "${marker}" (bounded context proibido — ver src/domain/inbox/inbox.model.ts).`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-inbox-conversation-isolation] Dependência cruzada entre inbox e conversation/chat encontrada:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[check-inbox-conversation-isolation] OK — inbox e conversation/chat permanecem arquiteturalmente separados (${files.length} arquivos verificados).`);
}

main().catch((error) => {
  console.error("[check-inbox-conversation-isolation] Erro inesperado.", error);
  process.exitCode = 1;
});
