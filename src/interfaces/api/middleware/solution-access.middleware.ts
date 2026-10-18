import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SolutionAccessService } from "../../../application/solutions/solution-access.service.js";
import { SOLUTIONS, solutionForApiPath } from "../../../domain/solutions/solution.model.js";
import { AppError } from "../http/app-error.js";

/**
 * Guarda de SOLUÇÃO na API — o isolamento entre soluções não depende de esconder itens na
 * sidebar: toda rota classificada numa solução (`solutionForApiPath`: Conversas, Meetings,
 * Marketing) responde 403 para um tenant sem entitlement, antes de chegar ao handler.
 *
 * Um único ponto, por prefixo de URL, em vez de um `if` em cada uma das dezenas de rotas de
 * Marketing — nenhuma rota existente precisou ser editada, e uma rota nova de Marketing sob um
 * prefixo já classificado nasce protegida.
 *
 * Só age sobre requisição AUTENTICADA: sem principal (webhook de provider, callback público) a
 * decisão continua sendo da própria rota, como sempre foi. Não substitui RBAC (`requirePermission`)
 * nem as feature flags do Creative Engine — roda antes deles.
 *
 * `service` ausente (modo sem identidade real: dev/teste em memória) = guarda desligado, mesmo
 * comportamento de antes desta separação.
 */
export function registerSolutionAccessMiddleware(app: FastifyInstance, service: SolutionAccessService | undefined): void {
  if (!service) return;

  // `onRequest` (e não `preHandler`): roda logo depois do hook de autenticação, ANTES do parsing e da
  // validação do corpo — quem não tem acesso recebe 403 sem que o payload chegue a ser lido.
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const principal = request.zunoContext?.principal;
    if (!principal) return;

    const solutionKey = solutionForApiPath(request.url);
    if (!solutionKey) return;

    if (await service.hasAccess(principal.tenantId, solutionKey)) return;
    if(solutionKey==="conversations"&&/^\/v1\/(?:products|product-metadata)(?:\/|\?|$)/.test(request.url)&&await service.hasAccess(principal.tenantId,"site"))return;

    throw new AppError({
      code: "SOLUTION_ACCESS_DENIED",
      message: `${SOLUTIONS[solutionKey].name} não está disponível para esta conta.`,
      statusCode: 403,
      recoverable: false,
      details: { solution: solutionKey },
    });
  });
}
