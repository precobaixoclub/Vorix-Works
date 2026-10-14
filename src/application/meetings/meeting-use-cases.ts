import {
  isSupportedMeetingUpload,
  meetingUsagePeriod,
  parseGoogleMeetUrl,
  resolveMeetingsLimits,
  type MeetingDetail,
  type MeetingListItem,
  type MeetingSource,
  type MeetingStatus,
  type MeetingsLimits,
  type MeetingTranscriptSegment,
} from "../../domain/meetings/meeting.model.js";
import { hasPermission, type TenantRole } from "../../domain/identity/identity.model.js";
import type { MeetingDashboard, MeetingRepositoryPort } from "../ports/meeting-repository.port.js";

/**
 * Casos de uso do Vorix Meetings (Fase 1/2: reunião first-class, Central, upload, admissão de
 * gravação). Nada aqui depende do Vorix Conversas.
 */

/** Storage PRIVADO das gravações: só chave + URL assinada curta no momento do uso. */
export type MeetingMediaStoragePort = {
  /** `false` quando o storage configurado não garante leitura privada por URL assinada — então o
   * upload é recusado (nunca gravar reunião num lugar público). */
  isPrivateSigned(): boolean;
  putFile(input: { key: string; filePath: string; contentType: string }): Promise<void>;
  signedReadUrl(key: string, ttlSeconds: number): string | undefined;
  /** Download em streaming para um arquivo local (worker). */
  downloadToFile(key: string, destinationPath: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Gates de release do Meetings (além do entitlement da solução, que o guarda da API já checou). */
export type MeetingsFeatures = {
  /** Gravação real por bot (MEETINGS_REAL_RECORDING_ENABLED). Desligado = "Gravar agora" cria a
   * reunião mas recusa a gravação com motivo explícito — nunca finge gravar. */
  realRecordingEnabled: boolean;
};

export type MeetingUseCaseDeps = {
  repository: MeetingRepositoryPort;
  media: MeetingMediaStoragePort;
  /** Limites comerciais do entitlement `meetings` do tenant (`solution_entitlements.limits`). */
  limitsFor: (tenantId: string) => Promise<MeetingsLimits>;
  features: MeetingsFeatures;
  idGenerator: (prefix: string) => string;
  now: () => Date;
};

export type MeetingActor = { tenantId: string; userId: string; role: TenantRole };

/** Validade da URL de reprodução: curta; o player renova pedindo outra. */
export const MEETING_PLAYBACK_URL_TTL_SECONDS = 15 * 60;

export class MeetingError extends Error {
  constructor(readonly code: "MEETING_NOT_FOUND" | "MEETING_INVALID_INPUT" | "MEETING_UNSUPPORTED_MEDIA" | "MEETING_STORAGE_UNAVAILABLE" | "MEETING_STORAGE_LIMIT_REACHED" | "MEETING_ACTIVE_CANNOT_DELETE", message: string) {
    super(`${code}: ${message}`);
  }
}

function visibilityOf(actor: MeetingActor): string | undefined {
  return hasPermission(actor.role, "meeting:read_all") ? undefined : actor.userId;
}

async function requireVisibleMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, workspaceId: string, meetingId: string): Promise<MeetingDetail> {
  const meeting = await deps.repository.getDetail({ tenantId: actor.tenantId, workspaceId, meetingId });
  const visibleTo = visibilityOf(actor);
  const visible = meeting && (!visibleTo || meeting.ownerUserId === visibleTo || meeting.createdByUserId === visibleTo || meeting.participants.some((participant) => participant.userId === visibleTo));
  if (!meeting || !visible) throw new MeetingError("MEETING_NOT_FOUND", "Reunião não encontrada.");
  return meeting;
}

export type CreateMeetingInput = {
  workspaceId: string;
  title?: string;
  description?: string;
  source: Extract<MeetingSource, "manual" | "external_link" | "instant">;
  meetingUrl?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  timezone?: string;
  participants?: { name?: string; email?: string }[];
};

export async function createMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: CreateMeetingInput): Promise<MeetingDetail> {
  const meetingUrl = input.meetingUrl?.trim() ? parseGoogleMeetUrl(input.meetingUrl) : undefined;
  if (input.meetingUrl?.trim() && !meetingUrl) throw new MeetingError("MEETING_INVALID_INPUT", "Informe um link válido do Google Meet (https://meet.google.com/abc-defg-hij).");
  if ((input.source === "external_link" || input.source === "instant") && !meetingUrl) {
    throw new MeetingError("MEETING_INVALID_INPUT", "Esta reunião precisa do link do Google Meet.");
  }
  if (input.scheduledStartAt && input.scheduledEndAt && Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)) {
    throw new MeetingError("MEETING_INVALID_INPUT", "O fim da reunião precisa ser depois do início.");
  }
  const participants = (input.participants ?? [])
    .map((participant) => ({ name: participant.name?.trim() || undefined, email: participant.email?.trim().toLowerCase() || undefined }))
    .filter((participant) => participant.name || participant.email);
  if (participants.some((participant) => participant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email))) {
    throw new MeetingError("MEETING_INVALID_INPUT", "Há um e-mail de participante inválido.");
  }
  const now = deps.now();
  return deps.repository.create({
    id: deps.idGenerator("meeting"),
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    ownerUserId: actor.userId,
    createdByUserId: actor.userId,
    title: input.title?.trim() || defaultTitle(input.source, now),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    source: input.source,
    status: "scheduled",
    ...(meetingUrl ? { meetingUrl } : {}),
    scheduledStartAt: input.scheduledStartAt ?? (input.source === "instant" ? now.toISOString() : undefined),
    ...(input.scheduledEndAt ? { scheduledEndAt: input.scheduledEndAt } : {}),
    timezone: input.timezone?.trim() || "America/Sao_Paulo",
    autoRecord: false,
    participants: participants.map((participant) => ({ ...participant, role: "attendee" as const })),
  });
}

