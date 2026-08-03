import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSecretManager } from "../dist/infrastructure/operations/postgres-secret-manager.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

test("PostgresSecretManager: put/get cifra em repouso com AES-256-GCM e nunca grava o valor em claro", async () => {
  const db = await startTestPostgres({ port: 55630 });
  try {
    await applyMigrations(db.pool, MIGRATIONS_DIR);
    const manager = new PostgresSecretManager(db.pool, "master-key-de-teste");

    await manager.put("tiktok:workspace-1:access-token", {
      value: { accessToken: "super-secreto-tiktok", refreshToken: "outro-segredo" },
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    const raw = await db.pool.query("select ciphertext from operational_secrets where reference = $1", [
      "tiktok:workspace-1:access-token",
    ]);
    assert.equal(raw.rows.length, 1);
    assert.ok(!raw.rows[0].ciphertext.includes("super-secreto-tiktok"), "ciphertext não pode conter o segredo em claro");

    const resolved = await manager.get("tiktok:workspace-1:access-token");
    assert.deepEqual(resolved?.value, { accessToken: "super-secreto-tiktok", refreshToken: "outro-segredo" });
    assert.equal(resolved?.expiresAt, "2026-12-31T00:00:00.000Z");

    const health = await manager.health();
    assert.equal(health.ok, true);
    assert.equal(health.provider, "production");
  } finally {
    await db.stop();
  }
});

test("PostgresSecretManager: get de referência inexistente retorna undefined; delete remove o segredo", async () => {
  const db = await startTestPostgres({ port: 55631 });
  try {
    await applyMigrations(db.pool, MIGRATIONS_DIR);
    const manager = new PostgresSecretManager(db.pool, "master-key-de-teste");

    assert.equal(await manager.get("nao-existe"), undefined);

    await manager.put("ref-a", { value: { token: "abc" } });
    await manager.delete("ref-a");
    assert.equal(await manager.get("ref-a"), undefined);
  } finally {
    await db.stop();
  }
});
