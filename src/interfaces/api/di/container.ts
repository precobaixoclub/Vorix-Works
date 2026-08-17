import { join } from "node:path";
import type pg from "pg";
import type { AiGatewayPort } from "../../../application/ports/ai-gateway.port.js";
import type { AnalyticsRepositoryPort } from "../../../application/ports/analytics-repository.port.js";
import type { AssetLibraryRepositoryPort } from "../../../application/ports/asset-library-repository.port.js";
import type { AssetMetadataSourcePort } from "../../../application/ports/asset-metadata-source.port.js";
import type { AuditLogPort } from "../../../application/ports/audit-log.port.js";
import type { AuthPort } from "../../../application/ports/auth.port.js";
import type { BriefingFieldValueRepositoryPort } from "../../../application/ports/briefing-field-value-repository.port.js";
import type { BriefingQuestionRepositoryPort } from "../../../application/ports/briefing-question-repository.port.js";
import type { BriefingRepositoryPort } from "../../../application/ports/briefing-repository.port.js";
import type { ChatRepositoryPort } from "../../../application/ports/chat-repository.port.js";
import type { CompanyKnowledgeSourcePort } from "../../../application/ports/company-knowledge-source.port.js";
import type { ConversationEventRepositoryPort } from "../../../application/ports/conversation-event-repository.port.js";
import type { ConversationMemoryRepositoryPort } from "../../../application/ports/conversation-memory-repository.port.js";
import type { BriefingPlanningHook } from "../../../application/briefing/briefing-use-cases.js";
import { ComplianceService } from "../../../application/credential/compliance-service.js";
import { CredentialGovernanceService } from "../../../application/credential/credential-governance-service.js";
import type { ConversationRepositoryPort } from "../../../application/ports/conversation-repository.port.js";
import type { CredentialRepositoryPort } from "../../../application/ports/credential-repository.port.js";
import type { ExecutionGraphRepositoryPort } from "../../../application/ports/execution-graph-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../../../application/ports/execution-task-repository.port.js";
import type { JwtPort } from "../../../application/ports/jwt.port.js";
import type { OperationalAuditRepositoryPort } from "../../../application/ports/operational-audit-repository.port.js";
import type { PasswordHasherPort } from "../../../application/ports/password-hasher.port.js";
import type { PlanningArtifactRepositoryPort } from "../../../application/ports/planning-artifact-repository.port.js";
import type { PlanningDecisionRepositoryPort } from "../../../application/ports/planning-decision-repository.port.js";
import type { PlanningRepositoryPort } from "../../../application/ports/planning-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../../../application/ports/platform-billing-repository.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../../../application/ports/platform-ai-settings-repository.port.js";
import type { AiProvidersRepositoryPort } from "../../../application/ports/ai-providers-repository.port.js";
import type { AiMediaProviderAdapterPort } from "../../../application/ports/ai-media-provider-adapter.port.js";
import { createDefaultAiMediaProviderRegistry, type AiMediaProviderRegistry } from "../../../application/ai-providers/ai-media-provider-registry.js";
import { CreditAccountingService } from "../../../application/ai-providers/credit-accounting.service.js";
import { MediaGenerationService } from "../../../application/ai-providers/media-generation.service.js";
import { OpenAiImageProviderAdapter } from "../../../infrastructure/ai-providers/openai-image-provider-adapter.js";
import { OpenAiIcaroImageProvider } from "../../../infrastructure/ai-providers/openai-icaro-image-provider.js";
import { GoogleVeoProviderAdapter } from "../../../infrastructure/ai-providers/google-veo-provider-adapter.js";
import { IcaroAIBrain } from "../../../application/ai/icaro-brain.js";
import { ValentinaTenantManager } from "../../../application/tenancy/valentina-tenant-manager.js";
import type { ValentinaTenantPort } from "../../../application/tenancy/valentina-tenant.port.js";
import { ClaraKnowledgeCenter } from "../../../application/knowledge/clara-knowledge-center.js";
import { LocalJsonValentinaTenantRepository } from "../../../infrastructure/storage/local-json-valentina-tenant-repository.js";
import { LocalJsonClaraKnowledgeRepository } from "../../../infrastructure/storage/local-json-clara-knowledge-repository.js";
import type { PublicationRepositoryPort } from "../../../application/ports/publication-repository.port.js";
import type { PreparedCommandRepositoryPort } from "../../../application/ports/prepared-command-repository.port.js";
import type { RefreshTokenRepositoryPort } from "../../../application/ports/refresh-token-repository.port.js";
import type { RuntimeRepositoryPort } from "../../../application/ports/runtime-repository.port.js";
import type { ExecutionRepositoryPort } from "../../../application/ports/execution-repository.port.js";
import { SystemClock, type ClockPort } from "../../../application/ports/clock.port.js";
import type { SchedulingRepositoryPort } from "../../../application/ports/scheduling-repository.port.js";
import type { SessionRepositoryPort } from "../../../application/ports/session-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../../application/ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../../../application/ports/user-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../application/ports/workspace-repository.port.js";
import type { WebhookEventRepositoryPort } from "../../../application/ports/webhook-event-repository.port.js";
import { BcryptPasswordHasher } from "../../../infrastructure/auth/bcrypt-password-hasher.js";
import { JsonWebTokenJwtAdapter } from "../../../infrastructure/auth/jsonwebtoken-jwt-adapter.js";
import { JwtAuthAdapter } from "../../../infrastructure/auth/jwt-auth-adapter.js";
import { createNoopAuthAdapter } from "../../../infrastructure/auth/noop-auth-adapter.js";
import { buildAiGateway } from "../../../infrastructure/ai-gateway/build-ai-gateway.js";
import { CreditGatedAiGateway } from "../../../application/ai-gateway/credit-gated-ai-gateway.js";
import { DeterministicExecutionTaskHandler } from "../../../application/execution/deterministic-handlers.js";
import type { ExecutionHandlerResolver } from "../../../application/execution/handler-resolver.js";
import type { ExecutionFeatureFlags } from "../../../application/execution/feature-flags.js";
import { createDefaultExecutionContractRegistry, type ExecutionContractRegistry } from "../../../application/execution/execution-contract-registry.js";
import { createExecutionEnvironmentPolicy, SideEffectGuard, type ExecutionEnvironmentPolicy } from "../../../application/execution/execution-operational-policy.js";
import { InMemoryHandlerCircuitBreaker, type HandlerCircuitBreakerPort } from "../../../application/execution/handler-circuit-breaker.js";
import { BackpressureController, BackupRestorePlanner, InMemoryTtlCache, OperationalCircuitBreaker, OperationalHealthService, OperationalRateLimiter, ProductionGuard, SecretManagerPublicationSecretStore } from "../../../application/operations/operational-services.js";
import type { OperationalStateRepositoryPort } from "../../../application/ports/operational-state-repository.port.js";
import type { SecretManagerPort } from "../../../application/ports/secret-manager.port.js";
import { DryRunPublicationProvider, FakePublicationProvider } from "../../../application/publication/fake-publication-providers.js";
import type { PublicationProviderAdapterPort } from "../../../application/publication/publication-provider-adapter.port.js";
import type { PublicationProviderPort } from "../../../application/publication/publication-provider.port.js";
import { PublicationProviderPolicy } from "../../../application/publication/publication-provider-policy.js";
import { PublicationGovernancePolicy } from "../../../application/credential/publication-governance-policy.js";
import { createDefaultPublicationProviderRegistry, type PublicationProviderRegistry } from "../../../application/publication/publication-provider-registry.js";
import { InMemoryPublicationQueue, type PublicationQueuePort } from "../../../application/publication/publication-queue.js";
import { CompositePublicationSecretResolver, FakePublicationSecretResolver, StoredPublicationSecretResolver, type PublicationSecretResolverPort } from "../../../application/publication/publication-secret-resolver.js";
import type { PublicationSecretStoragePort } from "../../../application/publication/publication-secret-store.js";
import { PublicationSynchronizationService } from "../../../application/webhook/publication-synchronization-service.js";
import { WebhookIngestionService } from "../../../application/webhook/webhook-ingestion-service.js";
import { AnalyticsMetricRegistry } from "../../../application/analytics/analytics-metric-registry.js";
import { AnalyticsAlertService, AnalyticsDataQualityService, AnalyticsEventConsumer, AnalyticsEventIngestionService, AnalyticsExportService, AnalyticsHealthService, AnalyticsInsightEngine, AnalyticsQueryService, AnalyticsRetentionService, AnalyticsSnapshotBuilder, AnalyticsSnapshotRebuilder } from "../../../application/analytics/analytics-services.js";
import { ScheduleConflictDetector } from "../../../application/scheduling/schedule-conflict-detector.js";
import { ScheduleOccurrenceGenerator } from "../../../application/scheduling/schedule-occurrence-generator.js";
import { SchedulingHealthService } from "../../../application/scheduling/scheduling-health-service.js";
import { SchedulingPublicationDispatcher } from "../../../application/scheduling/scheduling-publication-dispatcher.js";
import { SchedulingRecoveryService } from "../../../application/scheduling/scheduling-recovery-service.js";
import { SchedulingUseCases } from "../../../application/scheduling/schedule-use-cases.js";
import { TemporalDispatcher } from "../../../application/scheduling/temporal-queue.js";
import { MetaPagesOAuthService } from "../../../infrastructure/publication/meta-pages-oauth-service.js";
import { MetaInstagramOAuthService, META_INSTAGRAM_REQUIRED_SCOPES } from "../../../infrastructure/publication/meta-instagram-oauth-service.js";
import { MetaContentPostingProvider } from "../../../infrastructure/publication/meta-instagram-content-posting-provider.js";
import { FailClosedProductionSecretManager, InMemorySecretManager } from "../../../infrastructure/operations/secret-managers.js";
import { PostgresSecretManager } from "../../../infrastructure/operations/postgres-secret-manager.js";
import type { ObjectStoragePort } from "../../../application/ports/object-storage.port.js";
import { S3ObjectStorage } from "../../../infrastructure/storage/s3-object-storage.js";
import { LocalObjectStorage } from "../../../infrastructure/storage/local-object-storage.js";
import { DisabledObjectStorage } from "../../../infrastructure/storage/disabled-object-storage.js";
import { MetaPagesSandboxProvider } from "../../../infrastructure/publication/meta-pages-sandbox-provider.js";
import { TikTokContentPostingProvider } from "../../../infrastructure/publication/tiktok-content-posting-provider.js";
import { TikTokOAuthService, TIKTOK_REQUIRED_SCOPES } from "../../../infrastructure/publication/tiktok-oauth-service.js";
import { KwaiContentPostingProvider } from "../../../infrastructure/publication/kwai-content-posting-provider.js";
import { KwaiOAuthService, KWAI_REQUIRED_SCOPES } from "../../../infrastructure/publication/kwai-oauth-service.js";
import { YouTubeContentPostingProvider } from "../../../infrastructure/publication/youtube-content-posting-provider.js";
import { YouTubeOAuthService, YOUTUBE_REQUIRED_SCOPES } from "../../../infrastructure/publication/youtube-oauth-service.js";
import { createLinkedInSandboxProvider, createXSandboxProvider } from "../../../infrastructure/publication/sandbox-social-providers.js";
import { buildExecutionHandlerResolver } from "../../../infrastructure/execution/build-execution-handler-resolver.js";
import { PlanningEngineBriefingHook } from "../../../infrastructure/planning/planning-engine-briefing-hook.js";
import { RuntimeEnginePlanningHook } from "../../../infrastructure/runtime/runtime-engine-planning-hook.js";
import { buildIdentityRepositories } from "../../../infrastructure/storage/build-identity-repositories.js";
import { buildPlatformRepositories } from "../../../infrastructure/storage/build-platform-repositories.js";
import type { ApiConfig } from "../config/api-config.js";

