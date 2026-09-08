import pg from "pg";
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { AiProvidersRepositoryPort } from "../../application/ports/ai-providers-repository.port.js";
import type { ContactIdentityRepositoryPort } from "../../application/ports/contact-identity-repository.port.js";
import type { CommercialSuggestionRepositoryPort } from "../../application/ports/commercial-suggestion-repository.port.js";
import type { ContactRepositoryPort } from "../../application/ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../../application/ports/deal-repository.port.js";
import type { PipelineRepositoryPort, PipelineStageRepositoryPort } from "../../application/ports/pipeline-repository.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../../application/ports/platform-ai-settings-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../../application/ports/platform-billing-repository.port.js";
import type { ProductRepositoryPort } from "../../application/ports/product-repository.port.js";
import type { ProposalRepositoryPort } from "../../application/ports/proposal-repository.port.js";
import type { RefreshTokenRepositoryPort } from "../../application/ports/refresh-token-repository.port.js";
import type { TaskRepositoryPort } from "../../application/ports/task-repository.port.js";
import type { SessionRepositoryPort } from "../../application/ports/session-repository.port.js";
import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../../application/ports/team-repository.port.js";
import type { TenantMemberInviteRepositoryPort } from "../../application/ports/tenant-member-invite-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { TimelineEventRepositoryPort } from "../../application/ports/timeline-event-repository.port.js";
import type { UserRepositoryPort } from "../../application/ports/user-repository.port.js";
import { PostgresAiProvidersRepository } from "./postgres/postgres-ai-providers-repository.js";
import { PostgresAuditLogRepository } from "./postgres/postgres-audit-log-repository.js";
import { PostgresContactIdentityRepository } from "./postgres/postgres-contact-identity-repository.js";
import { PostgresCommercialSuggestionRepository } from "./postgres/postgres-commercial-suggestion-repository.js";
import { PostgresContactRepository } from "./postgres/postgres-contact-repository.js";
import { PostgresDealRepository } from "./postgres/postgres-deal-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "./postgres/postgres-pipeline-repository.js";
import { PostgresPlatformAiSettingsRepository } from "./postgres/postgres-platform-ai-settings-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres/postgres-platform-billing-repository.js";
import { PostgresProductRepository } from "./postgres/postgres-product-repository.js";
import { PostgresProposalRepository } from "./postgres/postgres-proposal-repository.js";
import { PostgresRefreshTokenRepository } from "./postgres/postgres-refresh-token-repository.js";
import { PostgresTaskRepository } from "./postgres/postgres-task-repository.js";
import { PostgresSessionRepository } from "./postgres/postgres-session-repository.js";
import { PostgresTeamMembershipRepository, PostgresTeamRepository } from "./postgres/postgres-team-repository.js";
import { PostgresTenantMemberInviteRepository } from "./postgres/postgres-tenant-member-invite-repository.js";
import { PostgresTenantMembershipRepository } from "./postgres/postgres-tenant-membership-repository.js";
import { PostgresTimelineEventRepository } from "./postgres/postgres-timeline-event-repository.js";
import { PostgresUserRepository } from "./postgres/postgres-user-repository.js";

const { Pool } = pg;

export type IdentityRepositories = {
  userRepository: UserRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  sessionRepository: SessionRepositoryPort;
  refreshTokenRepository: RefreshTokenRepositoryPort;
  auditLog: AuditLogPort;
  /** Sprint 25 — painel admin + cotas/consumo/lucro por tenant. Reusa o mesmo pool de identidade. */
  platformBillingRepository: PlatformBillingRepositoryPort;
  /** Sprint 25/Fase 3 — configuração global do AI Gateway gerida pelo painel admin. */
  platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
  /** Sprint 26 — cadastro de Provedores de IA, catálogo de operações e ledger financeiro. */
  aiProvidersRepository: AiProvidersRepositoryPort;
  /** CRM/Comercial (Fase 1) — Equipes, convites, Contato 360°/identidade por canal, Timeline. */
  teamRepository: TeamRepositoryPort;
  teamMembershipRepository: TeamMembershipRepositoryPort;
  tenantMemberInviteRepository: TenantMemberInviteRepositoryPort;
  contactRepository: ContactRepositoryPort;
  contactIdentityRepository: ContactIdentityRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  /** CRM/Comercial (Fase 2) — Pipelines/Etapas/Negócios (Kanban). */
  pipelineRepository: PipelineRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  dealRepository: DealRepositoryPort;
  /** CRM/Comercial (Fase 3) — Tarefas, Catálogo de produtos, Propostas (com link público). */
  taskRepository: TaskRepositoryPort;
  productRepository: ProductRepositoryPort;
  proposalRepository: ProposalRepositoryPort;
  /** CRM/Comercial (Fase 5) — Sugestões do Copiloto Comercial (IA). */
  commercialSuggestionRepository: CommercialSuggestionRepositoryPort;
  pool: InstanceType<typeof Pool>;
};

export function buildIdentityRepositories(options: { databaseUrl: string; secretsMasterKey: string }): IdentityRepositories {
  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    userRepository: new PostgresUserRepository(pool),
    membershipRepository: new PostgresTenantMembershipRepository(pool),
    sessionRepository: new PostgresSessionRepository(pool),
    refreshTokenRepository: new PostgresRefreshTokenRepository(pool),
    auditLog: new PostgresAuditLogRepository(pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(pool),
    platformAiSettingsRepository: new PostgresPlatformAiSettingsRepository(pool, options.secretsMasterKey),
    aiProvidersRepository: new PostgresAiProvidersRepository(pool),
    teamRepository: new PostgresTeamRepository(pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(pool),
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(pool),
    contactRepository: new PostgresContactRepository(pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(pool),
    timelineEventRepository: new PostgresTimelineEventRepository(pool),
    pipelineRepository: new PostgresPipelineRepository(pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(pool),
    dealRepository: new PostgresDealRepository(pool),
    taskRepository: new PostgresTaskRepository(pool),
    productRepository: new PostgresProductRepository(pool),
    proposalRepository: new PostgresProposalRepository(pool),
    commercialSuggestionRepository: new PostgresCommercialSuggestionRepository(pool),
    pool,
  };
}
