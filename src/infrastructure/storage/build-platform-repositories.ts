import pg from "pg";
import type { AiExecutionRepositoryPort } from "../../application/ports/ai-execution-repository.port.js";
import type { AnalyticsRepositoryPort } from "../../application/ports/analytics-repository.port.js";
import type { AssetLibraryRepositoryPort } from "../../application/ports/asset-library-repository.port.js";
import type { BrandVisualProfileRepositoryPort } from "../../application/ports/brand-visual-profile-repository.port.js";
import type { AssetMetadataSourcePort } from "../../application/ports/asset-metadata-source.port.js";
import type { BriefingFieldValueRepositoryPort } from "../../application/ports/briefing-field-value-repository.port.js";
import type { BriefingQuestionRepositoryPort } from "../../application/ports/briefing-question-repository.port.js";
import type { BriefingRepositoryPort } from "../../application/ports/briefing-repository.port.js";
import type { ChatRepositoryPort } from "../../application/ports/chat-repository.port.js";
import type { CompanyKnowledgeSourcePort } from "../../application/ports/company-knowledge-source.port.js";
import type { ConversationEventRepositoryPort } from "../../application/ports/conversation-event-repository.port.js";
import type { ConversationMemoryRepositoryPort } from "../../application/ports/conversation-memory-repository.port.js";
import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.js";
import type { CredentialRepositoryPort } from "../../application/ports/credential-repository.port.js";
import type { ExecutionGraphRepositoryPort } from "../../application/ports/execution-graph-repository.port.js";
import type { ExecutionRepositoryPort } from "../../application/ports/execution-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../../application/ports/execution-task-repository.port.js";
import type { ContentGenerationHistoryPort } from "../../application/ports/content-generation-history.port.js";
import type { CreativeEngineRunRepositoryPort } from "../../application/ports/creative-engine-run-repository.port.js";
import type { QualityFeedbackRepositoryPort } from "../../application/quality-feedback/quality-feedback-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../../application/ports/operational-audit-repository.port.js";
import type { OperationalStateRepositoryPort } from "../../application/ports/operational-state-repository.port.js";
import type { PlanningArtifactRepositoryPort } from "../../application/ports/planning-artifact-repository.port.js";
import type { PlanningDecisionRepositoryPort } from "../../application/ports/planning-decision-repository.port.js";
import type { PlanningRepositoryPort } from "../../application/ports/planning-repository.port.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { SchedulingRepositoryPort } from "../../application/ports/scheduling-repository.port.js";
import type { PreparedCommandRepositoryPort } from "../../application/ports/prepared-command-repository.port.js";
import type { RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import type { WebhookEventRepositoryPort } from "../../application/ports/webhook-event-repository.port.js";
import { createAssetLibraryAssetMetadataSource } from "../briefing/asset-library-asset-metadata-source.js";
import { createNotConnectedCompanyKnowledgeSource } from "../briefing/not-connected-company-knowledge-source.js";
import { InMemoryAiExecutionRepository } from "./in-memory-ai-execution-repository.js";
import { InMemoryAnalyticsRepository } from "./in-memory-analytics-repository.js";
import { InMemoryAssetLibraryRepository } from "./in-memory-asset-library-repository.js";
import { InMemoryBrandVisualProfileRepository } from "./in-memory-brand-visual-profile-repository.js";
import { InMemoryContentGenerationHistoryRepository } from "./in-memory-content-generation-history-repository.js";
import { InMemoryCreativeEngineRunRepository } from "./in-memory-creative-engine-run-repository.js";
import { InMemoryQualityFeedbackRepository } from "./in-memory-quality-feedback-repository.js";
import { InMemoryBriefingFieldValueRepository } from "./in-memory-briefing-field-value-repository.js";
import { InMemoryBriefingQuestionRepository } from "./in-memory-briefing-question-repository.js";
import { InMemoryBriefingRepository } from "./in-memory-briefing-repository.js";
import { InMemoryChatRepository } from "./in-memory-chat-repository.js";
import { InMemoryConversationEventRepository } from "./in-memory-conversation-event-repository.js";
import { InMemoryConversationMemoryRepository } from "./in-memory-conversation-memory-repository.js";
import { InMemoryConversationRepository } from "./in-memory-conversation-repository.js";
import { InMemoryCredentialRepository } from "./in-memory-credential-repository.js";
import { InMemoryExecutionGraphRepository } from "./in-memory-execution-graph-repository.js";
import { InMemoryExecutionRepository } from "./in-memory-execution-repository.js";
import { InMemoryExecutionTaskRepository } from "./in-memory-execution-task-repository.js";
import { InMemoryOperationalAuditRepository } from "./in-memory-operational-audit-repository.js";
import { InMemoryOperationalStateRepository } from "./in-memory-operational-state-repository.js";
import { InMemoryPlanningArtifactRepository } from "./in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "./in-memory-planning-decision-repository.js";
import { InMemoryPlanningRepository } from "./in-memory-planning-repository.js";
import { InMemoryPreparedCommandRepository } from "./in-memory-prepared-command-repository.js";
import { InMemoryPublicationRepository } from "./in-memory-publication-repository.js";
import { InMemoryRuntimeRepository } from "./in-memory-runtime-repository.js";
import { InMemorySchedulingRepository } from "./in-memory-scheduling-repository.js";
import { InMemoryWebhookEventRepository } from "./in-memory-webhook-event-repository.js";
import { InMemoryWorkspaceRepository } from "./in-memory-workspace-repository.js";
import { PostgresAiExecutionRepository } from "./postgres/postgres-ai-execution-repository.js";
import { PostgresAnalyticsRepository } from "./postgres/postgres-analytics-repository.js";
import { PostgresAssetLibraryRepository } from "./postgres/postgres-asset-library-repository.js";
import { PostgresBrandVisualProfileRepository } from "./postgres/postgres-brand-visual-profile-repository.js";
import { PostgresContentGenerationHistoryRepository } from "./postgres/postgres-content-generation-history-repository.js";
import { PostgresCreativeEngineRunRepository } from "./postgres/postgres-creative-engine-run-repository.js";
import { PostgresQualityFeedbackRepository } from "./postgres/postgres-quality-feedback-repository.js";
import { PostgresBriefingFieldValueRepository } from "./postgres/postgres-briefing-field-value-repository.js";
import { PostgresBriefingQuestionRepository } from "./postgres/postgres-briefing-question-repository.js";
import { PostgresBriefingRepository } from "./postgres/postgres-briefing-repository.js";
import { PostgresChatRepository } from "./postgres/postgres-chat-repository.js";
import { PostgresConversationEventRepository } from "./postgres/postgres-conversation-event-repository.js";
import { PostgresConversationMemoryRepository } from "./postgres/postgres-conversation-memory-repository.js";
import { PostgresConversationRepository } from "./postgres/postgres-conversation-repository.js";
import { PostgresCredentialRepository } from "./postgres/postgres-credential-repository.js";
import { PostgresExecutionGraphRepository } from "./postgres/postgres-execution-graph-repository.js";
import { PostgresExecutionRepository } from "./postgres/postgres-execution-repository.js";
import { PostgresExecutionTaskRepository } from "./postgres/postgres-execution-task-repository.js";
import { PostgresOperationalAuditRepository } from "./postgres/postgres-operational-audit-repository.js";
import { PostgresOperationalStateRepository } from "./postgres/postgres-operational-state-repository.js";
import { PostgresPlanningArtifactRepository } from "./postgres/postgres-planning-artifact-repository.js";
import { PostgresPlanningDecisionRepository } from "./postgres/postgres-planning-decision-repository.js";
import { PostgresPlanningRepository } from "./postgres/postgres-planning-repository.js";
import { PostgresPreparedCommandRepository } from "./postgres/postgres-prepared-command-repository.js";
import { PostgresPublicationRepository } from "./postgres/postgres-publication-repository.js";
import { PostgresRuntimeRepository } from "./postgres/postgres-runtime-repository.js";
import { PostgresSchedulingRepository } from "./postgres/postgres-scheduling-repository.js";
import { PostgresWebhookEventRepository } from "./postgres/postgres-webhook-event-repository.js";
import { PostgresWorkspaceRepository } from "./postgres/postgres-workspace-repository.js";

const { Pool } = pg;

export type PersistenceDriver = "memory" | "postgres";

export type PlatformRepositories = {
  workspaceRepository: WorkspaceRepositoryPort;
  assetLibraryRepository: AssetLibraryRepositoryPort;
  brandVisualProfileRepository: BrandVisualProfileRepositoryPort;
  chatRepository: ChatRepositoryPort;
  conversationRepository: ConversationRepositoryPort;
  conversationEventRepository: ConversationEventRepositoryPort;
  conversationMemoryRepository: ConversationMemoryRepositoryPort;
  briefingRepository: BriefingRepositoryPort;
  briefingFieldValueRepository: BriefingFieldValueRepositoryPort;
  briefingQuestionRepository: BriefingQuestionRepositoryPort;
  preparedCommandRepository: PreparedCommandRepositoryPort;
  /** Portas estreitas do Context Resolver (Sprint 07, Fase 4) — nunca o Port completo de Clara/Asset Library. */
  companyKnowledgeSource: CompanyKnowledgeSourcePort;
  assetMetadataSource: AssetMetadataSourcePort;
  /** Sprint 08 (Fase 15). */
  aiExecutionRepository: AiExecutionRepositoryPort;
  /** Sprint 09 — Planning Engine. */
  planningRepository: PlanningRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  planningArtifactRepository: PlanningArtifactRepositoryPort;
  planningDecisionRepository: PlanningDecisionRepositoryPort;
  /** Sprint 10 — Runtime Engine. */
  runtimeRepository: RuntimeRepositoryPort;
  /** Sprint 11 — Execution Engine dry_run. */
  executionRepository: ExecutionRepositoryPort;
  /** Sprint 15/16 — Publication domain e orquestração operacional. */
  publicationRepository: PublicationRepositoryPort;
  /** Sprint 19 — Governança operacional independente de Publication. */
  credentialRepository: CredentialRepositoryPort;
  operationalAuditRepository: OperationalAuditRepositoryPort;
  /** Sprint 20 — Webhook/Event Store externo, separado de Publication. */
  webhookEventRepository: WebhookEventRepositoryPort;
  /** Sprint 21 — Scheduling/Calendario editorial independente de Publication. */
  schedulingRepository: SchedulingRepositoryPort;
  /** Sprint 22 — Analytics independente, append-only e derivado de eventos normalizados. */
  analyticsRepository: AnalyticsRepositoryPort;
  /** Sprint 23 — estado operacional transversal, sem pertencer a Publication/Scheduling/Analytics. */
  operationalStateRepository: OperationalStateRepositoryPort;
  /** Memória editorial (peças aprovadas recentes) + feedback de qualidade (avaliações/rejeições) —
   * ver `ContentBriefExecutionTaskHandler`/`QualityGateExecutionTaskHandler`. */
  contentGenerationHistoryRepository: ContentGenerationHistoryPort;
  qualityFeedbackRepository: QualityFeedbackRepositoryPort;
  /** Migração "GPT como motor criativo único" — prova auditável de qual motor produziu cada peça
   * (`db/migrations/0060_creative_engine_runs.sql`). */
  creativeEngineRunRepository: CreativeEngineRunRepositoryPort;
  /** Só existe quando `driver === "postgres"` — quem chama esta função é responsável por fechar (`pool.end()`) no shutdown. */
  pool?: InstanceType<typeof Pool>;
};

/**
 * Único ponto de construção dos repositórios de Workspace/Asset Library/Chat/Conversation
 * ("composition root", Sprint 03 Fase 5, estendido na Sprint 06 para incluir Conversation). Hoje
 * só a API (`src/interfaces/api/di/container.ts`) chama isto; a CLI (`buildRuntime()`, NÃO
 * tocado) ainda não conhece estes domínios.
 *
 * O que esta função estabelece é o PONTO DE EXTENSÃO certo: se um futuro comando de CLI precisar
 * de qualquer um destes Ports, deve chamar `buildPlatformRepositories` também — nunca
 * reimplementar a escolha "memória ou Postgres" em outro lugar.
 */
export function buildPlatformRepositories(options: { driver: PersistenceDriver; databaseUrl?: string }): PlatformRepositories {
  if (options.driver === "memory") {
    const workspaceRepository = new InMemoryWorkspaceRepository();
    const assetLibraryRepository = new InMemoryAssetLibraryRepository();
    return {
      workspaceRepository,
      assetLibraryRepository,
      brandVisualProfileRepository: new InMemoryBrandVisualProfileRepository(),
      chatRepository: new InMemoryChatRepository(),
      conversationRepository: new InMemoryConversationRepository(),
      conversationEventRepository: new InMemoryConversationEventRepository(),
      conversationMemoryRepository: new InMemoryConversationMemoryRepository(),
      briefingRepository: new InMemoryBriefingRepository(),
      briefingFieldValueRepository: new InMemoryBriefingFieldValueRepository(),
      briefingQuestionRepository: new InMemoryBriefingQuestionRepository(),
      preparedCommandRepository: new InMemoryPreparedCommandRepository(),
      companyKnowledgeSource: createNotConnectedCompanyKnowledgeSource(),
      assetMetadataSource: createAssetLibraryAssetMetadataSource(workspaceRepository, assetLibraryRepository),
      aiExecutionRepository: new InMemoryAiExecutionRepository(),
      planningRepository: new InMemoryPlanningRepository(),
      executionTaskRepository: new InMemoryExecutionTaskRepository(),
      executionGraphRepository: new InMemoryExecutionGraphRepository(),
      planningArtifactRepository: new InMemoryPlanningArtifactRepository(),
      planningDecisionRepository: new InMemoryPlanningDecisionRepository(),
      runtimeRepository: new InMemoryRuntimeRepository(),
      executionRepository: new InMemoryExecutionRepository(),
      publicationRepository: new InMemoryPublicationRepository(),
      credentialRepository: new InMemoryCredentialRepository(),
      operationalAuditRepository: new InMemoryOperationalAuditRepository(),
      webhookEventRepository: new InMemoryWebhookEventRepository(),
      schedulingRepository: new InMemorySchedulingRepository(),
      analyticsRepository: new InMemoryAnalyticsRepository(),
      operationalStateRepository: new InMemoryOperationalStateRepository(),
      contentGenerationHistoryRepository: new InMemoryContentGenerationHistoryRepository(),
      qualityFeedbackRepository: new InMemoryQualityFeedbackRepository(),
      creativeEngineRunRepository: new InMemoryCreativeEngineRunRepository(),
    };
  }

  if (!options.databaseUrl) {
    throw new Error('PERSISTENCE_DRIVER="postgres" exige DATABASE_URL configurado (ver .env.example).');
  }

  const pool = new Pool({ connectionString: options.databaseUrl });
  const workspaceRepository = new PostgresWorkspaceRepository(pool);
  const assetLibraryRepository = new PostgresAssetLibraryRepository(pool);
  return {
    workspaceRepository,
    assetLibraryRepository,
    brandVisualProfileRepository: new PostgresBrandVisualProfileRepository(pool),
    chatRepository: new PostgresChatRepository(pool),
    conversationRepository: new PostgresConversationRepository(pool),
    conversationEventRepository: new PostgresConversationEventRepository(pool),
    conversationMemoryRepository: new PostgresConversationMemoryRepository(pool),
    briefingRepository: new PostgresBriefingRepository(pool),
    briefingFieldValueRepository: new PostgresBriefingFieldValueRepository(pool),
    briefingQuestionRepository: new PostgresBriefingQuestionRepository(pool),
    preparedCommandRepository: new PostgresPreparedCommandRepository(pool),
    companyKnowledgeSource: createNotConnectedCompanyKnowledgeSource(),
    assetMetadataSource: createAssetLibraryAssetMetadataSource(workspaceRepository, assetLibraryRepository),
    aiExecutionRepository: new PostgresAiExecutionRepository(pool),
    planningRepository: new PostgresPlanningRepository(pool),
    executionTaskRepository: new PostgresExecutionTaskRepository(pool),
    executionGraphRepository: new PostgresExecutionGraphRepository(pool),
    planningArtifactRepository: new PostgresPlanningArtifactRepository(pool),
    planningDecisionRepository: new PostgresPlanningDecisionRepository(pool),
    runtimeRepository: new PostgresRuntimeRepository(pool),
    executionRepository: new PostgresExecutionRepository(pool),
    publicationRepository: new PostgresPublicationRepository(pool),
    credentialRepository: new PostgresCredentialRepository(pool),
    operationalAuditRepository: new PostgresOperationalAuditRepository(pool),
    webhookEventRepository: new PostgresWebhookEventRepository(pool),
    schedulingRepository: new PostgresSchedulingRepository(pool),
    analyticsRepository: new PostgresAnalyticsRepository(pool),
    operationalStateRepository: new PostgresOperationalStateRepository(pool),
    contentGenerationHistoryRepository: new PostgresContentGenerationHistoryRepository(pool),
    qualityFeedbackRepository: new PostgresQualityFeedbackRepository(pool),
    creativeEngineRunRepository: new PostgresCreativeEngineRunRepository(pool),
    pool,
  };
}