const DISABLED_AI_GATEWAY_CONFIG: ApiConfig["aiGateway"] = {
  enabled: false,
  briefingExtractionEnabled: false,
  anthropicBriefingExtractionModel: "claude-haiku-4-5-20251001",
};

const defaultPlanningIdGenerator = () => `planning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const defaultRuntimeIdGenerator = () => `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const defaultExecutionIdGenerator = () => `execution-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const defaultGovernanceIdGenerator = () => `governance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const META_PAGES_REQUIRED_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"] as const;
const PROVIDER_REQUIRED_SCOPES = {
  meta_pages_sandbox: META_PAGES_REQUIRED_SCOPES,
  linkedin_sandbox: ["w_member_social", "r_liteprofile"],
  x_sandbox: ["tweet.write", "tweet.read", "users.read"],
  tiktok: TIKTOK_REQUIRED_SCOPES,
  kwai: KWAI_REQUIRED_SCOPES,
  youtube: YOUTUBE_REQUIRED_SCOPES,
  instagram: META_INSTAGRAM_REQUIRED_SCOPES,
  facebook: META_INSTAGRAM_REQUIRED_SCOPES,
} as const;
const DEFAULT_WEBHOOK_SECRETS = {
  meta_pages_sandbox: "meta-pages-sandbox-webhook-secret",
  linkedin_sandbox: "linkedin-sandbox-webhook-secret",
  x_sandbox: "x-sandbox-webhook-secret",
} as const;

