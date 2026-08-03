import type { Pool } from "pg";
import type {
  PlatformAiSettingsRepositoryPort,
  PlatformAiSettingsResolved,
  UpdatePlatformAiSettingsInput,
} from "../../../application/ports/platform-ai-settings-repository.port.js";
import { decryptSecret, encryptSecret, last4 } from "../../crypto/secret-cipher.js";

type Row = {
  gateway_enabled: boolean;
  briefing_extraction_enabled: boolean;
  anthropic_api_key_encrypted: string | null;
  anthropic_api_key_last4: string | null;
  anthropic_briefing_extraction_model: string;
  updated_at: Date;
  updated_by: string | null;
};

/**
 * Adapter Postgres do `PlatformAiSettingsRepositoryPort` — Sprint 25/Fase 3. Guarda a API key
 * criptografada com AES-256-GCM (chave derivada de `secretsMasterKey`, tipicamente `JWT_SECRET`).
 * `get()` sempre encontra a linha (migração 0052 insere o singleton).
 */
export class PostgresPlatformAiSettingsRepository implements PlatformAiSettingsRepositoryPort {
  constructor(private readonly pool: Pool, private readonly secretsMasterKey: string) {}

  async get(): Promise<PlatformAiSettingsResolved> {
    const result = await this.pool.query<Row>("select * from platform_ai_settings where id = 'singleton'");
    if (!result.rows[0]) throw new Error("PLATFORM_AI_SETTINGS_SINGLETON_MISSING: migração 0052 não aplicada?");
    return this.toDomain(result.rows[0]);
  }

  async update(input: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettingsResolved> {
    const current = await this.get();

    const gatewayEnabled = input.gatewayEnabled ?? current.gatewayEnabled;
    const briefingExtractionEnabled = input.briefingExtractionEnabled ?? current.briefingExtractionEnabled;
    const model = input.anthropicBriefingExtractionModel ?? current.anthropicBriefingExtractionModel;

    let encrypted: string | null;
    let last4Value: string | null;
    if (input.anthropicApiKey === undefined) {
      encrypted = current.resolvedAnthropicApiKey ? encryptSecret(current.resolvedAnthropicApiKey, this.secretsMasterKey) : null;
      last4Value = current.anthropicApiKeyLast4 ?? null;
    } else if (input.anthropicApiKey === "") {
      encrypted = null;
      last4Value = null;
    } else {
      encrypted = encryptSecret(input.anthropicApiKey, this.secretsMasterKey);
      last4Value = last4(input.anthropicApiKey);
    }

    const updated = await this.pool.query<Row>(
      `update platform_ai_settings
       set gateway_enabled = $1,
           briefing_extraction_enabled = $2,
           anthropic_api_key_encrypted = $3,
           anthropic_api_key_last4 = $4,
           anthropic_briefing_extraction_model = $5,
           updated_at = $6,
           updated_by = $7
       where id = 'singleton'
       returning *`,
      [
        gatewayEnabled,
        briefingExtractionEnabled,
        encrypted,
        last4Value,
        model,
        input.now,
        input.actorUserId ?? null,
      ],
    );
    return this.toDomain(updated.rows[0]);
  }

  private toDomain(row: Row): PlatformAiSettingsResolved {
    let resolvedKey: string | undefined;
    if (row.anthropic_api_key_encrypted) {
      try {
        resolvedKey = decryptSecret(row.anthropic_api_key_encrypted, this.secretsMasterKey);
      } catch {
        // Chave mestra rotacionada — deixa em branco (equivale a "não configurado"), o admin precisa reinserir.
        resolvedKey = undefined;
      }
    }
    return {
      gatewayEnabled: row.gateway_enabled,
      briefingExtractionEnabled: row.briefing_extraction_enabled,
      anthropicApiKeyLast4: row.anthropic_api_key_last4 ?? undefined,
      anthropicBriefingExtractionModel: row.anthropic_briefing_extraction_model,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by ?? undefined,
      resolvedAnthropicApiKey: resolvedKey,
    };
  }
}
