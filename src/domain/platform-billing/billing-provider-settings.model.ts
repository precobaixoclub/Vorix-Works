/**
 * Configuração das credenciais do Mercado Pago gerenciável pelo painel admin — mesmo racional de
 * `platform-ai-settings.model.ts` (Sprint 25/Fase 3). Uma linha singleton em
 * `billing_provider_settings`. Os segredos nunca saem daqui em claro; para consumo em runtime
 * existem `resolvedMercadoPagoAccessToken?`/`resolvedMercadoPagoWebhookSecret?` (ver
 * `billing-provider-settings-repository.port.ts`), decodificados APENAS pelo adapter Postgres.
 *
 * Escopo desta tela é só CREDENCIAIS — qual provider está ATIVO (sandbox/stripe/mercadopago)
 * continua sendo `BILLING_PROVIDER_ENABLED`/`BILLING_PROVIDER` (env + deploy), decisão de produto
 * explícita (a rota de webhook é registrada uma vez no boot a partir do provider ativo).
 */
export type BillingProviderSettings = {
  mercadoPagoAccessTokenLast4?: string;
  mercadoPagoWebhookSecretLast4?: string;
  /** Não é segredo (é a URL pública que o Mercado Pago chama) — guardado em claro. */
  mercadoPagoNotificationUrl?: string;
  updatedAt: string;
  updatedBy?: string;
};

/** Visão pública (admin) — nunca inclui os segredos em claro. `hasMercadoPago*` diz apenas se
 * existe algum valor configurado. */
export type BillingProviderSettingsPublic = BillingProviderSettings & {
  hasMercadoPagoAccessToken: boolean;
  hasMercadoPagoWebhookSecret: boolean;
};

/**
 * Constrói o objeto campo a campo (NUNCA `{...settings}`) — o chamador real
 * (`billing-provider-settings.usecases.ts`) passa um `BillingProviderSettingsResolved`, que
 * carrega `resolvedMercadoPagoAccessToken`/`resolvedMercadoPagoWebhookSecret` em claro; o
 * TypeScript permite isso estruturalmente (é um supertipo de `BillingProviderSettings`), mas um
 * spread copiaria essas propriedades extras em runtime pro JSON da resposta HTTP mesmo assim — o
 * tipo de retorno só protege em tempo de compilação, nunca em runtime.
 */
export function toPublicBillingProviderSettings(settings: BillingProviderSettings): BillingProviderSettingsPublic {
  return {
    mercadoPagoAccessTokenLast4: settings.mercadoPagoAccessTokenLast4,
    mercadoPagoWebhookSecretLast4: settings.mercadoPagoWebhookSecretLast4,
    mercadoPagoNotificationUrl: settings.mercadoPagoNotificationUrl,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    hasMercadoPagoAccessToken: Boolean(settings.mercadoPagoAccessTokenLast4),
    hasMercadoPagoWebhookSecret: Boolean(settings.mercadoPagoWebhookSecretLast4),
  };
}
