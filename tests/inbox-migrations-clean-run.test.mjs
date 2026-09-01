import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — Fase 7 (Hardening). "Simule banco limpo: migration 0001 → última migration.
 * E banco existente: 0083 → 0084 → 0085 → 0086 → novas. Nenhuma migration deve depender de estado
 * manual de produção." Os dois cenários são exercitados de verdade aqui — não apenas "todo teste já
 * roda `applyMigrations` uma vez" (isso só prova o caminho "banco limpo"; o caminho "banco já
 * existente rodando incrementalmente" nunca tinha sido exercitado explicitamente antes desta fase).
 */

const REAL_MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function listMigrationFiles() {
  return readdirSync(REAL_MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
}

test("Migrations: banco LIMPO aplica 0001 até a última migration sem erro", async () => {
  const db = await startTestPostgres({ port: 55700 });
  try {
    await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);

    const allFiles = listMigrationFiles();
    const applied = await db.pool.query("select id from schema_migrations order by id asc");
    assert.equal(applied.rows.length, allFiles.length, "toda migration do diretório foi aplicada, nenhuma pulada silenciosamente");

    // Confirma que tabelas centrais do módulo Conversas (as mais recentes) existem de verdade —
    // nunca apenas "a migration rodou", mas "o schema resultante está correto".
    const tables = await db.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('inbox_conversations','inbox_messages','inbox_conversation_events','messaging_connections','ai_generation_ledger')",
    );
    assert.equal(tables.rows.length, 5, "todas as tabelas do módulo Conversas + billing existem após rodar do zero");

    // Colunas mais recentes (Fase 6/7) — prova que o histórico INTEIRO de migrations aditivas
    // chega ao estado final correto partindo de um banco vazio.
    const columns = await db.pool.query(
      "select column_name from information_schema.columns where table_name = 'ai_generation_ledger' and column_name = 'idempotency_key'",
    );
    assert.equal(columns.rows.length, 1, "coluna mais recente (idempotency_key, migration 0087) existe no banco limpo");
  } finally {
    await db.stop();
  }
});

test("Migrations: banco JÁ EXISTENTE (parado em 0083) continua aplicando 0084+ sem depender de nenhum estado manual", async () => {
  const db = await startTestPostgres({ port: 55701 });
  const partialDir = mkdtempSync(join(tmpdir(), "vorix-migrations-partial-"));
  try {
    const allFiles = listMigrationFiles();
    const upTo0083 = allFiles.filter((name) => name <= "0083_inbox_messages.sql");
    assert.ok(upTo0083.length > 0 && upTo0083.some((name) => name.startsWith("0083")), "sanity check: o corte inclui exatamente até 0083");

    // Passo 1 — simula "banco de produção já rodando, parado em 0083": aplica só esse subconjunto
    // num diretório temporário isolado (nunca toca no diretório real do repositório).
    for (const file of upTo0083) copyFileSync(join(REAL_MIGRATIONS_DIR, file), join(partialDir, file));
    await applyMigrations(db.pool, partialDir);

    const appliedAfterPartial = await db.pool.query("select id from schema_migrations order by id asc");
    assert.equal(appliedAfterPartial.rows.length, upTo0083.length, "só as migrations até 0083 foram aplicadas nesta primeira rodada");

    // Passo 2 — "deploy novo chega": roda o runner de novo, agora apontando pro diretório REAL
    // completo (0001..0087). Precisa reconhecer o que já foi aplicado (por checksum/id) e aplicar
    // SÓ o que falta (0084, 0085, 0086, 0087) — sem exigir nenhuma intervenção manual no banco.
    await applyMigrations(db.pool, REAL_MIGRATIONS_DIR);

    const appliedAfterFull = await db.pool.query("select id from schema_migrations order by id asc");
    assert.equal(appliedAfterFull.rows.length, allFiles.length, "depois da segunda rodada, TODAS as migrations (incluindo as novas 0084-0087) estão aplicadas");

    const newTables = await db.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = 'inbox_conversation_events'",
    );
    assert.equal(newTables.rows.length, 1, "tabela introduzida depois de 0083 (inbox_conversation_events, 0084) existe após a rodada incremental");

    const idempotencyColumn = await db.pool.query(
      "select column_name from information_schema.columns where table_name = 'ai_generation_ledger' and column_name = 'idempotency_key'",
    );
    assert.equal(idempotencyColumn.rows.length, 1, "coluna da Fase 7 (0087) também chega corretamente pela via incremental, não só pela via limpa");
  } finally {
    await db.stop();
    rmSync(partialDir, { recursive: true, force: true });
  }
});
