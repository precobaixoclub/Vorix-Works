import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { assertNotProduction, INBOX_RESTORE_TABLE_ORDER, runRestoreDrill } from "../scripts/lib/restore-drill.mjs";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — Fase 6 (Backup). "Backup só é considerado validado se conseguir restaurá-lo"
 * — este teste executa a verificação de restore de ponta a ponta, de verdade, contra dois bancos
 * Postgres reais (pglite, que fala o protocolo real via `PGLiteSocketServer` — mesma técnica já
 * usada por toda a suíte de testes deste repositório): um representando os dados já restaurados
 * de um backup ("origem"), outro representando o banco descartável de verificação ("destino",
 * schema vazio antes de rodar). NUNCA toca em produção — `assertNotProduction` é testado
 * separadamente também.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let source;
let target;

before(async () => {
  source = await startTestPostgres({ port: 55680 });
  target = await startTestPostgres({ port: 55681 });
  await applyMigrations(source.pool, MIGRATIONS_DIR);
  await applyMigrations(target.pool, MIGRATIONS_DIR); // schema aplicado, SEM dados — simula o banco descartável de verificação.
});

after(async () => {
  await source.stop();
  await target.stop();
});

async function seedRepresentativeData(pool) {
  const workspaceId = "ws-restore-drill";
  const connectionId = "conn-restore-drill";
  const contactId = "contact-restore-drill";
  const conversationId = "conv-restore-drill";

  await pool.query(
    "insert into workspaces (id, tenant_id, name, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
    [workspaceId, "tenant-restore-drill", "Workspace do drill"],
  );
  await pool.query(
    "insert into messaging_connections (id, tenant_id, workspace_id, provider, display_name, status) values ($1, $2, $3, 'wuzapi', 'Conexão do drill', 'connected')",
    [connectionId, "tenant-restore-drill", workspaceId],
  );
  await pool.query(
    "insert into inbox_contacts (id, tenant_id, workspace_id, phone_normalized, name) values ($1, $2, $3, '+5511900000000', 'Cliente do drill')",
    [contactId, "tenant-restore-drill", workspaceId],
  );
  await pool.query(
    "insert into inbox_conversations (id, tenant_id, workspace_id, connection_id, contact_id) values ($1, $2, $3, $4, $5)",
    [conversationId, "tenant-restore-drill", workspaceId, connectionId, contactId],
  );
  await pool.query(
    `insert into inbox_messages (id, tenant_id, workspace_id, conversation_id, connection_id, external_message_id, direction, type, status, body)
     values ($1, $2, $3, $4, $5, 'wa-restore-drill', 'inbound', 'text', 'delivered', 'Mensagem que precisa sobreviver ao backup e restore intacta.')`,
    ["msg-restore-drill", "tenant-restore-drill", workspaceId, conversationId, connectionId],
  );
  await pool.query(
    "insert into inbox_conversation_events (id, tenant_id, workspace_id, conversation_id, type, performed_by) values ($1, $2, $3, $4, 'assigned', 'user-restore-drill')",
    ["evt-restore-drill", "tenant-restore-drill", workspaceId, conversationId],
  );
}

test("Verificação de restore: dados do módulo Conversas sobrevivem ao dump+restore intactos, tabela por tabela", async () => {
  await seedRepresentativeData(source.pool);

  const { ok, results } = await runRestoreDrill({ sourcePool: source.pool, targetPool: target.pool, tables: INBOX_RESTORE_TABLE_ORDER });

  assert.equal(ok, true, "restore precisa ser considerado válido — toda tabela bate origem x destino");
  for (const result of results) {
    assert.equal(result.sourceCount, result.restoredCount, `tabela "${result.table}": contagem de origem e destino têm que bater`);
  }
  assert.ok(results.some((r) => r.table === "inbox_messages" && r.sourceCount > 0), "pelo menos a mensagem semeada precisa ter sido contabilizada");

  // Confiança extra: o CONTEÚDO da mensagem (não só a contagem) sobreviveu intacto.
  const restoredMessage = await target.pool.query("select body from inbox_messages where id = $1", ["msg-restore-drill"]);
  assert.equal(restoredMessage.rows[0].body, "Mensagem que precisa sobreviver ao backup e restore intacta.");
});

test("Verificação de restore nunca aponta para produção — assertNotProduction recusa explicitamente", () => {
  assert.throws(() => assertNotProduction("postgres://user:pass@prod-db.internal:5432/zuno", "TARGET"), /RESTORE_DRILL_REFUSED/);
  assert.throws(() => assertNotProduction("postgres://user:pass@zuno-production:5432/zuno", "TARGET"), /RESTORE_DRILL_REFUSED/);
  assert.doesNotThrow(() => assertNotProduction("postgres://user:pass@127.0.0.1:55999/zuno_descartavel", "TARGET"));
});