function defaultTitle(source: MeetingSource, now: Date): string {
  const when = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (source === "upload") return `Gravação enviada em ${when}`;
  return `Reunião de ${when}`;
}

export type RecordingRequestResult =
  | { ok: true; status: MeetingStatus; botAccountId: string; jobId: string }
  | { ok: false; reason: "RECORDING_DISABLED" | "MISSING_MEETING_URL" | "CONCURRENCY_LIMIT_REACHED" | "NO_BOT_AVAILABLE" | "INVALID_STATE"; message: string; limit?: number; activeRecordings?: number };

/**
 * Pede a gravação de uma reunião (manual ou "Gravar agora"). Admissão atômica: limite de
 * gravações simultâneas do plano + reserva de um bot livre. Nunca inicia "silenciosamente" acima
 * do limite — devolve o motivo explícito e audita.
 */
export async function requestRecording(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<RecordingRequestResult> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  if (!deps.features.realRecordingEnabled) {
    await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.refused", details: { reason: "RECORDING_DISABLED" } });
    return { ok: false, reason: "RECORDING_DISABLED", message: "A gravação automática por bot ainda não está habilitada neste ambiente. A reunião foi salva." };
  }
  if (!meeting.meetingUrl) return { ok: false, reason: "MISSING_MEETING_URL", message: "Informe o link do Google Meet para gravar." };

  const limits = await deps.limitsFor(actor.tenantId);
  const admission = await deps.repository.admitRecording({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    meetingId: meeting.id,
    maxConcurrentRecordings: limits.maxConcurrentRecordings,
    now: deps.now(),
  });
  if (admission.ok) {
    await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.admitted", details: { botAccountId: admission.botAccountId, activeRecordings: admission.activeRecordings } });
    return { ok: true, status: "queued", botAccountId: admission.botAccountId, jobId: admission.jobId };
  }
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.refused", details: { ...admission } });
  if (admission.reason === "CONCURRENCY_LIMIT_REACHED") {
    return { ok: false, reason: admission.reason, limit: admission.limit, activeRecordings: admission.activeRecordings, message: `Seu plano permite ${admission.limit} gravação(ões) simultânea(s) e todas estão em uso agora.` };
  }
  if (admission.reason === "NO_BOT_AVAILABLE") {
    return { ok: false, reason: admission.reason, activeRecordings: admission.activeRecordings, message: "Nenhum gravador disponível no momento. Tente novamente em instantes." };
  }
  return { ok: false, reason: "INVALID_STATE", message: `Esta reunião não pode iniciar gravação no estado atual (${admission.status}).` };
}

export async function stopMeetingRecording(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<{ stopRequested: true }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const requested = await deps.repository.requestRecordingStop({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId });
  if (!requested) throw new MeetingError("MEETING_INVALID_INPUT", "Esta reuniao nao possui uma gravacao ativa para encerrar.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.stop_requested" });
  return { stopRequested: true };
}

