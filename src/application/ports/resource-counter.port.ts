import type { PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";

/**
 * `ResourceCounterPort` — SaaS Commercialization, Fase 1. Ponte pequena e específica (mesmo
 * racional de `InboxAiResponderPort`/`CommercialCopilotGeneratorPort`): `application/billing/*`
 * nunca importa repositórios de Identity/Inbox/CRM diretamente para contar usuários/workspaces/
 * conexões/contatos/automações — só este contrato. A implementação concreta, que SABE como cada
 * recurso vira uma contagem real (`TenantMembershipRepositoryPort.listByTenant`,
 * `WorkspaceRepositoryPort.listByTenant`, etc.), vive na composição raiz (`container.ts`), o único
 * lugar que já tem acesso legítimo a todos esses repositórios ao mesmo tempo.
 *
 * `undefined` significa "este recurso não é medido por contagem de linhas" (`ai_credits` vem do
 * ledger de créditos existente; `storage_mb` vem de `usage_counters`) — nunca um erro.
 */
export type ResourceCounterPort = {
  count(input: { tenantId: string; resource: PlanLimitResource }): Promise<number | undefined>;
};
