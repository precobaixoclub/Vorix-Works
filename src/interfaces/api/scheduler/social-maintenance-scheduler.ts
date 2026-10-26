import type { FastifyInstance } from "fastify";
import { PublicationReconciliationService } from "../../../application/publication/publication-reconciliation-service.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Manutenção periódica do Social Publishing, em processo (timer `unref()`, encerrado no `onClose`):
 * - health check leve das contas: detecta credencial inválida ANTES do horário de publicar;
 * - reconciliação dos resultados desconhecidos: verifica no provider antes de qualquer repetição.
 * A publicação em si continua no scheduler de Publication (outbox persistido) — este loop não publica.
 */
export type SocialMaintenanceSchedulerOptions = {
  enabled: boolean;
  intervalMs: number;
  healthCheckMaxAgeMs: number;
};

export function registerSocialMaintenanceScheduler(app: FastifyInstance, container: ApiContainer, options: SocialMaintenanceSchedulerOptions): void {
  const social = container.social;
  if (!options.enabled || !social) return;
  const reconciliation = new PublicationReconciliationService({
    repository: container.publicationRepository,
    providerRegistry: container.publicationProviderRegistry,
    secretResolver: container.publicationSecretResolver,
    idGenerator: () => `soc-rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const health = await social.accounts.runHealthChecks({ olderThanMs: options.healthCheckMaxAgeMs, limit: 50 });
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const unknown = (await social.repository.listPublishLog({ since, limit: 2_000 })).filter((entry) => entry.outcome === "unknown");
      const scopes = new Map(unknown.map((entry) => [`${entry.tenantId}:${entry.workspaceId}`, { tenantId: entry.tenantId, workspaceId: entry.workspaceId }]));
      let confirmed = 0;
      let notPublished = 0;
      for (const scope of scopes.values()) {
        const result = await reconciliation.reconcile({ ...scope, providerIds: ["social"] });
        confirmed += result.confirmed;
        notPublished += result.notPublished;
      }
      if (health.checked > 0 || confirmed > 0 || notPublished > 0) app.log.info({ ...health, confirmed, notPublished }, "social maintenance tick");
    } catch (error) {
      app.log.error({ err: error }, "social maintenance tick failed");
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
