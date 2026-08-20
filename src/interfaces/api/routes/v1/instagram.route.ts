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
import type { MetaInstagramOAuthService } from "../../../../infrastructure/publication/meta-instagram-oauth-service.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, providerId: { type: "string", enum: ["instagram", "facebook"] } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

/** Política fixa dos posts do Instagram/Facebook — canal/provider travados para não vazar para outra rede. */
function metaPolicy(target: "instagram" | "facebook"): PublicationPolicy {
  return {
    allowPublish: true,
    requireApproval: false,
    allowedChannels: [target],
    allowedProviders: [target],
    publishMode: "real",
    approvalPolicy: "optional",
    maxRetries: 3,
    rollbackSupported: false,
  };
}

export type InstagramRoutesDeps = {
  publicationRepository: PublicationRepositoryPort;
  providers: readonly PublicationProviderPort[];
  providerRegistry: PublicationProviderRegistry;
  providerPolicy: PublicationProviderPolicy;
  secretResolver: PublicationSecretResolverPort;
  queue: PublicationQueuePort;
  metaInstagramOAuthService: MetaInstagramOAuthService;
  providerCircuitBreaker?: OperationalCircuitBreaker;
  idGenerator: () => string;
};

type SchedulePostBody = {
  workspaceId: string;
  target?: "instagram" | "facebook";
  /** "story" só existe de verdade no Instagram; no Facebook só foto (vídeo ainda não suportado — ver docs). */
  placement?: "feed" | "story";
  caption: string;
  videoUrl?: string;
  imageUrls?: readonly string[];
  thumbnailUrl?: string;
  scheduledAt?: string;
  timezone?: string;
  credentialReferenceId?: string;
  idempotencyKey?: string;
};

const SCHEDULE_POST_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "caption"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    target: { type: "string", enum: ["instagram", "facebook"] },
    placement: { type: "string", enum: ["feed", "story"] },
    caption: { type: "string", minLength: 0, maxLength: 4000 },
    videoUrl: { type: "string", format: "uri" },
    imageUrls: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 10 },
    thumbnailUrl: { type: "string", format: "uri" },
    scheduledAt: { type: "string", minLength: 1 },
    timezone: { type: "string", minLength: 1 },
    credentialReferenceId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 1 },
  },
} as const;

