import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations, getMigrationStatus, loadMigrationFiles } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const REAL_MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

async function withTempMigrationsDir(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-migrations-"));
  try {
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(join(dir, name), sql, "utf8");
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("migration runner: banco vazio aplica todas as migrations reais do projeto", async () => {
  const db = await startTestPostgres({ port: 55401 });
  try {
    const files = await loadMigrationFiles(REAL_MIGRATIONS_DIR);
    const result = await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);
    assert.deepEqual(result.applied, files.map((f) => f.id));

    const tables = await db.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    for (const expected of ["workspaces", "workspace_members", "workspace_integrations", "asset_libraries", "assets", "chat_sessions", "chat_messages", "chat_message_attachments", "schema_migrations"]) {
      assert.ok(tableNames.includes(expected), `esperava a tabela "${expected}"`);
    }
  } finally {
    await db.stop();
  }
});

test("migration runner: execução repetida é idempotente (nada a aplicar na segunda vez)", async () => {
  const db = await startTestPostgres({ port: 55402 });
  try {
    const first = await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);
    assert.ok(first.applied.length > 0);

    const second = await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);
    assert.deepEqual(second.applied, []);

    const status = await getMigrationStatus(db.pool, REAL_MIGRATIONS_DIR);
    assert.ok(status.every((entry) => entry.applied && entry.checksumMatches));
  } finally {
    await db.stop();
  }
});

test("migration runner: falha explícita quando uma migration já aplicada foi alterada", async () => {
  const db = await startTestPostgres({ port: 55403 });
  try {
    await withTempMigrationsDir(
      { "0001_a.sql": "create table a (id text primary key);" },
      async (dir) => {
        await applyMigrations(db.pool, dir);

        await writeFile(join(dir, "0001_a.sql"), "create table a (id text primary key, extra text);", "utf8");

        await assert.rejects(() => applyMigrations(db.pool, dir), /MIGRATION_CHECKSUM_MISMATCH/);
      },
    );
  } finally {
    await db.stop();
  }
});

test("migration runner: concorrência — duas execuções simultâneas não aplicam a mesma migration duas vezes", async () => {
  const db = await startTestPostgres({ port: 55404 });
  try {
    const results = await Promise.all([
      applyMigrations(db.pool, REAL_MIGRATIONS_DIR),
      applyMigrations(db.pool, REAL_MIGRATIONS_DIR),
    ]);

    const totalApplied = results[0].applied.length + results[1].applied.length;
    const files = await loadMigrationFiles(REAL_MIGRATIONS_DIR);
    assert.equal(totalApplied, files.length, "a soma das migrations aplicadas pelas duas execuções deve ser exatamente o total — sem duplicação");

    const rows = await db.pool.query("select id from schema_migrations");
    assert.equal(rows.rows.length, files.length);
  } finally {
    await db.stop();
  }
});

test("migration runner: uma migration que falha faz rollback de si mesma, sem afetar as anteriores", async () => {
  const db = await startTestPostgres({ port: 55405 });
  try {
    await withTempMigrationsDir(
      {
        "0001_ok.sql": "create table ok_table (id text primary key);",
        "0002_broken.sql": "create table broken_table (id text primary key); this is not valid sql;",
      },
      async (dir) => {
        await assert.rejects(() => applyMigrations(db.pool, dir), /MIGRATION_FAILED/);

        const applied = await db.pool.query("select id from schema_migrations order by id");
        assert.deepEqual(applied.rows.map((r) => r.id), ["0001_ok"]);

        const brokenTable = await db.pool.query(
          "select table_name from information_schema.tables where table_name = 'broken_table'",
        );
        assert.equal(brokenTable.rows.length, 0, "a tabela da migration que falhou não deve existir — rollback funcionou");
      },
    );
  } finally {
    await db.stop();
  }
});

test("migration runner: encerra a conexão corretamente (pool aceita end() sem erro após uso)", async () => {
  const db = await startTestPostgres({ port: 55406 });
  await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);
  await db.stop();
});
