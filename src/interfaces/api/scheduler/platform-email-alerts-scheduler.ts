import type { FastifyInstance } from "fastify";
import type { PlatformEmailAlerts } from "../../../application/notification/platform-email-alerts.js";

export function registerPlatformEmailAlertsScheduler(app: FastifyInstance, alerts: PlatformEmailAlerts): void {
  let inProgress: Promise<void> | undefined;
  const timer = setInterval(() => {
    inProgress ??= alerts.dispatch()
      .catch(() => { app.log.error("platform_email_alerts_dispatch_failed"); })
      .finally(() => { inProgress = undefined; });
  }, 15_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await inProgress;
  });
}
