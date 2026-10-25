import type pg from "pg";

/** Repositories may create their own transactions. Inside a provisioning transaction they
 * share its connection and use savepoints; they must never reconnect/release the outer client. */
export function transactionScopedPool(client: pg.PoolClient): pg.Pool {
  let sequence = 0;
  return {
    query: client.query.bind(client),
    connect: async () => {
      const savepoint = `repository_tx_${++sequence}`;
      return {
        query: async (sql: string, values?: unknown[]) => {
          const command = typeof sql === "string" ? sql.trim().toLowerCase() : "";
          if (command === "begin") return client.query(`savepoint ${savepoint}`);
          if (command === "commit") return client.query(`release savepoint ${savepoint}`);
          if (command === "rollback") return client.query(`rollback to savepoint ${savepoint}`);
          return client.query(sql, values);
        },
        release: () => undefined,
      };
    },
  } as unknown as pg.Pool;
}
