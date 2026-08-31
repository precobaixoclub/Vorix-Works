/**
 * Verificação de restore — Fase 6 (Módulo Conversas: Resiliência/Observabilidade). "Backup só é
 * considerado validado se conseguir restaurá-lo" — este módulo faz exatamente isso de ponta a
 * ponta: lê os dados de um Postgres de ORIGEM (o "backup" já restaurado num banco descartável) e
 * confirma, tabela por tabela, que TODAS as linhas existem intactas num Postgres de DESTINO
 * (o "descartável"), nunca o inverso e nunca contra produção — ver `assertNotProduction`.
 *
 * Reaproveita só o driver `pg` já usado no projeto inteiro (nenhuma dependência nova) — funciona
 * tanto contra um Postgres real (produção usa `pg_dump`/`gunzip | psql` para o dump/restore em si,
 * ver `backup-postgres.sh`; este script valida o RESULTADO) quanto contra pglite (usado nos testes
 * deste repositório, ver `tests/helpers/pglite-test-db.mjs`) — ambos falam o protocolo real do
 * Postgres, então o mesmo código serve para o teste automatizado E para uma verificação manual
 * real em produção/staging.
 */

const PRODUCTION_NAME_PATTERN = /\bprod(uction)?\b/i;

/** Nunca aponta por engano para um banco de produção — checagem simples por nome, best-effort
 * (não substitui julgamento humano, mas barra o erro mais óbvio: rodar isto contra `zuno` de
 * produção por engano em vez de um banco descartável). */
export function assertNotProduction(connectionString, label) {
  if (PRODUCTION_NAME_PATTERN.test(connectionString)) {
    throw new Error(`RESTORE_DRILL_REFUSED: "${label}" parece apontar para produção ("${connectionString}") — use sempre um banco descartável.`);
  }
}

/**
 * Copia e verifica os dados de `tables` de `sourcePool` para `targetPool` (que já deve ter o
 * schema criado, ex.: via `applyMigrations`). Para cada tabela: lê todas as linhas da origem,
 * insere no destino, e compara contagens — nunca assume sucesso sem checar.
 */
export async function runRestoreDrill({ sourcePool, targetPool, tables }) {
  const results = [];

  for (const table of tables) {
    const sourceRows = await sourcePool.query(`select * from ${table}`);
    const columns = sourceRows.fields.map((field) => field.name);

    if (sourceRows.rows.length > 0 && columns.length > 0) {
      const columnList = columns.map((column) => `"${column}"`).join(", ");
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      for (const row of sourceRows.rows) {
        const values = columns.map((column) => row[column]);
        await targetPool.query(`insert into ${table} (${columnList}) values (${placeholders}) on conflict do nothing`, values);
      }
    }

    const targetCount = await targetPool.query(`select count(*)::int as count from ${table}`);
    const sourceCount = sourceRows.rows.length;
    const restoredCount = targetCount.rows[0].count;
    results.push({ table, sourceCount, restoredCount, ok: sourceCount === restoredCount });
  }

  const ok = results.every((result) => result.ok);
  return { ok, results };
}

/** Ordem segura de restauração respeitando FKs simples (pai antes de filho) — mesma ordem lógica
 * do `BackupRestorePlanner` para as tabelas centrais do módulo Conversas. Usado tanto pelo teste
 * automatizado quanto pelo CLI (`restore-drill.mjs`). */
export const INBOX_RESTORE_TABLE_ORDER = [
  "workspaces",
  "messaging_connections",
  "inbox_contacts",
  "inbox_conversations",
  "inbox_messages",
  "inbox_conversation_events",
];