export async function listMeetings(
  deps: MeetingUseCaseDeps,
  actor: MeetingActor,
  input: { workspaceId: string; ownerUserId?: string; status?: MeetingStatus; source?: MeetingSource; from?: string; to?: string; hasRecording?: boolean; hasTranscript?: boolean; query?: string; limit?: number; offset?: number },
): Promise<{ items: MeetingListItem[]; total: number }> {
  return deps.repository.list({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    visibleToUserId: visibilityOf(actor),
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.hasRecording !== undefined ? { hasRecording: input.hasRecording } : {}),
    ...(input.hasTranscript !== undefined ? { hasTranscript: input.hasTranscript } : {}),
    ...(input.query?.trim() ? { query: input.query.trim().slice(0, 200) } : {}),
    limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
    offset: Math.max(input.offset ?? 0, 0),
  });
}

export async function getMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<MeetingDetail> {
  return requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
}

export async function updateMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; title?: string; description?: string | null }): Promise<MeetingDetail> {
  await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  if (input.title !== undefined && !input.title.trim()) throw new MeetingError("MEETING_INVALID_INPUT", "O título não pode ficar vazio.");
  await deps.repository.update({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    patch: { ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}) },
  });
  return requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
}

/** Exclusão lógica (nunca hard delete). Reunião com bot ativo precisa ser cancelada antes. */
export async function deleteMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<void> {
  await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const deleted = await deps.repository.softDelete({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, actorUserId: actor.userId });
  if (!deleted) throw new MeetingError("MEETING_ACTIVE_CANNOT_DELETE", "Esta reunião está sendo gravada agora — encerre a gravação antes de excluir.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, actorUserId: actor.userId, action: "meeting.deleted" });
}

export type UploadedMeetingFile = { tempFilePath: string; fileName: string; mimeType: string; bytes: number; sha256: string };

/**
 * Upload manual de gravação: vira uma reunião (`source: upload`) que aparece na Central como
 * qualquer outra, já com a transcrição enfileirada. Formatos aceitos: `MEETING_UPLOAD_MIME_TYPES`.
 */
export async function uploadMeetingRecording(
  deps: MeetingUseCaseDeps,
  actor: MeetingActor,
  input: { workspaceId: string; title?: string; file: UploadedMeetingFile },
): Promise<MeetingDetail> {
  if (!deps.media.isPrivateSigned()) {
    throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O armazenamento privado de gravações não está configurado neste servidor.");
  }
  if (!isSupportedMeetingUpload(input.file.mimeType, input.file.fileName)) {
    throw new MeetingError("MEETING_UNSUPPORTED_MEDIA", "Formato não suportado. Envie MP3, M4A, WAV, WEBM, OGG, MP4 ou MOV.");
  }
  if (input.file.bytes <= 0) throw new MeetingError("MEETING_INVALID_INPUT", "O arquivo está vazio.");
  const limits = await deps.limitsFor(actor.tenantId);
  const inUse = await deps.repository.storageBytesInUse(actor.tenantId);
  if (inUse + input.file.bytes > limits.maxStorageBytes) {
    throw new MeetingError("MEETING_STORAGE_LIMIT_REACHED", "O armazenamento de gravações do seu plano está cheio.");
  }

  const now = deps.now();
  const meeting = await deps.repository.create({
    id: deps.idGenerator("meeting"),
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    ownerUserId: actor.userId,
    createdByUserId: actor.userId,
    title: input.title?.trim() || defaultTitle("upload", now),
    source: "upload",
    status: "scheduled",
    timezone: "America/Sao_Paulo",
    autoRecord: false,
    participants: [],
  });
  const extension = input.file.fileName.toLowerCase().split(".").pop();
  const storageKey = `meetings/${actor.tenantId}/${input.workspaceId}/${meeting.id}/original-${deps.idGenerator("rec")}.${extension}`;
  await deps.media.putFile({ key: storageKey, filePath: input.file.tempFilePath, contentType: input.file.mimeType });
  const recording = await deps.repository.addRecording({
    id: deps.idGenerator("mrec"),
    meetingId: meeting.id,
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    kind: "original",
    storageKey,
    mimeType: input.file.mimeType,
    bytes: input.file.bytes,
    checksumSha256: input.file.sha256,
    originalFileName: input.file.fileName.slice(0, 255),
  });
  await deps.repository.transition({ tenantId: actor.tenantId, meetingId: meeting.id, to: "processing" });
  await deps.repository.enqueueTranscription({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  await deps.repository.recordUsage({ tenantId: actor.tenantId, period: meetingUsagePeriod(now), delta: { storageBytes: input.file.bytes } });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "recording.uploaded", details: { bytes: input.file.bytes, mimeType: input.file.mimeType } });
  return requireVisibleMeeting(deps, actor, input.workspaceId, meeting.id);
}

/** URL assinada curta para reproduzir UMA gravação — acesso sensível, sempre auditado. */
export async function getRecordingPlaybackUrl(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; recordingId: string }): Promise<{ url: string; mimeType: string; expiresInSeconds: number }> {
  await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const recording = await deps.repository.getRecording({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, recordingId: input.recordingId });
  if (!recording || recording.status !== "available") throw new MeetingError("MEETING_NOT_FOUND", "Gravação não encontrada.");
  const url = deps.media.signedReadUrl(recording.storageKey, MEETING_PLAYBACK_URL_TTL_SECONDS);
  if (!url) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O armazenamento privado de gravações não está configurado neste servidor.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, actorUserId: actor.userId, action: "recording.accessed", details: { recordingId: recording.id } });
  return { url, mimeType: recording.mimeType, expiresInSeconds: MEETING_PLAYBACK_URL_TTL_SECONDS };
}

