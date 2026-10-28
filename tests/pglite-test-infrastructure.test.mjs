import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

test("TEST_INFRA: fixture and API pools can keep more than ten simultaneous clients without socket rejection", { timeout: 30_000 }, async () => {
  const db = await startTestPostgres();
  const apiPool = new pg.Pool({ connectionString: db.connectionString, max: 12, connectionTimeoutMillis: 15_000 });
  const clients = [];
  try {
    const fixture = await db.pool.connect(); clients.push(fixture);
    const acquired = await Promise.allSettled(Array.from({ length: 12 }, () => apiPool.connect()));
    for (const item of acquired) if (item.status === "fulfilled") clients.push(item.value);
    assert.equal(acquired.filter(r => r.status === "rejected").length, 0, "TEST_INFRA_FAILURE: PGlite socket capacity exhausted");
    for (const client of clients) assert.equal((await client.query("select 42::int answer")).rows[0].answer, 42);
  } finally {
    clients.forEach(c => c.release());
    await apiPool.end(); await db.stop();
  }
});

test("TEST_INFRA: fragmented extended-query messages cannot share another connection's unnamed statement", { timeout: 30_000 }, async () => {
  const db = await startTestPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString, max: 2, connectionTimeoutMillis: 15_000 });
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    for (const client of clients) {
      const stream = client.connection.stream, write = stream.write.bind(stream);
      let sent = Promise.resolve();
      // Model real TCP fragmentation deterministically instead of relying on the OS packet layout.
      stream.write = (chunk, ...args) => {
        sent = sent.then(() => new Promise(resolve => setTimeout(resolve, 3))).then(() => { write(chunk, ...args); });
        return true;
      };
    }
    for (let round = 0; round < 10; round++) {
      const rows = await Promise.allSettled([
        clients[0].query("select $1::text value", [`one-${round}`]),
        clients[1].query("select $1::text value,$2::int b,$3::int c", [`three-${round}`, 2, 3]),
      ]);
      for (const r of rows) assert.equal(r.status, "fulfilled", `TEST_INFRA_FAILURE: ${r.reason?.message}`);
      assert.equal(rows[0].value.rows[0].value, `one-${round}`);
      assert.deepEqual(rows[1].value.rows[0], { value: `three-${round}`, b: 2, c: 3 });
    }
  } finally {
    clients.forEach(c => c.release()); await pool.end(); await db.stop();
  }
});

test("TEST_INFRA: another connection waits for transaction completion and errors do not strand protocol ownership", { timeout: 30_000 }, async () => {
  const db = await startTestPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    await clients[0].query("create table fixture_serialization(id int)");
    await clients[0].query("begin");
    await clients[0].query("insert into fixture_serialization values($1)", [42]);
    const other = clients[1].query("select id from fixture_serialization where id=$1", [42]);
    await clients[0].query("commit");
    assert.deepEqual((await other).rows, [{ id: 42 }]);
    await assert.rejects(() => clients[0].query("select * from missing_fixture_table"), /does not exist/);
    assert.equal((await clients[1].query("select $1::int value", [7])).rows[0].value, 7);
  } finally { clients.forEach(c => c.release()); await pool.end(); await db.stop(); }
});
