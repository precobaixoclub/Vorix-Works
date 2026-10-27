import {PostgresSiteCommerceRepository} from "../../../../infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {registerSiteCommerceRoutes} from "./site-commerce.route.js";
import {registerConversationProductRoutes} from "./conversation-products.route.js";
import {registerCommerceRoutes} from "./commerce.route.js";
import {siteCheckoutStatus} from "../../../../application/commerce/checkout-use-cases.js";
import {PostgresCommerceOrderRepository} from "../../../../infrastructure/storage/postgres/postgres-commerce-order-repository.js";
import {SandboxPaymentProvider,MercadoPagoPaymentProvider} from "../../../../infrastructure/commerce/payment-providers.js";
import {OwnShippingProvider,MelhorEnvioShippingProvider} from "../../../../infrastructure/commerce/shipping-providers.js";
import type {SiteLeadDeps} from "../../../../application/commercial-bridge/site-lead-use-cases.js";
import { registerCommercialResponseVisibility } from "../../http/commercial-response-visibility.js";
import { registerWorkspaceTenantGuard } from "../../http/workspace-tenant-guard.js";
import { registerCrmAccessGuards } from "../../http/crm-access.js";
import { moveDealStage } from "../../../../application/crm/deal-use-cases.js";
import type { AutomationUseCaseDeps } from "../../../../application/crm/automation-use-cases.js";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { registerAnalyticsRoutes } from "./analytics.route.js";
import { registerAdminRoutes } from "./admin.route.js";
import { registerAiProvidersRoutes } from "./ai-providers.route.js";
import { registerAssetsRoutes } from "./assets.route.js";
import { registerProductionSettingsRoutes } from "./production-settings.route.js";
import { registerBrandProfileRoutes } from "./brand-profile.route.js";
import { registerBrandIdentityRoutes } from "./brand-identity.route.js";
import { registerFileRoutes } from "./files.route.js";
import { createObjectKeyReadAuthorizer } from "../../object-url-access.js";
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
import { registerSocialRoutes } from "./social.route.js";
import { registerYouTubeRoutes } from "./youtube.route.js";
import { registerInstagramRoutes } from "./instagram.route.js";
import { registerInboxRoutes } from "./inbox.route.js";
import { registerDashboardRoutes } from "./dashboard.route.js";
import { PostgresDashboardRepository } from "../../../../infrastructure/storage/postgres/postgres-dashboard-repository.js";
import { registerNotificationRoutes } from "./notifications.route.js";
import { registerSolutionRoutes } from "./solutions.route.js";
import { registerMeetingRoutes } from "./meetings.route.js";
import { registerMeetingAgendaRoutes } from "./meetings-agenda.route.js";
import { registerMeetingsRecorderAdminRoutes } from "./meetings-recorder-admin.route.js";
import { registerMeetingRecorderAccountRoutes } from "./meetings-recorder-accounts.route.js";
import { newViewerToken } from "../../../../infrastructure/meetings/provisioning-link-auth.js";
import { encryptSecret } from "../../../../infrastructure/crypto/secret-cipher.js";
import { registerRadarRoutes } from "./radar.route.js";
import { registerInboxMetricsRoutes } from "./inbox-metrics.route.js";
import { registerTeamsRoutes } from "./teams.route.js";
import { registerTenantMembersRoutes } from "./tenant-members.route.js";
import { registerContactsRoutes } from "./contacts.route.js";
import { registerContactPhonesRoutes } from "./contact-phones.route.js";
import { PostgresContactPhoneRepository } from "../../../../infrastructure/storage/postgres/postgres-contact-phone-repository.js";
import { registerPipelinesRoutes } from "./pipelines.route.js";
import { registerDealsRoutes } from "./deals.route.js";
import { registerTasksRoutes } from "./tasks.route.js";
import { registerProductsRoutes } from "./products.route.js";
import { registerProductEngineRoutes } from "./product-engine.route.js";
import { registerSiteRoutes } from "./sites.route.js";
import { registerCommercialSuggestionsRoutes } from "./commercial-suggestions.route.js";
import { registerAutomationRulesRoutes } from "./automation-rules.route.js";
import { registerCommercialMetricsRoutes } from "./commercial-metrics.route.js";
import { registerSalesEngineRoutes } from "./sales-engine.route.js";
import { registerSalesPerformanceRoutes } from "./sales-performance.route.js";
import { checkGoalsReached } from "../../../../application/sales/sales-performance-use-cases.js";
import { AiGatewayDealInsightsGenerator } from "../../../../infrastructure/ai-gateway/deal-insights-generator-adapter.js";
import { proposalAcceptanceHandler, proposalApprovalGate, proposalBuyerEventHandler, proposalMessageTemplates, renderProposalMessage } from "../../../../application/sales/proposal-sales-use-cases.js";
import { registerBillingEntitlementsRoutes } from "./billing-entitlements.route.js";
import { registerReadOnlyGuard } from "../../http/read-only-guard.js";
import { registerAdminPlanVersionsRoutes } from "./admin-plan-versions.route.js";
import { registerBillingCheckoutRoutes, registerBillingTrialRoutes } from "./billing-checkout.route.js";
import { registerBillingCapacityRoutes } from "./billing-capacity.route.js";
import { assertWithinLimit } from "../../../../application/billing/entitlement-use-cases.js";
import { registerProductEventsRoutes } from "./product-events.route.js";
import { registerBillingLifecycleRoutes } from "./billing-lifecycle.route.js";
import { registerBillingOverviewRoutes } from "./billing-overview.route.js";
import { registerBillingCreditsRoutes } from "./billing-credits.route.js";
import { registerReportsRoutes } from "./reports.route.js";
import { AiGatewayReportAi } from "../../../../infrastructure/ai-gateway/report-ai-adapter.js";
import { registerOnboardingRoutes } from "./onboarding.route.js";
import { DefaultResourceCounterAdapter } from "../../../../infrastructure/billing/resource-counter-adapter.js";
import { registerProposalsRoutes } from "./proposals.route.js";
import { registerPublicProposalsRoutes } from "./public-proposals.route.js";
import { registerProposalTemplatesRoutes } from "./proposal-templates.route.js";
import { AiGatewayCommercialCopilotGenerator } from "../../../../infrastructure/ai-gateway/commercial-copilot-generator-adapter.js";
import { registerMetaAdsRoutes } from "./meta-ads.route.js";
import { registerMetaAdCampaignsRoutes } from "./meta-ad-campaigns.route.js";
import { registerMetaAudiencesRoutes } from "./meta-audiences.route.js";
import { registerMetaPixelsRoutes } from "./meta-pixels.route.js";
import { registerPublicationMediaRoutes } from "./publication-media.route.js";
import { registerExecutionRunRoutes } from "./execution-runs.route.js";
import { registerProductionRoutes } from "./production.route.js";
import { registerCreativeEngineEntitlementRoutes } from "./creative-engine-entitlements.route.js";
import { registerPublicationRoutes } from "./publications.route.js";
import { registerWebhookRoutes } from "./webhooks.route.js";
import { registerWorkspaceRoutes } from "./workspaces.route.js";
import { registerGrowthDashboardRoutes } from "./growth-dashboard.route.js";
import { registerMeetingIntelligenceRoutes, registerPublicMeetingRoutes } from "./meetings-intelligence.route.js";
import { buildMeetingCrmBridge, buildMeetingMessagingBridge } from "../../meetings-bridges.js";
import { AiGatewayMeetingIntelligence } from "../../../../infrastructure/ai-gateway/meeting-intelligence-ai-adapter.js";
import { GoogleMeetTranscriptClient } from "../../../../infrastructure/meetings/google-meet-transcript-client.js";

