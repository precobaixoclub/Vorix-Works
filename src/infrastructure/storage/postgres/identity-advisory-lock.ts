import type { Pool, PoolClient } from "pg";

/**
 * Mutex distribuído barato via `pg_advisory_xact_lock` (lock transacional — liberado
 * automaticamente no commit/rollback, nunca precisa de "unlock" explícito) — mesmo padrão descrito
 * pelo usuário no relatório do CMDesk/desk-spark-ai (`contactPhoneGuard.service.ts`).
 *
 * Protege especificamente a janela "ler `inbox_identity_links` → decidir se cria/reusa/funde →
 * escrever" dentro de `registerInboundMessage` — a criação de contato/conversa em si já é
 * race-safe por `ON CONFLICT ... DO UPDATE` (constraint de banco), mas decidir SE duas chaves
 * diferentes (pseudo-telefone-por-LID vs. telefone real) representam a mesma pessoa não é algo que
 * uma constraint resolva sozinha — precisa da leitura-decisão-escrita inteira ser serializada por
 * chave lógica.
 */
export async function withIdentityLock<T>(pool: Pool, key: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Hash MD5 da chave lógica → bigint de 64 bits (mesma fórmula do sistema de referência) — o
    // lock em si é escopado à TRANSAÇÃO deste client, nunca vaza pra outras conexões do pool.
    await client.query("SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)", [key]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Chave lógica de lock pra resolução de identidade de UM LID dentro de um workspace — nunca
 * conflita com o lock de outro LID/workspace, mesmo sob o mesmo pool de conexões. */
export function identityLockKeyForLid(workspaceId: string, lid: string): string {
  return `identity:${workspaceId}:${lid}`;
}
