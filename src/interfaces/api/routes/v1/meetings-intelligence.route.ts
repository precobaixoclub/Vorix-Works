import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  addMeetingComment,
  askMeetings,
  createCrmTaskFromActionItem,
  createMeetingClip,
  createMeetingShare,
  deleteKeywordTracker,
  deleteMeetingClip,
  deleteMeetingComment,
  exportMeetingMarkdown,
  generateMeetingFollowUp,
  getMeetingInsights,
  getMeetingPreferences,
  getMeetingsUsage,
  getSharedMeeting,
  keywordTrackerReport,
  linkMeetingToCrm,
  listKeywordTrackers,
  listMeetingQuestions,
  purgeMeetingPermanently,
  renameMeetingSpeaker,
  revokeMeetingShare,
  saveKeywordTracker,
  searchMeetingCrm,
  sendMeetingFollowUpWhatsApp,
  setMeetingSummaryTemplate,
  updateMeetingPreferences,
  type MeetingIntelligenceDeps,
} from "../../../../application/meetings/meeting-intelligence.js";
import { MeetingError, type MeetingActor } from "../../../../application/meetings/meeting-use-cases.js";
import { importNativeTranscriptForActor, type GoogleAccessTokenPort, type GoogleMeetTranscriptPort } from "../../../../application/meetings/meet-native-import.js";
import { getZoomStatus, importZoomRecording, listZoomRecordings, type ZoomAuthPort, type ZoomRecordingsPort } from "../../../../application/meetings/zoom-import.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { AUTO_RECORD_MODES, MEETING_SUMMARY_TEMPLATES, type AutoRecordMode } from "../../../../domain/meetings/meeting-intelligence.js";
import { AppError, NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

/**
 * Vorix Meetings — inteligência e colaboração (resumo por modelo, falantes, "pergunte à reunião",
 * follow-up, CRM, compartilhamento, exportação, trechos, comentários, palavras monitoradas,
 * preferências, uso e exclusão definitiva). `/v1/meetings/*` passa pelo guarda da solução; o link
 * público fica em `/v1/public/meetings/:token` (sem login: o token é a autorização).
 */
export type MeetingIntelligenceRoutesDeps = MeetingIntelligenceDeps & {
  workspaceRepository: WorkspaceRepositoryPort;
  /** Importação da transcrição nativa do Google Meet (só com Google Calendar configurado). */
  nativeImport?: { meet: GoogleMeetTranscriptPort; tokens: GoogleAccessTokenPort; analysisEnabled: boolean };
  /** Zoom (gravações em nuvem) — só com o app OAuth do Zoom configurado. */
  zoom?: ZoomAuthPort & ZoomRecordingsPort;
  maxUploadBytes?: number;
  /** MEETINGS_AI_ANALYSIS_ENABLED: sem IA, importações não enfileiram resumo. */
  analysisEnabled?: boolean;
};

const WS = { workspaceId: { type: "string", minLength: 1 } } as const;
const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: WS } as const;
const ID_PARAMS = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const body = (required: string[], properties: Record<string, unknown>) => ({ type: "object", required: ["workspaceId", ...required], additionalProperties: false, properties: { ...WS, ...properties } });

function actorOf(request: FastifyRequest, permission: Parameters<typeof requirePermission>[1]): MeetingActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions };
}

function translate(error: unknown): never {
  if (error instanceof MeetingError) {
    const message = error.message.slice(error.code.length + 1).trim();
    if (error.code === "MEETING_NOT_FOUND") throw new NotFoundError(message);
    const status = error.code === "MEETING_INVALID_INPUT" ? 400 : error.code === "MEETING_STORAGE_UNAVAILABLE" ? 503 : error.code === "MEETING_STORAGE_LIMIT_REACHED" ? 402 : 409;
    throw new AppError({ code: error.code, message, statusCode: status, recoverable: status !== 400 });
  }
  throw error;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    translate(error);
  }
}

