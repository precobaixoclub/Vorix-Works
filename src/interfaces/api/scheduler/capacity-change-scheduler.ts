import type { FastifyInstance } from "fastify";
import { applyDuePendingCapacityChanges } from "../../../application/billing/capacity-use-cases.js";
import { DefaultResourceCounterAdapter } from "../../../infrastructure/billing/resource-counter-adapter.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Varredura periódica de reduções de capacidade agendadas (Pricing/Capacity Etapa B, seção 15/22 do
 * pedido) — mesmo padrão de `trial-expiration-scheduler.ts` (`setInterval` + `unref()` +
 * `onClose`). Nunca roda se `identity` não existir (sem Postgres não há `Subscription` real).
 */
export type CapacityChangeSchedulerOptions = { intervalMs: number };

export function registerCapacityChangeScheduler(app: FastifyInstance, container: ApiContainer, options: CapacityChangeSchedulerOptions): void {
  if (!container.identity) return;
  const identity = container.identity;

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await applyDuePendingCapacityChanges({
        subscriptionRepository: identity.subscriptionRepository,
        subscriptionItemRepository: identity.subscriptionItemRepository,
        planVersionRepository: identity.planVersionRepository,
        addonDefinitionRepository: identity.addonDefinitionRepository,
        platformBillingRepository: identity.platformBillingRepository,
        usageCounterRepository: identity.usageCounterRepository,
        resourceCounter: new DefaultResourceCounterAdapter({
          tenantMembershipRepository: identity.membershipRepository,
          workspaceRepository: container.workspaceRepository,
          messagingConnectionRepository: container.messagingConnectionRepository,
          contactRepository: identity.contactRepository,
          automationRuleRepository: identity.automationRuleRepository,
        }),
        billingProvider: container.billingProvider,
        billingEventRepository: identity.billingEventRepository,
        subscriptionPendingChangeRepository: identity.subscriptionPendingChangeRepository,
      });
      if (result.appliedCount > 0 || result.failedIds.length > 0) {
        app.log.info({ appliedCount: result.appliedCount, failedIds: result.failedIds }, "capacity change scheduler tick");
      }
    } catch (error) {
      app.log.error({ err: error }, "capacity change scheduler tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
}
