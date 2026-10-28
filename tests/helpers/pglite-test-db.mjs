import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { serializePgliteProtocol } from "./pglite-protocol-queue.mjs";

const { Pool } = pg;

/**
 * Sobe um Postgres real (compilado para WASM, via PGlite) embutido no processo de teste, servido
 * por TCP via pglite-socket, para que o `pg.Pool` (o mesmo driver de produção) converse com ele
 * exatamente como conversaria com um `DATABASE_URL` real — sem exigir nenhuma credencial do
 * Postgres real do desenvolvedor. Ver Relatório da Sprint 03 para o raciocínio completo.
 */
export async function startTestPostgres(_options = {}) {
  const db = new PGlite();
  // The OS assigns a free port, avoiding other test workers and local databases.
  // The fixture pool and API pools are independent (each pg.Pool defaults to ten clients).
  // Ten sockets globally let one pool starve another and caused intermittent startup disconnects.
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: _options.maxConnections ?? 32 });
  serializePgliteProtocol(server);
  await server.start();
  const port = Number(server.getServerConn().split(":").at(-1));

  const pool = new Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    password: "postgres",
    connectionTimeoutMillis: 15_000,
  });

  return {
    pool,
    connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await pool.end();
      await server.stop();
      await db.close();
    },
  };
}
