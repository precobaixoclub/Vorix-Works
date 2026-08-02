import type { FastifyInstance } from "fastify";
import type { PublicationSynchronizationService } from "../../../../application/webhook/publication-synchronization-service.js";
import type { WebhookEventRepositoryPort } from "../../../../application/ports/webhook-event-repository.port.js";
import type { PublicationProvider } from "../../../../domain/publication/publication.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    workspaceId: { type: "string" },
    providerId: { type: "string" },
    status: { type: "string" },
  },
} as const;

export type WebhookRoutesDeps = {
  webhookRepository: WebhookEventRepositoryPort;
  synchronizationService: PublicationSynchronizationService;
};

export async function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRoutesDeps): Promise<void> {
  app.get("/webhooks", { schema: { querystring: QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "audit:read");
    const query = request.query as { workspaceId?: string; providerId?: PublicationProvider; status?: never };
    const [events, providerEvents, normalized, metrics] = await Promise.all([
      deps.webhookRepository.listWebhookEvents({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId, status: query.status, limit: 200 }),
      deps.webhookRepository.listProviderEvents({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId, limit: 200 }),
      deps.webhookRepository.listNormalizedEvents({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId, limit: 200 }),
      deps.webhookRepository.metrics({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId }),
    ]);
    return successEnvelope({ events, providerEvents, normalized, metrics }, request.id);
  });

  app.get("/publication-sync", { schema: { querystring: QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:reconcile");
    const query = request.query as { workspaceId?: string; providerId?: PublicationProvider };
    const [events, pending] = await Promise.all([
      deps.webhookRepository.listSynchronizationEvents({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId, limit: 300 }),
      deps.webhookRepository.listNormalizedEvents({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId, status: "pending", limit: 300 }),
    ]);
    return successEnvelope({ events, pending }, request.id);
  });

  app.post("/publication-sync/run", { schema: { body: { type: "object", properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:reconcile");
    const { workspaceId } = (request.body ?? {}) as { workspaceId?: string };
    return successEnvelope(await deps.synchronizationService.processPending({ tenantId: principal.tenantId, workspaceId }), request.id);
  });
}
