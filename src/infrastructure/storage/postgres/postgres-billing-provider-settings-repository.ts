import type { Pool } from "pg";
import type {
  BillingProviderSettingsRepositoryPort,
  BillingProviderSettingsResolved,
  UpdateBillingProviderSettingsInput,
} from "../../../application/ports/billing-provider-settings-repository.port.js";
import { decryptSecret, encryptSecret, last4 } from "../../crypto/secret-cipher.js";

type Row = {
  mercadopago_access_token_encrypted: string | null;
  mercadopago_access_token_last4: string | null;
  mercadopago_webhook_secret_encrypted: string | null;
  mercadopago_webhook_secret_last4: string | null;
  mercadopago_notification_url: string | null;
  updated_at: Date;
  updated_by: string | null;
};

/**
 * Adapter Postgres do `BillingProviderSettingsRepositoryPort` — mesmo padrão de
 * `PostgresPlatformAiSettingsRepository`. Guarda access token/webhook secret criptografados com
 * AES-256-GCM (chave derivada de `secretsMasterKey`, tipicamente `JWT_SECRET`); `notification_url`
 * não é segredo, fica em claro. `get()` sempre encontra a linha (migração 0134 insere o singleton).
 */
export class PostgresBillingProviderSettingsRepository implements BillingProviderSettingsRepositoryPort {
  constructor(
    private readonly pool: Pool,
    private readonly secretsMasterKey: string,
  ) {}

  async get(): Promise<BillingProviderSettingsResolved> {
    const result = await this.pool.query<Row>("select * from billing_provider_settings where id = 'singleton'");
    if (!result.rows[0]) throw new Error("BILLING_PROVIDER_SETTINGS_SINGLETON_MISSING: migração 0134 não aplicada?");
    return this.toDomain(result.rows[0]);
  }

  async update(input: UpdateBillingProviderSettingsInput): Promise<BillingProviderSettingsResolved> {
    const current = await this.get();

    const [accessTokenEncrypted, accessTokenLast4] = this.applySecretPatch(
      input.mercadoPagoAccessToken,
      current.resolvedMercadoPagoAccessToken,
      current.mercadoPagoAccessTokenLast4,
    );
    const [webhookSecretEncrypted, webhookSecretLast4] = this.applySecretPatch(
      input.mercadoPagoWebhookSecret,
      current.resolvedMercadoPagoWebhookSecret,
      current.mercadoPagoWebhookSecretLast4,
    );
    const notificationUrl =
      input.mercadoPagoNotificationUrl === undefined
        ? (current.mercadoPagoNotificationUrl ?? null)
        : input.mercadoPagoNotificationUrl === ""
          ? null
          : input.mercadoPagoNotificationUrl;

    const updated = await this.pool.query<Row>(
      `update billing_provider_settings
       set mercadopago_access_token_encrypted = $1,
           mercadopago_access_token_last4 = $2,
           mercadopago_webhook_secret_encrypted = $3,
           mercadopago_webhook_secret_last4 = $4,
           mercadopago_notification_url = $5,
           updated_at = $6,
           updated_by = $7
       where id = 'singleton'
       returning *`,
      [accessTokenEncrypted, accessTokenLast4, webhookSecretEncrypted, webhookSecretLast4, notificationUrl, input.now, input.actorUserId ?? null],
    );
    return this.toDomain(updated.rows[0]);
  }

  /** `undefined` → mantém (recriptografa o valor atual, mesma convenção de
   * `PostgresPlatformAiSettingsRepository`); `""` → remove; outro valor → substitui. */
  private applySecretPatch(input: string | undefined, currentResolved: string | undefined, currentLast4: string | undefined): [string | null, string | null] {
    if (input === undefined) {
      return [currentResolved ? encryptSecret(currentResolved, this.secretsMasterKey) : null, currentLast4 ?? null];
    }
    if (input === "") return [null, null];
    return [encryptSecret(input, this.secretsMasterKey), last4(input)];
  }

  private toDomain(row: Row): BillingProviderSettingsResolved {
    const decrypt = (encrypted: string | null): string | undefined => {
      if (!encrypted) return undefined;
      try {
        return decryptSecret(encrypted, this.secretsMasterKey);
      } catch {
        // Chave mestra rotacionada — equivale a "não configurado", admin precisa reinserir.
        return undefined;
      }
    };
    return {
      mercadoPagoAccessTokenLast4: row.mercadopago_access_token_last4 ?? undefined,
      mercadoPagoWebhookSecretLast4: row.mercadopago_webhook_secret_last4 ?? undefined,
      mercadoPagoNotificationUrl: row.mercadopago_notification_url ?? undefined,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by ?? undefined,
      resolvedMercadoPagoAccessToken: decrypt(row.mercadopago_access_token_encrypted),
      resolvedMercadoPagoWebhookSecret: decrypt(row.mercadopago_webhook_secret_encrypted),
    };
  }
}
