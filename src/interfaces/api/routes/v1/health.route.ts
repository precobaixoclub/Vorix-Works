import type { FastifyInstance } from "fastify";
import { successEnvelope } from "../../http/response-envelope.js";

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (request, _reply) => {
    return successEnvelope(
      {
        status: "ok" as const,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        version: "v1",
      },
      request.id,
    );
  });
}
