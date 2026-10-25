import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadMigrationFiles } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

test("Migration comercial preserva oportunidades antigas, normaliza fases e mantém preferências explícitas", async () => {
  const db = await startTestPostgres();
  try {
    const files = await loadMigrationFiles(join(process.cwd(), "db/migrations"));
    const migration = files.find(f => f.id === "0173_deal_commercial_lifecycle");
    for (const file of files.filter(f => f.id < migration.id)) await db.pool.query(file.sql);
    await db.pool.query("insert into workspaces (id,tenant_id,name,status,created_at,updated_at) values ('legacy-workspace','legacy-tenant','Legado','active',now(),now())");
    await db.pool.query("insert into pipelines (id,tenant_id,workspace_id,name) values ('legacy-pipeline','legacy-tenant','legacy-workspace','Comercial'), ('empty-pipeline','legacy-tenant','legacy-workspace','Vazio')");
    await db.pool.query(`insert into pipeline_stages (id,pipeline_id,name,position,is_won,is_lost) values
      ('won-a','legacy-pipeline','Venda concluída',0,true,false),
      ('active-a','legacy-pipeline','Negociando',1,false,false),
      ('won-b','legacy-pipeline','Outro ganho',2,true,false)`);
    await db.pool.query(`insert into deals (id,tenant_id,workspace_id,pipeline_id,stage_id,title,status,value_cents,final_value_cents,closed_at)
      values ('legacy-deal','legacy-tenant','legacy-workspace','legacy-pipeline','won-b','Preservar venda','won',10000,8500,'2026-01-10T12:00:00Z')`);
    await db.pool.query("insert into commercial_settings (workspace_id,tenant_id,proposal_accept_auto_win) values ('legacy-workspace','legacy-tenant',false)");
    await db.pool.query("begin");
    await db.pool.query(migration.sql);
    await db.pool.query("commit");
    const stages = (await db.pool.query("select * from pipeline_stages where pipeline_id = 'legacy-pipeline' order by position")).rows;
    assert.equal(stages.filter(s => s.is_won).length, 1);
    assert.equal(stages.filter(s => s.is_lost).length, 1);
    assert.equal(stages.at(-2).id, "won-a");
    assert.equal(stages.at(-2).name, "Venda concluída");
    assert.equal(stages.find(s => s.id === "won-b").is_won, false);
    assert.ok(stages.at(-1).is_lost);
    const deal = (await db.pool.query("select * from deals where id = 'legacy-deal'")).rows[0];
    assert.equal(deal.stage_id, "won-a");
    assert.equal(deal.status, "won");
    assert.equal(Number(deal.final_value_cents), 8500);
    assert.equal(deal.first_closed_at.toISOString(), "2026-01-10T12:00:00.000Z");
    assert.equal(deal.archived_at, null);
    const settings = (await db.pool.query("select * from commercial_settings where workspace_id='legacy-workspace'")).rows[0];
    assert.equal(settings.proposal_accept_auto_win, false);
    assert.equal(settings.closed_deal_archive_days, null);
    const empty = (await db.pool.query("select * from pipeline_stages where pipeline_id='empty-pipeline' order by position")).rows;
    assert.deepEqual(empty.map(s => s.is_won ? "won" : s.is_lost ? "lost" : "open"), ["open", "won", "lost"]);
    assert.equal((await db.pool.query("select * from timeline_events where entity_id='legacy-deal'")).rows[0].payload.source, "lifecycle_migration");
  } finally { await db.stop(); }
});
