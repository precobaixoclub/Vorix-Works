import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createMeeting,
  decideMeetingActionItem,
  deleteMeeting,
  reanalyzeMeeting,
  retranscribeMeeting,
  getMeeting,
  getRecorderEligibility,
  setMeetingHumanIdentity,
  getMeetingsDashboard,
  getMeetingTranscript,
  getRecordingPlaybackUrl,
  listMeetings,
  MeetingError,
  requestRecording,
  stopMeetingRecording,
  updateMeeting,
  uploadMeetingRecording,
  type MeetingActor,
  type MeetingUseCaseDeps,
} from "../../../../application/meetings/meeting-use-cases.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { MEETING_SOURCES, MEETING_STATUSES, type MeetingSource, type MeetingStatus } from "../../../../domain/meetings/meeting.model.js";
import { AppError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

/**
 * Vorix Meetings — API da Central de Reuniões. Tudo sob `/v1/meetings`: o guarda de solução
 * (`solution-access.middleware.ts`) já barrou quem não tem a solução `meetings` antes daqui; cada
 * rota ainda aplica o RBAC próprio do Meetings (`meeting:*`) e o escopo tenant+workspace.
 */
export type MeetingRoutesDeps = MeetingUseCaseDeps & {
  workspaceRepository: WorkspaceRepositoryPort;
  /** Teto do upload manual de gravação (MEETINGS_MAX_UPLOAD_BYTES). */
  maxUploadBytes: number;
};

const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const RECORDING_PARAMS = { type: "object", required: ["id", "recordingId"], properties: { id: { type: "string", minLength: 1 }, recordingId: { type: "string", minLength: 1 } } } as const;
const LIST_QUERY = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    ownerUserId: { type: "string" },
    status: { type: "string", enum: [...MEETING_STATUSES] },
    source: { type: "string", enum: [...MEETING_SOURCES] },
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    hasRecording: { type: "string", enum: ["true", "false"] },
    hasTranscript: { type: "string", enum: ["true", "false"] },
    q: { type: "string", maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;
const PARTICIPANTS = {
  type: "array",
  maxItems: 100,
  items: { type: "object", additionalProperties: false, properties: { name: { type: "string", maxLength: 120 }, email: { type: "string", maxLength: 254 } } },
} as const;
const CREATE_BODY = {
  type: "object",
  required: ["workspaceId", "source"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    source: { type: "string", enum: ["manual", "external_link", "instant"] },
    title: { type: "string", maxLength: 200 },
    description: { type: "string", maxLength: 5000 },
    meetingUrl: { type: "string", maxLength: 500 },
    scheduledStartAt: { type: "string", format: "date-time" },
    scheduledEndAt: { type: "string", format: "date-time" },
    timezone: { type: "string", maxLength: 64 },
    participants: PARTICIPANTS,
    /** "Gravar agora": cria a reunião e já pede a gravação (admissão no mesmo request). */
    recordNow: { type: "boolean" },
    /** Conta Google com que a PESSOA entrará na reunião (nunca será a conta de gravação). */
    humanJoinAccountEmail: { type: "string", maxLength: 254 },
  },
} as const;
const RECORD_BODY = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, humanJoinAccountEmail: { type: "string", maxLength: 254 } },
} as const;
const IDENTITY_BODY = {
  type: "object",
  required: ["workspaceId", "humanJoinAccountEmail"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, humanJoinAccountEmail: { type: "string", minLength: 3, maxLength: 254 } },
} as const;
const UPDATE_BODY = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, title: { type: "string", maxLength: 200 }, description: { type: ["string", "null"], maxLength: 5000 } },
} as const;

function actorOf(request: FastifyRequest, permission: Parameters<typeof requirePermission>[1]): MeetingActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions };
}