/**
 * Grupo de rotas `v1` — esqueleto de versionamento. Registrado sob o prefixo `/v1` (ver `app.ts`),
 * para que uma futura `v2` conviva lado a lado sem quebrar clientes existentes. `app.zunoContainer`/
 * `app.zunoConfig` (decorados por `registerDiPlugin` na instância pai) chegam aqui por herança de
 * decorators do Fastify — nenhuma rota importa um adapter diretamente.
 */
export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  registerWorkspaceTenantGuard(app, app.zunoContainer.workspaceRepository);
  // Trial + Product Analytics — construído uma ÚNICA vez aqui (não dentro do bloco `if
  // (identity)` mais abaixo) porque `registerAuthRoutes` (signup) já precisa dele antes disso.
  // `undefined` quando `identity` não existe (modo memória/noop) — toda instrumentação vira um
  // no-op silencioso automaticamente (ver `recordProductEvent`/`recordFirstEvent`).
  const productAnalyticsDeps = app.zunoContainer.identity
    ? {
        productEventRepository: app.zunoContainer.identity.productEventRepository,
        enabled: app.zunoConfig.productAnalytics.enabled,
        onWriteFailed: ({ eventName, error }: { eventName: string; error: unknown }) => {
          app.log.warn({ err: error, eventName }, "product_event_write_failed");
        },
      }
    : undefined;

  await registerHealthRoutes(app);
  // Soluções da plataforma (Core) — sempre registrada: é ela que diz ao frontend quais soluções
  // este tenant enxerga.
  await registerSolutionRoutes(app, { solutionAccess: app.zunoContainer.solutionAccess });
  // Vorix Meetings — só com identidade real; o guarda de solução barra tenants sem `meetings`.
  if (app.zunoContainer.meetings) {
    await registerMeetingRoutes(app, { ...app.zunoContainer.meetings, workspaceRepository: app.zunoContainer.workspaceRepository });
    // Contas de gravação do cliente (self-service). O navegador de login só existe com JWT_SECRET
    // (cifra da sessão e assinatura do canal API → recorder).
    await registerMeetingRecorderAccountRoutes(app, {
      repository: app.zunoContainer.meetings.repository,
      limitsFor: app.zunoContainer.meetings.limitsFor,
      idGenerator: app.zunoContainer.meetings.idGenerator,
      now: app.zunoContainer.meetings.now,
      newViewerToken,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      streamAvailable: Boolean(app.zunoConfig.jwtSecret),
    });
  }
  if (app.zunoContainer.meetingsAgenda) {
    await registerMeetingAgendaRoutes(app, { ...app.zunoContainer.meetingsAgenda, workspaceRepository: app.zunoContainer.workspaceRepository });
  }
  // Central de notificações in-app (réplica adaptada do CMDesk, pedido explícito do usuário) —
  // SEMPRE registrada (nunca atrás de um kill switch de módulo, ao contrário de `/v1/inbox/*`).
  await registerNotificationRoutes(app, {
    notificationRepository: app.zunoContainer.notificationRepository,
    realtimePublisher: app.zunoContainer.notificationRealtimePublisher,
    jwtPort: app.zunoContainer.identity?.jwt,
  });
  await registerWorkspaceRoutes(app, {
    workspaceRepository: app.zunoContainer.workspaceRepository,
    platformBillingRepository: app.zunoContainer.identity?.platformBillingRepository,
    creativeEngineEntitlementRepository: app.zunoContainer.creativeEngineEntitlementRepository,
  });
  await registerAuthRoutes(app, {
    identity: app.zunoContainer.identity,
    config: app.zunoConfig,
    workspaceRepository: app.zunoContainer.workspaceRepository,
    productAnalytics: productAnalyticsDeps,
  });
  // Pricing/Capacity Etapa B (P0 da auditoria) — lê de `plan_versions` (banco), nunca mais do
  // catálogo TS hardcoded, quando `identity`/Postgres estão disponíveis (sempre em produção real).
  await registerPlatformPlansRoutes(app, app.zunoContainer.identity ? { planVersionRepository: app.zunoContainer.identity.planVersionRepository, addonDefinitionRepository: app.zunoContainer.identity.addonDefinitionRepository } : {});
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
    productAnalytics: productAnalyticsDeps,
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
    workspaceRepository: app.zunoContainer.workspaceRepository,
    executionRepository: app.zunoContainer.executionRepository,
    executionTaskRepository: app.zunoContainer.executionTaskRepository,
    executionGraphRepository: app.zunoContainer.executionGraphRepository,
    artifactRepository: app.zunoContainer.planningArtifactRepository,
    handlers: app.zunoContainer.executionHandlers,
    handlerResolver: executionHandlerResolver,
    featureFlags: app.zunoContainer.executionFeatureFlags,
    referenceAssetResolver: app.zunoContainer.referenceAssetResolver,
    editorialQaAllowlist: app.zunoContainer.creativeEngineEditorialQaAllowlist,
    contractRegistry: app.zunoContainer.executionContractRegistry,
    sideEffectGuard: app.zunoContainer.executionSideEffectGuard,
    circuitBreaker: app.zunoContainer.executionCircuitBreaker,
    idGenerator: () => `execution-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ensureHouseTenantProfile: app.zunoContainer.ensureHouseTenantProfile,
    imageDescriber: app.zunoContainer.imageDescriber,
    referenceIntelligenceExtractor: app.zunoContainer.referenceIntelligenceExtractor,
    qualityFeedback: app.zunoContainer.qualityFeedback,
    creativeEngineEntitlementRepository: app.zunoContainer.creativeEngineEntitlementRepository,
  });
  await registerCreativeEngineEntitlementRoutes(app, {
    workspaceRepository: app.zunoContainer.workspaceRepository,
    creativeEngineEntitlementRepository: app.zunoContainer.creativeEngineEntitlementRepository,
    featureFlags: app.zunoContainer.executionFeatureFlags,
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
  // Social Publishing multiprovider (Vorix Marketing) + admin de providers (platform admin).
  if (app.zunoContainer.social) {
    await registerSocialRoutes(app, {
      social: app.zunoContainer.social,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      idGenerator: () => `soc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    });
  }
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
  // Fase 10 (Pre-Pilot Hardening) — SEMPRE registrada, mesmo com o módulo desligado (nunca 404):
  // é assim que o frontend distingue "Conversas está desligado neste ambiente" (esperado, UX
  // neutra) de "algo quebrou" (erro real) ANTES de tentar qualquer outra rota `/v1/inbox/*`. Não
  // exige permissão específica — qualquer principal autenticado do tenant pode ver se o módulo
  // está ligado nesta instância; não é dado sensível, é uma flag de plataforma.
  app.get("/inbox/status", async (request) => {
    requirePrincipal(request);
    return successEnvelope({ enabled: app.zunoContainer.inboxFeatureFlags.enabled }, request.id);
  });

  // Módulo Conversas (Fase 1) — kill switch global via `CONVERSATIONS_MODULE_ENABLED`; sem isto,
  // `/v1/inbox/*` nem existe (nenhum tenant vê o módulo até habilitação explícita).
  let sharedInboxDeps: Parameters<typeof registerInboxRoutes>[1] | undefined;
  if (app.zunoContainer.inboxFeatureFlags.enabled) {
    sharedInboxDeps = {
      connectionRepository: app.zunoContainer.messagingConnectionRepository,
      contactRepository: app.zunoContainer.inboxContactRepository,
      conversationRepository: app.zunoContainer.inboxConversationRepository,
      conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
      messageRepository: app.zunoContainer.inboxMessageRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      outboundQueue: app.zunoContainer.inboxOutboundQueue,
      providers: { wuzapi: app.zunoContainer.inboxProvider, instagram: app.zunoContainer.instagramMessagingProvider },
      realtimeSubscriber: app.zunoContainer.inboxRealtimeSubscriber,
      membershipRepository: app.zunoContainer.identity?.membershipRepository,
      userRepository: app.zunoContainer.identity?.userRepository,
      productAnalytics: productAnalyticsDeps,
      jwtPort: app.zunoContainer.identity?.jwt,
      inboxMediaStorage: app.zunoContainer.inboxMediaStorage,
      maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
      channelRoutingRepository: app.zunoContainer.identity?.channelRoutingRepository,
      teamRepository: app.zunoContainer.identity?.teamRepository,
      teamMembershipRepository: app.zunoContainer.identity?.teamMembershipRepository,
      teamKanbanPhaseRepository: app.zunoContainer.identity?.teamKanbanPhaseRepository,
      conversationTimeEntryRepository: app.zunoContainer.identity?.conversationTimeEntryRepository,
      notificationRepository: app.zunoContainer.notificationRepository,
      notificationRealtimePublisher: app.zunoContainer.notificationRealtimePublisher,
      tagRepository: app.zunoContainer.inboxTagRepository,
      quickReplyRepository: app.zunoContainer.inboxQuickReplyRepository,
      stickerRepository: app.zunoContainer.inboxStickerRepository,
      serviceSettingsRepository: app.zunoContainer.inboxServiceSettingsRepository,
      attendanceRepository: app.zunoContainer.inboxAttendanceRepository,
      closureCatalogRepository: app.zunoContainer.inboxClosureCatalogRepository,
    };
    await registerInboxRoutes(app, sharedInboxDeps);
    // Fase 7 (Resultados) — métricas agregadas de atendimento, mesmo kill switch do módulo.
    await registerInboxMetricsRoutes(app, { inboxMetricsRepository: app.zunoContainer.inboxMetricsRepository });
    // Radar de Sentimento (réplica adaptada do CMDesk) — lê conversas da Inbox, então só existe
    // com o módulo Conversas ligado, e ainda atrás do próprio kill switch (`RADAR_ENABLED`).
    if (app.zunoContainer.radar) {
      await registerRadarRoutes(app, { ...app.zunoContainer.radar, teamMembershipRepository: app.zunoContainer.identity?.teamMembershipRepository });
    }
  }
  // CRM/Comercial (Fase 1) — sempre postgres-backed (mesmo racional de Identidade); registrado
  // só quando `identity` existe (driver postgres), nunca em modo memória (dev/teste sem banco).
  if (app.zunoContainer.identity) {
    const identity = app.zunoContainer.identity;
    const crmAccess = { teamRepository: identity.teamRepository, inboxConversationRepository: app.zunoContainer.inboxConversationRepository, workspaceRepository: app.zunoContainer.workspaceRepository, dealRepository: identity.dealRepository, contactRepository: identity.contactRepository, taskRepository: identity.taskRepository, proposalRepository: identity.proposalRepository, teamMembershipRepository: identity.teamMembershipRepository, membershipRepository: identity.membershipRepository };
    registerCrmAccessGuards(app, crmAccess);
    registerCommercialResponseVisibility(app, { salesConfigRepository: identity.salesConfigRepository });
    // CRM/Comercial (Fase 6) — deps de automação, reaproveitadas por Contatos/Negócios/Propostas
    // (opcional em cada um: quando ausente, nenhuma automação dispara, comportamento idêntico às
    // fases anteriores).
    const automationDeps: AutomationUseCaseDeps = {
      automationRuleRepository: identity.automationRuleRepository,
      automationRunLogRepository: identity.automationRunLogRepository,
      contactRepository: identity.contactRepository,
      dealRepository: identity.dealRepository,
      taskRepository: identity.taskRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      timelineEventRepository: identity.timelineEventRepository,
    };
    await registerTeamsRoutes(app, { teamRepository: identity.teamRepository, teamMembershipRepository: identity.teamMembershipRepository, accessAuditLog: identity.accessAuditLog, onAccessChanged: (userId, tenantId) => identity.accessResolver.invalidate(userId, tenantId) });
    await registerTenantMembersRoutes(app, {
      assertCanAddMember: tenantId => assertWithinLimit(entitlementDeps, { tenantId, resource: "users" }),
      passwordHasher: identity.passwordHasher,
      tenantMemberInviteRepository: identity.tenantMemberInviteRepository,
      membershipRepository: identity.membershipRepository,
      userRepository: identity.userRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      productAnalytics: productAnalyticsDeps,
      teamRepository: identity.teamRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
      accessAuditLog: identity.accessAuditLog,
      onAccessChanged: (userId, tenantId) => identity.accessResolver.invalidate(userId, tenantId),
    });
    // Celular é o pivô do CRM: telefone na lista de contatos e limpeza dos contatos só com LID.
    await registerContactPhonesRoutes(app, { contactPhoneRepository: new PostgresContactPhoneRepository(identity.pool) });
    await registerContactsRoutes(app, {
      access: crmAccess,
      contactRepository: identity.contactRepository,
      contactIdentityRepository: identity.contactIdentityRepository,
      timelineEventRepository: identity.timelineEventRepository,
      // Fase 5 — GET /contacts/:id/lead-score.
      dealRepository: identity.dealRepository,
      taskRepository: identity.taskRepository,
      // Jornada Comercial, Fase 5 — GET /contacts/:id/activity (Timeline 360).
      proposalRepository: identity.proposalRepository,
      inbox: sharedInboxDeps ? {
        conversationRepository: app.zunoContainer.inboxConversationRepository,
        conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
      } : undefined,
      // Fase 6 — dispara `contact_created` ao criar um contato.
      automation: automationDeps,
    });
    // CRM/Comercial (Fase 2) — Pipelines/Etapas/Negócios (Kanban).
    await registerPipelinesRoutes(app, {
      pipelineRepository: identity.pipelineRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
    });
    // Sales Engine (Conversas) — oportunidade como negociação completa: itens com snapshot,
    // margem, política comercial/aprovações, fechamento com snapshot, catálogo estendido.
    const salesDeps = {
      workspaceRepository: app.zunoContainer.workspaceRepository,
      dealRepository: identity.dealRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      productRepository: identity.productRepository,
      timelineEventRepository: identity.timelineEventRepository,
      dealItemRepository: identity.dealItemRepository,
      salesCatalogRepository: identity.salesCatalogRepository,
      salesConfigRepository: identity.salesConfigRepository,
      approvalRepository: identity.commercialApprovalRepository,
      membershipRepository: identity.membershipRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
      taskRepository: identity.taskRepository,
      contactRepository: identity.contactRepository,
      notification: { notificationRepository: app.zunoContainer.notificationRepository, realtimePublisher: app.zunoContainer.notificationRealtimePublisher },
      automation: automationDeps,
      proposalRepository: identity.proposalRepository,
      // Metas: cada ganho reavalia "meta atingida" (notifica uma única vez por meta).
      onDealWon: async (deal: import("../../../../domain/crm/crm.model.js").Deal) => checkGoalsReached(salesPerformanceDeps, deal),
    };
    automationDeps.transitionDealStage = (deal, targetStageId) => moveDealStage({ ...salesDeps, sales: salesDeps }, { dealId: deal.id, tenantId: deal.tenantId, workspaceId: deal.workspaceId, targetStageId, source: "automation" });
    const salesPerformanceDeps = { ...salesDeps, goalRepository: identity.salesGoalRepository, analyticsRepository: identity.salesAnalyticsRepository };
    // Proposta como parte da negociação: gate de aprovação no envio, alertas ao vendedor e o
    // efeito configurável do aceite (padrão: ganho automático; preserva preferências existentes).
    const proposalSalesHooks = {
      approvalGate: proposalApprovalGate(salesDeps),
      onBuyerEvent: proposalBuyerEventHandler(salesDeps),
    };
    await registerDealsRoutes(app, {
      dealRepository: identity.dealRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      timelineEventRepository: identity.timelineEventRepository,
      // Fase 6 — dispara `deal_stage_changed` ao mover um negócio de etapa.
      automation: automationDeps,
      productAnalytics: productAnalyticsDeps,
      sales: salesDeps,
    });
    await registerSalesEngineRoutes(app, salesDeps);
    // Vorix Commerce, Fase 1 — Site como entrada comercial: formulário com regras, intenção de venda,
    // carrinho para WhatsApp. A conversão da mensagem com referência roda no worker.
    if (app.zunoContainer.siteEngine) {
      const commerceRepository = new PostgresSiteCommerceRepository(identity.pool);
      const siteLead: SiteLeadDeps = {
        commerceRepository,
        siteRepository: app.zunoContainer.siteEngine.repository,
        crm: { dealRepository: identity.dealRepository, pipelineRepository: identity.pipelineRepository, pipelineStageRepository: identity.pipelineStageRepository, timelineEventRepository: identity.timelineEventRepository, sales: salesDeps },
        sales: salesDeps,
        teamMembershipRepository: identity.teamMembershipRepository,
        notification: salesDeps.notification,
        inbox: sharedInboxDeps,
        crmBridge: sharedInboxDeps ? { inboxContactRepository: sharedInboxDeps.contactRepository, inboxMessageRepository: sharedInboxDeps.messageRepository, contact: { contactRepository: identity.contactRepository, contactIdentityRepository: identity.contactIdentityRepository, timelineEventRepository: identity.timelineEventRepository } } : undefined,
        log: (event, data) => app.log.info({ event, ...data }, `site-commerce ${event}`),
      };
      // Vorix Commerce, Fase 2 — pedidos, checkout, pagamento (conta do lojista) e frete.
      const orders = new PostgresCommerceOrderRepository(identity.pool);
      const commerceConfig = app.zunoConfig.commerce ?? { sandboxPaymentsEnabled: false };
      // Modo de teste: desligado por padrão; quando ligado, pode ficar restrito a tenants de QA.
      const sandboxTenants = new Set(commerceConfig.sandboxTenantIds ?? []);
      const checkoutBase = { secrets: app.zunoContainer.secretManager, sandboxAllowed: (tenantId: string) => commerceConfig.sandboxPaymentsEnabled && (!sandboxTenants.size || sandboxTenants.has(tenantId)) };
      const siteEngine = { ...app.zunoContainer.siteEngine, commerceRepository, checkoutStatus: (site: import("../../../../domain/sites/site.model.js").Site, settings: import("../../../../domain/sites/site-commerce.js").SiteCommerceSettings) => siteCheckoutStatus(checkoutBase, site, settings) };
      await registerSiteRoutes(app, { ...siteEngine, workspaceRepository: app.zunoContainer.workspaceRepository, objectStorage: app.zunoContainer.objectStorage, publicBaseDomain: app.zunoConfig.sitePublicBaseDomain, siteLead });
      await registerSiteCommerceRoutes(app, {
        ...siteEngine,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        teamBelongsToWorkspace: async ({ tenantId, workspaceId, teamId }) => { const team = await identity.teamRepository.getById(teamId); return !!team && team.tenantId === tenantId && team.workspaceId === workspaceId; },
        log: siteLead.log,
      });
      await registerCommerceRoutes(app, {
        ...siteEngine,
        ...checkoutBase,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        orders,
        paymentProviders: { SANDBOX: new SandboxPaymentProvider(), MERCADO_PAGO: new MercadoPagoPaymentProvider() },
        shippingProviders: { OWN: new OwnShippingProvider(), MELHOR_ENVIO: new MelhorEnvioShippingProvider() },
        webhookBaseUrl: commerceConfig.webhookBaseUrl,
        crm: { orders, contact: siteLead.crmBridge?.contact ?? { contactRepository: identity.contactRepository, contactIdentityRepository: identity.contactIdentityRepository, timelineEventRepository: identity.timelineEventRepository }, crm: siteLead.crm, sales: salesDeps },
        notification: salesDeps.notification,
        teamMembershipRepository: identity.teamMembershipRepository,
        log: siteLead.log,
        expirationIntervalMs: 60_000,
      });
    }
    // Produto dentro do Vorix Conversas (buscar, enviar card do catálogo, levar para a oportunidade).
    if (sharedInboxDeps) {
      await registerConversationProductRoutes(app, {
        inbox: sharedInboxDeps,
        routes: sharedInboxDeps,
        productRepository: identity.productRepository,
        salesCatalogRepository: identity.salesCatalogRepository,
        productEngineRepository: identity.productEngineRepository,
        siteRepository: app.zunoContainer.siteEngine?.repository,
        objectStorage: app.zunoContainer.objectStorage,
        publicBaseDomain: app.zunoConfig.sitePublicBaseDomain,
        appBaseUrl: app.zunoConfig.billing?.appBaseUrl,
        crmBridge: { inboxContactRepository: sharedInboxDeps.contactRepository, inboxMessageRepository: sharedInboxDeps.messageRepository, contact: { contactRepository: identity.contactRepository, contactIdentityRepository: identity.contactIdentityRepository, timelineEventRepository: identity.timelineEventRepository } },
        sales: salesDeps,
        crm: { dealRepository: identity.dealRepository, pipelineRepository: identity.pipelineRepository, pipelineStageRepository: identity.pipelineStageRepository, timelineEventRepository: identity.timelineEventRepository, sales: salesDeps },
      });
    }
    // IA comercial: leitura da conversa do contato por ponte (sales nunca importa inbox) e gerador
    // via AI Gateway (mesmo stack/créditos do Copiloto Comercial).
    const inboxForInsights = sharedInboxDeps;
    // Dashboard principal (0174): atendimento + SLA + CSAT + comercial + metas, sempre no escopo.
    await registerDashboardRoutes(app, {
      dashboardRepository: new PostgresDashboardRepository(identity.pool),
      workspaceRepository: app.zunoContainer.workspaceRepository,
      membershipRepository: identity.membershipRepository,
      teamRepository: identity.teamRepository,
      teamMembershipRepository: identity.teamMembershipRepository,
      sales: salesPerformanceDeps,
    });
    await registerSalesPerformanceRoutes(app, {
      ...salesPerformanceDeps,
      proposalRepository: identity.proposalRepository,
      insightsGenerator: new AiGatewayDealInsightsGenerator(app.zunoContainer.aiGateway),
      conversationReader: inboxForInsights ? {
        recentMessages: async ({ tenantId, workspaceId, contactId, limit }) => {
          const conversations = await inboxForInsights.conversationRepository.listByWorkspace({ tenantId, workspaceId, contactId });
          const messages = (await Promise.all(conversations.slice(0, 3).map((conversation) => inboxForInsights.messageRepository.listByConversation({ tenantId, workspaceId, conversationId: conversation.id, limit })))).flat();
          return messages
            .filter((message) => typeof message.body === "string" && message.body.trim().length > 0)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .slice(-limit)
            .map((message) => ({ direction: message.direction, at: message.createdAt.slice(0, 16).replace("T", " "), text: message.body as string }));
        },
      } : undefined,
    });
    // CRM/Comercial (Fase 3) — Tarefas, Catálogo de produtos, Propostas (com link público).
    await registerTasksRoutes(app, { access: crmAccess, taskRepository: identity.taskRepository, timelineEventRepository: identity.timelineEventRepository });
    await registerProductsRoutes(app, {
      productRepository: identity.productRepository,
      productEngineRepository: identity.productEngineRepository,
      salesCatalogRepository: identity.salesCatalogRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      salesConfigRepository: identity.salesConfigRepository,
      membershipRepository: identity.membershipRepository,
      notification: { notificationRepository: app.zunoContainer.notificationRepository, realtimePublisher: app.zunoContainer.notificationRealtimePublisher },
      objectStorage: app.zunoContainer.objectStorage,
      maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
    });
    if(identity.productEngineRepository) await registerProductEngineRoutes(app,{repository:identity.productEngineRepository,productRepository:identity.productRepository,workspaceRepository:app.zunoContainer.workspaceRepository,objectStorage:app.zunoContainer.objectStorage});
    const proposalUseCaseDeps = {
      proposalRepository: identity.proposalRepository,
      timelineEventRepository: identity.timelineEventRepository,
      contactRepository: identity.contactRepository,
      dealRepository: identity.dealRepository,
      automation: automationDeps,
      productAnalytics: productAnalyticsDeps,
      ...proposalSalesHooks,
    };
    await registerProposalsRoutes(app, {
      access: crmAccess,
      ...proposalUseCaseDeps,
      delivery: sharedInboxDeps ? {
        ...proposalUseCaseDeps,
        inbox: sharedInboxDeps,
        appBaseUrl: app.zunoConfig.billing.appBaseUrl,
        messageTemplates: (tenantId: string, workspaceId: string) => proposalMessageTemplates(salesDeps, tenantId, workspaceId),
        renderMessage: renderProposalMessage,
      } : undefined,
      sales: { ...salesDeps, proposalRepository: identity.proposalRepository, proposalTemplateRepository: identity.proposalTemplateRepository, proposal: proposalUseCaseDeps },
    });
    await registerProposalTemplatesRoutes(app, { proposalTemplateRepository: identity.proposalTemplateRepository });
    await registerPublicProposalsRoutes(app, {
      proposalRepository: identity.proposalRepository,
      timelineEventRepository: identity.timelineEventRepository,
      contactRepository: identity.contactRepository,
      workspaceRepository: app.zunoContainer.workspaceRepository,
      dealRepository: identity.dealRepository,
      pipelineStageRepository: identity.pipelineStageRepository,
      // Fase 6 — dispara `proposal_accepted`/`proposal_rejected` ao responder ao link público.
      automation: automationDeps,
      productAnalytics: productAnalyticsDeps,
      salesConfigRepository: identity.salesConfigRepository,
      onBuyerEvent: proposalSalesHooks.onBuyerEvent,
      acceptanceHandler: proposalAcceptanceHandler(salesDeps),
    });
    // Vorix Meetings — inteligência e colaboração. CRM e WhatsApp entram por ponte (o Meetings
    // não importa `crm`/`inbox`); sem Conversas habilitado, o envio por WhatsApp fica indisponível.
    if (app.zunoContainer.meetings?.insights) {
      const meetingIntelligenceDeps = {
        ...app.zunoContainer.meetings,
        insights: app.zunoContainer.meetings.insights,
        ai: new AiGatewayMeetingIntelligence(app.zunoContainer.aiGateway),
        crm: buildMeetingCrmBridge({
          contactRepository: identity.contactRepository,
          contactIdentityRepository: identity.contactIdentityRepository,
          dealRepository: identity.dealRepository,
          taskRepository: identity.taskRepository,
          timelineEventRepository: identity.timelineEventRepository,
        }),
        ...(sharedInboxDeps ? { messaging: buildMeetingMessagingBridge(sharedInboxDeps, async (tenantId) => (await app.zunoContainer.solutionAccess?.hasAccess(tenantId, "conversations")) ?? false) } : {}),
        publicAppUrl: app.zunoConfig.billing.appBaseUrl,
      };
      await registerMeetingIntelligenceRoutes(app, {
        ...meetingIntelligenceDeps,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        ...(app.zunoContainer.meetings.zoom ? { zoom: app.zunoContainer.meetings.zoom } : {}),
        analysisEnabled: app.zunoConfig.meetings?.aiAnalysisEnabled ?? true,
        ...(app.zunoContainer.meetingsAgenda ? { nativeImport: { meet: new GoogleMeetTranscriptClient(), tokens: app.zunoContainer.meetingsAgenda.connection.auth, analysisEnabled: app.zunoConfig.meetings?.aiAnalysisEnabled ?? true } } : {}),
      });
      await registerPublicMeetingRoutes(app, meetingIntelligenceDeps);
    }
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
    await registerCommercialMetricsRoutes(app, { commercialMetricsRepository: identity.commercialMetricsRepository, teamMembershipRepository: identity.teamMembershipRepository });
    // SaaS Commercialization (Fase 1) — Billing Foundation: canUse()/limit() centralizados.
    const entitlementDeps = {
      subscriptionPendingChangeRepository:identity.subscriptionPendingChangeRepository,
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
    // Aquisição self-service — bloqueia criação operacional (Contato/Negócio/Tarefa/Proposta/
    // Automação) quando o tenant está em modo somente-leitura (trial vencido/pagamento pendente/
    // suspenso). Opt-in por rota via `config.readOnlyGuard`, ver `read-only-guard.ts`.
    registerReadOnlyGuard(app, entitlementDeps);
    await registerAdminPlanVersionsRoutes(app, { planVersionRepository: identity.planVersionRepository, addonDefinitionRepository: identity.addonDefinitionRepository });
    // SaaS Commercialization (Fase 2) — Checkout self-service. A ativação real da Subscription só
    // acontece via webhook confirmado (`billing-webhook.route.ts`, fora de `/v1`), nunca aqui.
    await registerBillingCheckoutRoutes(app, {
      billingProvider: app.zunoContainer.billingProvider,
      planVersionRepository: identity.planVersionRepository,
      addonDefinitionRepository: identity.addonDefinitionRepository,
      subscriptionRepository: identity.subscriptionRepository,
      userRepository: identity.userRepository,
      checkoutIntentRepository: identity.checkoutIntentRepository,
      appBaseUrl: app.zunoConfig.billing.appBaseUrl,
      productAnalytics: productAnalyticsDeps,
    });
    // Trial + Product Analytics — trial sem cartão, mesma Subscription real de qualquer assinatura.
    await registerBillingTrialRoutes(app, {
      subscriptionRepository: identity.subscriptionRepository,
      planVersionRepository: identity.planVersionRepository,
      platformBillingRepository: identity.platformBillingRepository,
      billingEventRepository: identity.billingEventRepository,
      trialEnabled: app.zunoConfig.billing.trialEnabled,
      trialAiCredits: app.zunoConfig.billing.aiCredits.trialCredits,
      productAnalytics: productAnalyticsDeps,
    });
    // Trial + Product Analytics — fundação de eventos de produto (`productAnalyticsDeps`
    // construído uma única vez no topo desta função, reusado aqui e por `registerAuthRoutes`).
    // Non-null seguro: estamos dentro de `if (app.zunoContainer.identity)`, a MESMA condição que
    // decidiu `productAnalyticsDeps` lá em cima — nunca `undefined` neste ponto.
    await registerProductEventsRoutes(app, productAnalyticsDeps!);
    // SaaS Commercialization (Fase 3) — upgrade/downgrade, add-ons, cancelamento/reativação.
    await registerBillingLifecycleRoutes(app, {
      ...entitlementDeps,
      billingProvider: app.zunoContainer.billingProvider,
      billingEventRepository: identity.billingEventRepository,
      subscriptionPendingChangeRepository: identity.subscriptionPendingChangeRepository,
      solutionEntitlementRepository: identity.solutionEntitlementRepository,
      productAnalytics: productAnalyticsDeps,
    });
    // Pricing/Capacity Etapa B — capacidade (usuários/números WhatsApp) self-service: estado,
    // preview financeiro, aplicar (aumento imediato/redução agendada), cancelar redução pendente.
    await registerBillingCapacityRoutes(app, {
      ...entitlementDeps,
      billingProvider: app.zunoContainer.billingProvider,
      billingEventRepository: identity.billingEventRepository,
      capacityMutationRepository:identity.capacityMutationRepository,
      subscriptionPendingChangeRepository: identity.subscriptionPendingChangeRepository,
      productAnalytics: productAnalyticsDeps,
    });
    // SaaS Commercialization (Fase 4) — tela "Plano e Cobrança" self-service.
    await registerBillingOverviewRoutes(app, {
      ...entitlementDeps,
      billingProvider: app.zunoContainer.billingProvider,
      invoiceRepository: identity.invoiceRepository,
      appBaseUrl: app.zunoConfig.billing.appBaseUrl,
    });
    // Relatórios — modelos fixos e do cliente, criação de modelo e análise com IA (créditos via AI Gateway).
    await registerReportsRoutes(app, { reportTemplateRepository: identity.reportTemplateRepository, reportAi: new AiGatewayReportAi(app.zunoContainer.aiGateway) });
    // Créditos de IA avulsos — saldo, preço e recarga (cartão salvo ou checkout de pagamento único).
    await registerBillingCreditsRoutes(app, {
      billingProvider: app.zunoContainer.billingProvider,
      subscriptionRepository: identity.subscriptionRepository,
      platformBillingRepository: identity.platformBillingRepository,
      aiCreditPurchaseRepository: identity.aiCreditPurchaseRepository,
      userRepository: identity.userRepository,
      pricing: app.zunoConfig.billing.aiCredits,
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
        workspaceRepository: app.zunoContainer.workspaceRepository,
        productAnalytics: productAnalyticsDeps,
      },
      inboxDeps: {
        connectionRepository: app.zunoContainer.messagingConnectionRepository,
        contactRepository: app.zunoContainer.inboxContactRepository,
        conversationRepository: app.zunoContainer.inboxConversationRepository,
        conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
        messageRepository: app.zunoContainer.inboxMessageRepository,
        workspaceRepository: app.zunoContainer.workspaceRepository,
        outboundQueue: app.zunoContainer.inboxOutboundQueue,
        providers: { wuzapi: app.zunoContainer.inboxProvider, instagram: app.zunoContainer.instagramMessagingProvider },
        productAnalytics: productAnalyticsDeps,
      },
      // Independente do entitlement de messaging_connections: isto é o kill switch operacional
      // do módulo (CONVERSATIONS_MODULE_ENABLED), não o limite de plano.
      inboxModuleEnabled: app.zunoContainer.inboxFeatureFlags.enabled,
      productAnalytics: productAnalyticsDeps,
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
    workspaceRepository: app.zunoContainer.workspaceRepository,
  });
  await registerAssetsRoutes(app, {
    assetLibraryRepository: app.zunoContainer.assetLibraryRepository,
    workspaceRepository: app.zunoContainer.workspaceRepository,
    objectStorage: app.zunoContainer.objectStorage,
    maxUploadBytes: app.zunoConfig.objectStorage.maxUploadBytes,
    removeImageBackground: app.zunoContainer.removeImageBackground,
  });
  await registerProductionSettingsRoutes(app, {
    productionSettingsRepository: app.zunoContainer.productionSettingsRepository,
    workspaceRepository: app.zunoContainer.workspaceRepository,
  });
  await registerBrandProfileRoutes(app, {
    resolveBrandProfile: app.zunoContainer.resolveBrandProfile,
    updateBrandProfile: app.zunoContainer.updateBrandProfile,
    workspaceRepository: app.zunoContainer.workspaceRepository,
  });
  await registerBrandIdentityRoutes(app, {
    brandIdentityService: app.zunoContainer.brandIdentityService,
    workspaceRepository: app.zunoContainer.workspaceRepository,
  });
  await registerFileRoutes(app, {
    authorize: createObjectKeyReadAuthorizer({
      workspaceRepository: app.zunoContainer.workspaceRepository,
      qaTenantIds: (app.zunoContainer.creativeEngineEditorialQaAllowlist ?? []).map((entry) => entry.tenantId),
    }),
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
      billingProviderSettings: {
        billingProviderSettingsRepository: identity.billingProviderSettingsRepository,
        now: () => new Date(),
      },
    });

    if (app.zunoContainer.meetings && app.zunoConfig.jwtSecret) {
      await registerMeetingsRecorderAdminRoutes(app, {
        repository: app.zunoContainer.meetings.repository,
        encryptSession: (plaintext) => encryptSecret(plaintext, app.zunoConfig.jwtSecret!),
        now: () => new Date(),
      });
    }

    await registerAiProvidersRoutes(app, {
      aiProvidersRepository: identity.aiProvidersRepository,
      aiMediaProviderRegistry: app.zunoContainer.aiMediaProviderRegistry,
      secretManager: app.zunoContainer.secretManager,
      now: () => new Date(),
    });

    // Trial + Product Analytics — Fatia E: Growth Dashboard mínimo, ADMIN-only.
    await registerGrowthDashboardRoutes(app, { growthMetricsRepository: identity.growthMetricsRepository });
  }
}