/**
 * Raiz de composição da API — mesmo papel que `buildRuntime()` cumpre para a CLI. Arthur/Caio/
 * Helena/Valentina/Clara/Icaro continuam fora daqui (nenhum endpoint os consome ainda).
 *
 * Sprint 05: `identity` só existe quando `authMode === "jwt"` — é o bloco de dependências que os
 * casos de uso de autenticação (`src/application/identity/`) e a rota `/v1/auth` precisam.
 * `authMode === "noop"` (dev/teste) não constrói nada disso; `identity` fica `undefined` e a rota
 * de auth deve tratar essa ausência explicitamente (não tentar autenticação real sem Postgres).
 */
export type ApiContainer = {
  authPort: AuthPort;
  workspaceRepository: WorkspaceRepositoryPort;
  assetLibraryRepository: AssetLibraryRepositoryPort;
  chatRepository: ChatRepositoryPort;
  conversationRepository: ConversationRepositoryPort;
  conversationEventRepository: ConversationEventRepositoryPort;
  conversationMemoryRepository: ConversationMemoryRepositoryPort;
  briefingRepository: BriefingRepositoryPort;
  briefingFieldValueRepository: BriefingFieldValueRepositoryPort;
  briefingQuestionRepository: BriefingQuestionRepositoryPort;
  preparedCommandRepository: PreparedCommandRepositoryPort;
  companyKnowledgeSource: CompanyKnowledgeSourcePort;
  assetMetadataSource: AssetMetadataSourcePort;
  /** Sprint 08 — `NotConfiguredAiGateway` quando `AI_GATEWAY_ENABLED` não está ligado (idêntico à
   * Sprint 07); um `AiGateway` real, com o provider Anthropic, quando está. */
  aiGateway: AiGatewayPort;
  aiExtractionEnabled: boolean;
  /** Sprint 09 — Planning Engine (só leitura pela API; escrita só via `planningEngineHook`, chamado
   * internamente por `briefing-use-cases.ts` ao confirmar/corrigir). */
  planningRepository: PlanningRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  planningArtifactRepository: PlanningArtifactRepositoryPort;
  planningDecisionRepository: PlanningDecisionRepositoryPort;
  planningEngineHook: BriefingPlanningHook;
  /** Sprint 10 — Runtime Engine (só leitura pela API; escrita só via `runtimeEngineHook`, chamado
   * internamente por `planning-engine.ts` quando um Planning fica `"ready"`/é superado). */
  runtimeRepository: RuntimeRepositoryPort;
  /** Sprint 12 — Execution Engine híbrido: dry_run determinístico e real controlado por handler resolver. */
  executionRepository: ExecutionRepositoryPort;
  /** Sprint 15/16 — Publication domain e operação assíncrona em memória. */
  publicationRepository: PublicationRepositoryPort;
  credentialRepository: CredentialRepositoryPort;
  operationalAuditRepository: OperationalAuditRepositoryPort;
  webhookEventRepository: WebhookEventRepositoryPort;
  schedulingRepository: SchedulingRepositoryPort;
  analyticsRepository: AnalyticsRepositoryPort;
  clock: ClockPort;
  publicationProviders: readonly PublicationProviderPort[];
  publicationProviderAdapters: readonly PublicationProviderAdapterPort[];
  publicationProviderRegistry: PublicationProviderRegistry;
  publicationProviderPolicy: PublicationProviderPolicy;
  publicationGovernancePolicy: PublicationGovernancePolicy;
  credentialGovernanceService: CredentialGovernanceService;
  complianceService: ComplianceService;
  publicationSynchronizationService: PublicationSynchronizationService;
  webhookIngestionService: WebhookIngestionService;
  schedulingUseCases: SchedulingUseCases;
  schedulingTemporalDispatcher: TemporalDispatcher;
  schedulingRecoveryService: SchedulingRecoveryService;
  schedulingHealthService: SchedulingHealthService;
  analyticsMetricRegistry: AnalyticsMetricRegistry;
  analyticsIngestionService: AnalyticsEventIngestionService;
  analyticsEventConsumer: AnalyticsEventConsumer;
  analyticsQueryService: AnalyticsQueryService;
  analyticsSnapshotBuilder: AnalyticsSnapshotBuilder;
  analyticsSnapshotRebuilder: AnalyticsSnapshotRebuilder;
  analyticsDataQualityService: AnalyticsDataQualityService;
  analyticsInsightEngine: AnalyticsInsightEngine;
  analyticsAlertService: AnalyticsAlertService;
  analyticsExportService: AnalyticsExportService;
  analyticsRetentionService: AnalyticsRetentionService;
  analyticsHealthService: AnalyticsHealthService;
  operationalStateRepository: OperationalStateRepositoryPort;
  secretManager: SecretManagerPort;
  productionGuard: ProductionGuard;
  operationalCircuitBreaker: OperationalCircuitBreaker;
  operationalRateLimiter: OperationalRateLimiter;
  operationalBackpressure: BackpressureController;
  operationalCache: InMemoryTtlCache;
  operationalHealthService: OperationalHealthService;
  backupRestorePlanner: BackupRestorePlanner;
  publicationSecretStore: PublicationSecretStoragePort;
  publicationSecretResolver: PublicationSecretResolverPort;
  metaPagesOAuthService: MetaPagesOAuthService;
  tiktokOAuthService: TikTokOAuthService;
  tiktokProvider: TikTokContentPostingProvider;
  kwaiOAuthService: KwaiOAuthService;
  kwaiProvider: KwaiContentPostingProvider;
  youtubeOAuthService: YouTubeOAuthService;
  youtubeProvider: YouTubeContentPostingProvider;
  metaInstagramOAuthService: MetaInstagramOAuthService;
  instagramProvider: MetaContentPostingProvider;
  facebookProvider: MetaContentPostingProvider;
  objectStorage: ObjectStoragePort;
  publicationQueue: PublicationQueuePort;
  /** Sprint 26 — Provedores de IA (imagem/vídeo). Registro sempre existe; adapters só entram
   * habilitados quando configurados via env/painel admin. */
  aiMediaProviderAdapters: readonly AiMediaProviderAdapterPort[];
  aiMediaProviderRegistry: AiMediaProviderRegistry;
  /** Só existe em modo "jwt" (precisa de `aiProvidersRepository` real via Postgres). */
  mediaGenerationService?: MediaGenerationService;
  executionHandlers: [DeterministicExecutionTaskHandler];
  executionFeatureFlags: ExecutionFeatureFlags;
  executionContractRegistry: ExecutionContractRegistry;
  executionEnvironmentPolicy: ExecutionEnvironmentPolicy;
  executionSideEffectGuard: SideEffectGuard;
  executionCircuitBreaker: HandlerCircuitBreakerPort;
  createExecutionHandlerResolver(): Promise<ExecutionHandlerResolver>;
  /** Perfil "Valentina" (tenant/plano/limites) que os skills reais (Sofia/Bianca/Pedro) exigem —
   * sistema separado do tenant de billing HTTP principal (`identity.platformBillingRepository`).
   * Usado por `production.route.ts` para garantir que a conta interna tenha um perfil antes da
   * primeira geração real. */
  valentina: ValentinaTenantPort;
  /** Garante (idempotente) que a conta interna tenha um perfil Valentina antes da primeira geração
   * real — ver comentário junto da implementação. */
  ensureHouseTenantProfile(tenantId: string): Promise<void>;
  /** Presente quando `persistenceDriver === "postgres"` — `app.ts` fecha isto no hook `onClose`. */
  pool?: pg.Pool;

  identity?: {
    userRepository: UserRepositoryPort;
    membershipRepository: TenantMembershipRepositoryPort;
    sessionRepository: SessionRepositoryPort;
    refreshTokenRepository: RefreshTokenRepositoryPort;
    auditLog: AuditLogPort;
    platformBillingRepository: PlatformBillingRepositoryPort;
    platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
    aiProvidersRepository: AiProvidersRepositoryPort;
    passwordHasher: PasswordHasherPort;
    jwt: JwtPort;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    /** Pool próprio (independente do `pool` de Workspace/Asset/Chat) — ver `buildIdentityRepositories`. Fechado no hook `onClose` também. */
    pool: pg.Pool;
  };
};

