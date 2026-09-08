import pg from "pg";
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { AiProvidersRepositoryPort } from "../../application/ports/ai-providers-repository.port.js";
import type { ContactIdentityRepositoryPort } from "../../application/ports/contact-identity-repository.port.js";
import type { AutomationRuleRepositoryPort } from "../../application/ports/automation-rule-repository.port.js";
import type { AutomationRunLogRepositoryPort } from "../../application/ports/automation-run-log-repository.port.js";
import type { BillingEventRepositoryPort, InvoiceRepositoryPort, PaymentMethodRepositoryPort, PaymentWebhookEventRepositoryPort } from "../../application/ports/billing-ops-repository.port.js";
import type { CommercialMetricsRepositoryPort } from "../../application/ports/commercial-metrics-repository.port.js";
import type { CommercialSuggestionRepositoryPort } from "../../application/ports/commercial-suggestion-repository.port.js";
import type { ContactRepositoryPort } from "../../application/ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../../application/ports/deal-repository.port.js";
import type { AddonDefinitionRepositoryPort, PlanVersionRepositoryPort } from "../../application/ports/plan-version-repository.port.js";
import type { PipelineRepositoryPort, PipelineStageRepositoryPort } from "../../application/ports/pipeline-repository.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../../application/ports/platform-ai-settings-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../../application/ports/platform-billing-repository.port.js";
import type { ProductRepositoryPort } from "../../application/ports/product-repository.port.js";
import type { ProposalRepositoryPort } from "../../application/ports/proposal-repository.port.js";
import type { RefreshTokenRepositoryPort } from "../../application/ports/refresh-token-repository.port.js";
import type { SubscriptionItemRepositoryPort, SubscriptionRepositoryPort } from "../../application/ports/subscription-repository.port.js";
import type { TaskRepositoryPort } from "../../application/ports/task-repository.port.js";
import type { UsageCounterRepositoryPort } from "../../application/ports/usage-counter-repository.port.js";
import type { SessionRepositoryPort } from "../../application/ports/session-repository.port.js";
import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../../application/ports/team-repository.port.js";
import type { TenantMemberInviteRepositoryPort } from "../../application/ports/tenant-member-invite-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { TimelineEventRepositoryPort } from "../../application/ports/timeline-event-repository.port.js";
import type { UserRepositoryPort } from "../../application/ports/user-repository.port.js";
import { PostgresAiProvidersRepository } from "./postgres/postgres-ai-providers-repository.js";
import { PostgresAuditLogRepository } from "./postgres/postgres-audit-log-repository.js";
import { PostgresContactIdentityRepository } from "./postgres/postgres-contact-identity-repository.js";
import { PostgresAutomationRuleRepository } from "./postgres/postgres-automation-rule-repository.js";
import { PostgresAutomationRunLogRepository } from "./postgres/postgres-automation-run-log-repository.js";
import { PostgresBillingEventRepository, PostgresInvoiceRepository, PostgresPaymentMethodRepository, PostgresPaymentWebhookEventRepository } from "./postgres/postgres-billing-ops-repository.js";
import { PostgresCommercialMetricsRepository } from "./postgres/postgres-commercial-metrics-repository.js";
import { PostgresCommercialSuggestionRepository } from "./postgres/postgres-commercial-suggestion-repository.js";
import { PostgresContactRepository } from "./postgres/postgres-contact-repository.js";
import { PostgresDealRepository } from "./postgres/postgres-deal-repository.js";
import { PostgresAddonDefinitionRepository, PostgresPlanVersionRepository } from "./postgres/postgres-plan-version-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "./postgres/postgres-pipeline-repository.js";
import { PostgresPlatformAiSettingsRepository } from "./postgres/postgres-platform-ai-settings-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres/postgres-platform-billing-repository.js";
import { PostgresProductRepository } from "./postgres/postgres-product-repository.js";
import { PostgresProposalRepository } from "./postgres/postgres-proposal-repository.js";
import { PostgresRefreshTokenRepository } from "./postgres/postgres-refresh-token-repository.js";
import { PostgresSubscriptionItemRepository, PostgresSubscriptionRepository } from "./postgres/postgres-subscription-repository.js";
import { PostgresTaskRepository } from "./postgres/postgres-task-repository.js";
import { PostgresUsageCounterRepository } from "./postgres/postgres-usage-counter-repository.js";
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
  /** CRM/Comercial (Fase 6) — Regras de automação e seu log de execução. */
  automationRuleRepository: AutomationRuleRepositoryPort;
  automationRunLogRepository: AutomationRunLogRepositoryPort;
  /** CRM/Comercial (Fase 7) — relatório agregado de resultados comerciais (read-only). */
  commercialMetricsRepository: CommercialMetricsRepositoryPort;
  /** SaaS Commercialization (Fase 1) — Billing Foundation: versionamento de plano, assinatura,
   * add-ons, uso e operações de cobrança. */
  planVersionRepository: PlanVersionRepositoryPort;
  addonDefinitionRepository: AddonDefinitionRepositoryPort;
  subscriptionRepository: SubscriptionRepositoryPort;
  subscriptionItemRepository: SubscriptionItemRepositoryPort;
  usageCounterRepository: UsageCounterRepositoryPort;
  paymentMethodRepository: PaymentMethodRepositoryPort;
  invoiceRepository: InvoiceRepositoryPort;
  billingEventRepository: BillingEventRepositoryPort;
  paymentWebhookEventRepository: PaymentWebhookEventRepositoryPort;
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
    automationRuleRepository: new PostgresAutomationRuleRepository(pool),
    automationRunLogRepository: new PostgresAutomationRunLogRepository(pool),
    commercialMetricsRepository: new PostgresCommercialMetricsRepository(pool),
    planVersionRepository: new PostgresPlanVersionRepository(pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(pool),
    subscriptionRepository: new PostgresSubscriptionRepository(pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(pool),
    usageCounterRepository: new PostgresUsageCounterRepository(pool),
    paymentMethodRepository: new PostgresPaymentMethodRepository(pool),
    invoiceRepository: new PostgresInvoiceRepository(pool),
    billingEventRepository: new PostgresBillingEventRepository(pool),
    paymentWebhookEventRepository: new PostgresPaymentWebhookEventRepository(pool),
    pool,
  };
}
