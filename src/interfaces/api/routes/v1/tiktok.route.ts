import type { FastifyInstance } from "fastify";
import type { PublicationRepositoryPort } from "../../../../application/ports/publication-repository.port.js";
import { approvePublication, cancelPublication, createPublication, type PublicationEngineDeps } from "../../../../application/publication/publication-engine.js";
import { enqueuePublication, PublicationWorker, runDueSchedules, schedulePublication, type PublicationOrchestratorDeps } from "../../../../application/publication/publication-orchestrator.js";
import type { PublicationProviderPort } from "../../../../application/publication/publication-provider.port.js";
import type { PublicationProviderRegistry } from "../../../../application/publication/publication-provider-registry.js";
import type { PublicationQueuePort } from "../../../../application/publication/publication-queue.js";
import type { PublicationSecretResolverPort } from "../../../../application/publication/publication-secret-resolver.js";
import type { OperationalCircuitBreaker } from "../../../../application/operations/operational-services.js";
import type { PublicationProviderPolicy } from "../../../../application/publication/publication-provider-policy.js";
import type { PublicationPlan, PublicationPolicy, PublicationProvider } from "../../../../domain/publication/publication.model.js";
import type { TikTokOAuthService } from "../../../../infrastructure/publication/tiktok-oauth-service.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

/** Política fixa dos posts de TikTok — canal/provider travados para não vazar para outra rede. */
const TIKTOK_POLICY: PublicationPolicy = {
  allowPublish: true,
  requireApproval: false,
  allowedChannels: ["tiktok"],
  allowedProviders: ["tiktok"],
  publishMode: "real",
  approvalPolicy: "optional",
  maxRetries: 3,
  rollbackSupported: false,
};

export type TikTokRoutesDeps = {
  publicationRepository: PublicationRepositoryPort;
  providers: readonly PublicationProviderPort[];
  providerRegistry: PublicationProviderRegistry;
  providerPolicy: PublicationProviderPolicy;
  secretResolver: PublicationSecretResolverPort;
  queue: PublicationQueuePort;
  tiktokOAuthService: TikTokOAuthService;
  providerCircuitBreaker?: OperationalCircuitBreaker;
  idGenerator: () => string;
};

type SchedulePostBody = {
  workspaceId: string;
  description: string;
  title?: string;
  videoUrl?: string;
  imageUrls?: readonly string[];
  scheduledAt?: string;
  timezone?: string;
  privacyLevel?: string;
  photoCoverIndex?: number;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  autoAddMusic?: boolean;
  credentialReferenceId?: string;
  idempotencyKey?: string;
};

const SCHEDULE_POST_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "description"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1, maxLength: 4000 },
    title: { type: "string", maxLength: 150 },
    videoUrl: { type: "string", format: "uri" },
    imageUrls: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 35 },
    scheduledAt: { type: "string", minLength: 1 },
    timezone: { type: "string", minLength: 1 },
    privacyLevel: { type: "string", enum: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] },
    photoCoverIndex: { type: "integer", minimum: 0 },
    disableComment: { type: "boolean" },
    disableDuet: { type: "boolean" },
    disableStitch: { type: "boolean" },
    autoAddMusic: { type: "boolean" },
    credentialReferenceId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 1 },
  },
} as const;

