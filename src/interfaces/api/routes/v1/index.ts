import type { FastifyInstance } from "fastify";
import { registerAnalyticsRoutes } from "./analytics.route.js";
import { registerAdminRoutes } from "./admin.route.js";
import { registerAiProvidersRoutes } from "./ai-providers.route.js";
import { registerAssetsRoutes } from "./assets.route.js";
import { registerAuthRoutes } from "./auth.route.js";
import { registerBriefingRoutes } from "./briefings.route.js";
import { registerConversationRoutes } from "./conversations.route.js";
import { registerCredentialRoutes } from "./credentials.route.js";
import { registerHealthRoutes } from "./health.route.js";
import { registerPlanningRoutes } from "./planning.route.js";
import { registerPlatformPlansRoutes } from "./platform-plans.route.js";
import { registerProviderRoutes } from "./providers.route.js";
import { registerRuntimeRoutes } from "./runtime.route.js";
import { registerSchedulingRoutes } from "./scheduling.route.js";
import { registerSystemRoutes } from "./system.route.js";
import { registerTikTokRoutes } from "./tiktok.route.js";
import { registerYouTubeRoutes } from "./youtube.route.js";
import { registerInstagramRoutes } from "./instagram.route.js";
import { registerPublicationMediaRoutes } from "./publication-media.route.js";
import { registerExecutionRunRoutes } from "./execution-runs.route.js";
import { registerProductionRoutes } from "./production.route.js";
import { registerPublicationRoutes } from "./publications.route.js";
import { registerWebhookRoutes } from "./webhooks.route.js";
import { registerWorkspaceRoutes } from "./workspaces.route.js";

/**
 * Grupo de rotas `v1` — esqueleto de versionamento. Registrado sob o prefixo `/v1` (ver `app.ts`),
 * para que uma futura `v2` conviva lado a lado sem quebrar clientes existentes. `app.zunoContainer`/
 * `app.zunoConfig` (decorados por `registerDiPlugin` na instância pai) chegam aqui por herança de
 * decorators do Fastify — nenhuma rota importa um adapter diretamente.
 */
