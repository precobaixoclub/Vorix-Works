import type { AiGatewayPort, AiGatewayResult, AiRequest } from "../ports/ai-gateway.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../ports/platform-ai-settings-repository.port.js";

const CACHE_TTL_MS = 30_000;

/**
 * Envolve o AI Gateway com as flags dinâmicas gerenciadas pelo painel admin
 * (`platform_ai_settings`) — Sprint 25/Fase 3. Se `gatewayEnabled=false` OU se a operação
 * corrente não estiver habilitada nas settings globais, retorna `not_configured` (o mesmo
 * comportamento de quando não há API key configurada), fazendo o chamador cair no fallback
 * determinístico. Cacheia a leitura por 30s para evitar 1 query por request.
 */
export class SettingsGatedAiGateway implements AiGatewayPort {
  private cache?: { at: number; gatewayEnabled: boolean; briefingExtractionEnabled: boolean };

  constructor(private readonly deps: {
    inner: AiGatewayPort;
    platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
  }) {}

  private async load(): Promise<{ gatewayEnabled: boolean; briefingExtractionEnabled: boolean }> {
    const now = Date.now();
    if (this.cache && now - this.cache.at <= CACHE_TTL_MS) return this.cache;
    const settings = await this.deps.platformAiSettingsRepository.get();
    this.cache = { at: now, gatewayEnabled: settings.gatewayEnabled, briefingExtractionEnabled: settings.briefingExtractionEnabled };
    return this.cache;
  }

  async execute(request: AiRequest): Promise<AiGatewayResult> {
    const flags = await this.load().catch(() => undefined);
    if (!flags || !flags.gatewayEnabled) {
      return { ok: false, error: { category: "not_configured", message: "AI Gateway desligado no painel admin.", retryable: false } };
    }
    if (request.operation === "briefing_field_extraction" && !flags.briefingExtractionEnabled) {
      return { ok: false, error: { category: "not_configured", message: "Extração de briefing por IA desligada no painel admin.", retryable: false } };
    }
    return this.deps.inner.execute(request);
  }
}
