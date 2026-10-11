import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../http/require-principal.js";
import { NotFoundError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { OBJECT_URL_TTL, parseOwnedObjectUrl, signObjectKey } from "../../../../shared/utils/object-url-signing.js";
import type { ObjectKeyReadAuthorizer } from "../../object-url-access.js";

const SIGN_BODY_SCHEMA = {
  type: "object",
  required: ["url"],
  additionalProperties: false,
  properties: { url: { type: "string", minLength: 1, maxLength: 4000 } },
} as const;

/**
 * Assina sob demanda uma URL do storage (`/uploads/<key>`) para o usuário autenticado — para os
 * poucos casos em que o frontend tem a URL canônica fora de uma resposta JSON já assinada (ex.:
 * reabrir uma peça depois de a assinatura expirar). Só chaves que ele pode ler; o resto é 404
 * (outro tenant, workspace de outro tenant, chave desconhecida, URL de fora) — nunca 403.
 */
export async function registerFileRoutes(app: FastifyInstance, deps: { authorize?: ObjectKeyReadAuthorizer }): Promise<void> {
  app.post("/files/sign", { schema: { body: SIGN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:read");
    const { url } = request.body as { url: string };
    const parsed = parseOwnedObjectUrl(url);
    if (!parsed || !deps.authorize || !(await deps.authorize(principal, parsed.key))) throw new NotFoundError("Arquivo não encontrado.");
    const signed = signObjectKey(parsed.key, OBJECT_URL_TTL.preview);
    if (!signed) throw new NotFoundError("Arquivo não encontrado.");
    return successEnvelope({ url: signed }, request.id);
  });
}
