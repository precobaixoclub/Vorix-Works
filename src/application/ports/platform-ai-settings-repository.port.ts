import type { PlatformAiSettings } from "../../domain/platform-billing/platform-ai-settings.model.js";

export type PlatformAiSettingsResolved = PlatformAiSettings & {
  /** API key em CLARO — só o adapter Postgres materializa isto (após decriptar). Nunca serializar
   * fora do processo. Nunca gravar em log. Nunca devolver em API pública. */
  resolvedAnthropicApiKey?: string;
};

export type UpdatePlatformAiSettingsInput = {
  gatewayEnabled?: boolean;
  briefingExtractionEnabled?: boolean;
  /** Se `undefined` → key não é alterada. Se `""` (string vazia) → key é REMOVIDA. Qualquer outro
   * valor → substitui a atual (criptografando e guardando últimos 4). */
  anthropicApiKey?: string;
  anthropicBriefingExtractionModel?: string;
  actorUserId?: string;
  now: string;
};

export type PlatformAiSettingsRepositoryPort = {
  /** Sempre retorna uma linha (o `INSERT` na migração garante a existência do singleton). */
  get(): Promise<PlatformAiSettingsResolved>;
  update(input: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettingsResolved>;
};
