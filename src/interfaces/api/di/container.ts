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
import { FailClosedProductionSecretManager, InMemorySecretManager } from "../../../infrastructure/operations/secret-managers.js";
import { MetaPagesSandboxProvider } from "../../../infrastructure/publication/meta-pages-sandbox-provider.js";
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
  publicationQueue: PublicationQueuePort;
  executionHandlers: [DeterministicExecutionTaskHandler];
  executionFeatureFlags: ExecutionFeatureFlags;
  executionContractRegistry: ExecutionContractRegistry;
  executionEnvironmentPolicy: ExecutionEnvironmentPolicy;
  executionSideEffectGuard: SideEffectGuard;
  executionCircuitBreaker: HandlerCircuitBreakerPort;
  createExecutionHandlerResolver(): Promise<ExecutionHandlerResolver>;
  /** Presente quando `persistenceDriver === "postgres"` — `app.ts` fecha isto no hook `onClose`. */
  pool?: pg.Pool;

  identity?: {
    userRepository: UserRepositoryPort;
    membershipRepository: TenantMembershipRepositoryPort;
    sessionRepository: SessionRepositoryPort;
    refreshTokenRepository: RefreshTokenRepositoryPort;
    auditLog: AuditLogPort;
    platformBillingRepository: PlatformBillingRepositoryPort;
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

  const { aiGateway, aiExtractionEnabled } = buildAiGateway({
    aiConfig: config?.aiGateway ?? DISABLED_AI_GATEWAY_CONFIG,
    executionRepository: repositories.aiExecutionRepository,
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
    ? new FailClosedProductionSecretManager()
    : new InMemorySecretManager();
  const productionGuard = new ProductionGuard(
    {
      environment: config?.execution.environment ?? "development",
      productionEnabled: config?.publication.productionEnabled ?? false,
      providerEnvironment: config?.publication.providerEnvironment ?? "sandbox",
      canaryEnabled: config?.publication.canaryEnabled ?? false,
      canaryTenantIds: config?.publication.canaryTenantIds ?? [],
      canaryWorkspaceIds: config?.publication.canaryWorkspaceIds ?? [],
      allowedProductionProviders: ["instagram", "facebook", "linkedin", "x"],
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
  const createExecutionHandlerResolver = () => buildExecutionHandlerResolver({ featureFlags: executionFeatureFlags });
  const publicationProviders = [new DryRunPublicationProvider(), new FakePublicationProvider()];
  const metaPagesSandboxProvider = new MetaPagesSandboxProvider({ graphBaseUrl: config?.publication.metaGraphBaseUrl });
  const linkedInSandboxProvider = createLinkedInSandboxProvider();
  const xSandboxProvider = createXSandboxProvider();
  const publicationProviderAdapters: readonly PublicationProviderAdapterPort[] = config?.publication.metaPagesSandboxEnabled
    ? [...publicationProviders, metaPagesSandboxProvider, linkedInSandboxProvider, xSandboxProvider]
    : [...publicationProviders, linkedInSandboxProvider, xSandboxProvider];
  const publicationProviderRegistry = createDefaultPublicationProviderRegistry(publicationProviderAdapters);
  const publicationSecretStore = new SecretManagerPublicationSecretStore(secretManager);
  const publicationSecretResolver = new CompositePublicationSecretResolver(new StoredPublicationSecretResolver(publicationSecretStore), new FakePublicationSecretResolver());
  const publicationProviderPolicy = new PublicationProviderPolicy(
    { environment: config?.publication.providerEnvironment ?? "sandbox", productionEnabled: config?.publication.productionEnabled ?? false },
    { enabled: config?.publication.canaryEnabled ?? false, providerId: "meta_pages_sandbox", tenantIds: config?.publication.canaryTenantIds ?? [], workspaceIds: config?.publication.canaryWorkspaceIds ?? [] },
  );
  const publicationGovernancePolicy = new PublicationGovernancePolicy(
    { environment: config?.publication.providerEnvironment ?? "sandbox", productionEnabled: config?.publication.productionEnabled ?? false },
    { enabled: config?.publication.canaryEnabled ?? false, providerId: "meta_pages_sandbox", tenantIds: config?.publication.canaryTenantIds ?? [], workspaceIds: config?.publication.canaryWorkspaceIds ?? [] },
  );
  const credentialGovernanceService = new CredentialGovernanceService({
    credentialRepository: repositories.credentialRepository,
    auditRepository: repositories.operationalAuditRepository,
    publicationRepository: repositories.publicationRepository,
    secretStore: publicationSecretStore,
    idGenerator: defaultGovernanceIdGenerator,
    requiredScopes: PROVIDER_REQUIRED_SCOPES,
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
  const authMode = config?.authMode ?? "noop";

  if (authMode === "jwt") {
    if (!config?.jwtSecret || !config.databaseUrl) {
      throw new Error('buildApiContainer: authMode "jwt" exige jwtSecret e databaseUrl configurados.');
    }

    const identityRepositories = buildIdentityRepositories({ databaseUrl: config.databaseUrl });
    const jwtPort = new JsonWebTokenJwtAdapter(config.jwtSecret);

    // Sprint 25/Fase 2 — envolve o AI Gateway real com controle de créditos por Tenant. Só no
    // modo "jwt" (produção) porque só nesse modo temos `platform_billing_repository` real
    // configurado; em "noop"/testes locais o Gateway roda "cru" para não exigir setup extra.
    const gatedAiGateway = new CreditGatedAiGateway({
      inner: aiGateway,
      platformBillingRepository: identityRepositories.platformBillingRepository,
      idGenerator: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => new Date(),
    });

    return {
      authPort: new JwtAuthAdapter(jwtPort),
      aiGateway: gatedAiGateway,
      aiExtractionEnabled,
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
      publicationQueue,
      clock,
      createExecutionHandlerResolver,
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
    publicationQueue,
    clock,
    createExecutionHandlerResolver,
    planningEngineHook,
    ...repositories,
  };
}


function definedWebhookSecrets(input: Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>): Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value.length > 0)) as Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>;
}