function translate(error: unknown): never {
  if (error instanceof MeetingError) {
    if (error.code === "MEETING_NOT_FOUND") throw new NotFoundError(error.message.slice(error.code.length + 1).trim());
    const status = error.code === "MEETING_INVALID_INPUT" ? 400 : error.code === "MEETING_UNSUPPORTED_MEDIA" ? 415 : error.code === "MEETING_STORAGE_UNAVAILABLE" ? 503 : 409;
    throw new AppError({ code: error.code, message: error.message.slice(error.code.length + 1).trim(), statusCode: status, recoverable: status !== 400 && status !== 415 });
  }
  throw error;
}

export async function registerMeetingRoutes(app: FastifyInstance, deps: MeetingRoutesDeps): Promise<void> {
  app.get("/meetings/dashboard", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await getMeetingsDashboard(deps, actor, { workspaceId }), request.id);
  });

  app.get("/meetings", { schema: { querystring: LIST_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const query = request.query as { workspaceId: string; ownerUserId?: string; status?: MeetingStatus; source?: MeetingSource; from?: string; to?: string; hasRecording?: "true" | "false"; hasTranscript?: "true" | "false"; q?: string; limit?: number; offset?: number };
    const result = await listMeetings(deps, actor, {
      ...query,
      ...(query.hasRecording ? { hasRecording: query.hasRecording === "true" } : {}),
      ...(query.hasTranscript ? { hasTranscript: query.hasTranscript === "true" } : {}),
      ...(query.q ? { query: query.q } : {}),
    } as never);
    return successEnvelope(result, request.id);
  });

  app.post("/meetings", { schema: { body: CREATE_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:create");
    const body = request.body as Parameters<typeof createMeeting>[2] & { recordNow?: boolean };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId: body.workspaceId });
    try {
      const { recordNow, ...input } = body;
      const meeting = await createMeeting(deps, actor, input);
      // A reunião existe a partir daqui, aconteça o que acontecer com a gravação.
      const recording = recordNow ? await requestRecording(deps, actorOf(request, "meeting:record"), { workspaceId: body.workspaceId, meetingId: meeting.id, ...(body.humanJoinAccountEmail ? { humanJoinAccountEmail: body.humanJoinAccountEmail } : {}) }) : undefined;
      reply.code(201);
      return successEnvelope({ meeting: recording?.ok ? await getMeeting(deps, actor, { workspaceId: body.workspaceId, meetingId: meeting.id }) : meeting, ...(recording ? { recording } : {}) }, request.id);
    } catch (error) {
      translate(error);
    }
  });

  /**
   * Upload manual de gravação (multipart). Os campos `workspaceId` (obrigatório) e `title`
   * (opcional) vêm ANTES do campo de arquivo. O arquivo é gravado em streaming num temporário
   * (sha256 e tamanho calculados no caminho) e só então vai para o storage privado — uma gravação
   * de centenas de MB nunca fica inteira na memória da API.
   */
  app.post("/meetings/uploads", { config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:create");
    const file = await request.file({ limits: { fileSize: deps.maxUploadBytes } });
    if (!file) throw new ValidationError("Envie o arquivo da gravação no campo multipart.");
    const field = (name: string) => {
      const value = (file.fields as Record<string, { value?: unknown } | undefined>)[name];
      return typeof value?.value === "string" ? value.value : undefined;
    };
    const workspaceId = field("workspaceId");
    if (!workspaceId) {
      file.file.resume();
      throw new ValidationError("Informe o workspaceId antes do arquivo.");
    }
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });

    const dir = await mkdtemp(join(tmpdir(), "vorix-meeting-upload-"));
    const tempFilePath = join(dir, randomUUID());
    try {
      const hash = createHash("sha256");
      let bytes = 0;
      await pipeline(
        file.file,
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            bytes += chunk.length;
            callback(null, chunk);
          },
        }),
        createWriteStream(tempFilePath),
      );
      if (file.file.truncated) {
        throw new AppError({ code: "MEETING_UPLOAD_TOO_LARGE", message: `A gravação passa do limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)} MB.`, statusCode: 413, recoverable: false });
      }
      const meeting = await uploadMeetingRecording(deps, actor, {
        workspaceId,
        ...(field("title") ? { title: field("title") } : {}),
        file: { tempFilePath, fileName: file.filename, mimeType: file.mimetype, bytes, sha256: hash.digest("hex") },
      });
      reply.code(201);
      return successEnvelope(meeting, request.id);
    } catch (error) {
      translate(error);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  app.get("/meetings/:id", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      return successEnvelope(await getMeeting(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.patch("/meetings/:id", { schema: { params: ID_PARAMS, body: UPDATE_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:create");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string; title?: string; description?: string | null };
    try {
      return successEnvelope(await updateMeeting(deps, actor, { workspaceId, meetingId: id, ...patch }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.delete("/meetings/:id", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:delete");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteMeeting(deps, actor, { workspaceId, meetingId: id });
      return successEnvelope({ deleted: true }, request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.post("/meetings/:id/recording", { schema: { params: ID_PARAMS, body: RECORD_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:record");
    const { id } = request.params as { id: string };
    const { workspaceId, humanJoinAccountEmail } = request.body as { workspaceId: string; humanJoinAccountEmail?: string };
    try {
      return successEnvelope(await requestRecording(deps, actor, { workspaceId, meetingId: id, ...(humanJoinAccountEmail ? { humanJoinAccountEmail } : {}) }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  /** Validação antecipada (agendamento): há conta de gravação que sirva para esta reunião? */
  app.get("/meetings/:id/recorder-eligibility", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      return successEnvelope(await getRecorderEligibility(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  /** Corrigir a conta Google com que a pessoa entrará na reunião (antes da gravação começar). */
  app.put("/meetings/:id/human-identity", { schema: { params: ID_PARAMS, body: IDENTITY_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:record");
    const { id } = request.params as { id: string };
    const { workspaceId, humanJoinAccountEmail } = request.body as { workspaceId: string; humanJoinAccountEmail: string };
    try {
      return successEnvelope(await setMeetingHumanIdentity(deps, actor, { workspaceId, meetingId: id, humanJoinAccountEmail }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.post("/meetings/:id/recording/stop", { schema: { params: ID_PARAMS, body: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:record");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      return successEnvelope(await stopMeetingRecording(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.get("/meetings/:id/recordings/:recordingId/playback", { schema: { params: RECORDING_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id, recordingId } = request.params as { id: string; recordingId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      return successEnvelope(await getRecordingPlaybackUrl(deps, actor, { workspaceId, meetingId: id, recordingId }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  // Reprocessamento: explícito, com RBAC (`meeting:analyze` = editor/admin/owner).
  app.post("/meetings/:id/retranscribe", { schema: { params: ID_PARAMS, body: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:analyze");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      return successEnvelope(await retranscribeMeeting(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.post("/meetings/:id/reanalyze", { schema: { params: ID_PARAMS, body: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:analyze");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      return successEnvelope(await reanalyzeMeeting(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });

  app.patch(
    "/meetings/:id/action-items/:itemId",
    {
      schema: {
        params: { type: "object", required: ["id", "itemId"], properties: { id: { type: "string", minLength: 1 }, itemId: { type: "string", minLength: 1 } } },
        body: { type: "object", required: ["workspaceId", "status"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, status: { type: "string", enum: ["confirmed", "dismissed"] } } },
      },
      config: { readOnlyGuard: true },
    },
    async (request) => {
      const actor = actorOf(request, "meeting:analyze");
      const { id, itemId } = request.params as { id: string; itemId: string };
      const { workspaceId, status } = request.body as { workspaceId: string; status: "confirmed" | "dismissed" };
      try {
        return successEnvelope(await decideMeetingActionItem(deps, actor, { workspaceId, meetingId: id, itemId, status }), request.id);
      } catch (error) {
        translate(error);
      }
    },
  );

  app.get("/meetings/:id/transcript", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      return successEnvelope(await getMeetingTranscript(deps, actor, { workspaceId, meetingId: id }), request.id);
    } catch (error) {
      translate(error);
    }
  });
}
