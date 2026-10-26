import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import type { SocialPublishingProvider } from "./social-publishing-provider.port.js";
import {
  defaultSocialProviderPolicy,
  KNOWN_SOCIAL_PROVIDER_TYPES,
  type SocialAccount,
  type SocialAccountConnection,
  type SocialNetwork,
  type SocialProviderAvailability,
  type SocialProviderPolicy,
  type SocialProviderSwitch,
  type SocialProviderType,
} from "../../domain/social/social-publishing.model.js";

/**
 * Padrões de plataforma vindos do ambiente (kill switch global). Separados da política por tenant
 * e da homologação: tudo DESLIGADO por padrão — ativação só explícita.
 */
export type SocialPlatformDefaults = Readonly<Record<SocialProviderType, { enabled: boolean }>>;

export const DEFAULT_SOCIAL_PLATFORM_DEFAULTS: SocialPlatformDefaults = { meta_official: { enabled: false }, tiktok_official: { enabled: false }, instagram_unofficial: { enabled: true }, facebook_unofficial: { enabled: true }, tiktok_unofficial: { enabled: true } };

export class SocialProviderRegistry {
  private readonly providers = new Map<SocialProviderType, SocialPublishingProvider>();

  constructor(providers: readonly SocialPublishingProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: SocialPublishingProvider): void {
    this.providers.set(provider.descriptor.type, provider);
  }

  get(type: SocialProviderType): SocialPublishingProvider | undefined {
    return this.providers.get(type);
  }

  list(): SocialPublishingProvider[] {
    return [...this.providers.values()];
  }

  /** Redes que o provider atende — declaradas pelo próprio provider registrado. */
  networksOf(type: SocialProviderType): readonly SocialNetwork[] {
    return this.providers.get(type)?.descriptor.networks ?? [];
  }

  providersFor(network: SocialNetwork): SocialProviderType[] {
    return this.list().filter((provider) => provider.descriptor.networks.includes(network)).map((provider) => provider.descriptor.type);
  }
}

export type SocialResolutionFailure = "PUBLISHING_NOT_ENABLED" | "PROVIDER_DISABLED" | "PROVIDER_NOT_APPROVED" | "PROVIDER_NOT_CONFIGURED" | "TENANT_PROVIDER_NOT_ENABLED" | "NOT_IMPLEMENTED" | "CONNECTION_MISSING";

export type SocialResolution =
  | { ok: true; providerType: SocialProviderType; provider: SocialPublishingProvider; connection?: SocialAccountConnection }
  | { ok: false; reason: SocialResolutionFailure; providerType: SocialProviderType };

/**
 * Ponto ÚNICO que decide qual provider atende tenant + rede + conta. Composer, fila, calendário e
 * histórico perguntam aqui — nenhum deles conhece Meta, TikTok ou qualquer provider específico.
 */
export class SocialProviderResolver {
  constructor(
    private readonly registry: SocialProviderRegistry,
    private readonly repository: Pick<SocialRepositoryPort, "getPolicy" | "getSwitch" | "listSwitches">,
    private readonly defaults: SocialPlatformDefaults = DEFAULT_SOCIAL_PLATFORM_DEFAULTS,
  ) {}

  get providers(): SocialProviderRegistry {
    return this.registry;
  }

  async policyFor(tenantId: string, network: SocialNetwork): Promise<SocialProviderPolicy> {
    return (await this.repository.getPolicy({ tenantId, network })) ?? defaultSocialProviderPolicy(tenantId, network);
  }

  async switchFor(providerType: SocialProviderType): Promise<SocialProviderSwitch> {
    return (await this.repository.getSwitch(providerType)) ?? { providerType, enabled: this.defaults[providerType]?.enabled ?? false, approved: this.unofficialAuthorized(providerType) };
  }

  async listSwitches(): Promise<SocialProviderSwitch[]> {
    const stored = new Map((await this.repository.listSwitches()).map((item) => [item.providerType, item]));
    const types = [...new Set<SocialProviderType>([...KNOWN_SOCIAL_PROVIDER_TYPES, ...this.registry.list().map((provider) => provider.descriptor.type)])];
    return types.map((type) => stored.get(type) ?? { providerType: type, enabled: this.defaults[type]?.enabled ?? false, approved: this.unofficialAuthorized(type) });
  }

