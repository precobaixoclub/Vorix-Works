import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { SocialAuditActor } from "../../../../application/social/social-audit.js";
import type { SocialComposeInput } from "../../../../application/social/social-post-service.js";
import type { Permission } from "../../../../domain/identity/identity.model.js";
import { NETWORK_LABEL, SOCIAL_NETWORKS, SOCIAL_POST_FORMATS, type SocialNetwork, type SocialPostFormat, type SocialProviderType } from "../../../../domain/social/social-publishing.model.js";
import type { SocialPublishingModule } from "../../../../infrastructure/social/social-publishing-module.js";
import { AppError, NotFoundError } from "../../http/app-error.js";
import { requirePermission, requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";
import { GatewayError, interactionSchema } from "../../../../infrastructure/social/gateway/protocol.js";

/**
 * Vorix Marketing → Redes sociais. O cliente comum vê contas, status e publicações; nunca tokens,
 * escopos OAuth, versão de API ou nome técnico de provider. A política de provider por tenant, a
 * homologação e o kill switch ficam em `/admin/social-providers` (platform admin).
 */
export type SocialRoutesDeps = {
  social: SocialPublishingModule;
  workspaceRepository: WorkspaceRepositoryPort;
  idGenerator: () => string;
};

const NETWORK_SCHEMA = { type: "string", enum: [...SOCIAL_NETWORKS] } as const;
const FORMAT_SCHEMA = { type: "string", enum: [...SOCIAL_POST_FORMATS] } as const;
/** Conjunto aberto: o serviço valida contra os providers registrados. */
const PROVIDER_TYPE_SCHEMA = { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" } as const;
const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, from: { type: "string" }, to: { type: "string" } } } as const;
const ID_PARAMS = (name: string) => ({ type: "object", required: [name], properties: { [name]: { type: "string", minLength: 1, maxLength: 120 } } }) as const;
const MEDIA_ITEM = {
  type: "object",
  required: ["url", "kind"],
  additionalProperties: false,
  properties: {
    url: { type: "string", minLength: 8, maxLength: 2_000 },
    kind: { type: "string", enum: ["image", "video"] },
    mimeType: { type: "string", maxLength: 100 },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    durationSec: { type: "number", minimum: 0 },
    sizeBytes: { type: "integer", minimum: 0 },
    hasAudio: { type: "boolean" },
    coverUrl: { type: "string", maxLength: 2_000 },
  },
} as const;
const MUSIC = {
  type: "object",
  required: ["musicId", "title"],
  additionalProperties: false,
  properties: {
    musicId: { type: "string", minLength: 1, maxLength: 200 },
    title: { type: "string", minLength: 1, maxLength: 300 },
    artist: { type: "string", maxLength: 300 },
    coverUrl: { type: "string", maxLength: 2_000 },
    durationSec: { type: "number", minimum: 0 },
    segmentStartSec: { type: "number", minimum: 0 },
    segmentDurationSec: { type: "number", minimum: 1, maximum: 90 },
    providerData: { type: "object", additionalProperties: { type: "string", maxLength: 300 } },
  },
} as const;
const COMPOSE_BODY = {
  type: "object",
  required: ["workspaceId", "base", "destinations"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
    base: {
      type: "object",
      required: ["caption", "media"],
      additionalProperties: false,
      properties: { caption: { type: "string", maxLength: 5_000 }, hashtags: { type: "array", maxItems: 30, items: { type: "string", maxLength: 100 } }, media: { type: "array", maxItems: 35, items: MEDIA_ITEM } },
    },
    destinations: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        required: ["accountId", "format"],
        additionalProperties: false,
        properties: {
          accountId: { type: "string", minLength: 1, maxLength: 120 },
          format: FORMAT_SCHEMA,
          caption: { type: "string", maxLength: 5_000 },
          hashtags: { type: "array", maxItems: 30, items: { type: "string", maxLength: 100 } },
          media: { type: "array", maxItems: 35, items: MEDIA_ITEM },
          music: MUSIC,
          audioMode: { type: "string", enum: ["NONE", "NATIVE_PLATFORM_MUSIC", "EMBEDDED_AUDIO"] },
        },
      },
    },
    when: {
      type: "object",
      required: ["mode"],
      additionalProperties: false,
      properties: { mode: { type: "string", enum: ["now", "schedule"] }, localDateTime: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?$" }, timezone: { type: "string", maxLength: 64 } },
    },
    requireApproval: { type: "boolean" },
    source: { type: "object", additionalProperties: false, properties: { executionRunId: { type: "string", maxLength: 120 } } },
  },
} as const;

