import type { PlanLimitResource } from "./plan-entitlements.model.js";

/**
 * `UsageCounter` — SaaS Commercialization, Fase 1. Só para recursos que precisam de contagem
 * PERIÓDICA e não são simplesmente "quantas linhas existem numa tabela agora" (ex.: mensagens
 * enviadas no mês, armazenamento consumido). Para `users`/`workspaces`/`messaging_connections`/
 * `contacts`/`automations` — que já são contagens diretas de tabelas existentes — nunca duplicar
 * aqui; contar direto com um cache curto em processo (ver `entitlement-use-cases.ts`), evitando
 * tanto "query pesada em todo request" quanto um segundo lugar de verdade que pode divergir do
 * dado real. `ai_credits` continua 100% em `tenant_ai_usage_monthly`/`CreditAccountingService`
 * (Fase de créditos de IA já existente) — nunca duplicado aqui.
 */
export type UsageCounter = {
  tenantId: string;
  workspaceId?: string;
  resource: PlanLimitResource;
  /** "YYYY-MM" para contadores mensais; "lifetime" para um contador que nunca reseta. */
  period: string;
  used: number;
  updatedAt: string;
};