  /** Internal operator authorization is separate from realPublishingValidated and platform app review. */
  private unofficialAuthorized(type: SocialProviderType): boolean {
    return ["instagram_unofficial", "facebook_unofficial", "tiktok_unofficial"].includes(type);
  }

  /** Camadas separadas: implementado, configurado, ligado, homologado, liberado ao tenant, validado. */
  async availability(input: { tenantId: string; network: SocialNetwork; providerType: SocialProviderType }): Promise<SocialProviderAvailability> {
    const provider = this.registry.get(input.providerType);
    const globalSwitch = await this.switchFor(input.providerType);
    const policy = await this.policyFor(input.tenantId, input.network);
    return {
      providerType: input.providerType,
      implemented: !!provider?.descriptor.implemented && provider.descriptor.networks.includes(input.network),
      configured: provider?.connection?.isConfigured() ?? false,
      enabled: globalSwitch.enabled,
      approved: globalSwitch.approved,
      tenantEnabled: policy.publishingEnabled && policy.enabledProviders.includes(input.providerType),
      realPublishingValidated: !!provider?.descriptor.realPublishingValidated,
    };
  }

  /** Provider que atende NOVAS conexões desta rede para o tenant (o cliente nunca escolhe). */
  async connectionProviderFor(tenantId: string, network: SocialNetwork): Promise<SocialResolution> {
    const policy = await this.policyFor(tenantId, network);
    let lastFailure: SocialResolution | undefined;
    for (const providerType of this.candidateOrder(policy)) {
      const usable = await this.usable(tenantId, network, providerType, policy, true);
      if (usable.ok) return usable;
      lastFailure = usable;
    }
    return lastFailure ?? { ok: false, reason: "PUBLISHING_NOT_ENABLED", providerType: policy.preferredProvider };
  }

  /**
   * Provider que deve publicar AGORA para esta conta: preferido primeiro, depois os demais liberados
   * — sempre exigindo uma conexão ativa da conta com aquele provider.
   */
  async resolveForAccount(account: SocialAccount): Promise<SocialResolution> {
    const policy = await this.policyFor(account.tenantId, account.network);
    let lastFailure: SocialResolution | undefined;
    for (const providerType of this.candidateOrder(policy)) {
      const usable = await this.usable(account.tenantId, account.network, providerType, policy, false);
      if (!usable.ok) {
        lastFailure = usable;
        continue;
      }
      const connection = activeConnection(account, providerType);
      if (!connection) {
        lastFailure = { ok: false, reason: "CONNECTION_MISSING", providerType };
        continue;
      }
      return { ...usable, connection };
    }
    return lastFailure ?? { ok: false, reason: "PUBLISHING_NOT_ENABLED", providerType: policy.preferredProvider };
  }

  private async usable(tenantId: string, network: SocialNetwork, providerType: SocialProviderType, policy: SocialProviderPolicy, requireConfigured: boolean): Promise<SocialResolution> {
    if (!policy.publishingEnabled) return { ok: false, reason: "PUBLISHING_NOT_ENABLED", providerType };
    const availability = await this.availability({ tenantId, network, providerType });
    const provider = this.registry.get(providerType);
    if (!availability.implemented || !provider) return { ok: false, reason: "NOT_IMPLEMENTED", providerType };
    if (!availability.enabled) return { ok: false, reason: "PROVIDER_DISABLED", providerType };
    if (!availability.approved) return { ok: false, reason: "PROVIDER_NOT_APPROVED", providerType };
    if (!availability.tenantEnabled) return { ok: false, reason: "TENANT_PROVIDER_NOT_ENABLED", providerType };
    if (requireConfigured && !availability.configured) return { ok: false, reason: "PROVIDER_NOT_CONFIGURED", providerType };
    return { ok: true, providerType, provider };
  }

  /** Preferido primeiro, depois os demais liberados; nunca um provider não liberado ao tenant. */
  private candidateOrder(policy: SocialProviderPolicy): SocialProviderType[] {
    const enabled = policy.enabledProviders.filter((type) => this.registry.networksOf(type).includes(policy.network));
    const ordered = enabled.includes(policy.preferredProvider) ? [policy.preferredProvider, ...enabled.filter((type) => type !== policy.preferredProvider)] : enabled;
    return ordered.length ? ordered : [policy.preferredProvider];
  }
}

export function activeConnection(account: SocialAccount, providerType: SocialProviderType): SocialAccountConnection | undefined {
  return account.connections.find((connection) => connection.providerType === providerType && connection.status === "active");
}
