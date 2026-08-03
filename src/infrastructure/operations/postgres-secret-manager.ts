import type { Pool } from "pg";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type { SecretManagerHealth, SecretValue } from "../../domain/operations/operations.model.js";
import { decryptSecret, encryptSecret } from "../crypto/secret-cipher.js";

type Row = { ciphertext: string; expires_at: Date | null };

/**
 * Secret Manager de produção real (substitui `FailClosedProductionSecretManager`): grava os
 * valores em `operational_secrets` cifrados com AES-256-GCM (mesma chave derivada de JWT_SECRET
 * usada em `platform_ai_settings`). Sem isto, produção só tinha um stub que rejeitava qualquer put/get.
 */
export class PostgresSecretManager implements SecretManagerPort {
  constructor(private readonly pool: Pool, private readonly masterKey: string) {}

  async health(): Promise<SecretManagerHealth> {
    try {
      await this.pool.query("select 1");
      return { ok: true, provider: "production", safeMessage: "Secret Manager de produção (Postgres, AES-256-GCM) disponível." };
    } catch {
      return { ok: false, provider: "not_configured", safeMessage: "Secret Manager de produção indisponível (falha ao conectar ao Postgres)." };
    }
  }

  async put(reference: string, value: SecretValue): Promise<void> {
    const ciphertext = encryptSecret(JSON.stringify(value.value), this.masterKey);
    const expiresAt = value.expiresAt ? new Date(value.expiresAt) : null;
    await this.pool.query(
      `insert into operational_secrets (reference, ciphertext, expires_at, updated_at)
       values ($1, $2, $3, now())
       on conflict (reference) do update set ciphertext = excluded.ciphertext, expires_at = excluded.expires_at, updated_at = now()`,
      [reference, ciphertext, expiresAt],
    );
  }

  async get(reference: string): Promise<SecretValue | undefined> {
    const result = await this.pool.query<Row>(
      "select ciphertext, expires_at from operational_secrets where reference = $1",
      [reference],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const value = JSON.parse(decryptSecret(row.ciphertext, this.masterKey)) as Record<string, string>;
    return { value, expiresAt: row.expires_at ? row.expires_at.toISOString() : undefined };
  }

  async delete(reference: string): Promise<void> {
    await this.pool.query("delete from operational_secrets where reference = $1", [reference]);
  }
}
