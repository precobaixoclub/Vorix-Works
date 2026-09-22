import { toPublicBillingProviderSettings, type BillingProviderSettingsPublic } from "../../domain/platform-billing/billing-provider-settings.model.js";
import type {
  BillingProviderSettingsRepositoryPort,
  UpdateBillingProviderSettingsInput,
} from "../ports/billing-provider-settings-repository.port.js";

export type BillingProviderSettingsUseCaseDeps = {
  billingProviderSettingsRepository: BillingProviderSettingsRepositoryPort;
  now: () => Date;
};

export type UpdateBillingProviderSettingsCommand = {
  mercadoPagoAccessToken?: string;
  mercadoPagoWebhookSecret?: string;
  mercadoPagoNotificationUrl?: string;
  actor: { userId: string };
};

export async function getBillingProviderSettings(deps: BillingProviderSettingsUseCaseDeps): Promise<BillingProviderSettingsPublic> {
  const settings = await deps.billingProviderSettingsRepository.get();
  return toPublicBillingProviderSettings(settings);
}

export async function updateBillingProviderSettings(
  deps: BillingProviderSettingsUseCaseDeps,
  command: UpdateBillingProviderSettingsCommand,
): Promise<BillingProviderSettingsPublic> {
  if (command.mercadoPagoNotificationUrl && !command.mercadoPagoNotificationUrl.startsWith("https://")) {
    throw new Error('BILLING_PROVIDER_SETTINGS_INVALID_URL: a Notification URL precisa começar com "https://".');
  }
  const patch: UpdateBillingProviderSettingsInput = {
    mercadoPagoAccessToken: command.mercadoPagoAccessToken,
    mercadoPagoWebhookSecret: command.mercadoPagoWebhookSecret,
    mercadoPagoNotificationUrl: command.mercadoPagoNotificationUrl,
    actorUserId: command.actor.userId,
    now: deps.now().toISOString(),
  };
  const updated = await deps.billingProviderSettingsRepository.update(patch);
  return toPublicBillingProviderSettings(updated);
}
