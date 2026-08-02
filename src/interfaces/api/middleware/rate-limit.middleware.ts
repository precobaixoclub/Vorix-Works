import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { OperationalRateLimiter } from "../../../application/operations/operational-services.js";
import { AppError } from "../http/app-error.js";

const SKIP_PATHS = new Set(["/health", "/livez", "/readyz", "/v1/health"]);

export function registerRateLimitMiddleware(app: FastifyInstance, rateLimiter: OperationalRateLimiter): void {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (SKIP_PATHS.has(request.url.split("?")[0])) return;
    const principal = request.zunoContext.principal;
    const result = await rateLimiter.consume({
      routeGroup: routeGroup(request.method, request.url),
      tenantId: principal?.tenantId,
      principalId: principal?.userId,
      ip: request.ip,
    });
    reply.header("X-RateLimit-Limit", result.bucket.limit);
    reply.header("X-RateLimit-Remaining", result.bucket.remaining);
    reply.header("X-RateLimit-Reset", result.bucket.resetAt);
    if (!result.allowed) {
      if (result.retryAfterMs !== undefined) reply.header("Retry-After", Math.ceil(result.retryAfterMs / 1000));
      throw new AppError({ code: "RATE_LIMIT_EXCEEDED", message: "Limite operacional de requisições excedido.", statusCode: 429, recoverable: true, details: { routeGroup: result.bucket.routeGroup, resetAt: result.bucket.resetAt } });
    }
  });
}

function routeGroup(method: string, url: string): string {
  const path = url.split("?")[0];
  if (path.startsWith("/v1/auth")) return "auth";
  if (path.startsWith("/webhooks") || path.startsWith("/v1/webhooks")) return "webhook";
  if (path.startsWith("/v1/analytics")) return method === "GET" ? "analytics_read" : "analytics_write";
  if (path.startsWith("/v1/publications") || path.startsWith("/v1/publication-providers")) return method === "GET" ? "publication_read" : "publication_operate";
  if (path.startsWith("/v1/scheduling") || path.startsWith("/v1/schedules") || path.startsWith("/v1/calendar")) return method === "GET" ? "scheduling_read" : "scheduling_operate";
  if (path.startsWith("/v1/system")) return "system";
  return method === "GET" ? "read" : "write";
}

