import { apiClient } from "@/lib/api-client";

export type BillingProviderSettingsPublic = {
  mercadoPagoAccessTokenLast4?: string;
  mercadoPagoWebhookSecretLast4?: string;
  mercadoPagoNotificationUrl?: string;
  updatedAt: string;
  updatedBy?: string;
  hasMercadoPagoAccessToken: boolean;
  hasMercadoPagoWebhookSecret: boolean;
};

export type UpdateBillingProviderSettingsPayload = {
  /** `undefined` = mantém, `""` = remove, qualquer outro valor substitui. */
  mercadoPagoAccessToken?: string;
  mercadoPagoWebhookSecret?: string;
  mercadoPagoNotificationUrl?: string;
};

export async function fetchBillingProviderSettings(): Promise<BillingProviderSettingsPublic> {
  return apiClient.get<BillingProviderSettingsPublic>("/v1/admin/billing-provider-settings");
}

export async function updateBillingProviderSettings(payload: UpdateBillingProviderSettingsPayload): Promise<BillingProviderSettingsPublic> {
  return apiClient.put<BillingProviderSettingsPublic>("/v1/admin/billing-provider-settings", payload);
}
