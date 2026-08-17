// Aplicador único e idempotente para as migrations "0056_quality_review_task_type",
// "0057_content_generation_history" e "0058_quality_feedback" — mesmo motivo de
// `apply-content-brief-migration.mjs`: o runner genérico (`scripts/migrate.mjs`) recusa aplicar
// qualquer migration pendente por causa de um checksum drift pré-existente em migrations antigas.
// Este script ignora o runner genérico de propósito: aplica só o SQL destas 3 migrations, na ordem,
// e registra cada uma em schema_migrations. Roda automaticamente uma vez no boot do container (ver
// docker-compose.zuno.yml) — idempotente (verifica schema_migrations antes de agir por id), então
// rodar de novo em deploys futuros é sempre um no-op seguro.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const MIGRATION_IDS = ["0056_quality_review_task_type", "0057_content_generation_history", "0058_quality_feedback"];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function applyOne(pool, migrationId) {
  const migrationPath = join(projectRoot, "db", "migrations", `${migrationId}.sql`);
  const existing = await pool.query("select 1 from schema_migrations where id = $1", [migrationId]);
  if (existing.rows.length > 0) {
    console.log(`[apply-quality-review-migration] "${migrationId}" já aplicada — nada a fazer.`);
    return;
  }

  const sql = await readFile(migrationPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (id, checksum, applied_at) values ($1, $2, now())", [migrationId, checksum]);
    await client.query("commit");
    console.log(`[apply-quality-review-migration] "${migrationId}" aplicada com sucesso.`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[apply-quality-review-migration] DATABASE_URL não definido — pulando (ambiente sem Postgres).");
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

    for (const migrationId of MIGRATION_IDS) {
      await applyOne(pool, migrationId);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[apply-quality-review-migration] Falha ao aplicar.", error);
  process.exitCode = 1;
});
