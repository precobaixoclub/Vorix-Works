// Aplica o "prompt criativo específico" às pautas existentes do bolsão, casando por external_id
// dentro de um workspace. ATUALIZA só a coluna creative_prompt — nunca toca em título, legenda,
// CTA, categoria, datas, status ou qualquer conteúdo já aprovado. Chamadas/legendas recomendadas
// do arquivo ficam como sugestão (ignoradas aqui, não sobrescrevem nada).
//
// Formato de entrada: o JSON de atualização { records: [{ id_externo, prompt_criativo }, ...] }.
// Fonte dos registros: um caminho de arquivo (argumento) OU globalThis.RECORDS (quando o script é
// canalizado para dentro do contêiner). O banco vem de process.env.DATABASE_URL.
//
//   node scripts/editorial/apply-creative-prompts.mjs <arquivo.json> --workspace <id> [--apply]
//
// Sem --apply é dry-run: não grava nada, só mostra o relatório (casadas, faltando, que mudariam).
import { readFile } from "node:fs/promises";
import pg from "pg";

const PROMPT_LIMIT = 8000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function loadRecords() {
  if (Array.isArray(globalThis.RECORDS)) return globalThis.RECORDS;
  if (globalThis.RECORDS && Array.isArray(globalThis.RECORDS.records)) return globalThis.RECORDS.records;
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && /\.json$/i.test(a));
  if (!file) throw new Error("informe o caminho do JSON (ou defina globalThis.RECORDS).");
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error("JSON sem array 'records'.");
  return records;
}

const workspaceId = arg("workspace");
const apply = process.argv.includes("--apply");
if (!workspaceId) throw new Error("informe --workspace <id>.");

const records = await loadRecords();
// id_externo -> prompt (apenas registros com prompt não vazio; prompt longo demais é reportado).
const wanted = new Map();
const tooLong = [];
const noPrompt = [];
for (const r of records) {
  const id = String(r.id_externo ?? r.externalId ?? "").trim();
  const prompt = typeof (r.prompt_criativo ?? r.creativePrompt) === "string" ? (r.prompt_criativo ?? r.creativePrompt).trim() : "";
  if (!id) continue;
  if (!prompt) { noPrompt.push(id); continue; }
  if (prompt.length > PROMPT_LIMIT) { tooLong.push({ id, length: prompt.length }); continue; }
  wanted.set(id, prompt);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const existing = new Map(
  (await pool.query("select external_id, creative_prompt from editorial_ideas where workspace_id = $1", [workspaceId])).rows.map((row) => [row.external_id, row.creative_prompt]),
);

const missing = []; // no arquivo, mas não existe no workspace
const unchanged = []; // já tem exatamente o mesmo prompt
const toUpdate = []; // vai gravar/alterar
for (const [id, prompt] of wanted) {
  if (!existing.has(id)) { missing.push(id); continue; }
  if (existing.get(id) === prompt) { unchanged.push(id); continue; }
  toUpdate.push({ id, prompt });
}

let updated = 0;
if (apply && toUpdate.length) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const { id, prompt } of toUpdate) {
      const res = await client.query(
        "update editorial_ideas set creative_prompt = $3, updated_at = now() where workspace_id = $1 and external_id = $2",
        [workspaceId, id, prompt],
      );
      updated += res.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();

const report = {
  mode: apply ? "APPLY" : "DRY-RUN",
  workspaceId,
  recordsInFile: records.length,
  promptsInFile: wanted.size,
  expectedMatches: wanted.size,
  matchedInWorkspace: wanted.size - missing.length,
  willUpdate: toUpdate.length,
  updated,
  unchanged: unchanged.length,
  missing: missing.length,
  recordsWithoutPrompt: noPrompt.length,
  tooLong: tooLong.length,
  missingIds: missing.slice(0, 20),
  tooLongIds: tooLong.slice(0, 20),
};
console.log("CREATIVE_PROMPT_REPORT " + JSON.stringify(report, null, 2));
if (missing.length) console.log("ATENÇÃO: external_ids no arquivo sem correspondência no workspace:", missing.join(", "));
if (tooLong.length) console.log("ATENÇÃO: prompts acima do limite (não aplicados):", tooLong.map((t) => `${t.id}(${t.length})`).join(", "));