export async function registerInstagramRoutes(app: FastifyInstance, deps: InstagramRoutesDeps): Promise<void> {
  const engineDeps: PublicationEngineDeps = { repository: deps.publicationRepository, providers: deps.providers, idGenerator: deps.idGenerator };
  const orchestratorDeps: PublicationOrchestratorDeps = {
    ...engineDeps,
    queue: deps.queue,
    providerRegistry: deps.providerRegistry,
    secretResolver: deps.secretResolver,
    providerCircuitBreaker: deps.providerCircuitBreaker,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
  };

  app.get("/publication-providers/meta/oauth/status", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId, providerId } = request.query as { workspaceId: string; providerId?: "instagram" | "facebook" };
    return successEnvelope(await deps.metaInstagramOAuthService.status({ tenantId: principal.tenantId, workspaceId, providerId }), request.id);
  });

  app.post("/publication-providers/meta/oauth/connect", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(deps.metaInstagramOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  // O Meta redireciona o navegador do cliente para o frontend; o frontend repassa code+state aqui
  // já autenticado, então o token nunca trafega sem sessão válida.
  app.post("/publication-providers/meta/oauth/callback", { schema: { body: { type: "object", required: ["state", "code"], properties: { state: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { state: string; code: string };
    let result: Awaited<ReturnType<MetaInstagramOAuthService["complete"]>>;
    try {
      result = await deps.metaInstagramOAuthService.complete({
        state: body.state,
        code: body.code,
        actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
        context: requestContext(request),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("META_NO_PAGES_FOUND")) {
        throw new AppError({
          code: "META_NO_PAGES_FOUND",
          message: "Nenhuma Página do Facebook foi encontrada para essa conta. Entre com um perfil que tenha controle total de uma Página vinculada ao Instagram profissional.",
          statusCode: 400,
          recoverable: true,
        });
      }
      throw error;
    }
    return successEnvelope(result, request.id);
  });

  app.post("/publication-providers/meta/oauth/disconnect", { schema: { body: { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string" }, credentialReferenceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { workspaceId: string; credentialReferenceId: string };
    const disconnected = await deps.metaInstagramOAuthService.disconnect({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      credentialReferenceId: body.credentialReferenceId,
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: requestContext(request),
      reason: "Meta OAuth disconnect",
    });
    return successEnvelope({ disconnected }, request.id);
  });

  app.get("/instagram/posts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const plans = (await deps.publicationRepository.listPlans({ tenantId: principal.tenantId, workspaceId })).filter(isMetaPlan);
    const schedules = await deps.publicationRepository.listSchedules({ tenantId: principal.tenantId, workspaceId });
    const posts = plans.map((plan) => ({
      publicationId: plan.id,
      target: (plan.policy.allowedProviders.includes("instagram") ? "instagram" : "facebook") as "instagram" | "facebook",
      placement: placementOf(plan),
      state: plan.state,
      caption: captionOf(plan),
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

  app.post("/instagram/posts", { schema: { body: SCHEDULE_POST_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:create");
    const body = request.body as SchedulePostBody;
    const target = body.target ?? "instagram";
    const placement = body.placement ?? "feed";
    const media = requireMedia(body, target);
    if (body.scheduledAt && Number.isNaN(Date.parse(body.scheduledAt))) throw new Error("META_SCHEDULED_AT_INVALID: scheduledAt deve ser uma data ISO-8601.");
    if (placement === "story" && media.imageUrls.length > 1) throw new Error("META_STORY_CAROUSEL_UNSUPPORTED: Stories aceitam só uma imagem ou um vídeo, nunca carrossel.");
    if (placement === "story" && target === "facebook" && media.videoUrl) throw new Error("META_FACEBOOK_VIDEO_STORY_UNSUPPORTED: Stories de vídeo no Facebook ainda não são suportadas por esta integração — use foto ou publique no feed.");

    // Mesmo portão de ambiente/canário que a rota genérica de publicação já aplica — antes, esta
    // rota ignorava PUBLICATION_PROVIDER_ENVIRONMENT/PRODUCTION_ENABLED/CANARY_* por completo.
    const fallbackToDryRun = deps.providerPolicy.shouldFallbackToDryRun({ tenantId: principal.tenantId, workspaceId: body.workspaceId, providerId: target });
    const effectiveProvider: PublicationProvider = fallbackToDryRun ? "dry_run" : target;
    const effectiveMode = fallbackToDryRun ? "dry_run" : "real";
    const policy: PublicationPolicy = fallbackToDryRun
      ? { ...metaPolicy(target), allowedProviders: ["dry_run"], publishMode: "dry_run" }
      : metaPolicy(target);

    const detail = await createPublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      idempotencyKey: body.idempotencyKey ?? `${target}:${body.workspaceId}:${deps.idGenerator()}`,
      sourceArtifacts: [{
        artifactId: `${target}-post-${deps.idGenerator()}`,
        artifactType: media.videoUrl ? "video" : media.imageUrls.length > 0 ? "image" : "text",
        schemaId: `inline.${target}.post`,
        schemaVersion: 1,
        checksum: "inline",
        payload: {
          caption: body.caption,
          videoUrl: media.videoUrl,
          imageUrls: media.imageUrls,
          thumbnailUrl: body.thumbnailUrl,
          placement,
          credentialReferenceId: body.credentialReferenceId,
        },
      }],
      channels: [target],
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
      reason: `Post ${target} confirmado pelo cliente no painel.`,
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
    await new PublicationWorker(orchestratorDeps, `${target}-publish-worker`).runUntilIdle(1, { tenantId: principal.tenantId, workspaceId: body.workspaceId });
    const published = await deps.publicationRepository.getDetail(detail.plan.id);
    return successEnvelope({ publicationId: detail.plan.id, state: published?.plan.state ?? detail.plan.state, receipts: published?.receipts ?? [] }, request.id);
  });

  app.post("/instagram/posts/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const detail = await cancelPublication(engineDeps, { tenantId: principal.tenantId, workspaceId, publicationId: id });
    return successEnvelope({ publicationId: id, state: detail.plan.state }, request.id);
  });

  app.post("/instagram/posts/run-due", { schema: { body: { type: "object", properties: { workspaceId: { type: "string" }, now: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:operate");
    const body = (request.body ?? {}) as { workspaceId?: string; now?: string };
    const enqueued = await runDueSchedules(orchestratorDeps, body.now, { tenantId: principal.tenantId, workspaceId: body.workspaceId });
    const processed = await new PublicationWorker(orchestratorDeps, "meta-due-worker").runUntilIdle(100, { tenantId: principal.tenantId, workspaceId: body.workspaceId });
    return successEnvelope({ enqueued, processed }, request.id);
  });
}

function requireMedia(body: SchedulePostBody, target: "instagram" | "facebook"): { videoUrl?: string; imageUrls: readonly string[] } {
  const imageUrls = body.imageUrls?.filter((url) => url.trim().length > 0) ?? [];
  if (body.videoUrl && imageUrls.length > 0) throw new Error("META_MEDIA_AMBIGUOUS: informe videoUrl OU imageUrls, não os dois.");
  if (target === "instagram" && !body.videoUrl && imageUrls.length === 0) throw new Error("META_MEDIA_REQUIRED: publicação no Instagram exige videoUrl ou ao menos uma imagem em imageUrls.");
  assertPublicHttpsUrls([...(body.videoUrl ? [body.videoUrl] : []), ...imageUrls, ...(body.thumbnailUrl ? [body.thumbnailUrl] : [])]);
  return body.videoUrl ? { videoUrl: body.videoUrl, imageUrls: [] } : { imageUrls };
}

/**
 * A Graph API busca a mídia por URL, então a URL precisa ser pública e HTTPS. Bloquear destinos
 * internos evita usar o backend como proxy para a rede privada (SSRF).
 */
function assertPublicHttpsUrls(urls: readonly string[]): void {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("META_MEDIA_URL_INVALID: URL de mídia inválida.");
    }
    if (url.protocol !== "https:") throw new Error("META_MEDIA_URL_INSECURE: a URL de mídia precisa usar HTTPS.");
    if (isPrivateHost(url.hostname)) throw new Error("META_MEDIA_URL_PRIVATE: a URL de mídia precisa ser pública para o Meta baixar o arquivo.");
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

const META_PROVIDERS: readonly PublicationProvider[] = ["instagram", "facebook"];

function isMetaPlan(plan: PublicationPlan): boolean {
  return plan.policy.allowedProviders.some((provider) => META_PROVIDERS.includes(provider)) || plan.policy.allowedChannels.some((channel) => META_PROVIDERS.includes(channel as PublicationProvider));
}

function captionOf(plan: PublicationPlan): string {
  for (const artifact of plan.sourceArtifacts) {
    const caption = (artifact.payload as { caption?: unknown } | undefined)?.caption;
    if (typeof caption === "string") return caption;
  }
  return "";
}

function placementOf(plan: PublicationPlan): "feed" | "story" {
  for (const artifact of plan.sourceArtifacts) {
    const placement = (artifact.payload as { placement?: unknown } | undefined)?.placement;
    if (placement === "story") return "story";
  }
  return "feed";
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