export async function registerMeetingIntelligenceRoutes(app: FastifyInstance, deps: MeetingIntelligenceRoutesDeps): Promise<void> {
  const ownWorkspace = (actor: MeetingActor, workspaceId: string) => assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });

  // ── Painel da reunião ──
  app.get("/meetings/:id/insights", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await run(() => getMeetingInsights(deps, actor, { workspaceId, meetingId: id })), request.id);
  });

  app.put("/meetings/:id/template", { schema: { params: ID_PARAMS, body: body(["template"], { template: { type: "string", enum: [...MEETING_SUMMARY_TEMPLATES] }, reanalyze: { type: "boolean" } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; template: string; reanalyze?: boolean };
    return successEnvelope(await run(() => setMeetingSummaryTemplate(deps, actor, { ...input, meetingId: id })), request.id);
  });

  app.put("/meetings/:id/speakers", { schema: { params: ID_PARAMS, body: body(["speakerKey", "displayName"], { speakerKey: { type: "string", minLength: 1, maxLength: 80 }, displayName: { type: "string", maxLength: 80 } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; speakerKey: string; displayName: string };
    await run(() => renameMeetingSpeaker(deps, actor, { ...input, meetingId: id }));
    return successEnvelope({ saved: true }, request.id);
  });

  // ── Pergunte à reunião (uma ou todas) ──
  app.post("/meetings/questions", { schema: { body: body(["question"], { question: { type: "string", minLength: 1, maxLength: 500 } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:analyze");
    const input = request.body as { workspaceId: string; question: string };
    return successEnvelope(await run(() => askMeetings(deps, actor, input)), request.id);
  });

  app.get("/meetings/questions", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await run(() => listMeetingQuestions(deps, actor, { workspaceId })), request.id);
  });

  app.post("/meetings/:id/questions", { schema: { params: ID_PARAMS, body: body(["question"], { question: { type: "string", minLength: 1, maxLength: 500 } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:analyze");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; question: string };
    return successEnvelope(await run(() => askMeetings(deps, actor, { ...input, meetingId: id })), request.id);
  });

  // ── Follow-up ──
  app.post("/meetings/:id/follow-up", { schema: { params: ID_PARAMS, body: body([], { recipientName: { type: "string", maxLength: 80 }, senderName: { type: "string", maxLength: 80 } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:analyze");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; recipientName?: string; senderName?: string };
    return successEnvelope(await run(() => generateMeetingFollowUp(deps, actor, { ...input, meetingId: id })), request.id);
  });

  app.get("/meetings/whatsapp-channels", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const channels = deps.messaging ? await run(() => deps.messaging!.listWhatsAppChannels({ tenantId: actor.tenantId, workspaceId })) : [];
    return successEnvelope({ available: !!deps.messaging, channels }, request.id);
  });

  app.post("/meetings/:id/follow-up/whatsapp", {
    schema: { params: ID_PARAMS, body: body(["connectionId", "message"], { connectionId: { type: "string", minLength: 1 }, phone: { type: "string", maxLength: 32 }, contactId: { type: "string" }, message: { type: "string", minLength: 1, maxLength: 4000 } }) },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; connectionId: string; phone?: string; contactId?: string; message: string };
    return successEnvelope(await run(() => sendMeetingFollowUpWhatsApp(deps, actor, { ...input, meetingId: id })), request.id);
  });

  // ── CRM ──
  app.get("/meetings/crm/search", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { ...WS, q: { type: "string", maxLength: 80 }, contactId: { type: "string" } } } } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId, q, contactId } = request.query as { workspaceId: string; q?: string; contactId?: string };
    return successEnvelope(await run(() => searchMeetingCrm(deps, actor, { workspaceId, ...(q ? { query: q } : {}), ...(contactId ? { contactId } : {}) })), request.id);
  });

  app.put("/meetings/:id/crm", { schema: { params: ID_PARAMS, body: body([], { contactId: { type: ["string", "null"] }, dealId: { type: ["string", "null"] } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; contactId?: string | null; dealId?: string | null };
    return successEnvelope(await run(() => linkMeetingToCrm(deps, actor, { ...input, meetingId: id })), request.id);
  });

  app.post("/meetings/:id/action-items/:itemId/crm-task", {
    schema: { params: { type: "object", required: ["id", "itemId"], properties: { id: { type: "string" }, itemId: { type: "string" } } }, body: body([], { dueAt: { type: "string", format: "date-time" }, ownerUserId: { type: "string" } }) },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id, itemId } = request.params as { id: string; itemId: string };
    const input = request.body as { workspaceId: string; dueAt?: string; ownerUserId?: string };
    return successEnvelope(await run(() => createCrmTaskFromActionItem(deps, actor, { ...input, meetingId: id, itemId })), request.id);
  });

  // ── Compartilhar e exportar ──
  app.post("/meetings/:id/shares", {
    schema: { params: ID_PARAMS, body: body([], { includeTranscript: { type: "boolean" }, includeRecording: { type: "boolean" }, expiresInDays: { type: "integer", minimum: 0, maximum: 365 } }) },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; includeTranscript?: boolean; includeRecording?: boolean; expiresInDays?: number };
    const result = await run(() => createMeetingShare(deps, actor, { workspaceId: input.workspaceId, meetingId: id, includeTranscript: input.includeTranscript ?? true, includeRecording: input.includeRecording ?? false, ...(input.expiresInDays !== undefined ? { expiresInDays: input.expiresInDays } : {}) }));
    reply.status(201);
    return successEnvelope(result, request.id);
  });

  app.delete("/meetings/:id/shares/:shareId", { schema: { params: { type: "object", required: ["id", "shareId"], properties: { id: { type: "string" }, shareId: { type: "string" } } }, querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id, shareId } = request.params as { id: string; shareId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await run(() => revokeMeetingShare(deps, actor, { workspaceId, meetingId: id, shareId }));
    return successEnvelope({ revoked: true }, request.id);
  });

  app.get("/meetings/:id/export", { schema: { params: ID_PARAMS, querystring: { type: "object", required: ["workspaceId"], properties: { ...WS, transcript: { type: "string", enum: ["true", "false"] } } } } }, async (request, reply: FastifyReply) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const { workspaceId, transcript } = request.query as { workspaceId: string; transcript?: string };
    const file = await run(() => exportMeetingMarkdown(deps, actor, { workspaceId, meetingId: id, includeTranscript: transcript !== "false" }));
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return reply.send(file.content);
  });

  // ── Trechos e comentários ──
  app.post("/meetings/:id/clips", {
    schema: { params: ID_PARAMS, body: body(["startMs", "endMs", "title"], { startMs: { type: "integer", minimum: 0 }, endMs: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 120 }, note: { type: "string", maxLength: 1000 } }) },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; startMs: number; endMs: number; title: string; note?: string };
    reply.status(201);
    return successEnvelope(await run(() => createMeetingClip(deps, actor, { ...input, meetingId: id })), request.id);
  });

  app.delete("/meetings/:id/clips/:clipId", { schema: { params: { type: "object", required: ["id", "clipId"], properties: { id: { type: "string" }, clipId: { type: "string" } } }, querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id, clipId } = request.params as { id: string; clipId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await run(() => deleteMeetingClip(deps, actor, { workspaceId, meetingId: id, clipId }));
    return successEnvelope({ deleted: true }, request.id);
  });

  app.post("/meetings/:id/comments", { schema: { params: ID_PARAMS, body: body(["text"], { text: { type: "string", minLength: 1, maxLength: 2000 }, atMs: { type: "integer", minimum: 0 } }) }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; text: string; atMs?: number };
    reply.status(201);
    return successEnvelope(await run(() => addMeetingComment(deps, actor, { ...input, meetingId: id })), request.id);
  });

  app.delete("/meetings/:id/comments/:commentId", { schema: { params: { type: "object", required: ["id", "commentId"], properties: { id: { type: "string" }, commentId: { type: "string" } } }, querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id, commentId } = request.params as { id: string; commentId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await run(() => deleteMeetingComment(deps, actor, { workspaceId, meetingId: id, commentId }));
    return successEnvelope({ deleted: true }, request.id);
  });

  // ── Palavras monitoradas ──
  app.get("/meetings/keyword-trackers", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await run(() => listKeywordTrackers(deps, actor, { workspaceId })), request.id);
  });

  app.get("/meetings/keyword-trackers/report", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { ...WS, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } } } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId, from, to } = request.query as { workspaceId: string; from?: string; to?: string };
    return successEnvelope(await run(() => keywordTrackerReport(deps, actor, { workspaceId, ...(from ? { from } : {}), ...(to ? { to } : {}) })), request.id);
  });

  const TRACKER_BODY = body(["label", "terms"], { label: { type: "string", minLength: 1, maxLength: 60 }, terms: { type: "array", minItems: 1, maxItems: 30, items: { type: "string", maxLength: 60 } } });
  app.post("/meetings/keyword-trackers", { schema: { body: TRACKER_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:manage_integrations");
    const input = request.body as { workspaceId: string; label: string; terms: string[] };
    await ownWorkspace(actor, input.workspaceId);
    reply.status(201);
    return successEnvelope(await run(() => saveKeywordTracker(deps, actor, input)), request.id);
  });

  app.put("/meetings/keyword-trackers/:trackerId", { schema: { params: { type: "object", required: ["trackerId"], properties: { trackerId: { type: "string" } } }, body: TRACKER_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_integrations");
    const { trackerId } = request.params as { trackerId: string };
    const input = request.body as { workspaceId: string; label: string; terms: string[] };
    return successEnvelope(await run(() => saveKeywordTracker(deps, actor, { ...input, trackerId })), request.id);
  });

  app.delete("/meetings/keyword-trackers/:trackerId", { schema: { params: { type: "object", required: ["trackerId"], properties: { trackerId: { type: "string" } } }, querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_integrations");
    const { trackerId } = request.params as { trackerId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await run(() => deleteKeywordTracker(deps, actor, { workspaceId, trackerId }));
    return successEnvelope({ deleted: true }, request.id);
  });

  // ── Preferências e uso ──
  app.get("/meetings/preferences", async (request) => {
    const actor = actorOf(request, "meeting:read");
    return successEnvelope(await run(() => getMeetingPreferences(deps, actor)), request.id);
  });

  app.put("/meetings/preferences", {
    schema: { body: { type: "object", additionalProperties: false, properties: { autoRecordMode: { type: "string", enum: [...AUTO_RECORD_MODES] }, defaultTemplate: { type: "string", enum: [...MEETING_SUMMARY_TEMPLATES] }, consentNoticeEnabled: { type: "boolean" }, consentMessage: { type: "string", maxLength: 500 } } } },
    config: { readOnlyGuard: true },
  }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const input = request.body as { autoRecordMode?: AutoRecordMode; defaultTemplate?: string; consentNoticeEnabled?: boolean; consentMessage?: string };
    return successEnvelope(await run(() => updateMeetingPreferences(deps, actor, input)), request.id);
  });

  app.get("/meetings/usage", async (request) => {
    const actor = actorOf(request, "meeting:read");
    return successEnvelope(await run(() => getMeetingsUsage(deps, actor)), request.id);
  });

  // ── Transcrição nativa do Google Meet (sem robô) ──
  app.post("/meetings/:id/import-google-transcript", { schema: { params: ID_PARAMS, body: body([], {}) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    if (!deps.nativeImport) throw new AppError({ code: "MEETING_STORAGE_UNAVAILABLE", message: "A integração com o Google não está configurada neste servidor.", statusCode: 503, recoverable: true });
    const nativeImport = deps.nativeImport;
    return successEnvelope(await run(() => importNativeTranscriptForActor({ repository: deps.repository, insights: deps.insights, meet: nativeImport.meet, tokens: nativeImport.tokens, analysisEnabled: nativeImport.analysisEnabled, now: deps.now }, actor, { workspaceId, meetingId: id })), request.id);
  });

  // ── Zoom: conectar e importar gravações em nuvem ──
  const zoomUnavailable = () => new AppError({ code: "MEETING_STORAGE_UNAVAILABLE", message: "A integração com o Zoom não está configurada neste servidor.", statusCode: 503, recoverable: true });
  const zoomDeps = () => ({ ...deps, zoomAuth: deps.zoom!, zoom: deps.zoom!, maxUploadBytes: deps.maxUploadBytes ?? 500 * 1024 * 1024, analysisEnabled: deps.analysisEnabled ?? true });

  app.get("/meetings/zoom/status", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    if (!deps.zoom) return successEnvelope({ configured: false, connected: false }, request.id);
    return successEnvelope(await getZoomStatus({ zoomAuth: deps.zoom }, actor, { workspaceId }), request.id);
  });

  app.post("/meetings/zoom/connect", { schema: { body: body([], {}) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { workspaceId } = request.body as { workspaceId: string };
    if (!deps.zoom?.isConfigured()) throw zoomUnavailable();
    await ownWorkspace(actor, workspaceId);
    return successEnvelope(deps.zoom.begin({ tenantId: actor.tenantId, workspaceId, userId: actor.userId }), request.id);
  });

  app.post("/meetings/zoom/callback", { schema: { body: { type: "object", required: ["code", "state"], additionalProperties: false, properties: { code: { type: "string", minLength: 1, maxLength: 2000 }, state: { type: "string", minLength: 1, maxLength: 2000 } } } }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    if (!deps.zoom) throw zoomUnavailable();
    const { code, state } = request.body as { code: string; state: string };
    let ownerOfState: { tenantId: string; userId: string; workspaceId: string };
    try {
      ownerOfState = deps.zoom.verifyState(state);
    } catch (error) {
      throw new AppError({ code: "MEETING_INVALID_INPUT", message: error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, "") : "Autorização inválida.", statusCode: 400, recoverable: false });
    }
    // A autorização só vale para quem a iniciou.
    if (ownerOfState.tenantId !== actor.tenantId || ownerOfState.userId !== actor.userId) throw new NotFoundError("Autorização não encontrada.");
    const result = await deps.zoom.complete({ code, state });
    return successEnvelope({ connected: true, workspaceId: ownerOfState.workspaceId, ...result }, request.id);
  });

  app.post("/meetings/zoom/disconnect", { schema: { body: body([], {}) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.body as { workspaceId: string };
    if (!deps.zoom) throw zoomUnavailable();
    await deps.zoom.disconnect({ tenantId: actor.tenantId, workspaceId, userId: actor.userId });
    return successEnvelope({ disconnected: true }, request.id);
  });

  app.get("/meetings/zoom/recordings", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { ...WS, days: { type: "integer", minimum: 1, maximum: 90 } } } } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { workspaceId, days } = request.query as { workspaceId: string; days?: number };
    if (!deps.zoom) throw zoomUnavailable();
    return successEnvelope(await run(() => listZoomRecordings(zoomDeps(), actor, { workspaceId, ...(days ? { days } : {}) })), request.id);
  });

  app.post("/meetings/zoom/import", { schema: { body: body(["meetingUuid"], { meetingUuid: { type: "string", minLength: 1, maxLength: 200 } }) }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:create");
    const { workspaceId, meetingUuid } = request.body as { workspaceId: string; meetingUuid: string };
    if (!deps.zoom) throw zoomUnavailable();
    await ownWorkspace(actor, workspaceId);
    reply.status(201);
    return successEnvelope(await run(() => importZoomRecording(zoomDeps(), actor, { workspaceId, meetingUuid })), request.id);
  });

  // ── LGPD ──
  app.post("/meetings/:id/purge", { schema: { params: ID_PARAMS, body: body(["confirmTitle"], { confirmTitle: { type: "string", minLength: 1, maxLength: 200 } }) }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:delete");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; confirmTitle: string };
    await run(() => purgeMeetingPermanently(deps, actor, { ...input, meetingId: id }));
    return successEnvelope({ purged: true }, request.id);
  });
}

/** Link público da reunião (sem login). Fora de `/meetings` para não passar pelo guarda da solução. */
export async function registerPublicMeetingRoutes(app: FastifyInstance, deps: MeetingIntelligenceDeps): Promise<void> {
  app.get("/public/meetings/:token", {
    schema: { params: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 20, maxLength: 64 } } } },
  }, async (request) => {
    const { token } = request.params as { token: string };
    return successEnvelope(await run(() => getSharedMeeting(deps, { token })), request.id);
  });
}
