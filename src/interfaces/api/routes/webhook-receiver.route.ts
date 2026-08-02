import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebhookIngestionService } from "../../../application/webhook/webhook-ingestion-service.js";
import type { PublicationProvider } from "../../../domain/publication/publication.model.js";
import { successEnvelope } from "../http/response-envelope.js";

const PARAMS_SCHEMA = { type: "object", required: ["provider"], properties: { provider: { type: "string", minLength: 1 } } } as const;

export async function registerWebhookReceiverRoutes(app: FastifyInstance, deps: { ingestionService: WebhookIngestionService }): Promise<void> {
  app.post("/webhooks/:provider", { schema: { params: PARAMS_SCHEMA, body: { type: "object", additionalProperties: true } } }, async (request, reply) => {
    const providerId = (request.params as { provider: PublicationProvider }).provider;
    const payload = normalizePayload(request.body);
    const rawPayload = JSON.stringify(payload);
    const result = await deps.ingestionService.ingest({ providerId, payload, rawPayload, headers: normalizedHeaders(request) });
    if (!result.accepted) {
      reply.code(400);
      return successEnvelope({ accepted: false, reason: result.reason, webhookEventId: result.webhookEvent.id, verification: result.verification.status }, request.id);
    }
    reply.code(202);
    return successEnvelope({ accepted: true, webhookEventId: result.webhookEvent.id, normalized: result.normalized, synchronization: result.synchronization }, request.id);
  });
}

function normalizePayload(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function normalizedHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  return headers;
}
