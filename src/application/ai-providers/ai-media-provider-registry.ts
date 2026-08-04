import type { AiProviderCode } from "../../domain/ai-providers/index.js";
import type { AiMediaProviderAdapterPort } from "../ports/ai-media-provider-adapter.port.js";

/** Registro de adapters de provedor de IA de mídia — espelha `PublicationProviderRegistry`. */
export class AiMediaProviderRegistry {
  private readonly providers = new Map<AiProviderCode, AiMediaProviderAdapterPort>();

  register(provider: AiMediaProviderAdapterPort): void {
    this.providers.set(provider.descriptor.providerCode, provider);
  }

  resolve(providerCode: AiProviderCode): AiMediaProviderAdapterPort {
    const provider = this.providers.get(providerCode);
    if (!provider) throw new Error(`AI_PROVIDER_UNKNOWN: provider "${providerCode}" não registrado.`);
    if (!provider.descriptor.enabled) throw new Error(`AI_PROVIDER_DISABLED: provider "${providerCode}" está desabilitado.`);
    return provider;
  }

  list(): AiMediaProviderAdapterPort["descriptor"][] {
    return [...this.providers.values()].map((provider) => provider.descriptor);
  }

  async health(providerCode: AiProviderCode): Promise<{ ok: boolean; safeMessage?: string; enabled: boolean; providerCode: AiProviderCode }> {
    const provider = this.providers.get(providerCode);
    if (!provider) throw new Error(`AI_PROVIDER_UNKNOWN: provider "${providerCode}" não registrado.`);
    const health = await provider.health();
    return { providerCode, enabled: provider.descriptor.enabled, ...health, ok: provider.descriptor.enabled && health.ok };
  }
}

export function createDefaultAiMediaProviderRegistry(providers: readonly AiMediaProviderAdapterPort[]): AiMediaProviderRegistry {
  const registry = new AiMediaProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}
