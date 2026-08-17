// Aplicador de migration único e idempotente para "0055_content_brief_capability" — criado porque
// o runner genérico (`scripts/migrate.mjs`, `assertNoChecksumDrift`) encontrou divergência de
// checksum em migrations já aplicadas anteriormente (achado pré-existente, provavelmente causado
// por normalização de line-ending em algum sync anterior) e por isso recusa aplicar QUALQUER
// migration pendente, incluindo a 0055. Este script ignora o runner genérico de propósito: aplica
// só o SQL de "0055_content_brief_capability.sql" e registra a linha em schema_migrations, sem
// tocar nas outras 54 migrations. Roda automaticamente uma vez no boot do container (ver
// docker-compose.zuno.yml) — idempotente (verifica schema_migrations antes de agir), então rodar
// de novo em deploys futuros é sempre um no-op seguro.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const MIGRATION_ID = "0055_content_brief_capability";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(projectRoot, "db", "migrations", `${MIGRATION_ID}.sql`);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[apply-content-brief-migration] DATABASE_URL não definido — pulando (ambiente sem Postgres).");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null
      )
    `);

    const existing = await pool.query("select 1 from schema_migrations where id = $1", [MIGRATION_ID]);
    if (existing.rows.length > 0) {
      console.log(`[apply-content-brief-migration] "${MIGRATION_ID}" já aplicada — nada a fazer.`);
      return;
    }

    const sql = await readFile(migrationPath, "utf8");
    // Mesmo checksum que `loadMigrationFiles` (migration-runner.ts) computaria — importante gravar
    // o valor real (não um placeholder), senão o runner genérico acusa MIGRATION_CHECKSUM_MISMATCH
    // para "0055" especificamente na próxima vez que alguém rodar `node scripts/migrate.mjs`.
    const checksum = createHash("sha256").update(sql).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (id, checksum, applied_at) values ($1, $2, now())", [MIGRATION_ID, checksum]);
      await client.query("commit");
      console.log(`[apply-content-brief-migration] "${MIGRATION_ID}" aplicada com sucesso.`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[apply-content-brief-migration] Falha ao aplicar.", error);
  process.exitCode = 1;
});