type ComposeBody = {
  workspaceId: string;
  idempotencyKey?: string;
  base: SocialComposeInput["base"];
  destinations: SocialComposeInput["destinations"];
  when?: { mode: "now" | "schedule"; localDateTime?: string; timezone?: string };
  requireApproval?: boolean;
  source?: { executionRunId?: string };
};

function actor(request: FastifyRequest, permission: Permission): { tenantId: string; actor: SocialAuditActor } {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, actor: { userId: principal.userId, role: principal.role } };
}

/** "CODE: mensagem" das camadas de aplicação → HTTP sem detalhes técnicos. */
function translate(error: unknown): never {
  if (error instanceof AppError) throw error;
  const text = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(text);
  if (!match) throw error;
  const [, code, message] = match as unknown as [string, string, string];
  if (code.endsWith("_NOT_FOUND")) throw new NotFoundError(message);
  if (code === "SOCIAL_VALIDATION_FAILED") throw new AppError({ code, message, statusCode: 422, recoverable: true, details: { destinations: (error as { details?: unknown }).details } });
  if (code.startsWith("SCHEDULE_") || code.startsWith("SOCIAL_SCHEDULE") || code === "SOCIAL_DESTINATIONS_REQUIRED" || code === "SOCIAL_DESTINATION_DUPLICATED" || code === "SOCIAL_POLICY_INVALID") throw new AppError({ code, message, statusCode: 400, recoverable: true });
  if (code.startsWith("SOCIAL_") || code.startsWith("PUBLICATION_")) throw new AppError({ code, message, statusCode: 409, recoverable: true });
  throw error;
}

