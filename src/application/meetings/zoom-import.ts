import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseZoomVtt } from "../../domain/meetings/zoom-transcript.js";
import { meetingUsagePeriod, type MeetingDetail } from "../../domain/meetings/meeting.model.js";
import type { MeetingInsightsRepositoryPort } from "../ports/meeting-insights-repository.port.js";
import { MeetingError, requireVisibleMeeting, type MeetingActor, type MeetingUseCaseDeps } from "./meeting-use-cases.js";

/**
 * Vorix Meetings — importar gravações EM NUVEM do Zoom (sem robô): a pessoa conecta o Zoom, vê as
 * gravações dos últimos dias e importa. O áudio vai para o storage privado (player) e, quando o
 * Zoom já gerou a transcrição (arquivo VTT, com o nome de quem falou), ela é usada direto — sem
 * transcrever de novo; senão, o áudio entra na transcrição normal do Vorix.
 */

export type ZoomRecordingFile = { id?: string; file_type?: string; file_extension?: string; file_size?: number; download_url?: string; recording_type?: string; status?: string };
export type ZoomCloudMeeting = { uuid: string; id?: number; topic?: string; start_time?: string; duration?: number; recording_files?: ZoomRecordingFile[] };

export type ZoomAuthPort = {
  isConfigured(): boolean;
  begin(owner: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string };
  verifyState(state: string): { tenantId: string; workspaceId: string; userId: string };
  complete(input: { state: string; code: string }): Promise<{ email?: string }>;
  status(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<{ configured: boolean; connected: boolean; email?: string }>;
  getAccessToken(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; message: string }>;
  disconnect(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<void>;
};

export type ZoomRecordingsPort = {
  listRecordings(input: { accessToken: string; from: string; to: string }): Promise<ZoomCloudMeeting[]>;
  getMeetingRecordings(input: { accessToken: string; meetingUuid: string }): Promise<ZoomCloudMeeting | undefined>;
  downloadToFile(input: { accessToken: string; downloadUrl: string; targetPath: string; maxBytes: number }): Promise<number>;
  downloadText(input: { accessToken: string; downloadUrl: string }): Promise<string>;
};

export type ZoomImportDeps = MeetingUseCaseDeps & {
  insights: MeetingInsightsRepositoryPort;
  zoomAuth: ZoomAuthPort;
  zoom: ZoomRecordingsPort;
  maxUploadBytes: number;
  analysisEnabled: boolean;
};

const owner = (actor: MeetingActor, workspaceId: string) => ({ tenantId: actor.tenantId, workspaceId, userId: actor.userId });

async function tokenFor(deps: ZoomImportDeps, actor: MeetingActor, workspaceId: string): Promise<string> {
  const token = await deps.zoomAuth.getAccessToken(owner(actor, workspaceId));
  if (!token.ok) throw new MeetingError("MEETING_INVALID_INPUT", token.message);
  return token.accessToken;
}

/** Melhor arquivo de áudio para transcrever/ouvir: só áudio (M4A) > vídeo (MP4). */
function pickMedia(files: readonly ZoomRecordingFile[]): ZoomRecordingFile | undefined {
  const ready = files.filter((file) => file.download_url && (file.status ?? "completed") === "completed");
  return ready.find((file) => file.file_type === "M4A") ?? ready.find((file) => file.file_type === "MP4" && file.recording_type?.includes("speaker")) ?? ready.find((file) => file.file_type === "MP4");
}

const pickTranscript = (files: readonly ZoomRecordingFile[]) => files.find((file) => file.file_type === "TRANSCRIPT" && file.download_url && (file.status ?? "completed") === "completed");

export async function getZoomStatus(deps: Pick<ZoomImportDeps, "zoomAuth">, actor: MeetingActor, input: { workspaceId: string }) {
  return deps.zoomAuth.status(owner(actor, input.workspaceId));
}

export async function listZoomRecordings(deps: ZoomImportDeps, actor: MeetingActor, input: { workspaceId: string; days?: number }): Promise<{ uuid: string; topic: string; startTime?: string; durationMinutes?: number; hasAudio: boolean; hasTranscript: boolean; importedMeetingId?: string }[]> {
  const accessToken = await tokenFor(deps, actor, input.workspaceId);
  const days = Math.min(Math.max(input.days ?? 30, 1), 90);
  const to = deps.now();
  const from = new Date(to.getTime() - days * 86_400_000);
  const meetings = await deps.zoom.listRecordings({ accessToken, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  const imported = await deps.insights.findExternalImports({ tenantId: actor.tenantId, provider: "zoom", externalIds: meetings.map((meeting) => meeting.uuid) });
  return meetings.map((meeting) => ({
    uuid: meeting.uuid,
    topic: meeting.topic?.trim() || "Reunião do Zoom",
    ...(meeting.start_time ? { startTime: meeting.start_time } : {}),
    ...(meeting.duration ? { durationMinutes: meeting.duration } : {}),
    hasAudio: Boolean(pickMedia(meeting.recording_files ?? [])),
    hasTranscript: Boolean(pickTranscript(meeting.recording_files ?? [])),
    ...(imported.get(meeting.uuid) ? { importedMeetingId: imported.get(meeting.uuid) } : {}),
  }));
}

export async function importZoomRecording(deps: ZoomImportDeps, actor: MeetingActor, input: { workspaceId: string; meetingUuid: string }): Promise<MeetingDetail> {
  if (!deps.media.isPrivateSigned()) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O armazenamento privado de gravações não está configurado neste servidor.");
  const already = (await deps.insights.findExternalImports({ tenantId: actor.tenantId, provider: "zoom", externalIds: [input.meetingUuid] })).get(input.meetingUuid);
  if (already) return requireVisibleMeeting(deps, actor, input.workspaceId, already);
  const accessToken = await tokenFor(deps, actor, input.workspaceId);
  const zoomMeeting = await deps.zoom.getMeetingRecordings({ accessToken, meetingUuid: input.meetingUuid });
  if (!zoomMeeting) throw new MeetingError("MEETING_NOT_FOUND", "Gravação não encontrada no Zoom (pode ter sido apagada).");
  const media = pickMedia(zoomMeeting.recording_files ?? []);
  if (!media?.download_url) throw new MeetingError("MEETING_INVALID_INPUT", "Esta gravação do Zoom ainda não tem áudio disponível. Tente de novo em alguns minutos.");
  const limits = await deps.limitsFor(actor.tenantId);
  const inUse = await deps.repository.storageBytesInUse(actor.tenantId);
  if (media.file_size && inUse + media.file_size > limits.maxStorageBytes) throw new MeetingError("MEETING_STORAGE_LIMIT_REACHED", "O armazenamento de gravações do seu plano está cheio.");

  const dir = await mkdtemp(join(tmpdir(), "vorix-zoom-"));
  try {
    const extension = media.file_type === "M4A" ? "m4a" : "mp4";
    const mimeType = media.file_type === "M4A" ? "audio/mp4" : "video/mp4";
    const filePath = join(dir, `zoom.${extension}`);
    const bytes = await deps.zoom.downloadToFile({ accessToken, downloadUrl: media.download_url, targetPath: filePath, maxBytes: deps.maxUploadBytes });
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
    const sha256 = hash.digest("hex");
    const transcriptFile = pickTranscript(zoomMeeting.recording_files ?? []);
    const zoomSegments = transcriptFile?.download_url ? parseZoomVtt(await deps.zoom.downloadText({ accessToken, downloadUrl: transcriptFile.download_url }).catch(() => "")) : [];

    const now = deps.now();
    const meeting = await deps.repository.create({
      id: deps.idGenerator("meeting"),
      tenantId: actor.tenantId,
      workspaceId: input.workspaceId,
      ownerUserId: actor.userId,
      createdByUserId: actor.userId,
      title: (zoomMeeting.topic?.trim() || "Reunião do Zoom").slice(0, 200),
      source: "upload",
      status: "scheduled",
      ...(zoomMeeting.start_time ? { scheduledStartAt: zoomMeeting.start_time } : {}),
      ...(zoomMeeting.start_time && zoomMeeting.duration ? { scheduledEndAt: new Date(Date.parse(zoomMeeting.start_time) + zoomMeeting.duration * 60_000).toISOString() } : {}),
      timezone: "America/Sao_Paulo",
      autoRecord: false,
      participants: [],
    });
    await deps.insights.recordExternalImport({ tenantId: actor.tenantId, provider: "zoom", externalId: input.meetingUuid, meetingId: meeting.id });
    const storageKey = `meetings/${actor.tenantId}/${input.workspaceId}/${meeting.id}/zoom-${deps.idGenerator("rec")}.${extension}`;
    await deps.media.putFile({ key: storageKey, filePath, contentType: mimeType });
    const recording = await deps.repository.addRecording({ id: deps.idGenerator("mrec"), meetingId: meeting.id, tenantId: actor.tenantId, workspaceId: input.workspaceId, kind: "original", storageKey, mimeType, bytes, checksumSha256: sha256, originalFileName: `zoom-${input.meetingUuid.slice(0, 40)}.${extension}` });
    await deps.repository.transition({ tenantId: actor.tenantId, meetingId: meeting.id, to: "processing" });
    if (zoomSegments.length) {
      // O Zoom já transcreveu (com nomes): usa direto e vai para o resumo.
      const durationSeconds = Math.round(Math.max(...zoomSegments.map((segment) => segment.endMs)) / 1000);
      await deps.repository.saveTranscript({ tenantId: actor.tenantId, meetingId: meeting.id, recordingId: recording.id, result: { language: "pt", engine: "zoom", model: "zoom-cloud-transcript", durationSeconds, processingMs: 0, segments: zoomSegments, metrics: { source: "zoom_cloud_transcript" } } });
      await deps.repository.setRecordingDuration({ tenantId: actor.tenantId, recordingId: recording.id, meetingId: meeting.id, durationSeconds });
      if (deps.analysisEnabled) {
        await deps.repository.transition({ tenantId: actor.tenantId, meetingId: meeting.id, to: "analyzing" });
        await deps.repository.enqueueAnalysis({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
      } else {
        await deps.repository.transition({ tenantId: actor.tenantId, meetingId: meeting.id, to: "completed" });
      }
    } else {
      await deps.repository.enqueueTranscription({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, recordingId: recording.id });
    }
    await deps.repository.recordUsage({ tenantId: actor.tenantId, period: meetingUsagePeriod(now), delta: { storageBytes: bytes } });
    await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.imported_zoom", details: { bytes, zoomTranscript: zoomSegments.length > 0 } });
    return requireVisibleMeeting(deps, actor, input.workspaceId, meeting.id);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