export async function registerTikTokRoutes(app: FastifyInstance, deps: TikTokRoutesDeps): Promise<void> {
  const engineDeps: PublicationEngineDeps = { repository: deps.publicationRepository, providers: deps.providers, idGenerator: deps.idGenerator };
  const orchestratorDeps: PublicationOrchestratorDeps = {
    ...engineDeps,
    queue: deps.queue,
    providerRegistry: deps.providerRegistry,
    secretResolver: deps.secretResolver,
    providerCircuitBreaker: deps.providerCircuitBreaker,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
  };

  app.get("/publication-providers/tiktok/oauth/status", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.tiktokOAuthService.status({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/publication-providers/tiktok/oauth/connect", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(deps.tiktokOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  // O TikTok redireciona o navegador do cliente para o frontend; o frontend repassa code+state aqui
  // já autenticado, então o token nunca trafega sem sessão válida.
  app.post("/publication-providers/tiktok/oauth/callback", { schema: { body: { type: "object", required: ["state", "code"], properties: { state: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { state: string; code: string };
    const result = await deps.tiktokOAuthService.complete({
      state: body.state,
      code: body.code,
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: requestContext(request),
    });
    return successEnvelope(result, request.id);
  });

  app.post("/publication-providers/tiktok/oauth/disconnect", { schema: { body: { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string" }, credentialReferenceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { workspaceId: string; credentialReferenceId: string };
    const disconnected = await deps.tiktokOAuthService.disconnect({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      credentialReferenceId: body.credentialReferenceId,
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: requestContext(request),
      reason: "TikTok OAuth disconnect",
    });
    return successEnvelope({ disconnected }, request.id);
  });

  app.get("/tiktok/posts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const plans = (await deps.publicationRepository.listPlans({ tenantId: principal.tenantId, workspaceId })).filter(isTikTokPlan);
    const schedules = await deps.publicationRepository.listSchedules({ tenantId: principal.tenantId, workspaceId });
    const posts = plans.map((plan) => ({
      publicationId: plan.id,
      state: plan.state,
      description: descriptionOf(plan),
      media: mediaOf(plan),
      scheduledAt: schedules.find((schedule) => schedule.publicationId === plan.id)?.scheduledAt ?? plan.scheduledAt,
      timezone: schedules.find((schedule) => schedule.publicationId === plan.id)?.timezone ?? plan.timezone,
      scheduleStatus: schedules.find((schedule) => schedule.publicationId === plan.id)?.status,
      createdAt: plan.createdAt,
      publishedAt: plan.publishedAt,
      cancelledAt: plan.cancelledAt,
    }));
    return successEnvelope(posts.sort((a, b) => (b.scheduledAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.createdAt)), request.id);
  });

  app.post("/tiktok/posts", { schema: { body: SCHEDULE_POST_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:create");
    const body = request.body as SchedulePostBody;
    const media = requireMedia(body);
    if (body.scheduledAt && Number.isNaN(Date.parse(body.scheduledAt))) throw new Error("TIKTOK_SCHEDULED_AT_INVALID: scheduledAt deve ser uma data ISO-8601.");

    // Mesmo portão de ambiente/canário que a rota genérica de publicação já aplica — antes, esta
    // rota ignorava PUBLICATION_PROVIDER_ENVIRONMENT/PRODUCTION_ENABLED/CANARY_* por completo.
    const fallbackToDryRun = deps.providerPolicy.shouldFallbackToDryRun({ tenantId: principal.tenantId, workspaceId: body.workspaceId, providerId: "tiktok" });
    const effectiveProvider: PublicationProvider = fallbackToDryRun ? "dry_run" : "tiktok";
    const effectiveMode = fallbackToDryRun ? "dry_run" : "real";
    const policy: PublicationPolicy = fallbackToDryRun
      ? { ...TIKTOK_POLICY, allowedProviders: ["dry_run"], publishMode: "dry_run" }
      : TIKTOK_POLICY;

    const detail = await createPublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      idempotencyKey: body.idempotencyKey ?? `tiktok:${body.workspaceId}:${deps.idGenerator()}`,
      sourceArtifacts: [{
        artifactId: `tiktok-post-${deps.idGenerator()}`,
        artifactType: media.videoUrl ? "video" : "image",
        schemaId: "inline.tiktok.post",
        schemaVersion: 1,
        checksum: "inline",
        payload: {
          description: body.description,
          title: body.title,
          videoUrl: media.videoUrl,
          imageUrls: media.imageUrls,
          privacyLevel: body.privacyLevel ?? "PUBLIC_TO_EVERYONE",
          photoCoverIndex: body.photoCoverIndex ?? 0,
          disableComment: body.disableComment ?? false,
          disableDuet: body.disableDuet ?? false,
          disableStitch: body.disableStitch ?? false,
          autoAddMusic: body.autoAddMusic ?? true,
          credentialReferenceId: body.credentialReferenceId,
        },
      }],
      channels: ["tiktok"],
      mode: effectiveMode,
      provider: effectiveProvider,
      policy,
      scheduledAt: body.scheduledAt,
      timezone: body.timezone,
      causationId: principal.userId,
    });

    // Sem aprovação manual: o cliente já confirmou o post ao agendar pelo painel.
    await approvePublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      publicationId: detail.plan.id,
      approvedByUserId: principal.userId,
      reason: "Post TikTok confirmado pelo cliente no painel.",
    });

    if (body.scheduledAt) {
      const scheduled = await schedulePublication(orchestratorDeps, {
        tenantId: principal.tenantId,
        workspaceId: body.workspaceId,
        publicationId: detail.plan.id,
        scheduledAt: body.scheduledAt,
        timezone: body.timezone ?? "America/Sao_Paulo",
      });
      return successEnvelope({ publicationId: scheduled.plan.id, state: scheduled.plan.state, scheduledAt: body.scheduledAt, timezone: body.timezone ?? "America/Sao_Paulo" }, request.id);
    }

    await enqueuePublication(orchestratorDeps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: detail.plan.id });
    await new PublicationWorker(orchestratorDeps, "tiktok-publish-worker").runUntilIdle(1);
    const published = await deps.publicationRepository.getDetail(detail.plan.id);
    return successEnvelope({ publicationId: detail.plan.id, state: published?.plan.state ?? detail.plan.state, receipts: published?.receipts ?? [] }, request.id);
  });

  app.post("/tiktok/posts/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const detail = await cancelPublication(engineDeps, { tenantId: principal.tenantId, workspaceId, publicationId: id });
    return successEnvelope({ publicationId: id, state: detail.plan.state }, request.id);
  });

  app.post("/tiktok/posts/run-due", { schema: { body: { type: "object", properties: { now: { type: "string" } } } } }, async (request) => {
    requirePermission(request, "publication:operate");
    const enqueued = await runDueSchedules(orchestratorDeps, ((request.body ?? {}) as { now?: string }).now);
    const processed = await new PublicationWorker(orchestratorDeps, "tiktok-due-worker").runUntilIdle();
    return successEnvelope({ enqueued, processed }, request.id);
  });
}

function requireMedia(body: SchedulePostBody): { videoUrl?: string; imageUrls?: readonly string[] } {
  const imageUrls = body.imageUrls?.filter((url) => url.trim().length > 0) ?? [];
  if (body.videoUrl && imageUrls.length > 0) throw new Error("TIKTOK_MEDIA_AMBIGUOUS: informe videoUrl OU imageUrls, não os dois.");
  if (!body.videoUrl && imageUrls.length === 0) throw new Error("TIKTOK_MEDIA_REQUIRED: informe videoUrl ou ao menos uma imagem em imageUrls.");
  assertPublicHttpsUrls([...(body.videoUrl ? [body.videoUrl] : []), ...imageUrls]);
  return body.videoUrl ? { videoUrl: body.videoUrl } : { imageUrls };
}

/**
 * O TikTok baixa a mídia por `PULL_FROM_URL`, então a URL precisa ser pública e HTTPS.
 * Bloquear destinos internos evita usar o backend como proxy para a rede privada (SSRF).
 */
function assertPublicHttpsUrls(urls: readonly string[]): void {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("TIKTOK_MEDIA_URL_INVALID: URL de mídia inválida.");
    }
    if (url.protocol !== "https:") throw new Error("TIKTOK_MEDIA_URL_INSECURE: a URL de mídia precisa usar HTTPS.");
    if (isPrivateHost(url.hostname)) throw new Error("TIKTOK_MEDIA_URL_PRIVATE: a URL de mídia precisa ser pública para o TikTok baixar o arquivo.");
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isTikTokPlan(plan: PublicationPlan): boolean {
  return plan.policy.allowedProviders.includes("tiktok") || plan.policy.allowedChannels.includes("tiktok");
}

function descriptionOf(plan: PublicationPlan): string {
  for (const artifact of plan.sourceArtifacts) {
    const description = (artifact.payload as { description?: unknown } | undefined)?.description;
    if (typeof description === "string") return description;
  }
  return "";
}

function mediaOf(plan: PublicationPlan): { videoUrl?: string; imageUrls: readonly string[] } {
  for (const artifact of plan.sourceArtifacts) {
    const payload = artifact.payload as { videoUrl?: unknown; imageUrls?: unknown } | undefined;
    const videoUrl = typeof payload?.videoUrl === "string" ? payload.videoUrl : undefined;
    const imageUrls = Array.isArray(payload?.imageUrls) ? payload.imageUrls.filter((url): url is string => typeof url === "string") : [];
    if (videoUrl || imageUrls.length > 0) return { videoUrl, imageUrls };
  }
  return { imageUrls: [] };
}

function requestContext(request: { id: string; ip?: string; headers: Record<string, string | string[] | undefined> }): { requestId: string; ip?: string; userAgent?: string } {
  const userAgent = request.headers["user-agent"];
  return { requestId: request.id, ip: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}
