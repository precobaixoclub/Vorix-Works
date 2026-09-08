import type { FastifyInstance } from "fastify";
import { expireTrials } from "../../../application/billing/trial-use-cases.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Varredura periódica de trials vencidos — mesmo padrão de `meta-ads-sync-scheduler.ts`
 * (`setInterval` + `unref()` + `onClose`, sem lib de cron). Nunca roda se `identity` não existir
 * (sem Postgres não há Subscription real pra varrer) nem se o trial estiver desabilitado.
 */
export type TrialExpirationSchedulerOptions = {
  enabled: boolean;
  intervalMs: number;
};

export function registerTrialExpirationScheduler(app: FastifyInstance, container: ApiContainer, options: TrialExpirationSchedulerOptions): void {
  if (!options.enabled || !container.identity) return;
  const identity = container.identity;

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await expireTrials({
        subscriptionRepository: identity.subscriptionRepository,
        planVersionRepository: identity.planVersionRepository,
        platformBillingRepository: identity.platformBillingRepository,
        billingEventRepository: identity.billingEventRepository,
        trialEnabled: true,
      });
      if (result.expiredCount > 0 || result.failedTenantIds.length > 0) {
        app.log.info({ expiredCount: result.expiredCount, failedTenantIds: result.failedTenantIds }, "trial expiration scheduler tick");
      }
    } catch (error) {
      app.log.error({ err: error }, "trial expiration scheduler tick failed");
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
