import type { FastifyInstance } from "fastify";
import { registerAnalyticsRoutes } from "./analytics.route.js";
import { registerAdminRoutes } from "./admin.route.js";
import { registerAiProvidersRoutes } from "./ai-providers.route.js";
import { registerAssetsRoutes } from "./assets.route.js";
import { registerProductionSettingsRoutes } from "./production-settings.route.js";
import { registerBrandProfileRoutes } from "./brand-profile.route.js";
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
import { registerInstagramDmRoutes } from "./instagram-dm.route.js";
import { registerInboxRoutes } from "./inbox.route.js";
import { registerInboxMetricsRoutes } from "./inbox-metrics.route.js";
import { registerTeamsRoutes } from "./teams.route.js";
import { registerTenantMembersRoutes } from "./tenant-members.route.js";
import { registerContactsRoutes } from "./contacts.route.js";
import { registerPipelinesRoutes } from "./pipelines.route.js";
import { registerDealsRoutes } from "./deals.route.js";
import { registerTasksRoutes } from "./tasks.route.js";
import { registerProductsRoutes } from "./products.route.js";
import { registerCommercialSuggestionsRoutes } from "./commercial-suggestions.route.js";
import { registerAutomationRulesRoutes } from "./automation-rules.route.js";
import { registerCommercialMetricsRoutes } from "./commercial-metrics.route.js";
import { registerBillingEntitlementsRoutes } from "./billing-entitlements.route.js";
import { registerAdminPlanVersionsRoutes } from "./admin-plan-versions.route.js";
import { registerBillingCheckoutRoutes, registerBillingTrialRoutes } from "./billing-checkout.route.js";
import { registerProductEventsRoutes } from "./product-events.route.js";
import { registerBillingLifecycleRoutes } from "./billing-lifecycle.route.js";
import { registerBillingOverviewRoutes } from "./billing-overview.route.js";
import { registerOnboardingRoutes } from "./onboarding.route.js";
import { DefaultResourceCounterAdapter } from "../../../../infrastructure/billing/resource-counter-adapter.js";
import { registerProposalsRoutes } from "./proposals.route.js";
import { registerPublicProposalsRoutes } from "./public-proposals.route.js";
import { AiGatewayCommercialCopilotGenerator } from "../../../../infrastructure/ai-gateway/commercial-copilot-generator-adapter.js";
import { registerMetaAdsRoutes } from "./meta-ads.route.js";
import { registerMetaAdCampaignsRoutes } from "./meta-ad-campaigns.route.js";
import { registerMetaAudiencesRoutes } from "./meta-audiences.route.js";
import { registerMetaPixelsRoutes } from "./meta-pixels.route.js";
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
    referenceIntelligenceExtractor: app.zunoContainer.referenceIntelligenceExtractor,
    qualityFeedback: app.zunoContainer.qualityFeedback,
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
    instagramDmAccountRouteRepository: app.zunoContainer.instagramDmAccountRouteRepository,
  });
  await registerInstagramDmRoutes(app, {
    conversationRepository: app.zunoContainer.instagramDmConversationRepository,
    messageRepository: app.zunoContainer.instagramDmMessageRepository,
    automationRuleRepository: app.zunoContainer.instagramDmAutomationRuleRepository,
    publicationRepository: app.zunoContainer.publicationRepository,
    publicationSecretStore: app.zunoContainer.publicationSecretStore,
  });
  // Módulo Conversas (Fase 1) — kill switch global via `CONVERSATIONS_MODULE_ENABLED`; sem isto,
  // `/v1/inbox/*` nem existe (nenhum tenant vê o módulo até habilitação explícita).
  if (app.zunoContainer.inboxFeatureFlags.enabled) {
    await registerInboxRoutes(app, {
      connectionRepository: app.zunoContainer.messagingConnectionRepository,
      contactRepository: app.zunoContainer.inboxContactRepository,
      conversationRepository: app.zunoContainer.inboxConversationRepository,
      conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
      messageRepository: app.zunoContainer.inboxMessageRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      outboundQueue: app.zunoContainer.inboxOutboundQueue,
      provider: app.zunoContainer.inboxProvider,
      realtimeSubscriber: app.zunoContainer.inboxRealtimeSubscriber,
      membershipRepository: app.zunoContainer.identity?.membershipRepository,
      userRepository: app.zunoContainer.identity?.userRepository,
    });
    // Fase 7 (Resultados) — métricas agregadas de atendimento, mesmo kill switch do módulo.
    await registerInboxMetricsRoutes(app, { inboxMetricsRepository: app.zunoContainer.inboxMetricsRepository });
  }
  // CRM/Comercial (Fase 1) — sempre postgres-backed (mesmo racional de Identidade); registrado
  // só quando `identity` existe (driver postgres), nunca em modo memória (dev/teste sem banco).
  if (app.zunoContainer.identity) {
    const identity = app.zunoContainer.identity;
    // CRM/Comercial (Fase 6) — deps de automação, reaproveitadas por Contatos/Negócios/Propostas
    // (opcional em cada um: quando ausente, nenhuma automação dispara, comportamento idêntico às
    // fases anteriores).
    const automationDeps = {
      automationRuleRepository: identity.automationRuleRepository,
      automationRunLogRepository: identity.automationRunLogRepository,
      contactRepository: identity.contactRepository,
      dealRepository: identity.dealRepository,
      taskRepository: identity.taskRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      timelineEventRepository: identity.timelineEventRepository,
    };
    await registerTeamsRoutes(app, { teamRepository: identity.teamRepository, teamMembershipRepository: identity.teamMembershipRepository });
    await registerTenantMembersRoutes(app, {
      tenantMemberInviteRepository: identity.tenantMemberInviteRepository,
      membershipRepository: identity.membershipRepository,
      userRepository: identity.userRepository,
    });
    await registerContactsRoutes(app, {
      contactRepository: identity.contactRepository,
      contactIdentityRepository: identity.contactIdentityRepository,
      timelineEventRepository: identity.timelineEventRepository,
      // Fase 5 — GET /contacts/:id/lead-score.
      dealRepository: identity.dealRepository,
      taskRepository: identity.taskRepository,
      // Fase 6 — dispara `contact_created` ao criar um contato.
      automation: automationDeps,
    });
    // CRM/Comercial (Fase 2) — Pipelines/Etapas/Negócios (Kanban).
    await registerPipelinesRoutes(app, {
      pipelineRepository: identity.pipelineRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
    });
    await registerDealsRoutes(app, {
      dealRepository: identity.dealRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      timelineEventRepository: identity.timelineEventRepository,
      // Fase 6 — dispara `deal_stage_changed` ao mover um negócio de etapa.
      automation: automationDeps,
    });
    // CRM/Comercial (Fase 3) — Tarefas, Catálogo de produtos, Propostas (com link público).
    await registerTasksRoutes(app, { taskRepository: identity.taskRepository, timelineEventRepository: identity.timelineEventRepository });
    await registerProductsRoutes(app, { productRepository: identity.productRepository });
    await registerProposalsRoutes(app, {
      proposalRepository: identity.proposalRepository,
      timelineEventRepository: identity.timelineEventRepository,
      automation: automationDeps,
    });
    await registerPublicProposalsRoutes(app, {
      proposalRepository: identity.proposalRepository,
      timelineEventRepository: identity.timelineEventRepository,
      dealRepository: identity.dealRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      // Fase 6 — dispara `proposal_accepted`/`proposal_rejected` ao responder ao link público.
      automation: automationDeps,
    });
    // CRM/Comercial (Fase 6) — Regras de automação (motor simples, gatilho + condições + ação).
    await registerAutomationRulesRoutes(app, automationDeps);
    // CRM/Comercial (Fase 5) — Copiloto Comercial (IA, via AI Gateway) + Pontuação de lead.
    await registerCommercialSuggestionsRoutes(app, {
      contactRepository: identity.contactRepository,
      dealRepository: identity.dealRepository,
      taskRepository: identity.taskRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      commercialSuggestionRepository: identity.commercialSuggestionRepository,
      timelineEventRepository: identity.timelineEventRepository,
      generator: new AiGatewayCommercialCopilotGenerator(app.zunoContainer.aiGateway),
    });
    // CRM/Comercial (Fase 7) — métricas agregadas de resultados comerciais.
    await registerCommercialMetricsRoutes(app, { commercialMetricsRepository: identity.commercialMetricsRepository });
    // SaaS Commercialization (Fase 1) — Billing Foundation: canUse()/limit() centralizados.
    const entitlementDeps = {
      subscriptionRepository: identity.subscriptionRepository,
      subscriptionItemRepository: identity.subscriptionItemRepository,
      planVersionRepository: identity.planVersionRepository,
      addonDefinitionRepository: identity.addonDefinitionRepository,
      platformBillingRepository: identity.platformBillingRepository,
      usageCounterRepository: identity.usageCounterRepository,
      resourceCounter: new DefaultResourceCounterAdapter({
        tenantMembershipRepository: identity.membershipRepository,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        messagingConnectionRepository: app.zunoContainer.messagingConnectionRepository,
        contactRepository: identity.contactRepository,
        automationRuleRepository: identity.automationRuleRepository,
      }),
    };
    await registerBillingEntitlementsRoutes(app, entitlementDeps);
    await registerAdminPlanVersionsRoutes(app, { planVersionRepository: identity.planVersionRepository, addonDefinitionRepository: identity.addonDefinitionRepository });
    // SaaS Commercialization (Fase 2) — Checkout self-service. A ativação real da Subscription só
    // acontece via webhook confirmado (`billing-webhook.route.ts`, fora de `/v1`), nunca aqui.
    await registerBillingCheckoutRoutes(app, {
      billingProvider: app.zunoContainer.billingProvider,
      planVersionRepository: identity.planVersionRepository,
      addonDefinitionRepository: identity.addonDefinitionRepository,
      subscriptionRepository: identity.subscriptionRepository,
      userRepository: identity.userRepository,
      appBaseUrl: app.zunoConfig.billing.appBaseUrl,
    });
    // Trial + Product Analytics — trial sem cartão, mesma Subscription real de qualquer assinatura.
    await registerBillingTrialRoutes(app, {
      subscriptionRepository: identity.subscriptionRepository,
      planVersionRepository: identity.planVersionRepository,
      platformBillingRepository: identity.platformBillingRepository,
      billingEventRepository: identity.billingEventRepository,
      trialEnabled: app.zunoConfig.billing.trialEnabled,
    });
    // Trial + Product Analytics — fundação de eventos de produto.
    const productAnalyticsDeps = {
      productEventRepository: identity.productEventRepository,
      enabled: app.zunoConfig.productAnalytics.enabled,
      onWriteFailed: ({ eventName, error }: { eventName: string; error: unknown }) => {
        app.log.warn({ err: error, eventName }, "product_event_write_failed");
      },
    };
    await registerProductEventsRoutes(app, productAnalyticsDeps);
    // SaaS Commercialization (Fase 3) — upgrade/downgrade, add-ons, cancelamento/reativação.
    await registerBillingLifecycleRoutes(app, { ...entitlementDeps, billingProvider: app.zunoContainer.billingProvider, billingEventRepository: identity.billingEventRepository });
    // SaaS Commercialization (Fase 4) — tela "Plano e Cobrança" self-service.
    await registerBillingOverviewRoutes(app, {
      ...entitlementDeps,
      billingProvider: app.zunoContainer.billingProvider,
      invoiceRepository: identity.invoiceRepository,
      appBaseUrl: app.zunoConfig.billing.appBaseUrl,
    });
    // Onboarding guiado — orquestra Convites/Conexões/Entitlements já existentes, nunca uma
    // segunda implementação daquelas ações (ver `onboarding-use-cases.ts`).
    await registerOnboardingRoutes(app, {
      workspaceOnboardingRepository: identity.workspaceOnboardingRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      entitlementDeps,
      inviteDeps: {
        tenantMemberInviteRepository: identity.tenantMemberInviteRepository,
        membershipRepository: identity.membershipRepository,
        userRepository: identity.userRepository,
      },
      inboxDeps: {
        connectionRepository: app.zunoContainer.messagingConnectionRepository,
        contactRepository: app.zunoContainer.inboxContactRepository,
        conversationRepository: app.zunoContainer.inboxConversationRepository,
        conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
        messageRepository: app.zunoContainer.inboxMessageRepository,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        outboundQueue: app.zunoContainer.inboxOutboundQueue,
        provider: app.zunoContainer.inboxProvider,
      },
      // Independente do entitlement de messaging_connections: isto é o kill switch operacional
      // do módulo (CONVERSATIONS_MODULE_ENABLED), não o limite de plano.
      inboxModuleEnabled: app.zunoContainer.inboxFeatureFlags.enabled,
    });
  }
  await registerMetaAdsRoutes(app, {
    metaAdsOAuthService: app.zunoContainer.metaAdsOAuthService,
    metaAdAccountRepository: app.zunoContainer.metaAdAccountRepository,
  });
  await registerMetaAdCampaignsRoutes(app, {
    metaAdAccountRepository: app.zunoContainer.metaAdAccountRepository,
    metaAdCampaignRepository: app.zunoContainer.metaAdCampaignRepository,
    metaAdSetRepository: app.zunoContainer.metaAdSetRepository,
    metaAdRepository: app.zunoContainer.metaAdRepository,
    metaAdsCredentialRepository: app.zunoContainer.metaAdsCredentialRepository,
    secretManager: app.zunoContainer.secretManager,
  });
  await registerMetaAudiencesRoutes(app, {
    metaAdAccountRepository: app.zunoContainer.metaAdAccountRepository,
    metaCustomAudienceRepository: app.zunoContainer.metaCustomAudienceRepository,
    metaAdsCredentialRepository: app.zunoContainer.metaAdsCredentialRepository,
    secretManager: app.zunoContainer.secretManager,
  });
  await registerMetaPixelsRoutes(app, {
    metaAdAccountRepository: app.zunoContainer.metaAdAccountRepository,
    metaPixelRepository: app.zunoContainer.metaPixelRepository,
    metaCapiEventRepository: app.zunoContainer.metaCapiEventRepository,
    metaAdsCredentialRepository: app.zunoContainer.metaAdsCredentialRepository,
    secretManager: app.zunoContainer.secretManager,
  });
  await registerPublicationMediaRoutes(app, {
    objectStorage: app.zunoContainer.objectStorage,
    maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
  });
  await registerAssetsRoutes(app, {
    assetLibraryRepository: app.zunoContainer.assetLibraryRepository,
    objectStorage: app.zunoContainer.objectStorage,
    maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
    removeImageBackground: app.zunoContainer.removeImageBackground,
  });
  await registerProductionSettingsRoutes(app, {
    productionSettingsRepository: app.zunoContainer.productionSettingsRepository,
  });
  await registerBrandProfileRoutes(app, {
    resolveBrandProfile: app.zunoContainer.resolveBrandProfile,
    updateBrandProfile: app.zunoContainer.updateBrandProfile,
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
