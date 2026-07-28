import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPrincipal } from "../../../application/ports/auth.port.js";

/**
 * Contexto por requisição — mesmo espírito de `SkillExecutionContext`
 * (`src/domain/skills/skill.contract.ts`: `executionId`, `correlationId`, `clientId`,
 * `tenantId`), adaptado para uma requisição HTTP em vez de uma execução de Skill. `principal` e
 * `tenantId` ficam `null` em toda requisição nesta sprint — não existe autenticação nem Workspace
 * real ainda; o campo existe para o dia em que existirem, sem precisar tocar nas rotas depois.
 */
export type RequestContext = {
  requestId: string;
  principal: AuthPrincipal | null;
  tenantId: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    zunoContext: RequestContext;
  }
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest("zunoContext", null as unknown as RequestContext);

  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    request.zunoContext = {
      requestId: request.id,
      principal: null,
      tenantId: null,
    };
  });
}