export async function registerSocialRoutes(app: FastifyInstance, deps: SocialRoutesDeps): Promise<void> {
  const { social } = deps;
  const ownWorkspace = (tenantId: string, workspaceId: string) => assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId, workspaceId });

  // Authenticated proxy for the private browser gateway. The flow is also bound to the initiating
  // user inside the gateway. No service token, session cookie or provider identifier is returned.
  app.post("/social/connections/interactive/:flowId/:operation", {
    schema: {
      params: { type: "object", required: ["flowId", "operation"], properties: { flowId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["frame", "interact", "finish", "cancel"] } } },
      body: { type: "object", required: ["workspaceId", "network"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, network: NETWORK_SCHEMA, action: { type: "object" } } },
    },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_connect");
    const { flowId, operation } = request.params as { flowId: string; operation: "frame" | "interact" | "finish" | "cancel" };
    const body = request.body as { workspaceId: string; network: SocialNetwork; action?: unknown };
    await ownWorkspace(tenantId, body.workspaceId);
    const scope = { tenantId, workspaceId: body.workspaceId, network: body.network, userId: who.userId, flowId };
    reply.header("Cache-Control", "no-store");
    try {
      if (operation !== "cancel") {
        const selected = await social.resolver.connectionProviderFor(tenantId, body.network);
        if (!selected.ok || selected.providerType !== `${body.network}_unofficial`) throw new GatewayError("UNSUPPORTED");
      }
      if (operation === "interact") {
        const parsed = interactionSchema.safeParse(body.action);
        if (!parsed.success) throw new AppError({ code: "SOCIAL_INPUT_INVALID", message: "Ação inválida.", statusCode: 400 });
        await social.gateway.call("interact", { ...scope, action: parsed.data });
        return successEnvelope({ accepted: true }, request.id);
      }
      if (operation === "finish") {
        const connected = await social.gateway.call<{ externalAccountId: string }>("finish", scope);
        await social.accounts.syncConnections({ tenantId, workspaceId: body.workspaceId, actor: who, network: body.network, externalAccountIds: [connected.externalAccountId] });
        return successEnvelope({ connected: true }, request.id);
      }
      return successEnvelope(await social.gateway.call(operation, scope), request.id);
    } catch (error) {
      if (error instanceof GatewayError) throw new AppError({ code: "SOCIAL_CONNECTION_ACTION_REQUIRED", message: error.code === "NOT_FOUND" ? "Esta conexão expirou. Clique em Conectar novamente." : error.code === "CHECKPOINT_REQUIRED" ? "Conclua a confirmação de segurança solicitada pela rede e tente continuar." : error.code === "AUTH_REQUIRED" || error.code === "SESSION_INVALID" ? "Conclua o login na rede antes de continuar." : "A conexão está indisponível no momento. Tente novamente.", statusCode: error.code === "NOT_FOUND" ? 404 : 409, recoverable: true });
      translate(error);
    }
  });

  // ---------- Contas / Integrações ----------
  app.get("/social/accounts", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    const accounts = await social.accounts.listAccountViews({ tenantId, workspaceId });
    // Por rede: dá para conectar agora? Mensagem simples, sem nome técnico de provider.
    const networks = await Promise.all(SOCIAL_NETWORKS.map(async (network) => {
      const resolution = await social.resolver.connectionProviderFor(tenantId, network);
      return {
        network,
        canConnect: resolution.ok,
        ...(resolution.ok ? {} : { message: resolution.reason === "PUBLISHING_NOT_ENABLED" || resolution.reason === "TENANT_PROVIDER_NOT_ENABLED" ? `A publicação no ${NETWORK_LABEL[network]} ainda não está liberada para a sua conta.` : `A conexão com o ${NETWORK_LABEL[network]} está indisponível no momento.` }),
      };
    }));
    return successEnvelope({ accounts, networks }, request.id);
  });

  // Conectar/Reconectar: devolve a URL de autorização da própria rede. O retorno (workspace, rede,
  // tela de volta) fica guardado no servidor junto do state — nunca confiado ao navegador.
  app.post("/social/connections", {
    schema: { body: { type: "object", required: ["workspaceId", "network"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, network: NETWORK_SCHEMA, returnPath: { type: "string", maxLength: 300 } } } },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_connect");
    const body = request.body as { workspaceId: string; network: SocialNetwork; returnPath?: string };
    await ownWorkspace(tenantId, body.workspaceId);
    const workspacePrefix = `/workspaces/${body.workspaceId}/`;
    const returnPath = body.returnPath?.startsWith(workspacePrefix) ? body.returnPath : `${workspacePrefix}social/integrations`;
    try {
      const started = await social.accounts.beginConnection({ tenantId, workspaceId: body.workspaceId, network: body.network, userId: who.userId, returnPath });
      reply.code(201);
      return successEnvelope(started, request.id);
    } catch (error) { translate(error); }
  });

  // Retorno da autorização (a página de callback repassa code+state já autenticada). O state é de
  // uso único e precisa ser do mesmo tenant e usuário que iniciaram a conexão.
  app.post("/social/connections/callback", {
    schema: { body: { type: "object", required: ["network", "state", "code"], additionalProperties: false, properties: { network: NETWORK_SCHEMA, state: { type: "string", minLength: 8, maxLength: 200 }, code: { type: "string", minLength: 1, maxLength: 2_000 } } } },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_connect");
    const body = request.body as { network: SocialNetwork; state: string; code: string };
    try {
      const result = await social.accounts.completeConnection({ tenantId, userId: who.userId, network: body.network, state: body.state, code: body.code, actor: who });
      await ownWorkspace(tenantId, result.workspaceId);
      return successEnvelope(result, request.id);
    } catch (error) {
      if (error instanceof Error && /_OAUTH_STATE_INVALID/.test(error.message)) {
        throw new AppError({ code: "SOCIAL_CONNECTION_EXPIRED", message: "Esta autorização expirou ou já foi usada. Clique em Conectar novamente.", statusCode: 400, recoverable: true });
      }
      translate(error);
    }
  });

  // Contas autorizadas na rede — para o cliente escolher quais usar quando houver mais de uma.
  app.get("/social/connections/authorized", {
    schema: { querystring: { type: "object", required: ["workspaceId", "network"], properties: { workspaceId: { type: "string", minLength: 1 }, network: NETWORK_SCHEMA } } },
  }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_connect");
    const query = request.query as { workspaceId: string; network: SocialNetwork };
    await ownWorkspace(tenantId, query.workspaceId);
    return successEnvelope({ accounts: await social.accounts.authorizedAccounts({ tenantId, workspaceId: query.workspaceId, network: query.network }) }, request.id);
  });

  // Importa/atualiza as contas autorizadas (sem duplicar). Com seleção: só as escolhidas entram.
  app.post("/social/accounts/sync", {
    schema: {
      querystring: WORKSPACE_QUERY,
      body: { type: ["object", "null"], additionalProperties: false, properties: { network: NETWORK_SCHEMA, externalAccountIds: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 200 } } } },
    },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_connect");
    const { workspaceId } = request.query as { workspaceId: string };
    const body = (request.body ?? {}) as { network?: SocialNetwork; externalAccountIds?: string[] };
    await ownWorkspace(tenantId, workspaceId);
    try {
      const result = await social.accounts.syncConnections({ tenantId, workspaceId, actor: who, ...(body.network ? { network: body.network } : {}), ...(body.externalAccountIds ? { externalAccountIds: body.externalAccountIds } : {}) });
      return successEnvelope({ ...result, accounts: await social.accounts.listAccountViews({ tenantId, workspaceId }) }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/social/accounts/:accountId/test", { schema: { params: ID_PARAMS("accountId"), querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_connect");
    const { accountId } = request.params as { accountId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    try {
      const result = await social.accounts.testConnection({ tenantId, workspaceId, accountId });
      const [view] = (await social.accounts.listAccountViews({ tenantId, workspaceId })).filter((item) => item.id === accountId);
      return successEnvelope({ healthy: result.healthy, message: result.message, account: view }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/social/accounts/:accountId/disconnect", { schema: { params: ID_PARAMS("accountId"), querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_manage_accounts");
    const { accountId } = request.params as { accountId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    try {
      await social.accounts.disconnect({ tenantId, workspaceId, accountId, actor: who });
      return successEnvelope({ disconnected: true }, request.id);
    } catch (error) { translate(error); }
  });

  // ---------- Composer ----------
  app.get("/social/composer", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    return successEnvelope({ accounts: await social.posts.composerOptions({ tenantId, workspaceId }) }, request.id);
  });

  app.post("/social/posts/validate", { schema: { body: COMPOSE_BODY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_schedule");
    const body = request.body as ComposeBody;
    await ownWorkspace(tenantId, body.workspaceId);
    try {
      return successEnvelope({ destinations: await social.posts.validate({ tenantId, workspaceId: body.workspaceId, base: body.base, destinations: body.destinations }) }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/social/posts", { schema: { body: COMPOSE_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const body = request.body as ComposeBody;
    const when = body.when?.mode === "schedule" ? { mode: "schedule" as const, localDateTime: body.when.localDateTime ?? "", timezone: body.when.timezone } : { mode: "now" as const };
    const { tenantId, actor: who } = actor(request, when.mode === "now" ? "marketing:social_publish" : "marketing:social_schedule");
    await ownWorkspace(tenantId, body.workspaceId);
    if (when.mode === "schedule" && !when.localDateTime) throw new AppError({ code: "SOCIAL_SCHEDULE_REQUIRED", message: "Informe data e hora do agendamento.", statusCode: 400 });
    try {
      const post = await social.posts.create({
        tenantId,
        workspaceId: body.workspaceId,
        actor: who,
        idempotencyKey: body.idempotencyKey ?? deps.idGenerator(),
        base: body.base,
        destinations: body.destinations,
        when,
        requireApproval: body.requireApproval,
        ...(body.source?.executionRunId ? { source: { executionRunId: body.source.executionRunId } } : {}),
      });
      reply.code(201);
      return successEnvelope(post, request.id);
    } catch (error) { translate(error); }
  });

  app.get("/social/posts", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const query = request.query as { workspaceId: string; from?: string; to?: string };
    await ownWorkspace(tenantId, query.workspaceId);
    return successEnvelope({ posts: await social.posts.calendar({ tenantId, workspaceId: query.workspaceId, from: query.from, to: query.to }) }, request.id);
  });

  app.get("/social/posts/:postId", { schema: { params: ID_PARAMS("postId"), querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const { postId } = request.params as { postId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    try {
      return successEnvelope(await social.posts.get({ tenantId, workspaceId, postId }), request.id);
    } catch (error) { translate(error); }
  });

  const postAction = (path: string, permission: Permission, run: (input: { tenantId: string; workspaceId: string; postId: string; actor: SocialAuditActor; body: Record<string, unknown> }) => Promise<unknown>) => {
    app.post(`/social/posts/:postId/${path}`, { schema: { params: ID_PARAMS("postId"), querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
      const { tenantId, actor: who } = actor(request, permission);
      const { postId } = request.params as { postId: string };
      const { workspaceId } = request.query as { workspaceId: string };
      await ownWorkspace(tenantId, workspaceId);
      try {
        return successEnvelope(await run({ tenantId, workspaceId, postId, actor: who, body: (request.body ?? {}) as Record<string, unknown> }), request.id);
      } catch (error) { translate(error); }
    });
  };
  postAction("approve", "publication:approve", (input) => social.posts.approve(input));
  postAction("publish-now", "marketing:social_publish", (input) => social.posts.publishNow(input));
  postAction("cancel", "marketing:social_schedule", (input) => social.posts.cancel(input));
  postAction("reschedule", "marketing:social_schedule", (input) => {
    const localDateTime = typeof input.body.localDateTime === "string" ? input.body.localDateTime : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(localDateTime)) throw new Error("SOCIAL_SCHEDULE_INVALID: informe data e hora válidas.");
    return social.posts.reschedule({ ...input, localDateTime, ...(typeof input.body.timezone === "string" ? { timezone: input.body.timezone } : {}) });
  });

  const destinationAction = (path: string, permission: Permission, run: (input: { tenantId: string; workspaceId: string; destinationId: string; actor: SocialAuditActor; body: Record<string, unknown> }) => Promise<unknown>) => {
    app.post(`/social/destinations/:destinationId/${path}`, { schema: { params: ID_PARAMS("destinationId"), querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
      const { tenantId, actor: who } = actor(request, permission);
      const { destinationId } = request.params as { destinationId: string };
      const { workspaceId } = request.query as { workspaceId: string };
      await ownWorkspace(tenantId, workspaceId);
      try {
        return successEnvelope(await run({ tenantId, workspaceId, destinationId, actor: who, body: (request.body ?? {}) as Record<string, unknown> }), request.id);
      } catch (error) { translate(error); }
    });
  };
  destinationAction("retry", "marketing:social_publish", (input) => social.posts.retryDestination(input));
  destinationAction("cancel", "marketing:social_schedule", (input) => social.posts.cancelDestination(input));
  // Resultado desconhecido que a API não permitiu verificar: o cliente confere na rede e confirma.
  destinationAction("resolve-unknown", "marketing:social_publish", (input) => {
    const outcome = input.body.outcome === "published" ? "published" : input.body.outcome === "not_published" ? "not_published" : undefined;
    if (!outcome) throw new Error("SOCIAL_POLICY_INVALID: informe se a publicação saiu ou não.");
    return social.posts.resolveUnknown({ ...input, outcome, ...(typeof input.body.externalUrl === "string" ? { externalUrl: input.body.externalUrl.slice(0, 500) } : {}) });
  });
  destinationAction("late-decision", "marketing:social_publish", async (input) => {
    const decision = input.body.decision === "skip" ? "skip" : input.body.decision === "publish" ? "publish" : undefined;
    if (!decision) throw new Error("SOCIAL_POLICY_INVALID: decisão inválida.");
    const destination = await social.accounts.decideLate({ ...input, decision });
    return social.posts.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: destination.publicationId });
  });

  // ---------- Música ----------
  app.get("/social/music/search", {
    schema: { querystring: { type: "object", required: ["workspaceId", "accountId", "format"], properties: { workspaceId: { type: "string", minLength: 1 }, accountId: { type: "string", minLength: 1 }, format: FORMAT_SCHEMA, q: { type: "string", maxLength: 100 } } } },
  }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_publish");
    const query = request.query as { workspaceId: string; accountId: string; format: SocialPostFormat; q?: string };
    await ownWorkspace(tenantId, query.workspaceId);
    try {
      return successEnvelope(await social.posts.searchMusic({ tenantId, workspaceId: query.workspaceId, accountId: query.accountId, format: query.format, query: query.q ?? "" }), request.id);
    } catch (error) { translate(error); }
  });

  // ---------- Política operacional do tenant (atraso e limites) ----------
  app.get("/social/settings", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    const networks = await Promise.all(SOCIAL_NETWORKS.map(async (network) => {
      const policy = await social.resolver.policyFor(tenantId, network);
      return { network, latePolicy: policy.latePolicy, rateLimits: policy.rateLimits };
    }));
    return successEnvelope({ networks, timezone: await social.posts.workspaceTimezone({ tenantId, workspaceId }) }, request.id);
  });

  app.put("/social/settings/:network", {
    schema: {
      params: { type: "object", required: ["network"], properties: { network: NETWORK_SCHEMA } },
      querystring: WORKSPACE_QUERY,
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          latePolicy: { type: "object", additionalProperties: false, properties: { toleranceMinutes: { type: "integer", minimum: 0, maximum: 1440 }, whenLate: { type: "string", enum: ["PUBLISH_ON_RECONNECT", "ASK_CONFIRMATION", "SKIP"] } } },
          rateLimits: { type: "object", additionalProperties: false, properties: { minimumIntervalSeconds: { type: "integer" }, maxPublicationsPerHour: { type: "integer" }, maxPublicationsPerDay: { type: "integer" }, maxConsecutiveFailures: { type: "integer" } } },
        },
      },
    },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const { tenantId, actor: who } = actor(request, "marketing:social_manage_provider");
    const { network } = request.params as { network: SocialNetwork };
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    const body = request.body as { latePolicy?: Record<string, unknown>; rateLimits?: Record<string, number> };
    try {
      const policy = await social.admin.setTenantOperationalPolicy({ tenantId, network, latePolicy: body.latePolicy as never, rateLimits: body.rateLimits, actor: who });
      return successEnvelope({ network, latePolicy: policy.latePolicy, rateLimits: policy.rateLimits }, request.id);
    } catch (error) { translate(error); }
  });

  app.get("/social/metrics", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { tenantId } = actor(request, "marketing:social_read");
    const { workspaceId } = request.query as { workspaceId: string };
    await ownWorkspace(tenantId, workspaceId);
    const metrics = await social.admin.metrics({ tenantId, sinceHours: 24 * 7 });
    // Visão do cliente: agregada por rede, sem nome técnico de provider.
    const byNetwork = SOCIAL_NETWORKS.map((network) => {
      const rows = metrics.byProvider.filter((row) => row.network === network);
      return { network, attempts: sum(rows, "attempts"), published: sum(rows, "published"), failed: sum(rows, "failed"), waitingReconnect: metrics.blocked.filter((row) => row.network === network && row.reason === "WAITING_REAUTH").reduce((total, row) => total + row.count, 0) };
    });
    return successEnvelope({ since: metrics.since, byNetwork }, request.id);
  });

  // ---------- Platform admin: providers ----------
  app.get("/admin/social-providers", async (request) => {
    requirePlatformAdmin(request);
    return successEnvelope({ providers: await social.admin.listSwitches() }, request.id);
  });

  app.put("/admin/social-providers/:providerType", {
    schema: {
      params: { type: "object", required: ["providerType"], properties: { providerType: PROVIDER_TYPE_SCHEMA } },
      body: { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" }, approved: { type: "boolean" }, reason: { type: "string", maxLength: 300 } } },
    },
  }, async (request) => {
    const principal = requirePlatformAdmin(request);
    const { providerType } = request.params as { providerType: SocialProviderType };
    const body = request.body as { enabled: boolean; approved?: boolean; reason?: string };
    try {
      return successEnvelope(await social.admin.setSwitch({ providerType, enabled: body.enabled, approved: body.approved, reason: body.reason, actor: { userId: principal.userId, role: principal.role } }), request.id);
    } catch (error) { translate(error); }
  });

  app.get("/admin/social-providers/metrics", async (request) => {
    requirePlatformAdmin(request);
    const { hours } = request.query as { hours?: string };
    return successEnvelope(await social.admin.metrics({ sinceHours: Math.min(24 * 30, Math.max(1, Number(hours ?? 24) || 24)) }), request.id);
  });

  app.get("/admin/social-providers/tenants/:tenantId", { schema: { params: ID_PARAMS("tenantId") } }, async (request) => {
    requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string };
    return successEnvelope(await social.admin.tenantOverview(tenantId), request.id);
  });

  app.put("/admin/social-providers/tenants/:tenantId/:network", {
    schema: {
      params: { type: "object", required: ["tenantId", "network"], properties: { tenantId: { type: "string", minLength: 1 }, network: NETWORK_SCHEMA } },
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          publishingEnabled: { type: "boolean" },
          preferredProvider: PROVIDER_TYPE_SCHEMA,
          enabledProviders: { type: "array", maxItems: 10, items: PROVIDER_TYPE_SCHEMA },
        },
      },
    },
  }, async (request) => {
    const principal = requirePlatformAdmin(request);
    const { tenantId, network } = request.params as { tenantId: string; network: SocialNetwork };
    const body = request.body as { publishingEnabled?: boolean; preferredProvider?: SocialProviderType; enabledProviders?: SocialProviderType[] };
    try {
      return successEnvelope(await social.admin.setTenantPolicy({ tenantId, network, ...body, actor: { userId: principal.userId, role: principal.role } }), request.id);
    } catch (error) { translate(error); }
  });
}

function sum<T extends Record<string, unknown>>(rows: readonly T[], key: keyof T): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}
