import { join } from "node:path";
import type pg from "pg";
import type { AiGatewayPort } from "../../../application/ports/ai-gateway.port.js";
import type { AnalyticsRepositoryPort } from "../../../application/ports/analytics-repository.port.js";
import type { AssetLibraryRepositoryPort } from "../../../application/ports/asset-library-repository.port.js";
import type { ProductionSettingsRepositoryPort } from "../../../application/ports/production-settings-repository.port.js";
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
import type { MetaAdAccountRepositoryPort } from "../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../../../application/ports/meta-ads-credential-repository.port.js";
import type { MetaAdCampaignRepositoryPort } from "../../../application/ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSetRepositoryPort } from "../../../application/ports/meta-ad-set-repository.port.js";
import type { MetaAdRepositoryPort } from "../../../application/ports/meta-ad-repository.port.js";
import type { MetaCustomAudienceRepositoryPort } from "../../../application/ports/meta-custom-audience-repository.port.js";
import type { MetaPixelRepositoryPort } from "../../../application/ports/meta-pixel-repository.port.js";
import type { MetaCapiEventRepositoryPort } from "../../../application/ports/meta-capi-event-repository.port.js";
import type { InstagramDmAccountRouteRepositoryPort } from "../../../application/ports/instagram-dm-account-route-repository.port.js";
import type { InstagramDmConversationRepositoryPort } from "../../../application/ports/instagram-dm-conversation-repository.port.js";
import type { InstagramDmMessageRepositoryPort } from "../../../application/ports/instagram-dm-message-repository.port.js";
import type { InstagramDmAutomationRuleRepositoryPort } from "../../../application/ports/instagram-dm-automation-rule-repository.port.js";
import type { AIProviderPort } from "../../../application/ports/ai-provider.port.js";
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
import { removeImageBackgroundViaAI } from "../../../infrastructure/ai-providers/openai-background-removal.js";
import { OpenAiIcaroImageProvider } from "../../../infrastructure/ai-providers/openai-icaro-image-provider.js";
import { OpenAiIcaroTextProvider } from "../../../infrastructure/ai-providers/openai-icaro-text-provider.js";
import { OpenAiCreativeImageProvider } from "../../../infrastructure/ai-providers/openai-creative-image-provider.js";
import { createQualityFeedbackCenter, type QualityFeedbackCenter } from "../../../application/quality-feedback/quality-feedback-center.js";
import { OpenAiVisionDescriber } from "../../../infrastructure/ai-providers/openai-vision-describer.js";
import { OpenAiReferenceIntelligenceExtractor } from "../../../infrastructure/ai-providers/openai-reference-intelligence-extractor.js";
import { OpenAiSemanticOcclusionChecker } from "../../../infrastructure/ai-providers/openai-semantic-occlusion-checker.js";
import type { ReferenceIntelligence } from "../../../shared/utils/reference-intelligence.types.js";
import { GoogleVeoProviderAdapter } from "../../../infrastructure/ai-providers/google-veo-provider-adapter.js";
import { IcaroAIBrain } from "../../../application/ai/icaro-brain.js";
import { InMemoryIcaroCostLedger } from "../../../infrastructure/telemetry/in-memory-icaro-cost-ledger.js";
import { PostgresIcaroCostLedger } from "../../../infrastructure/telemetry/postgres-icaro-cost-ledger.js";
import { InMemoryIcaroLogger } from "../../../infrastructure/telemetry/in-memory-icaro-logger.js";
import { PostgresIcaroLogger } from "../../../infrastructure/telemetry/postgres-icaro-logger.js";
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
import { assertCreativeEngineExclusivity, resolveCreativeEngineMode } from "../../../application/creative-engine/creative-engine-mode.js";
import type { CreativeBrandProfile } from "../../../application/creative-engine/build-creative-context.js";
import type { CreativeEngineRunRepositoryPort } from "../../../application/ports/creative-engine-run-repository.port.js";
import { compositeLogoOntoImage } from "../../../infrastructure/media/logo-compositor.js";
import { compositeScreenshotIntoDeviceMockup } from "../../../infrastructure/media/screenshot-mockup-compositor.js";
import { renderCreativePlanTextZones } from "../../../infrastructure/rendering/render-creative-plan-text-zones.js";
import { computeAssetSuitabilityScore } from "../../../infrastructure/image-processing/product-background.js";
import sharp from "sharp";
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
import { MetaAdsOAuthService, META_ADS_REQUIRED_SCOPES } from "../../../infrastructure/publication/meta-ads-oauth-service.js";
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
import { buildConservativeDefaultProfile, type BrandVisualProfile } from "../../../shared/utils/brand-visual-profile.types.js";

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
  productionSettingsRepository: ProductionSettingsRepositoryPort;
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
  /** Migração "GPT como motor criativo único" (PR 1/9) — prova auditável de qual motor produziu
   * cada peça publicável (ver `creative-engine-run-repository.port.ts`). Exposta aqui (já fluía
   * via `...repositories` no retorno, mas sem tipo declarado) para que qualquer leitor legítimo
   * — um endpoint de auditoria futuro, um script de validação — possa consultar
   * `getByExecutionRunId`/`listByWorkspace` sem precisar de um cast. */
  creativeEngineRunRepository: CreativeEngineRunRepositoryPort;
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
  /** Módulo Meta Ads Manager (Fase 1) — deliberadamente separado de `metaInstagramOAuthService`,
   * ver comentário no topo de `meta-ads-oauth-service.ts`. */
  metaAdsOAuthService: MetaAdsOAuthService;
  /** Módulo Instagram DM Automation (Fase 5) — instância dedicada, ver comentário onde é
   * construída. */
  instagramDmAiReplyProvider: AIProviderPort;
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
  /** Fase 2 — expostos para o scheduler de sync (`meta-ads-sync-scheduler.ts`) e para as rotas de
   * árvore de campanhas. */
  metaAdsCredentialRepository: MetaAdsCredentialRepositoryPort;
  metaAdCampaignRepository: MetaAdCampaignRepositoryPort;
  metaAdSetRepository: MetaAdSetRepositoryPort;
  metaAdRepository: MetaAdRepositoryPort;
  /** Fase 4 — públicos customizados/semelhantes, pixels e log de auditoria da Conversions API. */
  metaCustomAudienceRepository: MetaCustomAudienceRepositoryPort;
  metaPixelRepository: MetaPixelRepositoryPort;
  metaCapiEventRepository: MetaCapiEventRepositoryPort;
  /** Módulo Instagram DM Automation (Fase 5). */
  instagramDmAccountRouteRepository: InstagramDmAccountRouteRepositoryPort;
  instagramDmConversationRepository: InstagramDmConversationRepositoryPort;
  instagramDmMessageRepository: InstagramDmMessageRepositoryPort;
  instagramDmAutomationRuleRepository: InstagramDmAutomationRuleRepositoryPort;
  objectStorage: ObjectStoragePort;
  /** Remoção de fundo de logo via IA (`POST /v1/images/edits`, `background: "transparent"`) —
   * ver `openai-background-removal.ts`. Nunca registra Asset por conta própria; a rota exige
   * confirmação explícita do usuário antes de salvar o resultado como logo oficial. */
  removeImageBackground: (input: { imageBuffer: Buffer; contentType: string }) => Promise<Buffer>;
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
  /** Garante (idempotente) que a conta interna tenha um perfil Valentina + identidade de marca
   * (a partir da logo real cadastrada em Materiais, quando existir) antes da primeira geração
   * real — ver comentário junto da implementação. */
  ensureHouseTenantProfile(tenantId: string, workspaceId: string): Promise<void>;
  /** Brand Visual Profile (Rodada 2, Fatia 2, Prioridade 5) — busca/cria (idempotente) o perfil
   * visual persistente do workspace, ver comentário junto da implementação. Chamado a cada geração
   * (não só no bootstrap do tenant) porque é a Skill de design quem consome — barato depois da
   * primeira vez (só um `select`). */
  ensureBrandVisualProfile(workspaceId: string): Promise<BrandVisualProfile>;
  /** Migração "Prompt Persistente de Produção" (achado numa autorrevisão) — resolve o perfil de
   * marca real (Clara BrandContext/IdentityContext/BusinessContext/AudienceContext/ProductContext)
   * a partir do `workspaceId`, para o motor GPT e para prova de auditoria/teste. `undefined` =
   * workspace sem nenhum dado de marca cadastrado ainda, nunca inventado. */
  resolveBrandProfile(workspaceId: string): Promise<CreativeBrandProfile | undefined>;
  /** Migração "Marca & Materiais" — grava os campos editáveis do Perfil da Marca (ver
   * `resolveBrandProfile` para o caminho de leitura simétrico). */
  updateBrandProfile(workspaceId: string, patch: { positioning?: string; toneOfVoice?: string; businessDescription?: string; targetAudience?: string }): Promise<void>;
  /** Exposto para teste/auditoria direta da Clara (ex.: provar que `resolveBrandProfile` lê o
   * dado real corretamente) — uso em produção continua indireto, via `resolveBrandProfile`/
   * `ensureHouseTenantProfile`, nunca uma segunda via de escrita de perfil de marca. */
  clara: ClaraKnowledgeCenter;
  /** Descreve uma imagem pública (referência anexada numa ideia, logo em Materiais) em texto —
   * usado tanto pelo bootstrap de marca acima quanto por `generate-visual-from-idea.ts` para
   * enriquecer o briefing com o que uma imagem de referência mostra. */
  imageDescriber: { describe(imageUrl: string, instruction: string): Promise<string | undefined> };
  /** Extração ESTRUTURADA de fatos de referência (produto, preço, desconto, oferta, o que
   * preservar) — diferente de `imageDescriber`, que só produz prosa de estilo visual. Usado por
   * `generate-visual-from-idea.ts` para popular `referenceIntelligence`. */
  referenceIntelligenceExtractor: { extract(imageUrls: string[]): Promise<ReferenceIntelligence | undefined> };
  /** Registra avaliações/rejeições de peças geradas (endpoint de rejeição estruturada da tela de
   * Revisão) e alimenta a memória editorial via `getRecentRejectionSignalsForWorkspace`. */
  qualityFeedback: QualityFeedbackCenter;
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

  const executionHandlers: [DeterministicExecutionTaskHandler] = [new DeterministicExecutionTaskHandler()];
  const executionFeatureFlags: ExecutionFeatureFlags = {
    realExecutionEnabled: config?.execution.realExecutionEnabled ?? false,
    realExecutionResearchEnabled: config?.execution.realExecutionResearchEnabled ?? false,
    realPlanningEnabled: config?.execution.realPlanningEnabled ?? false,
    realCopyEnabled: config?.execution.realCopyEnabled ?? false,
    realVisualEnabled: config?.execution.realVisualEnabled ?? false,
    realDistributionEnabled: config?.execution.realDistributionEnabled ?? false,
    // Migração "GPT como motor criativo único" (PR 6/9) — default do container (sem config)
    // preserva o motor legado, espelhando `DEFAULT_EXECUTION_FEATURE_FLAGS`.
    creativeEngineGptEnabled: config?.execution.creativeEngineGptEnabled ?? false,
    legacyCreativeEngineEnabled: config?.execution.legacyCreativeEngineEnabled ?? true,
  };
  // Falha alto e cedo no boot em vez de deixar uma execução descobrir ambiguidade/ausência de
  // motor criativo no meio do caminho — ver `creative-engine-mode.ts`.
  assertCreativeEngineExclusivity(executionFeatureFlags);
  const creativeEngineMode = resolveCreativeEngineMode(executionFeatureFlags).mode;
  const planningEngineHook = new PlanningEngineBriefingHook({
    planningRepository: repositories.planningRepository,
    executionGraphRepository: repositories.executionGraphRepository,
    executionTaskRepository: repositories.executionTaskRepository,
    artifactRepository: repositories.planningArtifactRepository,
    decisionRepository: repositories.planningDecisionRepository,
    idGenerator: defaultPlanningIdGenerator,
    runtimeEngine: runtimeEngineHook,
    creativeEngine: creativeEngineMode,
  });
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
  const removeImageBackground = (input: { imageBuffer: Buffer; contentType: string }) =>
    removeImageBackgroundViaAI(
      { apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl, getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai") },
      input,
    );
  const imageDescriber = new OpenAiVisionDescriber({
    apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
  });
  // Reference Intelligence — extração ESTRUTURADA de fatos de referência (produto, preço,
  // desconto, oferta), separada de `imageDescriber` (que só produz prosa de estilo visual). Mesma
  // config/credencial, provider distinto por ter contrato de saída (JSON estruturado) diferente.
  const referenceIntelligenceExtractor = new OpenAiReferenceIntelligenceExtractor({
    apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
  });
  // Repair Loop (Rodada 2, Fatia 3) — checagem barata de oclusão semântica (rosto/olhos/mãos/
  // produto cobertos por um elemento comercial), rodada DENTRO do próprio pipeline visual antes
  // de finalizar o artefato. Mesmo critério do registro oficial do Lucas (`semantic-occlusion.
  // types.ts`), transporte HTTP próprio porque o execution handler não tem `IcaroBrainPort`.
  const semanticOcclusionChecker = new OpenAiSemanticOcclusionChecker({
    apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
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
  // Sem o Provider de texto, João/Maria/Lucas nunca tinham NENHUM Provider que respondesse
  // "analysis"/"text_generation"/"review" — só "image_generation" (Pedro) estava registrado. João
  // degrada bem sem IA, mas Maria exige Ícaro (não é opcional na Skill dela): sem isto, toda
  // chamada de copy_generation no grafo `content_request-visual-only-v2` falhava sempre.
  // `costLedger` fecha um gap encontrado na auditoria "GPT como motor criativo único": até aqui,
  // NENHUMA chamada de IA das Skills (João/Maria/Bianca/Pedro/Lucas/Sofia) ficava registrada em
  // lugar nenhum além de memória — perdida a cada reinício. Com Postgres disponível, cada chamada
  // completa vira uma linha em `icaro_ai_calls` (ver `postgres-icaro-cost-ledger.ts`), dando uma
  // baseline real de custo/latência do motor legado antes do corte para o motor GPT.
  const icaroCostLedger = repositories.pool
    ? new PostgresIcaroCostLedger(repositories.pool, { brain: "legacy" })
    : new InMemoryIcaroCostLedger();
  // `logger` persiste só as ações de log com diagnóstico real (Timeout/Error) em
  // `icaro_ai_call_errors` — ver `postgres-icaro-logger.ts`. Complementa `costLedger`, que só
  // guarda status/custo/latência agregados, nunca o motivo de uma falha.
  const icaroLogger = repositories.pool
    ? new PostgresIcaroLogger(repositories.pool, { brain: "legacy" })
    : new InMemoryIcaroLogger();
  const icaro = new IcaroAIBrain({
    providers: [
      new OpenAiIcaroImageProvider(openaiImageProvider),
      new OpenAiIcaroTextProvider({
        apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
        getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
      }),
    ],
    costLedger: icaroCostLedger,
    logger: icaroLogger,
  });
  // Módulo de Quality Feedback (`src/application/quality-feedback/*`) já existia mas nunca tinha
  // sido ligado à API/produção — só CLI. Reaproveitado aqui em vez de criar um mecanismo novo,
  // tanto para o endpoint de rejeição estruturada quanto para alimentar a memória editorial
  // (`getRecentRejectionSignalsForWorkspace`).
  const qualityFeedback = createQualityFeedbackCenter({ repository: repositories.qualityFeedbackRepository });
  const contentGenerationHistory = repositories.contentGenerationHistoryRepository;
  // Migração "GPT como motor criativo único" (PR 6/9) — segunda instância do Ícaro, FISICAMENTE
  // separada de `icaro` acima: providers próprios (texto configurado explicitamente para
  // "gpt-4o", nunca o "gpt-4o-mini" padrão da instância legada) e ledger/logger com
  // `brain: "creative"`, para nunca misturar custo/latência do motor novo com o legado em
  // `icaro_ai_calls`. Duas instâncias = fisicamente impossível o diretor criativo cair no modelo
  // econômico "por conveniência".
  const creativeIcaroCostLedger = repositories.pool
    ? new PostgresIcaroCostLedger(repositories.pool, { brain: "creative" })
    : new InMemoryIcaroCostLedger();
  const creativeIcaroLogger = repositories.pool
    ? new PostgresIcaroLogger(repositories.pool, { brain: "creative" })
    : new InMemoryIcaroLogger();
  const creativeIcaro = new IcaroAIBrain({
    providers: [
      new OpenAiCreativeImageProvider(openaiImageProvider),
      new OpenAiIcaroTextProvider({
        apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
        getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
        modelId: "gpt-4o",
      }),
    ],
    costLedger: creativeIcaroCostLedger,
    logger: creativeIcaroLogger,
  });
  // Módulo Instagram DM Automation (Fase 5) — instância DEDICADA de `OpenAiIcaroTextProvider`,
  // nunca `icaro`/`creativeIcaro` acima (mesmo raciocínio: nunca misturar custo/contexto entre
  // papéis). Chamada direta em `generateAiDmReply`, sem passar pelo `IcaroAIBrain` — não há
  // tarefa multi-provider pra rotear numa resposta avulsa de DM.
  const instagramDmAiReplyProvider: AIProviderPort = new OpenAiIcaroTextProvider({
    apiBaseUrl: config?.mediaProviders.openaiApiBaseUrl,
    getApiKey: resolveMediaProviderKey(config?.mediaProviders.openaiApiKey, "ai-provider:openai"),
  });
  const readCreativeImageDimensions = async (buffer: Buffer): Promise<{ width?: number; height?: number }> => {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  };
  // Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — resolve o
  // Prompt de Produção/Diretrizes Criativas do workspace, sempre best-effort (nunca derruba a
  // geração por falha de leitura; ausência = workspace sem configuração ainda, nunca inventado).
  const resolveProductionSettings = async (workspaceId: string) =>
    repositories.productionSettingsRepository.getByWorkspace(workspaceId).catch(() => undefined);
  // Lista os materiais reais (com arquivo) da Asset Library do workspace, já com URL pública
  // resolvida — a seleção de QUAIS são relevantes para o pedido atual acontece em
  // `select-brand-materials.ts`, nunca aqui (este resolver só lista o que existe).
  //
  // Achado ao vivo (cliente real): `materialType` é aditivo (ver `asset-library.model.ts`) — um
  // asset cadastrado como logo ANTES da migração "Marca & Materiais" (ou via qualquer fluxo que só
  // seta `kind: "logo"`, ex.: `LogoConfigCard` antes desta correção) nunca teve `materialType`
  // preenchido. `select-brand-materials.ts` só reconhece `materialType === "logo_principal"/
  // "logo_secundaria"` para incluir a logo automaticamente — sem esse campo, a logo aparece como
  // "configurada" em toda a UI (que checa só `kind`), mas o motor GPT real nunca a recebe, e a
  // peça gerada sai sem nenhuma logo, em silêncio. Backfill aqui (nunca em `select-brand-
  // materials.ts`, que deve continuar puro/alheio a `AssetKind`): `kind: "logo"` sem `materialType`
  // próprio conta como "logo_principal" — nunca sobrescreve um `materialType` já definido
  // explicitamente (ex.: alguém marcou de propósito como "logo_secundaria").
  const resolveBrandMaterials = async (workspaceId: string) => {
    const library = await repositories.assetLibraryRepository.getLibraryByWorkspace(workspaceId).catch(() => undefined);
    if (!library) return [];
    const assets = await repositories.assetLibraryRepository.listAssets(library.id).catch(() => []);
    return assets
      .filter((asset) => asset.status === "active" && asset.storageRef)
      .map((asset) => {
        let url: string | undefined;
        try {
          url = asset.storageRef ? objectStorage.resolvePublicUrl(asset.storageRef.objectKey) : undefined;
        } catch {
          url = undefined;
        }
        const materialType = asset.materialType ?? (asset.kind === "logo" ? "logo_principal" : undefined);
        return {
          id: asset.id,
          name: asset.name,
          materialType,
          usagePriority: asset.usagePriority,
          aiInstructions: asset.aiInstructions,
          usageRule: asset.usageRule,
          url,
        };
      });
  };
  // Migração "Prompt Persistente de Produção" (achado numa autorrevisão) — fecha o gap que
  // deixava `resolveBrandProfile` fora do wiring: `workspaceRepository.getById` resolve o
  // `tenantId` real do workspace (Clara é indexada por `clientId`≈`tenantId`, nunca por
  // `workspaceId` diretamente), e a partir daí reaproveita EXATAMENTE a mesma porta Clara já usada
  // por `ensureHouseBrandContext`/`ensureHouseIdentityContext` acima — nunca uma segunda fonte de
  // perfil de marca. Best-effort em cada leitura (best-effort agregado, não por módulo individual,
  // de propósito: um erro real do Clara para este tenant deveria mesmo derrubar o perfil inteiro
  // em vez de devolver um perfil parcialmente corrompido sem se saber).
  const resolveBrandProfile = async (workspaceId: string): Promise<CreativeBrandProfile | undefined> => {
    const workspace = await repositories.workspaceRepository.getById(workspaceId).catch(() => undefined);
    if (!workspace) return undefined;
    const clientId = workspace.tenantId;

    const [brandRecords, identityRecords, businessRecords, audienceRecords, productRecords] = await Promise.all([
      clara.list({ clientId, module: "BrandContext", status: "active" }).catch(() => []),
      clara.list({ clientId, module: "IdentityContext", status: "active" }).catch(() => []),
      clara.list({ clientId, module: "BusinessContext", status: "active" }).catch(() => []),
      clara.list({ clientId, module: "AudienceContext", status: "active" }).catch(() => []),
      clara.list({ clientId, module: "ProductContext", status: "active" }).catch(() => []),
    ]);

    const brand = brandRecords[0]?.payload as { brandName?: string; positioning?: string; toneOfVoice?: string } | undefined;
    const identity = identityRecords[0]?.payload as { colors?: string[]; imageStyle?: string; logoUri?: string } | undefined;
    const business = businessRecords[0]?.payload as { description?: string } | undefined;
    const audience = audienceRecords[0]?.payload as { targetAudience?: string } | undefined;
    const productsOrServices = productRecords
      .map((record) => (record.payload as { productName?: string; serviceName?: string }).productName ?? (record.payload as { productName?: string; serviceName?: string }).serviceName)
      .filter((name): name is string => Boolean(name));
    const differentiators = productRecords.flatMap((record) => (record.payload as { differentiators?: string[] }).differentiators ?? []);

    // Achado ao vivo numa autorrevisão: `BrandContext.brandName` é SEMPRE o literal "Vorix" nesta
    // base de código — `ensureHouseBrandContext` (acima) escreve esse valor incondicionalmente,
    // nunca o nome real do cliente. Nunca surfar isto como se fosse o nome real da marca —
    // `buildCreativeContext` já usa `input.brandName` (vindo do briefing real) como o nome
    // correto; aqui só `positioning` pode ser real, e só quando não for mais o texto genérico do
    // bootstrap (`GENERIC_BRAND_POSITIONING`, escrito quando ainda não há descrição derivada de
    // logo real). Pelo mesmo motivo, `colors`/`imageStyle` só são reais quando `identity.logoUri`
    // existe — sem logo real, `ensureHouseIdentityContext` grava cores/estilo neutros fixos, nunca
    // identidade visual de verdade — surfar esses valores fixos como "identidade da marca" seria
    // apresentar preenchimento genérico como fato decidido.
    const hasRealPositioning = Boolean(brand?.positioning) && brand?.positioning !== GENERIC_BRAND_POSITIONING;
    const hasRealVisualIdentity = Boolean(identity?.logoUri);
    // Mesmo problema do `positioning`: `ensureHouseBrandContext` grava `toneOfVoice` genérico
    // incondicionalmente (achado nesta migração "Marca & Materiais") — nunca surfar como se a
    // marca tivesse de fato definido um tom de voz.
    const hasRealToneOfVoice = Boolean(brand?.toneOfVoice) && brand?.toneOfVoice !== GENERIC_BRAND_TONE_OF_VOICE;

    if (!hasRealPositioning && !hasRealVisualIdentity && !hasRealToneOfVoice && !business && !audience && productsOrServices.length === 0 && differentiators.length === 0) return undefined;

    return {
      positioning: hasRealPositioning ? brand?.positioning : undefined,
      toneOfVoice: hasRealToneOfVoice ? brand?.toneOfVoice : undefined,
      businessDescription: business?.description,
      targetAudience: audience?.targetAudience,
      productsOrServices: productsOrServices.length > 0 ? productsOrServices : undefined,
      differentiators: differentiators.length > 0 ? differentiators : undefined,
      brandColors: hasRealVisualIdentity ? identity?.colors : undefined,
      visualIdentityNotes: hasRealVisualIdentity ? identity?.imageStyle : undefined,
    };
  };

  /** Migração "Marca & Materiais" — grava os campos editáveis do Perfil da Marca reusando
   * EXATAMENTE o mesmo mecanismo de `ensureHouseBrandContext`/Clara (create/update por módulo),
   * nunca uma segunda fonte de verdade. Corrige na origem o vazamento de `brandName: "Vorix"`: se
   * o registro ainda tem o valor genérico do bootstrap, uma edição real do usuário já substitui
   * pelo nome real do workspace. Campos ausentes do patch preservam o valor já existente (merge
   * parcial, nunca reseta o que não foi editado). */
  const updateBrandProfile = async (
    workspaceId: string,
    patch: { positioning?: string; toneOfVoice?: string; businessDescription?: string; targetAudience?: string },
  ): Promise<void> => {
    const workspace = await repositories.workspaceRepository.getById(workspaceId);
    if (!workspace) throw new Error("WORKSPACE_NOT_FOUND: workspace inexistente.");
    const clientId = workspace.tenantId;
    const audit = { actor: { id: "human", type: "human" as const }, reason: "Edição manual do Perfil da Marca (Marca & Materiais)." };

    if (patch.positioning !== undefined || patch.toneOfVoice !== undefined) {
      const existing = await clara.list({ clientId, module: "BrandContext", status: "active" });
      const current = existing[0]?.payload as { brandName?: string; positioning?: string; toneOfVoice?: string } | undefined;
      const payload = {
        clientId,
        brandName: current?.brandName && current.brandName !== "Vorix" ? current.brandName : workspace.name,
        positioning: patch.positioning ?? current?.positioning,
        toneOfVoice: patch.toneOfVoice ?? current?.toneOfVoice,
      };
      if (existing.length > 0) await clara.update({ id: existing[0].id, patch: payload, audit });
      else await clara.create({ module: "BrandContext", title: "Identidade de marca", payload, audit });
    }

    if (patch.businessDescription !== undefined) {
      const existing = await clara.list({ clientId, module: "BusinessContext", status: "active" });
      const current = existing[0]?.payload as { businessName?: string; description?: string } | undefined;
      const payload = { clientId, businessName: current?.businessName ?? workspace.name, description: patch.businessDescription };
      if (existing.length > 0) await clara.update({ id: existing[0].id, patch: payload, audit });
      else await clara.create({ module: "BusinessContext", title: "Sobre o negócio", payload, audit });
    }

    if (patch.targetAudience !== undefined && patch.targetAudience.trim().length > 0) {
      const existing = await clara.list({ clientId, module: "AudienceContext", status: "active" });
      const payload = { clientId, targetAudience: patch.targetAudience };
      if (existing.length > 0) await clara.update({ id: existing[0].id, patch: payload, audit });
      else await clara.create({ module: "AudienceContext", title: "Público-alvo", payload, audit });
    }
  };
  // Deps exclusivas do motor GPT (`build-execution-handler-resolver.ts`, só lido quando
  // `creativeEngineGptEnabled` está ligado).
  const gptCreativeEngineDeps = {
    creativeBrain: creativeIcaro,
    objectStorage,
    compositeLogo: compositeLogoOntoImage,
    compositeScreenshot: compositeScreenshotIntoDeviceMockup,
    renderTextZones: renderCreativePlanTextZones,
    computeAssetSuitability: computeAssetSuitabilityScore,
    readImageDimensions: readCreativeImageDimensions,
    resolveRecentHistory: async (workspaceId: string, limit?: number) => {
      const entries = await contentGenerationHistory.getRecentForWorkspace(workspaceId, limit);
      return entries.map((entry) => ({ headline: entry.headline, cta: entry.cta, visualConcept: entry.visualConcept }));
    },
    referenceIntelligenceExtractor,
    creativeEngineRunRepository: repositories.creativeEngineRunRepository,
    resolveProductionSettings,
    resolveBrandMaterials,
    resolveBrandProfile,
  };
  const createExecutionHandlerResolver = () =>
    buildExecutionHandlerResolver({
      featureFlags: executionFeatureFlags,
      runtimeDependencies: { valentina, clara, icaro },
      runtimeRepository: repositories.runtimeRepository,
      preparedCommandRepository: repositories.preparedCommandRepository,
      contentGenerationHistory,
      qualityFeedback,
      clara,
      objectStorage,
      ensureBrandVisualProfile,
      semanticOcclusionChecker,
      gptCreativeEngine: gptCreativeEngineDeps,
    });
  // `ValentinaTenantManager.createTenant` sempre gera um `id` novo (nunca aceita um `id`
  // explícito) — mas os skills reais (Pedro/Sofia/Bianca...) chamam
  // `valentina.getClientContext(input.tenantId)` usando o tenantId REAL da plataforma (o mesmo
  // de `principal.tenantId`), que precisa bater exatamente com `TenantRecord.id`. Por isso este
  // bootstrap grava o registro direto no repositório (que aceita `save(record)` com `id` livre)
  // em vez de passar por `createTenant`. Idempotente — não faz nada se o registro já existir.
  const ensureHouseTenantProfile = async (tenantId: string, workspaceId: string): Promise<void> => {
    await ensureHouseValentinaProfile(tenantId);
    await ensureHouseBrandContext(tenantId, workspaceId);
    await ensureHouseIdentityContext(tenantId, workspaceId);
  };
  // Resolve a logo cadastrada em Materiais (Asset Library, `kind: "logo"`) do workspace — usada
  // para descrever a marca de verdade (estilo, cores) em vez de um placeholder genérico, ver
  // `ensureHouseBrandContext`/`ensureHouseIdentityContext` abaixo. `AssetStorageRef` nunca guarda
  // a URL em si (decisão obrigatória do domínio), só `objectKey` — por isso a resolução via
  // `objectStorage.resolvePublicUrl`. Best-effort: qualquer ausência (sem library, sem logo, sem
  // storageRef) devolve `undefined` em vez de lançar — a geração real nunca deveria falhar só
  // porque a marca ainda não tem logo cadastrada.
  const findLogoAssetUrl = async (workspaceId: string): Promise<string | undefined> => {
    const library = await repositories.assetLibraryRepository.getLibraryByWorkspace(workspaceId);
    if (!library) return undefined;
    const logos = await repositories.assetLibraryRepository.listAssets(library.id, { kind: "logo" });
    const active = logos.find((asset) => asset.status === "active" && asset.storageRef);
    if (!active?.storageRef) return undefined;
    try {
      return objectStorage.resolvePublicUrl(active.storageRef.objectKey);
    } catch {
      return undefined;
    }
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
  // genérico), mesmo espírito de `ensureHouseValentinaProfile` acima. NÃO idempotente-para-sempre
  // de propósito: se o registro ainda está com o texto genérico (`GENERIC_BRAND_POSITIONING`) e uma
  // logo passou a existir em Materiais depois da primeira chamada, atualiza uma vez — achado real:
  // o bootstrap tinha rodado antes da logo ser cadastrada e nunca mais olhava de novo.
  const GENERIC_BRAND_POSITIONING = "Plataforma de marketing com IA para pequenos e médios negócios.";
  const GENERIC_BRAND_TONE_OF_VOICE = "claro, direto e confiável";
  const ensureHouseBrandContext = async (tenantId: string, workspaceId: string): Promise<void> => {
    const existing = await clara.list({ clientId: tenantId, module: "BrandContext", status: "active" });
    const currentlyGeneric = existing.length === 0 || (existing[0].payload as { positioning?: string }).positioning === GENERIC_BRAND_POSITIONING;
    const logoUrl = await findLogoAssetUrl(workspaceId);
    if (existing.length > 0 && (!currentlyGeneric || !logoUrl)) return;

    const brandDescription = logoUrl
      ? await imageDescriber.describe(logoUrl, "Descreva esta logo de marca em português: personalidade e sensação transmitida (ex.: moderna, acolhedora, premium), em até 2 frases objetivas. Não descreva cores.")
      : undefined;
    const payload = {
      clientId: tenantId,
      brandName: "Vorix",
      positioning: brandDescription ?? GENERIC_BRAND_POSITIONING,
      toneOfVoice: GENERIC_BRAND_TONE_OF_VOICE,
    };
    const audit = { actor: { id: "system", type: "system" as const }, reason: logoUrl ? "Bootstrap automático a partir da logo cadastrada em Materiais." : "Bootstrap automático do tenant interno para geração real de imagem (sem logo cadastrada ainda)." };
    if (existing.length > 0) {
      await clara.update({ id: existing[0].id, patch: payload, audit });
    } else {
      await clara.create({ module: "BrandContext", title: "Identidade de marca", payload, audit });
    }
  };
  // Bianca (`bianca-social-media-design.skill.ts`, `evaluateDesignContextCompleteness`) exige
  // "IdentityContext" especificamente — diferente de Sofia, não aceita "BrandContext" como
  // alternativa. Pedro (`evaluateVisualContextCompleteness`, mesmo formato de Sofia) também
  // consulta os dois; com ambos os registros seed, os três (Sofia/Bianca/Pedro) passam pelo gate
  // de contexto da Clara.
  const ensureHouseIdentityContext = async (tenantId: string, workspaceId: string): Promise<void> => {
    const existing = await clara.list({ clientId: tenantId, module: "IdentityContext", status: "active" });
    const logoUrl = await findLogoAssetUrl(workspaceId);
    // `logoUri` já guarda a URL usada da última vez — se bate com a atual (ou não há logo ainda),
    // não há nada novo a refletir. Evita rechamar a visão computacional a cada geração depois que
    // já está em dia (custo real de API) e ainda assim se recupera sozinho se uma logo cadastrada
    // depois nunca tiver sido vista.
    if (existing.length > 0 && ((existing[0].payload as { logoUri?: string }).logoUri === logoUrl || !logoUrl)) return;

    let colors = ["#4338CA", "#F5F5F4", "#111827"];
    let imageStyle = "Fotografia limpa e moderna, com boa legibilidade de texto sobreposto.";
    let visualGuidelines = ["Priorizar contraste alto entre texto e fundo.", "Manter identidade consistente entre peças."];

    if (logoUrl) {
      const [colorsText, styleText] = await Promise.all([
        imageDescriber.describe(logoUrl, "Liste de 2 a 4 cores predominantes desta logo, em português, separadas só por vírgula (ex.: azul marinho, branco, dourado). Responda só com a lista, sem mais nada."),
        imageDescriber.describe(logoUrl, "Descreva o estilo visual desta logo/marca em português (ex.: moderno e minimalista, divertido, elegante e sério) em uma frase objetiva."),
      ]);
      const parsedColors = colorsText?.split(",").map((color) => color.trim()).filter(Boolean).slice(0, 5);
      if (parsedColors && parsedColors.length > 0) colors = parsedColors;
      if (styleText) {
        imageStyle = styleText;
        visualGuidelines = [
          `Manter consistência com a identidade visual da marca: ${styleText}`,
          "Reservar uma área visualmente limpa (sem elementos importantes) para a logo poder ser posicionada depois.",
          "Priorizar contraste alto entre texto e fundo.",
        ];
      }
    }

    const payload = { clientId: tenantId, colors, fonts: ["Inter"], imageStyle, visualGuidelines, logoUri: logoUrl };
    const audit = { actor: { id: "system", type: "system" as const }, reason: logoUrl ? "Bootstrap automático a partir da logo cadastrada em Materiais." : "Bootstrap automático do tenant interno para geração real de imagem (sem logo cadastrada ainda)." };
    if (existing.length > 0) {
      await clara.update({ id: existing[0].id, patch: payload, audit });
    } else {
      await clara.create({ module: "IdentityContext", title: "Identidade visual", payload, audit });
    }
  };
  // Brand Visual Profile (Rodada 2, Fatia 2, Prioridade 5) — persistente por WORKSPACE (diferente
  // de IdentityContext/BrandContext acima, que ficam por TENANT), Postgres real
  // (`brand_visual_profiles`, migration 0059). Idempotente-em-repouso: uma vez criado, nunca
  // regenerado do zero a cada publicação — só cria quando ainda não existe. Nunca inventa uma
  // identidade "exagerada": sem logo cadastrada, cai no perfil conservador padrão
  // (`buildConservativeDefaultProfile`, mesmos tons neutros já usados como fallback de
  // `ensureHouseIdentityContext` acima); com logo, marca a origem como `bootstrap_from_logo` (sinal
  // de que HÁ identidade real disponível) sem reextrair cor via visão computacional de novo — evita
  // uma segunda chamada de IA pra um dado que `ensureHouseIdentityContext` já resolveu.
  const ensureBrandVisualProfile = async (workspaceId: string): Promise<BrandVisualProfile> => {
    const existing = await repositories.brandVisualProfileRepository.getByWorkspace(workspaceId);
    if (existing) return existing;
    const logoUrl = await findLogoAssetUrl(workspaceId);
    const now = new Date().toISOString();
    const profile: BrandVisualProfile = {
      ...buildConservativeDefaultProfile(workspaceId, now),
      source: logoUrl ? "bootstrap_from_logo" : "bootstrap_conservative",
    };
    return repositories.brandVisualProfileRepository.upsert(profile);
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
  const metaAdsOAuthService = new MetaAdsOAuthService({
    config: {
      enabled: config?.metaAds.enabled ?? false,
      appId: config?.metaAds.appId,
      appSecret: config?.metaAds.appSecret,
      redirectUri: config?.metaAds.redirectUri,
      loginConfigId: config?.metaAds.loginConfigId,
      scopes: META_ADS_REQUIRED_SCOPES,
    },
    credentialRepository: repositories.metaAdsCredentialRepository,
    adAccountRepository: repositories.metaAdAccountRepository,
    secretManager,
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
      metaAdsOAuthService,
      instagramDmAiReplyProvider,
      objectStorage,
      removeImageBackground,
      publicationQueue,
      clock,
      createExecutionHandlerResolver,
      valentina,
      ensureHouseTenantProfile,
      ensureBrandVisualProfile,
      resolveBrandProfile,
      updateBrandProfile,
      clara,
      imageDescriber,
      referenceIntelligenceExtractor,
      qualityFeedback,
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
    metaAdsOAuthService,
    instagramDmAiReplyProvider,
    objectStorage,
    removeImageBackground,
    publicationQueue,
    clock,
    createExecutionHandlerResolver,
    valentina,
    ensureHouseTenantProfile,
    ensureBrandVisualProfile,
    resolveBrandProfile,
    updateBrandProfile,
    clara,
    imageDescriber,
    referenceIntelligenceExtractor,
    qualityFeedback,
    planningEngineHook,
    ...repositories,
  };
}


function definedWebhookSecrets(input: Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>): Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value.length > 0)) as Partial<Record<keyof typeof DEFAULT_WEBHOOK_SECRETS, string>>;
}
