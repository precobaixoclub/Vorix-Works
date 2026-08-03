import type { FastifyInstance } from "fastify";
import { PublicationWorker, runDueSchedules, type PublicationOrchestratorDeps } from "../../../application/publication/publication-orchestrator.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Loop em processo que faz os agendamentos realmente dispararem: a cada ciclo move os schedules
 * vencidos para a fila (`runDueSchedules`) e drena a fila com um worker. Sem ele, um post agendado
 * só sairia se alguém chamasse `/v1/publications/operate/run-due` manualmente.
 *
 * O timer é `unref()` para nunca segurar o processo e é encerrado no `onClose` do Fastify.
 */
export type PublicationSchedulerOptions = {
  enabled: boolean;
  intervalMs: number;
};

export function registerPublicationScheduler(app: FastifyInstance, container: ApiContainer, options: PublicationSchedulerOptions): void {
  if (!options.enabled) return;

  const deps: PublicationOrchestratorDeps = {
    repository: container.publicationRepository,
    providers: container.publicationProviders,
    idGenerator: () => `scheduler-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    queue: container.publicationQueue,
    providerRegistry: container.publicationProviderRegistry,
    secretResolver: container.publicationSecretResolver,
    providerCircuitBreaker: container.operationalCircuitBreaker,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
  };

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const enqueued = await runDueSchedules(deps);
      const processed = await new PublicationWorker(deps, "publication-scheduler").runUntilIdle();
      if (enqueued > 0 || processed > 0) app.log.info({ enqueued, processed }, "publication scheduler tick");
    } catch (error) {
      app.log.error({ err: error }, "publication scheduler tick failed");
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