export function buildApiContainer(config?: ApiConfig): ApiContainer {
  const repositories = buildPlatformRepositories({
    driver: config?.persistenceDriver ?? "memory",
    databaseUrl: config?.databaseUrl,
  });

  const authMode = config?.authMode ?? "noop";
  // Repos de identidade (inclui `platformAiSettingsRepository`) só existem em modo "jwt". Precisam
  // ser construídos ANTES do buildAiGateway para permitir gestão dinâmica das configs de IA.
  const identityRepositories = authMode === "jwt" && config?.databaseUrl && config?.jwtSecret
    ? buildIdentityRepositories({ databaseUrl: config.databaseUrl, secretsMasterKey: config.jwtSecret })
    : undefined;

  const { aiGateway, aiExtractionEnabled } = buildAiGateway({
    aiConfig: config?.aiGateway ?? DISABLED_AI_GATEWAY_CONFIG,
    executionRepository: repositories.aiExecutionRepository,
    platformAiSettingsRepository: identityRepositories?.platformAiSettingsRepository,
  });

  const runtimeEngineHook = new RuntimeEnginePlanningHook({
    runtimeRepository: repositories.runtimeRepository,
    executionTaskRepository: repositories.executionTaskRepository,
    executionGraphRepository: repositories.executionGraphRepository,
    artifactRepository: repositories.planningArtifactRepository,
    idGenerator: defaultRuntimeIdGenerator,
  });

  const planningEngineHook = new PlanningEngineBriefingHook({
    planningRepository: repositories.planningRepository,
    executionGraphRepository: repositories.executionGraphRepository,
    executionTaskRepository: repositories.executionTaskRepository,
    artifactRepository: repositories.planningArtifactRepository,
    decisionRepository: repositories.planningDecisionRepository,
    idGenerator: defaultPlanningIdGenerator,
    runtimeEngine: runtimeEngineHook,
  });
  const executionHandlers: [DeterministicExecutionTaskHandler] = [new DeterministicExecutionTaskHandler()];
  const executionFeatureFlags: ExecutionFeatureFlags = {
    realExecutionEnabled: config?.execution.realExecutionEnabled ?? false,
    realExecutionResearchEnabled: config?.execution.realExecutionResearchEnabled ?? false,
    realPlanningEnabled: config?.execution.realPlanningEnabled ?? false,
    realCopyEnabled: config?.execution.realCopyEnabled ?? false,
    realVisualEnabled: config?.execution.realVisualEnabled ?? false,
    realDistributionEnabled: config?.execution.realDistributionEnabled ?? false,
  };
  const executionContractRegistry = createDefaultExecutionContractRegistry();
  const executionEnvironmentPolicy = createExecutionEnvironmentPolicy(config?.execution.environment ?? "development");
  const executionSideEffectGuard = new SideEffectGuard(executionEnvironmentPolicy);
  const executionCircuitBreaker = new InMemoryHandlerCircuitBreaker({ now: () => new Date() });
  const secretManager = config?.operations.secretManagerProvider === "production"
    ? repositories.pool && config.jwtSecret
      ? new PostgresSecretManager(repositories.pool, config.jwtSecret)
      : new FailClosedProductionSecretManager()
    : new InMemorySecretManager();
  const objectStorage: ObjectStoragePort = (() => {
    const oss = config?.objectStorage;
    if (oss?.enabled && oss.driver === "local" && oss.localDir && oss.publicBaseUrl) {
      return new LocalObjectStorage({
        rootDir: oss.localDir,
        publicBaseUrl: oss.publicBaseUrl,
      });
    }
    if (oss?.enabled && oss.bucket && oss.accessKeyId && oss.secretAccessKey) {
      return new S3ObjectStorage({
        endpoint: oss.endpoint,
        region: oss.region,
        bucket: oss.bucket,
        accessKeyId: oss.accessKeyId,
        secretAccessKey: oss.secretAccessKey,
        publicBaseUrl: oss.publicBaseUrl,
        forcePathStyle: oss.forcePathStyle,
        acl: oss.acl,
      });
    }
    return new DisabledObjectStorage();
  })();
  const productionGuard = new ProductionGuard(
    {
      environment: config?.execution.environment ?? "development",
      productionEnabled: config?.publication.productionEnabled ?? false,
      providerEnvironment: config?.publication.providerEnvironment ?? "sandbox",
      canaryEnabled: config?.publication.canaryEnabled ?? false,
      canaryTenantIds: config?.publication.canaryTenantIds ?? [],
      canaryWorkspaceIds: config?.publication.canaryWorkspaceIds ?? [],
      allowedProductionProviders: ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube"],
    },
    secretManager,
  );
  const operationalCircuitBreaker = new OperationalCircuitBreaker(repositories.operationalStateRepository, {
    failureThreshold: config?.operations.circuitBreakerFailureThreshold ?? 2,
    cooldownMs: config?.operations.circuitBreakerCooldownMs ?? 60_000,
  });
  const operationalRateLimiter = new OperationalRateLimiter(repositories.operationalStateRepository, {
    defaultLimit: config?.operations.rateLimitDefaultLimit ?? 120,
    windowMs: config?.operations.rateLimitWindowMs ?? 60_000,
  });
  const operationalBackpressure = new BackpressureController(repositories.operationalStateRepository, {
    publicationQueueMax: config?.operations.publicationQueueMax ?? 500,
    publicationOutboxPendingMax: config?.operations.publicationOutboxPendingMax ?? 500,
    publicationDeadLetterMax: config?.operations.publicationDeadLetterMax ?? 25,
    schedulingLateMsMax: config?.operations.schedulingLateMsMax ?? 15 * 60_000,
    analyticsDeadLetterMax: config?.operations.analyticsDeadLetterMax ?? 25,
    idGenerator: defaultGovernanceIdGenerator,
  });
  const operationalCache = new InMemoryTtlCache();
  const backupRestorePlanner = new BackupRestorePlanner();
  const publicationProviders = [new DryRunPublicationProvider(), new FakePublicationProvider()];
  const metaPagesSandboxProvider = new MetaPagesSandboxProvider({ graphBaseUrl: config?.publication.metaGraphBaseUrl });
  const linkedInSandboxProvider = createLinkedInSandboxProvider();
  const xSandboxProvider = createXSandboxProvider();
  // O provider precisa renovar o token antes de publicar, mas o serviço OAuth só nasce adiante
  // (depende da governança de credenciais) — daí a referência tardia resolvida no momento da chamada.
  let tiktokOAuthServiceRef: TikTokOAuthService | undefined;
  const tiktokProvider = new TikTokContentPostingProvider(
    { apiBaseUrl: config?.publication.tiktokApiBaseUrl },
    fetch,
    (input) => (tiktokOAuthServiceRef ? tiktokOAuthServiceRef.refresh(input) : Promise.resolve(undefined)),
  );
  // O provider precisa renovar o Page Access Token antes de publicar, mas o serviço OAuth só nasce
  // adiante (depende da governança de credenciais) — daí a referência tardia, igual ao TikTok.
  let metaInstagramOAuthServiceRef: MetaInstagramOAuthService | undefined;
  const metaRefresh = (input: { tenantId: string; workspaceId: string; credentialReferenceId: string }) =>
    metaInstagramOAuthServiceRef ? metaInstagramOAuthServiceRef.refresh(input) : Promise.resolve(undefined);
  const instagramProvider = new MetaContentPostingProvider("instagram", { graphBaseUrl: config?.publication.metaGraphBaseUrl }, fetch, metaRefresh);
  const facebookProvider = new MetaContentPostingProvider("facebook", { graphBaseUrl: config?.publication.metaGraphBaseUrl }, fetch, metaRefresh);
  let kwaiOAuthServiceRef: KwaiOAuthService | undefined;
  const kwaiProvider = new KwaiContentPostingProvider(
    { appId: config?.publication.kwaiAppId, apiBaseUrl: config?.publication.kwaiApiBaseUrl },
    fetch,
    (input) => (kwaiOAuthServiceRef ? kwaiOAuthServiceRef.refresh(input) : Promise.resolve(undefined)),
  );
  let youtubeOAuthServiceRef: YouTubeOAuthService | undefined;
  const youtubeProvider = new YouTubeContentPostingProvider(
    { apiBaseUrl: config?.publication.youtubeApiBaseUrl, uploadBaseUrl: config?.publication.youtubeUploadBaseUrl },
    fetch,
    (input) => (youtubeOAuthServiceRef ? youtubeOAuthServiceRef.refresh(input) : Promise.resolve(undefined)),
  );
  const publicationProviderAdapters: readonly PublicationProviderAdapterPort[] = [
    ...publicationProviders,
    ...(config?.publication.metaPagesSandboxEnabled ? [metaPagesSandboxProvider] : []),
    linkedInSandboxProvider,
    xSandboxProvider,
    ...(config?.publication.tiktokEnabled ? [tiktokProvider] : []),
    ...(config?.publication.kwaiEnabled ? [kwaiProvider] : []),
    ...(config?.publication.youtubeEnabled ? [youtubeProvider] : []),
    ...(config?.publication.metaInstagramEnabled ? [instagramProvider, facebookProvider] : []),
  ];
  const publicationProviderRegistry = createDefaultPublicationProviderRegistry(publicationProviderAdapters);
  const tiktokRequiredScopes = config?.publication.tiktokScopes.length
    ? config.publication.tiktokScopes
    : TIKTOK_REQUIRED_SCOPES;
  const providerRequiredScopes = {
    ...PROVIDER_REQUIRED_SCOPES,
    tiktok: tiktokRequiredScopes,
    youtube: config?.publication.youtubeScopes.length ? config.publication.youtubeScopes : YOUTUBE_REQUIRED_SCOPES,
  };

  // Sprint 26 — Provedores de IA de mídia (imagem/vídeo). Mesma filosofia da chave dinâmica da
  // Anthropic (`AnthropicAiModelProvider.getApiKey`): quando há Postgres real, a chave configurada
  // pelo painel admin (`ai_providers.secret_reference`, via `secretManager`) tem prioridade sobre a
  // variável de ambiente — permite trocar/ligar sem restart.
  const resolveMediaProviderKey = (envKey: string | undefined, secretReference: string) => async (): Promise<string | undefined> => {
    const stored = await secretManager.get(secretReference).catch(() => undefined);
    const storedKey = stored?.value?.apiKey;
    return storedKey ?? envKey;
  };
  const openaiImageProvider = new OpenAiImageProviderAdapter({
    enabled: config?.mediaProviders.openaiEnabled ?? false,
    apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
    persistGeneratedImage: async ({ base64, tenantId }) => {
      const result = await objectStorage.put({
        key: `ai-generated/${tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`,
        body: Buffer.from(base64, "base64"),
        contentType: "image/png",
      });
      return result.url;
    },
  });
  const googleVeoProvider = new GoogleVeoProviderAdapter({
    enabled: config?.mediaProviders.googleEnabled ?? false,
    apiBaseUrl: config?.mediaProviders.googleApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.googleApiKey, "ai-provider:google"),
  });
  const aiMediaProviderAdapters: readonly AiMediaProviderAdapterPort[] = [openaiImageProvider, googleVeoProvider];

  // Ponte real para os skills (Sofia/Bianca/Pedro) rodarem via HTTP — antes disso, nenhuma
  // dependência era passada para `buildExecutionHandlerResolver` e Pedro caía num Proxy que
  // lançava erro no primeiro uso ("IcaroBrainPort não configurado"). `valentina`/`clara` usam
  // armazenamento em JSON (mesma classe que a CLI já usa), dentro do volume de uploads já
  // existente — sem infraestrutura nova. `icaro` reaproveita o `openaiImageProvider` já wireado
  // acima (chave/objectStorage já resolvidos) via `OpenAiIcaroImageProvider`.
  const tenantDataDir = join(config?.objectStorage?.localDir ?? "./data", "vorix-tenant-data");
  const valentinaRepository = new LocalJsonValentinaTenantRepository(join(tenantDataDir, "tenants.json"));
  const valentina = new ValentinaTenantManager({ repository: valentinaRepository });
  const clara = new ClaraKnowledgeCenter({
    repository: new LocalJsonClaraKnowledgeRepository(join(tenantDataDir, "knowledge.json")),
  });
  const icaro = new IcaroAIBrain({ providers: [new OpenAiIcaroImageProvider(openaiImageProvider)] });
  const createExecutionHandlerResolver = () =>
    buildExecutionHandlerResolver({
      featureFlags: executionFeatureFlags,
      runtimeDependencies: { valentina, clara, icaro },
      runtimeRepository: repositories.runtimeRepository,
      preparedCommandRepository: repositories.preparedCommandRepository,
    });
  // `ValentinaTenantManager.createTenant` sempre gera um `id` novo (nunca aceita um `id`
  // explícito) — mas os skills reais (Pedro/Sofia/Bianca...) chamam
  // `valentina.getClientContext(input.tenantId)` usando o tenantId REAL da plataforma (o mesmo
  // de `principal.tenantId`), que precisa bater exatamente com `TenantRecord.id`. Por isso este
  // bootstrap grava o registro direto no repositório (que aceita `save(record)` com `id` livre)
  // em vez de passar por `createTenant`. Idempotente — não faz nada se o registro já existir.
  const ensureHouseTenantProfile = async (tenantId: string): Promise<void> => {
    await ensureHouseValentinaProfile(tenantId);
    await ensureHouseBrandContext(tenantId);
  };
  const ensureHouseValentinaProfile = async (tenantId: string): Promise<void> => {
    const existing = await valentinaRepository.findById(tenantId);
    if (existing) return;
    const now = new Date().toISOString();
    await valentinaRepository.save({
      id: tenantId,
      clientId: tenantId,
      displayName: "Vorix",
      status: "active",
      subscriptionStatus: "active",
      plan: "ENTERPRISE",
      planLimits: {
        monthlyAiTokens: "unlimited",
        dailyAiTokens: "unlimited",
        specialists: "all",
        features: "all",
        integrations: "all",
        monthlyPublications: "unlimited",
        monthlyCampaigns: "unlimited",
        monthlyImages: "unlimited",
        monthlyVideos: "unlimited",
      },
      createdAt: now,
      updatedAt: now,
      mainObjectives: [],
      connectedSocialNetworks: [],
      integrations: {},
      credits: { addedAiTokens: 0, consumedExtraAiTokens: 0, availableExtraAiTokens: 0 },
      usage: { monthly: [] },
      enabledSpecialists: "all",
      enabledFeatures: "all",
      permissions: {
        canPublish: true,
        canCreateCampaigns: true,
        canUsePaidAds: true,
        canUseImageGeneration: true,
        canUseVideoGeneration: true,
      },
      settings: { timezone: "America/Sao_Paulo", language: "pt-BR", country: "BR", environment: "production", preferences: {} },
      currentVersion: 1,
      versions: [],
      history: [],
    });
  };
  // Sofia (`sofia-art-direction.skill.ts`, `evaluateVisualContextCompleteness`) recusa gerar
  // direção visual (`status: "needs_more_context"`) se a Clara não tiver NENHUM registro
  // "IdentityContext" nem "BrandContext" para o `clientId` — sem isso a geração real falha sempre,
  // mesmo com tudo mais correto. Bootstrap idempotente do mínimo necessário (um BrandContext
  // genérico), mesmo espírito de `ensureHouseValentinaProfile` acima.
  const ensureHouseBrandContext = async (tenantId: string): Promise<void> => {
    const existing = await clara.list({ clientId: tenantId, module: "BrandContext", status: "active" });
    if (existing.length > 0) return;
    await clara.create({
      module: "BrandContext",
      title: "Identidade de marca — Vorix (interno)",
      payload: {
        clientId: tenantId,
        brandName: "Vorix",
        positioning: "Plataforma de marketing com IA para pequenos e médios negócios.",
        toneOfVoice: "claro, direto e confiável",
      },
      audit: { actor: { id: "system", type: "system" }, reason: "Bootstrap automático do tenant interno para geração real de imagem." },
    });
  };
  const aiMediaProviderRegistry = createDefaultAiMediaProviderRegistry(aiMediaProviderAdapters);

  const publicationSecretStore = new SecretManagerPublicationSecretStore(secretManager);
  const publicationSecretResolver = new CompositePublicationSecretResolver(new StoredPublicationSecretResolver(publicationSecretStore), new FakePublicationSecretResolver());
  const publicationProviderPolicy = new PublicationProviderPolicy(
    { environment: config?.publication.providerEnvironment ?? "sandbox", productionEnabled: config?.publication.productionEnabled ?? false },
    { enabled: config?.publication.canaryEnabled ?? false, providerId: "meta_pages_sandbox", providerIds: config?.publication.canaryProviderIds ?? [], tenantIds: config?.publication.canaryTenantIds ?? [], workspaceIds: config?.publication.canaryWorkspaceIds ?? [] },
  );
  const publicationGovernancePolicy = new PublicationGovernancePolicy(
    { environment: config?.publication.providerEnvironment ?? "sandbox", productionEnabled: config?.publication.productionEnabled ?? false },
    { enabled: config?.publication.canaryEnabled ?? false, providerId: "meta_pages_sandbox", providerIds: config?.publication.canaryProviderIds ?? [], tenantIds: config?.publication.canaryTenantIds ?? [], workspaceIds: config?.publication.canaryWorkspaceIds ?? [] },
  );
  const credentialGovernanceService = new CredentialGovernanceService({
    credentialRepository: repositories.credentialRepository,
    auditRepository: repositories.operationalAuditRepository,
    publicationRepository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    idGenerator: defaultGovernanceIdGenerator,
    requiredScopes: providerRequiredScopes,
  });
  const complianceService = new ComplianceService({
    credentialRepository: repositories.credentialRepository,
    auditRepository: repositories.operationalAuditRepository,
    publicationRepository: repositories.publicationRepository,
    webhookRepository: repositories.webhookEventRepository,
  });
  const publicationSynchronizationService = new PublicationSynchronizationService({
    webhookRepository: repositories.webhookEventRepository,
    publicationRepository: repositories.publicationRepository,
    auditRepository: repositories.operationalAuditRepository,
    idGenerator: defaultGovernanceIdGenerator,
  });
  const webhookIngestionService = new WebhookIngestionService({
    webhookRepository: repositories.webhookEventRepository,
    synchronizationService: publicationSynchronizationService,
    providerDescriptors: () => publicationProviderRegistry.list(),
    webhookSecrets: {
      ...DEFAULT_WEBHOOK_SECRETS,
      ...definedWebhookSecrets(config?.publication.webhookSecrets ?? {}),
    },
    idGenerator: defaultGovernanceIdGenerator,
  });
  const metaPagesOAuthService = new MetaPagesOAuthService({
    config: {
      enabled: config?.publication.metaPagesSandboxEnabled ?? false,
      appId: config?.publication.metaAppId,
      appSecret: config?.publication.metaAppSecret,
      redirectUri: config?.publication.metaRedirectUri,
      graphBaseUrl: config?.publication.metaGraphBaseUrl,
      scopes: META_PAGES_REQUIRED_SCOPES,
    },
    repository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    credentialGovernanceService,
  });
  const tiktokOAuthService = new TikTokOAuthService({
    config: {
      enabled: config?.publication.tiktokEnabled ?? false,
      clientKey: config?.publication.tiktokClientKey,
      clientSecret: config?.publication.tiktokClientSecret,
      redirectUri: config?.publication.tiktokRedirectUri,
      apiBaseUrl: config?.publication.tiktokApiBaseUrl,
      authorizeBaseUrl: config?.publication.tiktokAuthorizeBaseUrl,
      scopes: tiktokRequiredScopes,
      environment: config?.publication.providerEnvironment ?? "sandbox",
      pkceEnabled: config?.publication.tiktokPkceEnabled ?? false,
    },
    repository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    credentialGovernanceService,
  });
  tiktokOAuthServiceRef = tiktokOAuthService;
  const kwaiOAuthService = new KwaiOAuthService({
    config: {
      enabled: config?.publication.kwaiEnabled ?? false,
      appId: config?.publication.kwaiAppId,
      appSecret: config?.publication.kwaiAppSecret,
      redirectUri: config?.publication.kwaiRedirectUri,
      apiBaseUrl: config?.publication.kwaiApiBaseUrl,
      scopes: KWAI_REQUIRED_SCOPES,
      environment: config?.publication.providerEnvironment ?? "sandbox",
    },
    repository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    credentialGovernanceService,
  });
  kwaiOAuthServiceRef = kwaiOAuthService;
  const youtubeOAuthService = new YouTubeOAuthService({
    config: {
      enabled: config?.publication.youtubeEnabled ?? false,
      clientId: config?.publication.youtubeClientId,
      clientSecret: config?.publication.youtubeClientSecret,
      redirectUri: config?.publication.youtubeRedirectUri,
      apiBaseUrl: config?.publication.youtubeApiBaseUrl,
      scopes: config?.publication.youtubeScopes.length ? config.publication.youtubeScopes : YOUTUBE_REQUIRED_SCOPES,
      environment: config?.publication.providerEnvironment ?? "sandbox",
    },
    repository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    credentialGovernanceService,
  });
  youtubeOAuthServiceRef = youtubeOAuthService;
  const metaInstagramOAuthService = new MetaInstagramOAuthService({
    config: {
      enabled: config?.publication.metaInstagramEnabled ?? false,
      appId: config?.publication.metaAppId,
      appSecret: config?.publication.metaAppSecret,
      redirectUri: config?.publication.metaInstagramRedirectUri,
      graphBaseUrl: config?.publication.metaGraphBaseUrl,
      loginConfigId: config?.publication.metaLoginConfigId,
      scopes: META_INSTAGRAM_REQUIRED_SCOPES,
    },
    repository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    credentialGovernanceService,
  });
  metaInstagramOAuthServiceRef = metaInstagramOAuthService;
  const publicationQueue = new InMemoryPublicationQueue();
  const clock = new SystemClock();
  const scheduleOccurrenceGenerator = new ScheduleOccurrenceGenerator({
    windowDays: config?.scheduling.occurrenceWindowDays ?? 30,
    maxOccurrencesPerRun: config?.scheduling.maxOccurrencesPerRun ?? 200,
  });
  const scheduleConflictDetector = new ScheduleConflictDetector({
    repository: repositories.schedulingRepository,
    idGenerator: defaultGovernanceIdGenerator,
    conflictWindowMinutes: config?.scheduling.conflictWindowMinutes ?? 30,
  });
  const schedulingPublicationDispatcher = new SchedulingPublicationDispatcher({
    publicationRepository: repositories.publicationRepository,
    credentialRepository: repositories.credentialRepository,
    auditRepository: repositories.operationalAuditRepository,
    providerRegistry: publicationProviderRegistry,
    providerPolicy: publicationProviderPolicy,
    publicationGovernancePolicy,
    secretResolver: publicationSecretResolver,
    queue: publicationQueue,
    providers: publicationProviders,
    idGenerator: defaultGovernanceIdGenerator,
    now: () => clock.now(),
  });
  const schedulingUseCases = new SchedulingUseCases({
    repository: repositories.schedulingRepository,
    publicationRepository: repositories.publicationRepository,
    auditRepository: repositories.operationalAuditRepository,
    clock,
    occurrenceGenerator: scheduleOccurrenceGenerator,
    conflictDetector: scheduleConflictDetector,
    idGenerator: defaultGovernanceIdGenerator,
  });
  const schedulingTemporalDispatcher = new TemporalDispatcher({
    repository: repositories.schedulingRepository,
    dispatcher: schedulingPublicationDispatcher,
    auditRepository: repositories.operationalAuditRepository,
    clock,
    idGenerator: defaultGovernanceIdGenerator,
    leaseMs: config?.scheduling.leaseMs ?? 60_000,
    maxBatch: config?.scheduling.maxBatch ?? 10,
    missedGraceMs: config?.scheduling.missedGraceMs ?? 15 * 60_000,
  });
  const schedulingRecoveryService = new SchedulingRecoveryService({
    repository: repositories.schedulingRepository,
    auditRepository: repositories.operationalAuditRepository,
    clock,
    idGenerator: defaultGovernanceIdGenerator,
    missedGraceMs: config?.scheduling.missedGraceMs ?? 15 * 60_000,
  });
  const schedulingHealthService = new SchedulingHealthService({
    repository: repositories.schedulingRepository,
    publicationRepository: repositories.publicationRepository,
    clock,
    lateThresholdMs: config?.scheduling.lateThresholdMs ?? 15 * 60_000,
  });
  const analyticsMetricRegistry = new AnalyticsMetricRegistry();
  const analyticsDeps = {
    repository: repositories.analyticsRepository,
    auditRepository: repositories.operationalAuditRepository,
    clock,
    metricRegistry: analyticsMetricRegistry,
    idGenerator: defaultGovernanceIdGenerator,
    maxQueryDays: config?.analytics.maxQueryDays ?? 370,
  };
  const analyticsIngestionService = new AnalyticsEventIngestionService(analyticsDeps);
  const analyticsEventConsumer = new AnalyticsEventConsumer(analyticsIngestionService);
  const analyticsQueryService = new AnalyticsQueryService(analyticsDeps);
  const analyticsSnapshotBuilder = new AnalyticsSnapshotBuilder(analyticsDeps);
  const analyticsSnapshotRebuilder = new AnalyticsSnapshotRebuilder(analyticsSnapshotBuilder, repositories.analyticsRepository);
  const analyticsDataQualityService = new AnalyticsDataQualityService(analyticsDeps);
  const analyticsInsightEngine = new AnalyticsInsightEngine(analyticsDeps);
  const analyticsAlertService = new AnalyticsAlertService(analyticsDeps);
  const analyticsExportService = new AnalyticsExportService(analyticsDeps);
  const analyticsRetentionService = new AnalyticsRetentionService(analyticsDeps);
  const analyticsHealthService = new AnalyticsHealthService(analyticsDeps);
  const operationalHealthService = new OperationalHealthService({
    repository: repositories.operationalStateRepository,
    secretManager,
    productionGuard,
    publicationQueue,
    pool: repositories.pool,
    persistenceDriver: config?.persistenceDriver ?? "memory",
    publicationRepository: repositories.publicationRepository,
    schedulingRepository: repositories.schedulingRepository,
    analyticsRepository: repositories.analyticsRepository,
    schedulingHealthService,
    analyticsHealthService,
  });

  // Sem config nenhuma (ex.: alguns testes chamam buildApiContainer() sem argumento) equivale a
  // "noop" por segurança — só uma config REAL carregada via loadApiConfig() pode pedir "jwt"
  // (e loadApiConfig já valida jwtSecret/databaseUrl antes de chegar aqui).

  if (authMode === "jwt") {
    if (!config?.jwtSecret || !config.databaseUrl || !identityRepositories) {
      throw new Error('buildApiContainer: authMode "jwt" exige jwtSecret e databaseUrl configurados.');
    }

    const jwtPort = new JsonWebTokenJwtAdapter(config.jwtSecret);

    // Sprint 25/Fase 2 (migrado na Sprint 26 para crédito fixo por operação) — envolve o AI
    // Gateway real com controle de créditos Vorix por Tenant. Só no modo "jwt" (produção) porque
    // só nesse modo temos os repositórios reais configurados; em "noop"/testes locais o Gateway
    // roda "cru" para não exigir setup extra.
    const creditAccounting = new CreditAccountingService({
      platformBillingRepository: identityRepositories.platformBillingRepository,
      aiProvidersRepository: identityRepositories.aiProvidersRepository,
      idGenerator: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const gatedAiGateway = new CreditGatedAiGateway({
      inner: aiGateway,
      creditAccounting,
      now: () => new Date(),
    });
    const mediaGenerationService = new MediaGenerationService({
      registry: aiMediaProviderRegistry,
      creditAccounting,
      aiProvidersRepository: identityRepositories.aiProvidersRepository,
      now: () => new Date(),
    });

    return {
      authPort: new JwtAuthAdapter(jwtPort),
      aiGateway: gatedAiGateway,
      aiExtractionEnabled,
      aiMediaProviderAdapters,
      aiMediaProviderRegistry,
      mediaGenerationService,
      executionHandlers,
      executionFeatureFlags,
      executionContractRegistry,
      executionEnvironmentPolicy,
      executionSideEffectGuard,
      executionCircuitBreaker,
      publicationProviders,
      publicationProviderAdapters,
      publicationProviderRegistry,
      publicationProviderPolicy,
      publicationGovernancePolicy,
      credentialGovernanceService,
      complianceService,
      publicationSynchronizationService,
      webhookIngestionService,
      schedulingUseCases,
      schedulingTemporalDispatcher,
      schedulingRecoveryService,
      schedulingHealthService,
      analyticsMetricRegistry,
      analyticsIngestionService,
      analyticsEventConsumer,
      analyticsQueryService,
      analyticsSnapshotBuilder,
      analyticsSnapshotRebuilder,
      analyticsDataQualityService,
      analyticsInsightEngine,
      analyticsAlertService,
      analyticsExportService,
      analyticsRetentionService,
      analyticsHealthService,
      secretManager,
      productionGuard,
      operationalCircuitBreaker,
      operationalRateLimiter,
      operationalBackpressure,
      operationalCache,
      operationalHealthService,
      backupRestorePlanner,
      publicationSecretStore,
      publicationSecretResolver,
      metaPagesOAuthService,
      tiktokOAuthService,
      tiktokProvider,
      kwaiOAuthService,
      kwaiProvider,
      youtubeOAuthService,
      youtubeProvider,
      metaInstagramOAuthService,
      instagramProvider,
      facebookProvider,
      objectStorage,
      publicationQueue,
      clock,
      createExecutionHandlerResolver,
      valentina,
      ensureHouseTenantProfile,
      planningEngineHook,
      ...repositories,
      identity: {
        ...identityRepositories,
        passwordHasher: new BcryptPasswordHasher(),
        jwt: jwtPort,
        accessTokenTtlSeconds: config.accessTokenTtlSeconds,
        refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
      },
    };
  }

  return {
    authPort: createNoopAuthAdapter({ devPrincipal: config?.devPrincipal }),
    aiGateway,
    aiExtractionEnabled,
    aiMediaProviderAdapters,
    aiMediaProviderRegistry,
    executionHandlers,
    executionFeatureFlags,
    executionContractRegistry,
    executionEnvironmentPolicy,
    executionSideEffectGuard,
    executionCircuitBreaker,
    publicationProviders,
    publicationProviderAdapters,
    publicationProviderRegistry,
    publicationProviderPolicy,
    publicationGovernancePolicy,
    credentialGovernanceService,
    complianceService,
    publicationSynchronizationService,
    webhookIngestionService,
    schedulingUseCases,
    schedulingTemporalDispatcher,
    schedulingRecoveryService,
    schedulingHealthService,
    analyticsMetricRegistry,
    analyticsIngestionService,
    analyticsEventConsumer,
    analyticsQueryService,
    analyticsSnapshotBuilder,
    analyticsSnapshotRebuilder,
    analyticsDataQualityService,
    analyticsInsightEngine,
    analyticsAlertService,
    analyticsExportService,
    analyticsRetentionService,
    analyticsHealthService,
    secretManager,
    productionGuard,
    operationalCircuitBreaker,
    operationalRateLimiter,
    operationalBackpressure,
    operationalCache,
    operationalHealthService,
    backupRestorePlanner,
    publicationSecretStore,
    publicationSecretResolver,
    metaPagesOAuthService,
    tiktokOAuthService,
    tiktokProvider,
    kwaiOAuthService,
    kwaiProvider,
    youtubeOAuthService,
    youtubeProvider,
    metaInstagramOAuthService,
    instagramProvider,
    facebookProvider,
    objectStorage,
    publicationQueue,
    clock,
    createExecutionHandlerResolver,
    valentina,
    ensureHouseTenantProfile,
    planningEngineHook,
    ...repositories,
  };
}


function definedWebhookSecrets(input: Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>): Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value.length > 0)) as Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>;
}
