import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

const { Pool } = pg;

/**
 * Sobe um Postgres real (compilado para WASM, via PGlite) embutido no processo de teste, servido
 * por TCP via pglite-socket, para que o `pg.Pool` (o mesmo driver de produção) converse com ele
 * exatamente como conversaria com um `DATABASE_URL` real — sem exigir nenhuma credencial do
 * Postgres real do desenvolvedor. Ver Relatório da Sprint 03 para o raciocínio completo.
 */
export async function startTestPostgres({ port }) {
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
  await server.start();

  const pool = new Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    password: "postgres",
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
