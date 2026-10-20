import type { FastifyInstance } from "fastify";
import { reconcileContactDirectory, type ContactDirectoryMaintenancePort } from "../../../application/crm/contact-phone-use-cases.js";
import { PostgresContactPhoneRepository } from "../../../infrastructure/storage/postgres/postgres-contact-phone-repository.js";
import type { ApiContainer } from "../di/container.js";

/** Manutenção automática e reversível; não apaga contatos, conversas ou histórico comercial. */
export function registerContactDirectoryScheduler(app: FastifyInstance, container: ApiContainer, options: { intervalMs: number }, repository?: ContactDirectoryMaintenancePort): void {
  if (!repository && !container.identity) return;
  const contacts = repository ?? new PostgresContactPhoneRepository(container.identity!.pool);
  let running = false;
  let closing = false;
  let activeTick: Promise<void> | undefined;
  const tick = (): Promise<void> => {
    if (running || closing) return Promise.resolve();
    running = true;
    activeTick = (async () => {
      try {
        const scopes = await contacts.listDirectoryScopes();
        for (const scope of scopes) {
          if (closing) break;
          try { await reconcileContactDirectory(contacts, scope); }
          catch (error) { app.log.error({ err: error, workspaceId: scope.workspaceId }, "contact directory reconciliation failed"); }
        }
      } catch (error) { app.log.error({ err: error }, "contact directory maintenance failed"); }
      finally { running = false; }
    })();
    return activeTick;
  };
  app.addHook("onReady", async () => { await tick(); });
  const timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref();
  app.addHook("onClose", async () => { closing = true; clearInterval(timer); await activeTick; });
}
