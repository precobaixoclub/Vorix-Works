import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
export type PgPool = InstanceType<typeof Pool>;

/**
 * Runner de migrations — Sprint 03 (Fase 3). Compartilhado entre o CLI (`scripts/migrate.mjs`) e
 * os testes de persistência (que rodam contra um Postgres real embutido via PGlite, nunca contra
 * um mock). Requisitos do briefing, um a um:
 *
 * - leitura ordenada: `loadMigrationFiles` ordena por nome de arquivo (prefixo numérico).
 * - tabela `schema_migrations`: `ensureMigrationsTable`.
 * - transação individual por migration: `begin`/`commit`/`rollback` por arquivo em `applyMigrations`.
 * - advisory lock: `pg_advisory_lock`/`pg_advisory_unlock` ao redor de toda a execução, para que
 *   duas execuções concorrentes nunca apliquem a mesma migration em paralelo.
 * - checksum: sha256 do conteúdo do arquivo; migrations já aplicadas têm o checksum comparado
 *   contra o arquivo em disco ANTES de qualquer migration pendente ser aplicada — falha explícita
 *   e nada é executado se algo já aplicado foi alterado.
 * - idempotente: migrations já registradas em `schema_migrations` são puladas.
 * - sem rollback destrutivo automático: uma migration com erro reverte a SI MESMA (sua própria
 *   transação); as migrations já aplicadas antes dela na mesma execução permanecem aplicadas.
 *
 * LIMITAÇÃO DE TESTE CONHECIDA: `pg_advisory_lock` é implementado pelo PGlite (o Postgres real
 * usado nos testes — ver `tests/helpers/pglite-test-db.mjs`) de forma síncrona/não-bloqueante —
 * duas sessões podem "adquirir" a mesma chave sem uma esperar a outra, diferente de um Postgres
 * real (verificado isoladamente antes de escrever este código). Por isso o loop de aplicação
 * abaixo tem uma segunda camada de defesa: se uma migration falhar por já existir (corrida
 * vencida por outra execução concorrente), o runner reconsulta `schema_migrations` antes de
 * declarar falha — se a outra execução já commitou aquela migration, isto não é um erro. Em
 * Postgres real o advisory lock evita que essa corrida aconteça; esta camada extra é só rede de
 * segurança, testável de fato só sob PGlite.
 */

const ADVISORY_LOCK_KEY = 727_100_1;

export type MigrationFile = {
  id: string;
  filePath: string;
  sql: string;
  checksum: string;
};

export type MigrationStatusEntry = {
  id: string;
  applied: boolean;
  /** `null` quando a migration ainda não foi aplicada — não há o que comparar. */
  checksumMatches: boolean | null;
};

export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir);
  const sqlFileNames = entries.filter((name) => name.endsWith(".sql")).sort();

  const files: MigrationFile[] = [];
  for (const fileName of sqlFileNames) {
    const filePath = path.join(migrationsDir, fileName);
    const sql = await readFile(filePath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    files.push({ id: fileName.replace(/\.sql$/, ""), filePath, sql, checksum });
  }
  return files;
}

export async function ensureMigrationsTable(client: { query: pg.ClientBase["query"] }): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null
    )
  `);
}

function assertNoChecksumDrift(files: MigrationFile[], appliedById: Map<string, string>): void {
  for (const file of files) {
    const existingChecksum = appliedById.get(file.id);
    if (existingChecksum !== undefined && existingChecksum !== file.checksum) {
      throw new Error(
        `MIGRATION_CHECKSUM_MISMATCH: a migration "${file.id}" foi alterada depois de já ter sido aplicada ` +
          `(checksum registrado: ${existingChecksum}, checksum atual do arquivo: ${file.checksum}). ` +
          `Migrations já aplicadas não podem ser editadas — crie uma nova migration para corrigir o schema.`,
      );
    }
  }
}

export async function applyMigrations(pool: PgPool, migrationsDir: string): Promise<{ applied: string[] }> {
  const files = await loadMigrationFiles(migrationsDir);
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      await ensureMigrationsTable(client);

      const appliedRows = await client.query<{ id: string; checksum: string }>("select id, checksum from schema_migrations");
      const appliedById = new Map(appliedRows.rows.map((row) => [row.id, row.checksum]));

      assertNoChecksumDrift(files, appliedById);

      for (const file of files) {
        if (appliedById.has(file.id)) continue;

        try {
          await client.query("begin");
          await client.query(file.sql);
          await client.query("insert into schema_migrations (id, checksum, applied_at) values ($1, $2, now())", [file.id, file.checksum]);
          await client.query("commit");
          applied.push(file.id);
        } catch (error) {
          await client.query("rollback");

          const concurrentWinner = await client.query<{ checksum: string }>("select checksum from schema_migrations where id = $1", [file.id]);
          if (concurrentWinner.rows.length > 0) {
            // Outra execução concorrente já aplicou e commitou esta migration primeiro — não é falha.
            continue;
          }

          throw new Error(`MIGRATION_FAILED: falha ao aplicar a migration "${file.id}": ${(error as Error).message}`);
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  return { applied };
}

export async function getMigrationStatus(pool: PgPool, migrationsDir: string): Promise<MigrationStatusEntry[]> {
  const files = await loadMigrationFiles(migrationsDir);
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const appliedRows = await client.query<{ id: string; checksum: string }>("select id, checksum from schema_migrations");
    const appliedById = new Map(appliedRows.rows.map((row) => [row.id, row.checksum]));

    return files.map((file) => {
      const existingChecksum = appliedById.get(file.id);
      const applied = existingChecksum !== undefined;
      return {
        id: file.id,
        applied,
        checksumMatches: applied ? existingChecksum === file.checksum : null,
      };
    });
  } finally {
    client.release();
  }
}