export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await registerHealthRoutes(app);
  await registerWorkspaceRoutes(app, {
    workspaceRepository: app.zunoContainer.workspaceRepository,
    platformBillingRepository: app.zunoContainer.identity?.platformBillingRepository,
  });
  await registerAuthRoutes(app, {
    identity: app.zunoContainer.identity,
    config: app.zunoConfig,
    workspaceRepository: app.zunoContainer.workspaceRepository,
  });
  await registerPlatformPlansRoutes(app);
  await registerConversationRoutes(app, {
    conversationRepository: app.zunoContainer.conversationRepository,
    eventRepository: app.zunoContainer.conversationEventRepository,
    memoryRepository: app.zunoContainer.conversationMemoryRepository,
    workspaceRepository: app.zunoContainer.workspaceRepository,
    briefingRepository: app.zunoContainer.briefingRepository,
    fieldValueRepository: app.zunoContainer.briefingFieldValueRepository,
    questionRepository: app.zunoContainer.briefingQuestionRepository,
    preparedCommandRepository: app.zunoContainer.preparedCommandRepository,
    companyKnowledgeSource: app.zunoContainer.companyKnowledgeSource,
    assetMetadataSource: app.zunoContainer.assetMetadataSource,
    aiGateway: app.zunoContainer.aiGateway,
    aiExtractionEnabled: app.zunoContainer.aiExtractionEnabled,
    planningEngine: app.zunoContainer.planningEngineHook,
  });
  await registerBriefingRoutes(app, {
    briefingRepository: app.zunoContainer.briefingRepository,
    fieldValueRepository: app.zunoContainer.briefingFieldValueRepository,
    questionRepository: app.zunoContainer.briefingQuestionRepository,
    preparedCommandRepository: app.zunoContainer.preparedCommandRepository,
    eventRepository: app.zunoContainer.conversationEventRepository,
    planningEngine: app.zunoContainer.planningEngineHook,
  });
  await registerPlanningRoutes(app, {
    planningRepository: app.zunoContainer.planningRepository,
    executionGraphRepository: app.zunoContainer.executionGraphRepository,
    executionTaskRepository: app.zunoContainer.executionTaskRepository,
    artifactRepository: app.zunoContainer.planningArtifactRepository,
    decisionRepository: app.zunoContainer.planningDecisionRepository,
  });
  await registerRuntimeRoutes(app, {
    runtimeRepository: app.zunoContainer.runtimeRepository,
    planningRepository: app.zunoContainer.planningRepository,
  });
  const executionHandlerResolver = await app.zunoContainer.createExecutionHandlerResolver();
  await registerExecutionRunRoutes(app, {
    executionRepository: app.zunoContainer.executionRepository,
    runtimeRepository: app.zunoContainer.runtimeRepository,
    planningRepository: app.zunoContainer.planningRepository,
    executionTaskRepository: app.zunoContainer.executionTaskRepository,
    executionGraphRepository: app.zunoContainer.executionGraphRepository,
    artifactRepository: app.zunoContainer.planningArtifactRepository,
    handlers: app.zunoContainer.executionHandlers,
    handlerResolver: executionHandlerResolver,
    featureFlags: app.zunoContainer.executionFeatureFlags,
    contractRegistry: app.zunoContainer.executionContractRegistry,
    sideEffectGuard: app.zunoContainer.executionSideEffectGuard,
    circuitBreaker: app.zunoContainer.executionCircuitBreaker,
    executionFeatureFlags: app.zunoContainer.executionFeatureFlags,
    executionEnvironmentPolicy: app.zunoContainer.executionEnvironmentPolicy,
    idGenerator: () => `execution-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerProductionRoutes(app, {
    conversationRepository: app.zunoContainer.conversationRepository,
    briefingRepository: app.zunoContainer.briefingRepository,
    fieldValueRepository: app.zunoContainer.briefingFieldValueRepository,
    questionRepository: app.zunoContainer.briefingQuestionRepository,
    preparedCommandRepository: app.zunoContainer.preparedCommandRepository,
    eventRepository: app.zunoContainer.conversationEventRepository,
    planningEngine: app.zunoContainer.planningEngineHook,
    planningRepository: app.zunoContainer.planningRepository,
    runtimeRepository: app.zunoContainer.runtimeRepository,
    executionRepository: app.zunoContainer.executionRepository,
    executionTaskRepository: app.zunoContainer.executionTaskRepository,
    executionGraphRepository: app.zunoContainer.executionGraphRepository,
    artifactRepository: app.zunoContainer.planningArtifactRepository,
    handlers: app.zunoContainer.executionHandlers,
    handlerResolver: executionHandlerResolver,
    featureFlags: app.zunoContainer.executionFeatureFlags,
    contractRegistry: app.zunoContainer.executionContractRegistry,
    sideEffectGuard: app.zunoContainer.executionSideEffectGuard,
    circuitBreaker: app.zunoContainer.executionCircuitBreaker,
    idGenerator: () => `execution-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ensureHouseTenantProfile: app.zunoContainer.ensureHouseTenantProfile,
    imageDescriber: app.zunoContainer.imageDescriber,
    copywriter: app.zunoContainer.copywriter,
  });
  await registerPublicationRoutes(app, {
    publicationRepository: app.zunoContainer.publicationRepository,
    credentialRepository: app.zunoContainer.credentialRepository,
    executionRepository: app.zunoContainer.executionRepository,
    providers: app.zunoContainer.publicationProviders,
    providerRegistry: app.zunoContainer.publicationProviderRegistry,
    providerPolicy: app.zunoContainer.publicationProviderPolicy,
    publicationGovernancePolicy: app.zunoContainer.publicationGovernancePolicy,
    secretResolver: app.zunoContainer.publicationSecretResolver,
    metaPagesOAuthService: app.zunoContainer.metaPagesOAuthService,
    queue: app.zunoContainer.publicationQueue,
    providerCircuitBreaker: app.zunoContainer.operationalCircuitBreaker,
    backpressure: app.zunoContainer.operationalBackpressure,
    idGenerator: () => `publication-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerTikTokRoutes(app, {
    publicationRepository: app.zunoContainer.publicationRepository,
    providers: app.zunoContainer.publicationProviders,
    providerRegistry: app.zunoContainer.publicationProviderRegistry,
    providerPolicy: app.zunoContainer.publicationProviderPolicy,
    secretResolver: app.zunoContainer.publicationSecretResolver,
    queue: app.zunoContainer.publicationQueue,
    tiktokOAuthService: app.zunoContainer.tiktokOAuthService,
    providerCircuitBreaker: app.zunoContainer.operationalCircuitBreaker,
    idGenerator: () => `tiktok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerYouTubeRoutes(app, {
    publicationRepository: app.zunoContainer.publicationRepository,
    providers: app.zunoContainer.publicationProviders,
    providerRegistry: app.zunoContainer.publicationProviderRegistry,
    providerPolicy: app.zunoContainer.publicationProviderPolicy,
    secretResolver: app.zunoContainer.publicationSecretResolver,
    queue: app.zunoContainer.publicationQueue,
    youtubeOAuthService: app.zunoContainer.youtubeOAuthService,
    providerCircuitBreaker: app.zunoContainer.operationalCircuitBreaker,
    idGenerator: () => `youtube-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerInstagramRoutes(app, {
    publicationRepository: app.zunoContainer.publicationRepository,
    providers: app.zunoContainer.publicationProviders,
    providerRegistry: app.zunoContainer.publicationProviderRegistry,
    providerPolicy: app.zunoContainer.publicationProviderPolicy,
    secretResolver: app.zunoContainer.publicationSecretResolver,
    queue: app.zunoContainer.publicationQueue,
    metaInstagramOAuthService: app.zunoContainer.metaInstagramOAuthService,
    providerCircuitBreaker: app.zunoContainer.operationalCircuitBreaker,
    idGenerator: () => `instagram-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerPublicationMediaRoutes(app, {
    objectStorage: app.zunoContainer.objectStorage,
    maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
  });
  await registerAssetsRoutes(app, {
    assetLibraryRepository: app.zunoContainer.assetLibraryRepository,
    objectStorage: app.zunoContainer.objectStorage,
    maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
  });
  await registerCredentialRoutes(app, {
    credentialGovernanceService: app.zunoContainer.credentialGovernanceService,
    auditRepository: app.zunoContainer.operationalAuditRepository,
    complianceService: app.zunoContainer.complianceService,
    metaPagesOAuthService: app.zunoContainer.metaPagesOAuthService,
    idGenerator: () => `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerProviderRoutes(app, {
    providerRegistry: app.zunoContainer.publicationProviderRegistry,
    credentialGovernanceService: app.zunoContainer.credentialGovernanceService,
    credentialRepository: app.zunoContainer.credentialRepository,
    auditRepository: app.zunoContainer.operationalAuditRepository,
    webhookRepository: app.zunoContainer.webhookEventRepository,
    secretStore: app.zunoContainer.publicationSecretStore,
    metaPagesOAuthService: app.zunoContainer.metaPagesOAuthService,
    idGenerator: () => `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await registerWebhookRoutes(app, {
    webhookRepository: app.zunoContainer.webhookEventRepository,
    synchronizationService: app.zunoContainer.publicationSynchronizationService,
  });
  await registerSchedulingRoutes(app, {
    schedulingRepository: app.zunoContainer.schedulingRepository,
    schedulingUseCases: app.zunoContainer.schedulingUseCases,
    temporalDispatcher: app.zunoContainer.schedulingTemporalDispatcher,
    recoveryService: app.zunoContainer.schedulingRecoveryService,
    healthService: app.zunoContainer.schedulingHealthService,
  });
  await registerAnalyticsRoutes(app, {
    repository: app.zunoContainer.analyticsRepository,
    auditRepository: app.zunoContainer.operationalAuditRepository,
    metricRegistry: app.zunoContainer.analyticsMetricRegistry,
    ingestionService: app.zunoContainer.analyticsIngestionService,
    queryService: app.zunoContainer.analyticsQueryService,
    snapshotRebuilder: app.zunoContainer.analyticsSnapshotRebuilder,
    dataQualityService: app.zunoContainer.analyticsDataQualityService,
    insightEngine: app.zunoContainer.analyticsInsightEngine,
    alertService: app.zunoContainer.analyticsAlertService,
    exportService: app.zunoContainer.analyticsExportService,
    healthService: app.zunoContainer.analyticsHealthService,
    idGenerator: () => `analytics-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    defaultTimezone: app.zunoConfig.analytics.defaultTimezone,
  });
  await registerSystemRoutes(app, {
    healthService: app.zunoContainer.operationalHealthService,
    circuitBreaker: app.zunoContainer.operationalCircuitBreaker,
    rateLimiter: app.zunoContainer.operationalRateLimiter,
    backpressure: app.zunoContainer.operationalBackpressure,
    productionGuard: app.zunoContainer.productionGuard,
    secretManager: app.zunoContainer.secretManager,
    publicationQueue: app.zunoContainer.publicationQueue,
    auditRepository: app.zunoContainer.operationalAuditRepository,
    schedulingRecoveryService: app.zunoContainer.schedulingRecoveryService,
    backupRestorePlanner: app.zunoContainer.backupRestorePlanner,
    idGenerator: () => `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });

  // Sprint 25 — Painel administrativo de plataforma. Só registrado quando há `identity` (modo JWT
  // real + Postgres); no modo noop/testes, `/v1/admin/*` fica inexistente. `requirePlatformAdmin`
  // dentro das rotas cuida do 403 quando o usuário logado não é superadmin.
  if (app.zunoContainer.identity) {
    const identity = app.zunoContainer.identity;
    await registerAdminRoutes(app, {
      platformBillingRepository: identity.platformBillingRepository,
      membershipRepository: identity.membershipRepository,
      userRepository: identity.userRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      idGenerator: () => `credit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => new Date(),
      platformAiSettings: {
        platformAiSettingsRepository: identity.platformAiSettingsRepository,
        now: () => new Date(),
      },
    });

    await registerAiProvidersRoutes(app, {
      aiProvidersRepository: identity.aiProvidersRepository,
      aiMediaProviderRegistry: app.zunoContainer.aiMediaProviderRegistry,
      secretManager: app.zunoContainer.secretManager,
      now: () => new Date(),
    });
  }
}
