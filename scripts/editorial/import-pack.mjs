// Importa um pacote de pautas (vorix.editorial-pack/v1) direto no bolsão de um workspace.
// Mesma validação e mesma regra da rota POST /v1/editorial-ideas/import: pauta com `id` que já
// existe no workspace é ignorada (nunca duplica nem sobrescreve o trabalho editorial já feito).
//
// Uso (dentro do contêiner da API, que já tem DATABASE_URL):
//   node scripts/editorial/import-pack.mjs --workspace "Vorix Works"              # só mostra o que faria
//   node scripts/editorial/import-pack.mjs --workspace "Vorix Works" --apply      # importa
//   ... --apply --calendar                                                         # e monta 30 dias úteis
// Opções: --pack <arquivo.json> (padrão: vorix-works-pautas.json ao lado deste script),
//         --workspace-id <id> quando o nome não for único, --start AAAA-MM-DD.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildEditorialCalendar, isIsoDate, parseEditorialPack } from "../../dist/domain/editorial/editorial-idea.model.js";
import { PostgresEditorialIdeaRepository } from "../../dist/infrastructure/storage/postgres/postgres-editorial-idea-repository.js";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main() {
  const workspaceName = arg("--workspace");
  const workspaceId = arg("--workspace-id");
  const packPath = arg("--pack") ?? join(here, "vorix-works-pautas.json");
  const apply = has("--apply");
  const calendar = has("--calendar");
  const start = arg("--start") ?? todayInSaoPaulo();
  if (!workspaceName && !workspaceId) throw new Error("Informe --workspace \"Nome\" ou --workspace-id <id>.");
  if (!isIsoDate(start)) throw new Error("--start inválido (use AAAA-MM-DD).");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definido.");

  const ideas = parseEditorialPack(JSON.parse(await readFile(packPath, "utf8")));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const found = workspaceId
      ? await pool.query("select id, tenant_id, name, status from workspaces where id = $1", [workspaceId])
      : await pool.query("select id, tenant_id, name, status from workspaces where lower(trim(name)) = lower(trim($1)) and status <> 'archived'", [workspaceName]);
    if (found.rows.length === 0) throw new Error("Nenhum workspace encontrado com esse nome/id.");
    if (found.rows.length > 1) {
      console.log("[editorial-import] Mais de um workspace com esse nome — rode de novo com --workspace-id:");
      for (const row of found.rows) console.log(`  - ${row.id}  tenant=${row.tenant_id}  status=${row.status}  nome=${row.name}`);
      process.exitCode = 2;
      return;
    }
    const workspace = found.rows[0];
    const repository = new PostgresEditorialIdeaRepository(pool);
    const before = await repository.listByWorkspace(workspace.id);
    const existing = new Set(before.map((idea) => idea.externalId));
    const fresh = ideas.filter((idea) => !existing.has(idea.externalId)).length;
    console.log(`[editorial-import] workspace=${workspace.id} (${workspace.name}) pacote=${ideas.length} já_no_bolsão=${before.length} novas=${fresh}`);
    if (!apply) {
      console.log("[editorial-import] Simulação — nada foi gravado. Use --apply para importar.");
      return;
    }
    const result = await repository.importMany({ tenantId: workspace.tenant_id, workspaceId: workspace.id, ideas });
    console.log(`[editorial-import] importadas=${result.created} ignoradas=${result.skipped}`);
    if (calendar) {
      const all = await repository.listByWorkspace(workspace.id);
      const assignments = buildEditorialCalendar(all, { startDate: start, days: 30 });
      for (const assignment of assignments) await repository.update(workspace.id, assignment.ideaId, { scheduledDate: assignment.date });
      console.log(`[editorial-import] calendário a partir de ${start}: ${assignments.length} pauta(s) agendada(s)`);
    }
    const after = await repository.listByWorkspace(workspace.id);
    const byCategory = {};
    for (const idea of after) byCategory[idea.category] = (byCategory[idea.category] ?? 0) + 1;
    console.log(`[editorial-import] total no bolsão=${after.length} agendadas=${after.filter((idea) => idea.scheduledDate).length}`);
    for (const [category, count] of Object.entries(byCategory)) console.log(`  - ${category}: ${count}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[editorial-import] Falha: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