export async function getMeetingTranscript(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<{ segments: MeetingTranscriptSegment[] }> {
  await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  return { segments: await deps.repository.getTranscriptSegments({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId }) };
}

/** Home do Meetings. Dia/semana no fuso de São Paulo (fuso do produto; sem horário de verão). */
export async function getMeetingsDashboard(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string }): Promise<MeetingDashboard & { limits: MeetingsLimits; realRecordingEnabled: boolean }> {
  const now = deps.now();
  const offsetMs = -3 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const todayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekday = (local.getUTCDay() + 6) % 7;
  const weekStart = new Date(todayStart.getTime() - weekday * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dashboard = await deps.repository.dashboard({ tenantId: actor.tenantId, workspaceId: input.workspaceId, visibleToUserId: visibilityOf(actor), todayStart, todayEnd, weekStart, weekEnd });
  return { ...dashboard, limits: await deps.limitsFor(actor.tenantId), realRecordingEnabled: deps.features.realRecordingEnabled };
}

export function limitsFromEntitlement(raw: Readonly<Record<string, number>> | undefined): MeetingsLimits {
  return resolveMeetingsLimits(raw);
}

// ---------------------------------------------------------------------------------------------
// Reprocessamento (rodada 2) — sempre por ação explícita, com RBAC na rota.
// ---------------------------------------------------------------------------------------------

/** Retranscrever: novo job para a gravação mais recente. Idempotente enquanto houver um ativo, e o
 * resultado SUBSTITUI os segmentos (não duplica). */
export async function retranscribeMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const recording = await deps.repository.latestRecording({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
  if (!recording) throw new MeetingError("MEETING_INVALID_INPUT", "Esta reunião não tem gravação disponível para transcrever.");
  const queued = await deps.repository.enqueueTranscription({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  if (!queued.alreadyActive) {
    await deps.repository.reopenForReprocessing({ tenantId: actor.tenantId, meetingId: meeting.id, status: "processing" });
    await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "transcript.requeued", details: { recordingId: recording.id } });
  }
  return { jobId: queued.jobId, alreadyQueued: queued.alreadyActive };
}

/** Reanalisar: nova análise por IA — consome crédito de novo quando executar de verdade. A análise
 * anterior continua visível até a nova terminar. */
export async function reanalyzeMeeting(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  if (meeting.transcript?.status !== "completed") throw new MeetingError("MEETING_INVALID_INPUT", "A transcrição precisa estar pronta para gerar a análise.");
  const queued = await deps.repository.enqueueAnalysis({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
  if (!queued.alreadyActive) {
    await deps.repository.reopenForReprocessing({ tenantId: actor.tenantId, meetingId: meeting.id, status: "analyzing" });
    await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "analysis.requeued" });
  }
  return { jobId: queued.jobId, alreadyQueued: queued.alreadyActive };
}

/** Confirmar/descartar um item sugerido pela IA. Confirmar só registra a decisão humana — nada vira
 * tarefa operacional automaticamente. */
export async function decideMeetingActionItem(deps: MeetingUseCaseDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; itemId: string; status: "confirmed" | "dismissed" }) {
  await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const item = await deps.repository.decideActionItem({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, itemId: input.itemId, status: input.status, actorUserId: actor.userId });
  if (!item) throw new MeetingError("MEETING_NOT_FOUND", "Item não encontrado.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, actorUserId: actor.userId, action: `action_item.${input.status}`, details: { itemId: item.id, type: item.type } });
  return item;
}
