import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLATFORM_EMAIL_EVENTS, type PlatformEmailAlerts } from "../../../../application/notification/platform-email-alerts.js";
import { ConflictError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const Email = z.string().trim().max(254).pipe(z.email());
const Settings = z.strictObject({
  enabled: z.boolean(),
  fromEmail: Email.nullable(),
  recipients: z.array(Email).max(12),
  events: z.array(z.enum(PLATFORM_EMAIL_EVENTS)).max(PLATFORM_EMAIL_EVENTS.length),
  apiKey: z.string().trim().regex(/^re_[A-Za-z0-9_-]{8,200}$/).optional(),
});

export async function registerAdminEmailAlertsRoutes(app: FastifyInstance, alerts: PlatformEmailAlerts) {
  const base = "/admin/email-notifications";
  app.get(base, async request => {
    requirePlatformAdmin(request);
    return successEnvelope(await alerts.settings(), request.id);
  });
  app.put(base, async request => {
    requirePlatformAdmin(request);
    const parsed = Settings.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Confira os e-mails, os eventos e o formato da chave do Resend.");
    const { enabled, fromEmail, apiKey } = parsed.data;
    const recipients = [...new Set(parsed.data.recipients.map(address => address.toLowerCase()))];
    const events = [...new Set(parsed.data.events)];
    if (enabled && (!fromEmail || !recipients.length || !events.length || (!apiKey && !(await alerts.settings()).hasApiKey))) {
      throw new ValidationError("Para ativar, informe o remetente, a chave do Resend e pelo menos um destinatário e um evento.");
    }
    return successEnvelope(await alerts.save({ enabled, fromEmail, recipients, events, apiKey }), request.id);
  });
  app.get(`${base}/history`, async request => {
    requirePlatformAdmin(request);
    return successEnvelope(await alerts.history(), request.id);
  });
  app.post(`${base}/test`, async (request, reply) => {
    requirePlatformAdmin(request);
    const settings = await alerts.settings();
    if (!settings.hasApiKey || !settings.fromEmail || !settings.recipients.length) {
      throw new ConflictError("Salve o remetente, os destinatários e a chave do Resend antes do teste.");
    }
    const queued = await alerts.enqueueTest();
    if (!queued) throw new ConflictError("Já existe um teste para estes destinatários neste minuto. Veja o histórico.");
    reply.code(202);
    return successEnvelope({ queued }, request.id);
  });
}
