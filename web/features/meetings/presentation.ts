import type { MeetingListItem, MeetingStatus } from "./types";

/** `—` quando não há valor (nunca "0:00" inventado). */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 })} ${units[unit]}`;
}

export function formatHours(seconds: number): string {
  if (!seconds) return "0 h";
  const hours = seconds / 3600;
  return `${hours.toLocaleString("pt-BR", { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`;
}

/** Quando a reunião aconteceu/acontece: agendamento se houver, senão a criação (upload, manual). */
export function meetingWhen(meeting: Pick<MeetingListItem, "scheduledStartAt" | "createdAt">): string {
  return meeting.scheduledStartAt ?? meeting.createdAt;
}

/** Duração exibida: a da gravação, se houver; senão a planejada. */
export function meetingDurationSeconds(meeting: Pick<MeetingListItem, "recordingDurationSeconds" | "durationSeconds" | "scheduledStartAt" | "scheduledEndAt">): number | undefined {
  if (meeting.recordingDurationSeconds) return meeting.recordingDurationSeconds;
  if (meeting.durationSeconds) return meeting.durationSeconds;
  if (meeting.scheduledStartAt && meeting.scheduledEndAt) {
    const seconds = (Date.parse(meeting.scheduledEndAt) - Date.parse(meeting.scheduledStartAt)) / 1000;
    return seconds > 0 ? seconds : undefined;
  }
  return undefined;
}

export function participantsSummary(meeting: Pick<MeetingListItem, "participants" | "participantCount">): string {
  if (meeting.participantCount === 0) return "—";
  const names = meeting.participants.map((participant) => participant.name ?? participant.email ?? "").filter(Boolean);
  const extra = meeting.participantCount - names.length;
  return `${names.slice(0, 2).join(", ")}${names.length > 2 || extra > 0 ? ` +${meeting.participantCount - Math.min(2, names.length)}` : ""}`;
}

/** Tom do selo de status (vocabulário fechado de acentos do design system). */
export function statusTone(status: MeetingStatus): "neutral" | "live" | "processing" | "done" | "failed" {
  if (status === "recording" || status === "waiting_admission" || status === "starting") return "live";
  if (status === "queued" || status === "processing" || status === "transcribing" || status === "analyzing") return "processing";
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  return "neutral";
}

export const STATUS_TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  neutral: "bg-muted text-muted-foreground",
  live: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  processing: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
};

/** ms → "m:ss" (ou "h:mm:ss") para os trechos da transcrição. */
export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
