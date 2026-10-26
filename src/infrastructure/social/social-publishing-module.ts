import type { NotificationUseCaseDeps } from "../../application/notification/notification-use-cases.js";
import type { OperationalAuditRepositoryPort } from "../../application/ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { SocialRepositoryPort } from "../../application/ports/social-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { PublicationProviderAdapterPort } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationSecretResolverPort } from "../../application/publication/publication-secret-resolver.js";
import { SocialAccountService } from "../../application/social/social-account-service.js";
import { SocialAuditLog } from "../../application/social/social-audit.js";
import type { SocialMediaProbePort } from "../../application/social/social-media-validation.js";
import { SocialNotifier, type SocialEmailNotifierPort } from "../../application/social/social-notifier.js";
import { SocialPostService } from "../../application/social/social-post-service.js";
import { SocialProviderAdminService } from "../../application/social/social-provider-admin-service.js";
import { DEFAULT_SOCIAL_PLATFORM_DEFAULTS, SocialProviderRegistry, SocialProviderResolver, type SocialPlatformDefaults } from "../../application/social/social-provider-resolver.js";
import { SocialPublicationRouter } from "../../application/social/social-publication-router.js";
import type { SocialPublishingProvider } from "../../application/social/social-publishing-provider.port.js";
import { SocialSessionVault } from "../../application/social/social-session-vault.js";
import { MetaOfficialSocialProvider, OfficialOAuthConnection, TikTokOfficialSocialProvider, type OfficialOAuthServiceLike } from "./official-social-providers.js";
import { SocialMediaProbe } from "./social-media-io.js";

export type SocialPublishingModuleDeps = {
  repository: SocialRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  /** Cofre central das credenciais OAuth (cifrado). */
  credentials: PublicationSecretResolverPort;
  /** Adapters oficiais já existentes (Meta IG/FB, TikTok), quando configurados. */
  officialAdapters?: { instagram?: PublicationProviderAdapterPort; facebook?: PublicationProviderAdapterPort; tiktok?: PublicationProviderAdapterPort };
  /** Serviços OAuth oficiais (resolvidos tarde: nascem depois da governança de credenciais). */
  oauth?: { meta?: () => OfficialOAuthServiceLike | undefined; tiktok?: () => OfficialOAuthServiceLike | undefined };
  memberships?: Pick<TenantMembershipRepositoryPort, "listByTenant">;
  notification?: Partial<NotificationUseCaseDeps>;
  email?: SocialEmailNotifierPort;
  auditRepository?: OperationalAuditRepositoryPort;
  platformDefaults?: SocialPlatformDefaults;
  /** Substitui os providers (testes / contract tests). */
  providers?: readonly SocialPublishingProvider[];
  mediaProbe?: SocialMediaProbePort | null;
  defaultTimezone?: string;
  timezoneFor?: (input: { tenantId: string; workspaceId: string }) => Promise<string | undefined>;
  idGenerator?: () => string;
  now?: () => Date;
};

export type SocialPublishingModule = {
  repository: SocialRepositoryPort;
  registry: SocialProviderRegistry;
  resolver: SocialProviderResolver;
  vault: SocialSessionVault;
  notifier: SocialNotifier;
  audit: SocialAuditLog;
  accounts: SocialAccountService;
  posts: SocialPostService;
  admin: SocialProviderAdminService;
  router: SocialPublicationRouter;
};

/** Providers oficiais: registrados (arquitetura pronta), mas desligados pela política/kill switch padrão. */
export function createOfficialSocialProviders(input: Pick<SocialPublishingModuleDeps, "officialAdapters" | "oauth">): SocialPublishingProvider[] {
  return [
    new MetaOfficialSocialProvider(
      { instagram: input.officialAdapters?.instagram, facebook: input.officialAdapters?.facebook },
      new OfficialOAuthConnection(input.oauth?.meta ?? (() => undefined), (account) => (account.providerId === "instagram" || account.providerId === "facebook" ? account.providerId : undefined)),
    ),
    new TikTokOfficialSocialProvider(
      { tiktok: input.officialAdapters?.tiktok },
      new OfficialOAuthConnection(input.oauth?.tiktok ?? (() => undefined), () => "tiktok"),
    ),
  ];
}

export function createSocialPublishingModule(deps: SocialPublishingModuleDeps): SocialPublishingModule {
  const idGenerator = deps.idGenerator ?? (() => `soc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const registry = new SocialProviderRegistry(deps.providers ?? createOfficialSocialProviders(deps));
  const resolver = new SocialProviderResolver(registry, deps.repository, deps.platformDefaults ?? DEFAULT_SOCIAL_PLATFORM_DEFAULTS);
  const vault = new SocialSessionVault(deps.credentials);
  const notifier = new SocialNotifier({ repository: deps.repository, memberships: deps.memberships, notification: deps.notification, email: deps.email, now: deps.now });
  const audit = new SocialAuditLog(deps.auditRepository, idGenerator);
  const accounts = new SocialAccountService({ repository: deps.repository, publicationRepository: deps.publicationRepository, resolver, vault, notifier, audit, idGenerator, now: deps.now });
  const posts = new SocialPostService({ repository: deps.repository, publicationRepository: deps.publicationRepository, accounts, resolver, vault, audit, mediaProbe: deps.mediaProbe === null ? undefined : deps.mediaProbe ?? new SocialMediaProbe(), idGenerator, now: deps.now, defaultTimezone: deps.defaultTimezone, timezoneFor: deps.timezoneFor });
  const admin = new SocialProviderAdminService({ repository: deps.repository, publicationRepository: deps.publicationRepository, resolver, notifier, audit, now: deps.now });
  const router = new SocialPublicationRouter({ repository: deps.repository, publicationRepository: deps.publicationRepository, accounts, resolver, vault, notifier, audit, idGenerator, now: deps.now });
  return { repository: deps.repository, registry, resolver, vault, notifier, audit, accounts, posts, admin, router };
}
