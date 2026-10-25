import type { FastifyInstance } from "fastify";
import type { ApiContainer } from "../di/container.js";

/** Operational visibility is independent of proposal reminders and commercial result. */
export function registerDealArchiveScheduler(app: FastifyInstance, container: ApiContainer): void {
  const repository = container.identity?.dealRepository;
  if (!repository) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await repository.archiveDueClosedDeals(); }
    catch (error) { app.log.error({ err: error }, "deal archive scheduler failed"); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
}
