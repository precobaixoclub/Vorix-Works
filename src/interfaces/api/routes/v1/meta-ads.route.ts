import type { FastifyInstance } from "fastify";
import type { MetaAdAccountRepositoryPort } from "../../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaAdsOAuthService } from "../../../../infrastructure/publication/meta-ads-oauth-service.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Rotas do módulo Meta Ads Manager — Fase 1 (conexão + descoberta de contas de anúncio).
 * DELIBERADAMENTE fora do namespace `/publication-providers/*` (`instagram.route.ts`) — uma conta
 * de anúncios não é um canal de publicação de conteúdo, ver `meta-ads-credential-repository.port.ts`.
 */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const CONNECT_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const CALLBACK_BODY_SCHEMA = { type: "object", required: ["state", "code"], properties: { state: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } } } as const;
const DISCONNECT_BODY_SCHEMA = { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string", minLength: 1 }, credentialReferenceId: { type: "string", minLength: 1 } } } as const;
const SYNC_BODY_SCHEMA = { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string", minLength: 1 }, credentialReferenceId: { type: "string", minLength: 1 } } } as const;

export type MetaAdsRoutesDeps = {
  metaAdsOAuthService: MetaAdsOAuthService;
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
};

export async function registerMetaAdsRoutes(app: FastifyInstance, deps: MetaAdsRoutesDeps): Promise<void> {
  app.get("/meta-ads/oauth/status", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.metaAdsOAuthService.status({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/meta-ads/oauth/connect", { schema: { body: CONNECT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:connect");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(deps.metaAdsOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  // O Meta redireciona o navegador do cliente para o frontend; o frontend repassa code+state aqui
  // já autenticado (mesmo padrão de `instagram.route.ts`) — o token nunca trafega sem sessão válida.
  app.post("/meta-ads/oauth/callback", { schema: { body: CALLBACK_BODY_SCHEMA } }, async (request) => {
    // Só o gate de permissão importa aqui — `complete()` não recebe ator (Fase 1 não integra
    // governança de credencial, ver comentário no topo de `meta-ads-oauth-service.ts`); o token
    // nunca trafega sem sessão válida porque esta rota exige autenticação antes de tudo.
    requirePermission(request, "ads:connect");
    const body = request.body as { state: string; code: string };
    try {
      const result = await deps.metaAdsOAuthService.complete({ state: body.state, code: body.code });
      return successEnvelope(result, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("META_ADS_OAUTH_STATE_INVALID")) {
        throw new AppError({ code: "META_ADS_OAUTH_STATE_INVALID", message: "A conexão expirou ou já foi usada — inicie a conexão novamente.", statusCode: 400, recoverable: true });
      }
      throw error;
    }
  });

  app.post("/meta-ads/oauth/disconnect", { schema: { body: DISCONNECT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:disconnect");
    const { workspaceId, credentialReferenceId } = request.body as { workspaceId: string; credentialReferenceId: string };
    const disconnected = await deps.metaAdsOAuthService.disconnect({ tenantId: principal.tenantId, workspaceId, credentialReferenceId });
    if (!disconnected) throw new AppError({ code: "META_ADS_CREDENTIAL_NOT_FOUND", message: "Conexão não encontrada para este workspace.", statusCode: 404, recoverable: false });
    return successEnvelope({ disconnected: true }, request.id);
  });

  app.get("/meta-ads/accounts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope({ accounts: await deps.metaAdAccountRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId }) }, request.id);
  });

  // Resync manual (o scheduler da Fase 2 cobre o caso periódico) — útil logo após vincular uma
  // conta nova a um Business Manager já conectado, sem esperar o próximo tick. A rota nunca vê o
  // token — `resyncAccounts` resolve o valor cifrado internamente.
  app.post("/meta-ads/accounts/sync", { schema: { body: SYNC_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:sync");
    const { workspaceId, credentialReferenceId } = request.body as { workspaceId: string; credentialReferenceId: string };
    try {
      const accounts = await deps.metaAdsOAuthService.resyncAccounts({ tenantId: principal.tenantId, workspaceId, credentialReferenceId });
      return successEnvelope({ accounts }, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("META_ADS_CREDENTIAL_NOT_ACTIVE")) {
        throw new AppError({ code: "META_ADS_CREDENTIAL_NOT_ACTIVE", message: "Esta conexão não está ativa — reconecte antes de sincronizar.", statusCode: 409, recoverable: true });
      }
      if (error instanceof Error && error.message.startsWith("META_ADS_TOKEN_MISSING")) {
        throw new AppError({ code: "META_ADS_TOKEN_MISSING", message: "Token não encontrado para esta conexão — reconecte.", statusCode: 409, recoverable: true });
      }
      throw error;
    }
  });
}
