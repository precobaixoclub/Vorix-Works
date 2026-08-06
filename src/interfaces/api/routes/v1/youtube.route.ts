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
import type { YouTubeOAuthService } from "../../../../infrastructure/publication/youtube-oauth-service.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

const YOUTUBE_POLICY: PublicationPolicy = {
  allowPublish: true,
  requireApproval: false,
  allowedChannels: ["youtube"],
  allowedProviders: ["youtube"],
  publishMode: "real",
  approvalPolicy: "optional",
  maxRetries: 3,
  rollbackSupported: false,
};

export type YouTubeRoutesDeps = {
  publicationRepository: PublicationRepositoryPort;
  providers: readonly PublicationProviderPort[];
  providerRegistry: PublicationProviderRegistry;
  providerPolicy: PublicationProviderPolicy;
  secretResolver: PublicationSecretResolverPort;
  queue: PublicationQueuePort;
  youtubeOAuthService: YouTubeOAuthService;
  providerCircuitBreaker?: OperationalCircuitBreaker;
  idGenerator: () => string;
};

type SchedulePostBody = {
  workspaceId: string;
  title?: string;
  description: string;
  videoUrl: string;
  scheduledAt?: string;
  timezone?: string;
  privacyStatus?: "public" | "unlisted" | "private";
  tags?: readonly string[];
  categoryId?: string;
  credentialReferenceId?: string;
  idempotencyKey?: string;
};

const SCHEDULE_POST_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "description", "videoUrl"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", minLength: 1, maxLength: 5000 },
    videoUrl: { type: "string", format: "uri" },
    scheduledAt: { type: "string", minLength: 1 },
    timezone: { type: "string", minLength: 1 },
    privacyStatus: { type: "string", enum: ["public", "unlisted", "private"] },
    tags: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 50 },
    categoryId: { type: "string", minLength: 1 },
    credentialReferenceId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 1 },
  },
} as const;

