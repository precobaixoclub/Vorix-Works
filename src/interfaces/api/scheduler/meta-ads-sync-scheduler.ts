import type { FastifyInstance } from "fastify";
import { syncMetaAdCampaignsForAccount } from "../../../application/meta-ads/sync-meta-ad-campaigns.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Loop em processo que sincroniza campanhas/adsets/ads de TODAS as contas de anúncio ativas —
 * mesmo padrão de `publication-scheduler.ts` (`setInterval` + `unref()` + `onClose`, sem
 * biblioteca de cron). Uma conta com falha (token revogado, rate limit) nunca interrompe as
 * demais — cada sync roda isolado, erro registrado e seguimos pra próxima.
 */
export type MetaAdsSyncSchedulerOptions = {
  enabled: boolean;
  intervalMs: number;
};

export function registerMetaAdsSyncScheduler(app: FastifyInstance, container: ApiContainer, options: MetaAdsSyncSchedulerOptions): void {
  if (!options.enabled) return;

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const accounts = await container.metaAdAccountRepository.listAllActive();
      let synced = 0;
      let failed = 0;
      for (const account of accounts) {
        try {
          await syncMetaAdCampaignsForAccount(
            {
              campaignRepository: container.metaAdCampaignRepository,
              adSetRepository: container.metaAdSetRepository,
              adRepository: container.metaAdRepository,
              credentialRepository: container.metaAdsCredentialRepository,
              secretManager: container.secretManager,
            },
            { tenantId: account.tenantId, workspaceId: account.workspaceId, adAccount: account },
          );
          synced++;
        } catch (error) {
          failed++;
          app.log.error({ err: error, adAccountId: account.id }, "meta ads sync failed for account");
        }
      }
      if (synced > 0 || failed > 0) app.log.info({ synced, failed, total: accounts.length }, "meta ads sync scheduler tick");
    } catch (error) {
      app.log.error({ err: error }, "meta ads sync scheduler tick failed");
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
