import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations, getMigrationStatus } from "../dist/infrastructure/storage/postgres/migration-runner.js";

const { Pool } = pg;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(projectRoot, "db", "migrations");

async function main() {
  const mode = process.argv[2] === "status" ? "status" : "apply";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("[migrate] DATABASE_URL não definido. Configure-o (ver .env.example) antes de rodar migrations.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    if (mode === "status") {
      const status = await getMigrationStatus(pool, migrationsDir);
      console.log("[migrate] Status das migrations:");
      for (const entry of status) {
        const state = entry.applied ? (entry.checksumMatches ? "aplicada" : "aplicada (CHECKSUM DIVERGENTE)") : "pendente";
        console.log(`  - ${entry.id}: ${state}`);
      }
      const pending = status.filter((entry) => !entry.applied).length;
      console.log(`[migrate] ${status.length - pending} aplicada(s), ${pending} pendente(s).`);
      return;
    }

    const result = await applyMigrations(pool, migrationsDir);
    if (result.applied.length === 0) {
      console.log("[migrate] Nada a aplicar — schema já está em dia.");
    } else {
      console.log(`[migrate] ${result.applied.length} migration(s) aplicada(s):`);
      for (const id of result.applied) console.log(`  - ${id}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Falha ao executar migrations.", error);
  process.exitCode = 1;
});
