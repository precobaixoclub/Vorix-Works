import type { BillingProviderSettings } from "../../domain/platform-billing/billing-provider-settings.model.js";

export type BillingProviderSettingsResolved = BillingProviderSettings & {
  /** Segredos em CLARO — só o adapter Postgres materializa isto (após decriptar). Nunca
   * serializar fora do processo. Nunca gravar em log. Nunca devolver em API pública. */
  resolvedMercadoPagoAccessToken?: string;
  resolvedMercadoPagoWebhookSecret?: string;
};

export type UpdateBillingProviderSettingsInput = {
  /** `undefined` → não altera. `""` → remove. Qualquer outro valor → substitui (criptografando e
   * guardando os últimos 4 caracteres). */
  mercadoPagoAccessToken?: string;
  mercadoPagoWebhookSecret?: string;
  /** Não é segredo — `undefined` mantém, `""` remove, outro valor substitui (sem criptografia). */
  mercadoPagoNotificationUrl?: string;
  actorUserId?: string;
  now: string;
};

export type BillingProviderSettingsRepositoryPort = {
  /** Sempre retorna uma linha (a migração 0134 insere o singleton). */
  get(): Promise<BillingProviderSettingsResolved>;
  update(input: UpdateBillingProviderSettingsInput): Promise<BillingProviderSettingsResolved>;
};
