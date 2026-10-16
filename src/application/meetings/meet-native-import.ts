import { parseGoogleMeetUrl } from "../../domain/meetings/meeting.model.js";
import type { MeetingRepositoryPort } from "../ports/meeting-repository.port.js";
import type { MeetingInsightsRepositoryPort } from "../ports/meeting-insights-repository.port.js";
import { MeetingError, requireVisibleMeeting, type MeetingActor, type MeetingUseCaseDeps } from "./meeting-use-cases.js";

/**
 * Vorix Meetings — importar a TRANSCRIÇÃO NATIVA do Google Meet (sem robô). Quando a reunião tem a
 * transcrição do Meet ligada (Google Workspace), o Google já entrega o texto com quem falou: o Vorix
 * lê pela API oficial (escopo `meetings.space.readonly` do Google do responsável) e segue para o
 * mesmo resumo por IA. Não depende da conta de gravação — é a alternativa ao bot.
 */

export type GoogleMeetNativeTranscript = {
  conferenceRecord: string;
  transcriptName: string;
  startedAt: string;
  endedAt?: string;
  language: string;
  entries: { startMs: number; endMs: number; text: string; speaker?: string }[];
};

export type GoogleMeetTranscriptPort = {
  findTranscript(input: { accessToken: string; meetingCode: string; notBefore?: string }): Promise<GoogleMeetNativeTranscript | { unavailable: "no_access" | "not_found" | "not_ready"; message: string }>;
};

export type GoogleAccessTokenPort = {
  getAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; message: string }>;
};

export type MeetNativeImportDeps = {
  repository: MeetingRepositoryPort;
  insights: MeetingInsightsRepositoryPort;
  meet: GoogleMeetTranscriptPort;
  tokens: GoogleAccessTokenPort;
  /** `false` = transcrição importada não gera resumo (IA desligada no ambiente). */
  analysisEnabled: boolean;
  now: () => Date;
};

export type NativeImportOutcome = { status: "imported"; segments: number } | { status: "no_access" | "not_found" | "not_ready" | "not_connected" | "not_eligible"; message: string };

/** Núcleo da importação (usado pela ação manual e pelo agendador). */
export async function importNativeTranscript(deps: MeetNativeImportDeps, input: { tenantId: string; workspaceId: string; meetingId: string; actorUserId?: string }): Promise<NativeImportOutcome> {
  const meeting = await deps.repository.getDetail({ tenantId: input.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId });
  if (!meeting) return { status: "not_eligible", message: "Reunião não encontrada." };
  const meetUrl = meeting.meetingUrl ? parseGoogleMeetUrl(meeting.meetingUrl) : undefined;
  if (!meetUrl) return { status: "not_eligible", message: "Esta reunião não tem link do Google Meet." };
  if (meeting.transcript?.status === "completed" || meeting.transcript?.status === "running") return { status: "not_eligible", message: "Esta reunião já tem transcrição." };
  if (["queued", "starting", "waiting_admission", "recording"].includes(meeting.status)) return { status: "not_eligible", message: "A reunião está sendo gravada pelo Vorix agora." };

  const token = await deps.tokens.getAccessToken({ tenantId: input.tenantId, workspaceId: input.workspaceId, userId: meeting.ownerUserId });
  if (!token.ok) return { status: "not_connected", message: "O responsável pela reunião precisa conectar o Google em Meetings → Integrações." };
  const meetingCode = meetUrl.split("/").pop()!;
  const notBefore = meeting.scheduledStartAt ? new Date(Date.parse(meeting.scheduledStartAt) - 6 * 60 * 60 * 1000).toISOString() : undefined;
  const found = await deps.meet.findTranscript({ accessToken: token.accessToken, meetingCode, ...(notBefore ? { notBefore } : {}) });
  if ("unavailable" in found) return { status: found.unavailable, message: found.message };
  if (!found.entries.length) return { status: "not_found", message: "A transcrição do Google Meet desta reunião está vazia." };

  const durationSeconds = Math.round(Math.max(...found.entries.map((entry) => entry.endMs)) / 1000);
  await deps.repository.transition({ tenantId: input.tenantId, meetingId: meeting.id, to: "processing" });
  await deps.repository.saveTranscript({
    tenantId: input.tenantId,
    meetingId: meeting.id,
    // Sem arquivo de gravação: a "origem" é a transcrição do Meet (id só para rastreio).
    recordingId: `google-meet:${found.transcriptName}`,
    result: { language: found.language, engine: "google-meet", model: "native-transcript", durationSeconds, processingMs: 0, segments: found.entries, metrics: { source: "google_meet_native", conference_record: found.conferenceRecord } },
  });
  if (deps.analysisEnabled) {
    await deps.repository.transition({ tenantId: input.tenantId, meetingId: meeting.id, to: "analyzing" });
    await deps.repository.enqueueAnalysis({ tenantId: input.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
  } else {
    await deps.repository.transition({ tenantId: input.tenantId, meetingId: meeting.id, to: "completed" });
  }
  await deps.repository.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), action: "transcript.imported_google_meet", details: { segments: found.entries.length, durationSeconds } });
  return { status: "imported", segments: found.entries.length };
}

/** Ação manual "Importar transcrição do Google Meet" (com a visibilidade da pessoa). */
export async function importNativeTranscriptForActor(deps: MeetNativeImportDeps & Pick<MeetingUseCaseDeps, "repository">, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<NativeImportOutcome> {
  await requireVisibleMeeting(deps as unknown as MeetingUseCaseDeps, actor, input.workspaceId, input.meetingId);
  const outcome = await importNativeTranscript(deps, { tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId, actorUserId: actor.userId });
  if (outcome.status === "not_eligible") throw new MeetingError("MEETING_INVALID_INPUT", outcome.message);
  return outcome;
}

/**
 * Agendador (worker): reuniões com link do Meet que já terminaram, sem transcrição e sem gravação
 * do Vorix, tentam a importação a cada 30 min por até 48 h depois do fim (o Google leva alguns
 * minutos para gerar a transcrição).
 */
export async function importDueNativeTranscripts(deps: MeetNativeImportDeps, input: { limit: number }): Promise<Record<string, number>> {
  const candidates = await deps.insights.listNativeImportCandidates({ now: deps.now(), limit: input.limit });
  const outcomes: Record<string, number> = {};
  for (const candidate of candidates) {
    let status: string;
    try {
      const outcome = await importNativeTranscript(deps, candidate);
      status = outcome.status;
      await deps.insights.recordNativeImportAttempt({ meetingId: candidate.meetingId, tenantId: candidate.tenantId, status, ...(outcome.status !== "imported" ? { error: outcome.message } : {}) });
    } catch (error) {
      status = "error";
      await deps.insights.recordNativeImportAttempt({ meetingId: candidate.meetingId, tenantId: candidate.tenantId, status, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
    outcomes[status] = (outcomes[status] ?? 0) + 1;
  }
  return outcomes;
}
