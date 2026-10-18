import type { FastifyInstance } from "fastify";
import type { SolutionAccessService } from "../../../../application/solutions/solution-access.service.js";
import { isSolutionContractable, isSolutionKey, SOLUTION_ENTITLEMENT_SOURCES, SOLUTION_KEYS, SOLUTIONS, type SolutionEntitlementSource } from "../../../../domain/solutions/solution.model.js";
import { AppError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Soluções da plataforma (Core).
 *
 * `GET /solutions` alimenta o seletor de soluções e a navegação do frontend: devolve SÓ as
 * soluções a que o tenant tem acesso. Uma solução sem acesso simplesmente não vem na lista —
 * nunca como "em breve", nunca com preço ou CTA.
 *
 * As rotas `/admin/tenants/:tenantId/solutions*` são o mecanismo de concessão — restritas a
 * administrador da plataforma. É por elas que o acesso INTERNO ao Vorix Marketing é dado
 * (`source: "internal"`); uma solução não comercial recusa qualquer outra origem.
 */
export type SolutionRoutesDeps = {
  /** `undefined` em modo sem identidade real (dev/teste em memória): todas as soluções
   * conhecidas aparecem habilitadas, igual ao comportamento anterior à separação. */
  solutionAccess?: SolutionAccessService;
};

const TENANT_PARAMS_SCHEMA = { type: "object", required: ["tenantId"], properties: { tenantId: { type: "string", minLength: 1 } } } as const;
const TENANT_SOLUTION_PARAMS_SCHEMA = {
  type: "object",
  required: ["tenantId", "solutionKey"],
  properties: { tenantId: { type: "string", minLength: 1 }, solutionKey: { type: "string", minLength: 1 } },
} as const;
const SET_BODY_SCHEMA = {
  type: "object",
  required: ["enabled", "source"],
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    source: { type: "string", enum: [...SOLUTION_ENTITLEMENT_SOURCES] },
    reason: { type: "string", maxLength: 500 },
    // Limites comerciais da solução (ex.: Meetings: maxConcurrentRecordings). Só inteiros >= 0.
    limits: { type: "object", additionalProperties: { type: "integer", minimum: 0 }, maxProperties: 20 },
  },
} as const;

export async function registerSolutionRoutes(app: FastifyInstance, deps: SolutionRoutesDeps): Promise<void> {
  app.get("/solutions", async (request) => {
    const principal = requirePrincipal(request);
    const access = deps.solutionAccess
      ? await deps.solutionAccess.listAccess(principal.tenantId)
      : SOLUTION_KEYS.map((key) => ({ key, name: SOLUTIONS[key].name, enabled: key!=="site"&&key!=="commerce", internal: !isSolutionContractable(SOLUTIONS[key]) }));
    return successEnvelope({ solutions: access.filter((solution) => solution.enabled).map(({ key, name, internal }) => ({ key, name, internal })) }, request.id);
  });

  app.get("/admin/tenants/:tenantId/solutions", { schema: { params: TENANT_PARAMS_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    if (!deps.solutionAccess) throw new AppError({ code: "SOLUTIONS_UNAVAILABLE", message: "Entitlement de soluções indisponível nesta configuração.", statusCode: 503 });
    const { tenantId } = request.params as { tenantId: string };
    const access = await deps.solutionAccess.listAccess(tenantId);
    return successEnvelope(
      { solutions: access.map((solution) => ({ ...solution, commercialAvailability: isSolutionContractable(SOLUTIONS[solution.key]) ? "public" : "internal" })) },
      request.id,
    );
  });

  app.put("/admin/tenants/:tenantId/solutions/:solutionKey", { schema: { params: TENANT_SOLUTION_PARAMS_SCHEMA, body: SET_BODY_SCHEMA } }, async (request) => {
    const principal = requirePlatformAdmin(request);
    if (!deps.solutionAccess) throw new AppError({ code: "SOLUTIONS_UNAVAILABLE", message: "Entitlement de soluções indisponível nesta configuração.", statusCode: 503 });
    const { tenantId, solutionKey } = request.params as { tenantId: string; solutionKey: string };
    if (!isSolutionKey(solutionKey)) throw new ValidationError(`Solução "${solutionKey}" não existe.`);
    const body = request.body as { enabled: boolean; source: SolutionEntitlementSource; limits?: Record<string, number>; reason?: string };
    try {
      const entitlement = await deps.solutionAccess.setEntitlement({
        tenantId,
        solutionKey,
        enabled: body.enabled,
        source: body.source,
        ...(body.limits ? { limits: body.limits } : {}),
        reason: body.reason?.trim() || undefined,
        actorUserId: principal.userId,
      });
      return successEnvelope(entitlement, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SOLUTION_NOT_CONTRACTABLE")) {
        throw new AppError({ code: "SOLUTION_NOT_CONTRACTABLE", message: error.message.slice("SOLUTION_NOT_CONTRACTABLE:".length).trim(), statusCode: 409, recoverable: false });
      }
      throw error;
    }
  });
}
