/**
 * Configuração global do AI Gateway — Sprint 25/Fase 3. Uma linha singleton em
 * `platform_ai_settings`. A API key nunca sai daqui em claro; para consumo em runtime existe
 * `resolvedAnthropicApiKey?: string` que é decodificado APENAS pelo adapter Postgres (dentro do
 * processo API, nunca serializado em API pública).
 */
export type PlatformAiSettings = {
  gatewayEnabled: boolean;
  briefingExtractionEnabled: boolean;
  anthropicApiKeyLast4?: string;
  anthropicBriefingExtractionModel: string;
  updatedAt: string;
  updatedBy?: string;
};

/** Visão pública (admin) — nunca inclui a key em claro. `hasAnthropicApiKey` diz apenas se existe alguma configurada. */
export type PlatformAiSettingsPublic = PlatformAiSettings & {
  hasAnthropicApiKey: boolean;
};

export function toPublicSettings(settings: PlatformAiSettings): PlatformAiSettingsPublic {
  return { ...settings, hasAnthropicApiKey: Boolean(settings.anthropicApiKeyLast4) };
}