export async function registerYouTubeRoutes(app: FastifyInstance, deps: YouTubeRoutesDeps): Promise<void> {
  const engineDeps: PublicationEngineDeps = { repository: deps.publicationRepository, providers: deps.providers, idGenerator: deps.idGenerator };
  const orchestratorDeps: PublicationOrchestratorDeps = {
    ...engineDeps,
    queue: deps.queue,
    providerRegistry: deps.providerRegistry,
    secretResolver: deps.secretResolver,
    providerCircuitBreaker: deps.providerCircuitBreaker,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
  };

  app.get("/publication-providers/youtube/oauth/status", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.youtubeOAuthService.status({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/publication-providers/youtube/oauth/connect", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(deps.youtubeOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/publication-providers/youtube/oauth/callback", { schema: { body: { type: "object", required: ["state", "code"], properties: { state: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { state: string; code: string };
    const result = await deps.youtubeOAuthService.complete({
      state: body.state,
      code: body.code,
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: requestContext(request),
    });
    return successEnvelope(result, request.id);
  });

  app.post("/publication-providers/youtube/oauth/disconnect", { schema: { body: { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string" }, credentialReferenceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { workspaceId: string; credentialReferenceId: string };
    const disconnected = await deps.youtubeOAuthService.disconnect({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      credentialReferenceId: body.credentialReferenceId,
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: requestContext(request),
      reason: "YouTube OAuth disconnect",
    });
    return successEnvelope({ disconnected }, request.id);
  });

  app.get("/youtube/posts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const plans = (await deps.publicationRepository.listPlans({ tenantId: principal.tenantId, workspaceId })).filter(isYouTubePlan);
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

  app.post("/youtube/posts", { schema: { body: SCHEDULE_POST_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:create");
    const body = request.body as SchedulePostBody;
    assertPublicHttpsUrls([body.videoUrl]);
    if (body.scheduledAt && Number.isNaN(Date.parse(body.scheduledAt))) throw new Error("YOUTUBE_SCHEDULED_AT_INVALID: scheduledAt deve ser uma data ISO-8601.");

    const fallbackToDryRun = deps.providerPolicy.shouldFallbackToDryRun({ tenantId: principal.tenantId, workspaceId: body.workspaceId, providerId: "youtube" });
    const effectiveProvider: PublicationProvider = fallbackToDryRun ? "dry_run" : "youtube";
    const effectiveMode = fallbackToDryRun ? "dry_run" : "real";
    const policy: PublicationPolicy = fallbackToDryRun
      ? { ...YOUTUBE_POLICY, allowedProviders: ["dry_run"], publishMode: "dry_run" }
      : YOUTUBE_POLICY;

    const detail = await createPublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      idempotencyKey: body.idempotencyKey ?? `youtube:${body.workspaceId}:${deps.idGenerator()}`,
      sourceArtifacts: [{
        artifactId: `youtube-short-${deps.idGenerator()}`,
        artifactType: "video",
        schemaId: "inline.youtube.short",
        schemaVersion: 1,
        checksum: "inline",
        payload: {
          title: body.title,
          description: body.description,
          videoUrl: body.videoUrl,
          privacyStatus: body.privacyStatus ?? "public",
          tags: body.tags ?? ["Shorts"],
          categoryId: body.categoryId ?? "22",
          credentialReferenceId: body.credentialReferenceId,
        },
      }],
      channels: ["youtube"],
      mode: effectiveMode,
      provider: effectiveProvider,
      policy,
      scheduledAt: body.scheduledAt,
      timezone: body.timezone,
      causationId: principal.userId,
    });

    await approvePublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      publicationId: detail.plan.id,
      approvedByUserId: principal.userId,
      reason: "Short YouTube confirmado pelo cliente no painel.",
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
    await new PublicationWorker(orchestratorDeps, "youtube-publish-worker").runUntilIdle(1);
    const published = await deps.publicationRepository.getDetail(detail.plan.id);
    return successEnvelope({ publicationId: detail.plan.id, state: published?.plan.state ?? detail.plan.state, receipts: published?.receipts ?? [] }, request.id);
  });

  app.post("/youtube/posts/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const detail = await cancelPublication(engineDeps, { tenantId: principal.tenantId, workspaceId, publicationId: id });
    return successEnvelope({ publicationId: id, state: detail.plan.state }, request.id);
  });

  app.post("/youtube/posts/run-due", { schema: { body: { type: "object", properties: { now: { type: "string" } } } } }, async (request) => {
    requirePermission(request, "publication:operate");
    const enqueued = await runDueSchedules(orchestratorDeps, ((request.body ?? {}) as { now?: string }).now);
    const processed = await new PublicationWorker(orchestratorDeps, "youtube-due-worker").runUntilIdle();
    return successEnvelope({ enqueued, processed }, request.id);
  });
}

function assertPublicHttpsUrls(urls: readonly string[]): void {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("YOUTUBE_MEDIA_URL_INVALID: URL de video invalida.");
    }
    if (url.protocol !== "https:") throw new Error("YOUTUBE_MEDIA_URL_INSECURE: a URL do video precisa usar HTTPS.");
    if (isPrivateHost(url.hostname)) throw new Error("YOUTUBE_MEDIA_URL_PRIVATE: a URL do video precisa ser publica.");
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function isYouTubePlan(plan: PublicationPlan): boolean {
  return plan.policy.allowedProviders.includes("youtube") || plan.policy.allowedChannels.includes("youtube");
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
    const payload = artifact.payload as { videoUrl?: unknown } | undefined;
    const videoUrl = typeof payload?.videoUrl === "string" ? payload.videoUrl : undefined;
    if (videoUrl) return { videoUrl, imageUrls: [] };
  }
  return { imageUrls: [] };
}

function requestContext(request: { id: string; ip?: string; headers: Record<string, string | string[] | undefined> }): { requestId: string; ip?: string; userAgent?: string } {
  const userAgent = request.headers["user-agent"];
  return { requestId: request.id, ip: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}
