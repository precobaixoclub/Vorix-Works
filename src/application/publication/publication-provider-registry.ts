import type { PublicationChannel, PublicationContentType, PublicationMode, PublicationProvider, PublicationProviderDescriptor } from "../../domain/publication/publication.model.js";
import type { PublicationProviderAdapterPort } from "./publication-provider-adapter.port.js";

export class PublicationProviderRegistry {
  private readonly providers = new Map<PublicationProvider, PublicationProviderAdapterPort>();

  register(provider: PublicationProviderAdapterPort): void {
    this.providers.set(provider.descriptor.providerId, provider);
  }

  resolve(providerId: PublicationProvider): PublicationProviderAdapterPort {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`PUBLICATION_PROVIDER_UNKNOWN: provider "${providerId}" não registrado.`);
    if (!provider.descriptor.enabled) throw new Error(`PUBLICATION_PROVIDER_DISABLED: provider "${providerId}" está desabilitado.`);
    return provider;
  }

  list(): PublicationProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => provider.descriptor);
  }

  async health(providerId: PublicationProvider): Promise<{ ok: boolean; safeMessage?: string; enabled: boolean; providerId: PublicationProvider }> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`PUBLICATION_PROVIDER_UNKNOWN: provider "${providerId}" não registrado.`);
    const health = await provider.health();
    return { providerId, enabled: provider.descriptor.enabled, ...health, ok: provider.descriptor.enabled && health.ok };
  }

  validateCapability(input: { providerId: PublicationProvider; channel: PublicationChannel; contentType: PublicationContentType; mode: PublicationMode; payloadBytes: number; assetCount: number }): void {
    const provider = this.resolve(input.providerId);
    const descriptor = provider.descriptor;
    if (!descriptor.supportedChannels.includes(input.channel)) throw new Error(`PUBLICATION_PROVIDER_CHANNEL_UNSUPPORTED: provider "${input.providerId}" não suporta "${input.channel}".`);
    if (!descriptor.supportedContentTypes.includes(input.contentType)) throw new Error(`PUBLICATION_PROVIDER_CONTENT_UNSUPPORTED: provider "${input.providerId}" não suporta "${input.contentType}".`);
    if (input.mode === "real" && descriptor.providerId === "dry_run") throw new Error("PUBLICATION_PROVIDER_MODE_UNSUPPORTED: dry_run não publica modo real.");
    if (input.payloadBytes > descriptor.maxPayloadBytes) throw new Error("PUBLICATION_PROVIDER_PAYLOAD_TOO_LARGE: payload excede limite do provider.");
    if (input.assetCount > descriptor.maxAssets) throw new Error("PUBLICATION_PROVIDER_TOO_MANY_ASSETS: assets excedem limite do provider.");
  }
}

export function createDefaultPublicationProviderRegistry(providers: readonly PublicationProviderAdapterPort[]): PublicationProviderRegistry {
  const registry = new PublicationProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}
