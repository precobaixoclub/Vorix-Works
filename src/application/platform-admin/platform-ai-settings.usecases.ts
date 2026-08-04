import { toPublicSettings, type PlatformAiSettingsPublic } from "../../domain/platform-billing/platform-ai-settings.model.js";
import type {
  PlatformAiSettingsRepositoryPort,
  UpdatePlatformAiSettingsInput,
} from "../ports/platform-ai-settings-repository.port.js";
import { isModelRegisteredAndActive } from "../ai-gateway/model-registry.js";

export type PlatformAiSettingsUseCaseDeps = {
  platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
  now: () => Date;
};

export type UpdatePlatformAiSettingsCommand = {
  gatewayEnabled?: boolean;
  briefingExtractionEnabled?: boolean;
  anthropicApiKey?: string;
  anthropicBriefingExtractionModel?: string;
  actor: { userId: string };
};

export async function getPlatformAiSettings(deps: PlatformAiSettingsUseCaseDeps): Promise<PlatformAiSettingsPublic> {
  const settings = await deps.platformAiSettingsRepository.get();
  return toPublicSettings(settings);
}

export async function updatePlatformAiSettings(
  deps: PlatformAiSettingsUseCaseDeps,
  command: UpdatePlatformAiSettingsCommand,
): Promise<PlatformAiSettingsPublic> {
  if (command.anthropicApiKey !== undefined && command.anthropicApiKey !== "" && !command.anthropicApiKey.startsWith("sk-ant-")) {
    throw new Error('PLATFORM_AI_SETTINGS_INVALID_KEY: API key da Anthropic precisa começar com "sk-ant-".');
  }
  if (command.anthropicBriefingExtractionModel && !isModelRegisteredAndActive("anthropic", command.anthropicBriefingExtractionModel)) {
    throw new Error(
      `PLATFORM_AI_SETTINGS_INVALID_MODEL: "${command.anthropicBriefingExtractionModel}" não está registrado ou ativo no Model Registry.`,
    );
  }
  const patch: UpdatePlatformAiSettingsInput = {
    gatewayEnabled: command.gatewayEnabled,
    briefingExtractionEnabled: command.briefingExtractionEnabled,
    anthropicApiKey: command.anthropicApiKey,
    anthropicBriefingExtractionModel: command.anthropicBriefingExtractionModel,
    actorUserId: command.actor.userId,
    now: deps.now().toISOString(),
  };
  const updated = await deps.platformAiSettingsRepository.update(patch);
  return toPublicSettings(updated);
}
