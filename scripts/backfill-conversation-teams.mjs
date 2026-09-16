// Script de uso único — atribui a equipe única existente a todas as conversas abertas/pendentes
// sem equipe ainda, usando o MESMO caso de uso real (setConversationTeam), nunca SQL cru direto
// nas colunas (garante que qualquer invariante futuro do use-case seja respeitado). Roda dentro
// do container zuno-api (DATABASE_URL já configurado no ambiente).
import pg from "pg";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresConversationTimeEntryRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-time-entry-repository.js";
import { setConversationTeam } from "../dist/application/inbox/inbox-use-cases.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const teamsResult = await pool.query("select id, tenant_id, workspace_id, name from teams");
  if (teamsResult.rows.length === 0) {
    console.log("Nenhuma equipe cadastrada — nada a fazer.");
    return;
  }

  const conversationRepository = new PostgresInboxConversationRepository(pool);
  const teamRepository = new PostgresTeamRepository(pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(pool);
  const conversationTimeEntryRepository = new PostgresConversationTimeEntryRepository(pool);
  const deps = { conversationRepository, teamRepository, teamMembershipRepository, conversationTimeEntryRepository };

  for (const team of teamsResult.rows) {
    const pending = await pool.query(
      "select id from inbox_conversations where tenant_id = $1 and workspace_id = $2 and current_team_id is null and status in ('open', 'pending')",
      [team.tenant_id, team.workspace_id],
    );
    console.log(`Equipe "${team.name}" (${team.id}) — ${pending.rows.length} conversa(s) sem equipe nesse workspace.`);
    let ok = 0;
    let fail = 0;
    for (const row of pending.rows) {
      try {
        await setConversationTeam(deps, { tenantId: team.tenant_id, workspaceId: team.workspace_id, conversationId: row.id, teamId: team.id, performedBy: "system-backfill" });
        ok++;
      } catch (error) {
        fail++;
        console.error(`  falhou ${row.id}:`, error instanceof Error ? error.message : error);
      }
    }
    console.log(`  -> ${ok} atribuída(s), ${fail} falha(s).`);
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
