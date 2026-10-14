"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ClipboardList, FileText, Info, ListChecks, Sparkles, UsersRound, Video } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { StatusPill } from "@/components/meetings/MeetingsCentral";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { deleteMeeting, getRecordingPlayback, requestMeetingRecording } from "@/features/meetings/api";
import { useMeeting, useMeetingTranscript } from "@/features/meetings/hooks";
import { formatBytes, formatDuration, formatTimestamp, meetingDurationSeconds, meetingWhen } from "@/features/meetings/presentation";
import { MEETING_SOURCE_LABEL, MEETING_STATUS_LABEL, TRANSCRIPT_STATUS_LABEL, type MeetingDetail, type MeetingRecording } from "@/features/meetings/types";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Section = "overview" | "recording" | "transcript" | "summary" | "participants" | "actions" | "technical";

const SECTIONS = [
  { value: "overview", label: "Visão geral", icon: Info },
  { value: "recording", label: "Gravação", icon: Video },
  { value: "transcript", label: "Transcrição", icon: FileText },
  { value: "summary", label: "Resumo IA", icon: Sparkles },
  { value: "participants", label: "Participantes", icon: UsersRound },
  { value: "actions", label: "Tarefas e decisões", icon: ListChecks },
  { value: "technical", label: "Informações técnicas", icon: ClipboardList },
];

export default function MeetingDetailPage() {
  const params = useParams<{ meetingId: string }>();
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const { state } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: meeting, error, isLoading, mutate } = useMeeting(workspace.id, params.meetingId);
  const [section, setSection] = useState<Section>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const playerRef = useRef<HTMLMediaElement | null>(null);
  const transcriptReady = meeting?.transcript?.status === "completed";
  const transcript = useMeetingTranscript(workspace.id, params.meetingId, Boolean(transcriptReady));
  const canManage = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const canRecord = state.status === "authenticated" && state.role !== "viewer";

  const seek = useCallback((ms: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = ms / 1000;
    void player.play().catch(() => undefined);
  }, []);

  async function record() {
    if (!meeting) return;
    setBusy(true);
    try {
      const result = await requestMeetingRecording(workspace.id, meeting.id);
      if (result.ok) toast.success("Gravação na fila", { description: "O gravador vai pedir para entrar na reunião." });
      else toast.warning("A gravação não começou", { description: result.message });
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível pedir a gravação", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!meeting) return;
    setBusy(true);
    try {
      await deleteMeeting(workspace.id, meeting.id);
      toast.success("Reunião excluída");
      await globalMutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("meeting"));
      router.push(`/workspaces/${workspace.id}/meetings/central`);
    } catch (cause) {
      toast.error("Não foi possível excluir", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1280px] space-y-4 px-3 py-5 sm:px-6 sm:py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </main>
    );
  }
  if (error || !meeting) {
    return (
      <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
        {error && !(error instanceof ApiError && error.statusCode === 404) ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : (
          <EmptyState title="Reunião não encontrada" description="Ela pode ter sido excluída ou você não tem acesso a ela." action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}/meetings/central`)}>Ver reuniões</Button>} />
        )}
      </main>
    );
  }

  const recording = meeting.recordings.find((item) => item.status === "available");
  const analysis = meeting.latestAnalysis;

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={meeting.title}
        description={`${formatDateTime(meetingWhen(meeting))} · ${MEETING_SOURCE_LABEL[meeting.source]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={meeting.status} />
            {canRecord && meeting.status === "scheduled" && meeting.meetingUrl ? <Button onClick={record} loading={busy} disabled={busy}>Gravar reunião</Button> : null}
            {canManage ? <Button variant="secondary" onClick={() => setConfirmDelete(true)} disabled={busy}>Excluir</Button> : null}
          </div>
        }
      />

      {meeting.failureMessage && meeting.status === "failed" ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{meeting.failureMessage}</Card>
      ) : null}

      {recording ? <RecordingPlayer workspaceId={workspace.id} meetingId={meeting.id} recording={recording} playerRef={playerRef} /> : null}

      <PageSubnav items={SECTIONS} value={section} onValueChange={(value) => setSection(value as Section)}>
        {section === "overview" ? <Overview meeting={meeting} myUserId={state.status === "authenticated" ? state.user.id : undefined} /> : null}
        {section === "recording" ? <RecordingSection meeting={meeting} /> : null}
        {section === "transcript" ? (
          <Card className="p-5">
            {!meeting.transcript ? <p className="text-sm text-muted-foreground">Esta reunião ainda não tem gravação para transcrever.</p> : null}
            {meeting.transcript && meeting.transcript.status !== "completed" ? (
              <p className="text-sm text-muted-foreground">
                {meeting.transcript.status === "failed" ? `A transcrição falhou${meeting.transcript.lastError ? `: ${meeting.transcript.lastError}` : "."}` : `Transcrição ${TRANSCRIPT_STATUS_LABEL[meeting.transcript.status].toLowerCase()} — esta página atualiza sozinha.`}
              </p>
            ) : null}
            {transcriptReady && transcript.error ? <ErrorState error={transcript.error} onRetry={() => transcript.mutate()} /> : null}
            {transcriptReady && transcript.data ? (
              <ol className="space-y-1" data-testid="transcript-segments">
                {transcript.data.segments.map((segment) => (
                  <li key={segment.seq}>
                    <button
                      type="button"
                      onClick={() => seek(segment.startMs)}
                      disabled={!recording}
                      className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="w-14 shrink-0 tabular-nums text-xs text-primary dark:text-primary-glow">{formatTimestamp(segment.startMs)}</span>
                      <span className="min-w-0">
                        {segment.speaker ? <span className="mr-1 font-medium text-foreground">{segment.speaker}:</span> : null}
                        <span className="text-foreground/90">{segment.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>
        ) : null}
        {section === "summary" ? (
          <Card className="space-y-4 p-5">
            {!analysis ? <p className="text-sm text-muted-foreground">O resumo por IA é gerado depois que a transcrição fica pronta.</p> : null}
            {analysis?.status === "blocked_no_credits" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <span>Sem créditos de IA para uma nova análise. A gravação e a transcrição continuam disponíveis.</span>
                <Link href={`/workspaces/${workspace.id}/settings/plano`} className="font-medium underline">Ver créditos</Link>
              </div>
            ) : null}
            {analysis?.status === "failed" ? <p className="text-sm text-destructive">A análise falhou{analysis.error ? `: ${analysis.error}` : "."}</p> : null}
            {analysis?.result ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo executivo</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">{analysis.result.executiveSummary}</p>
                </div>
                <BulletList title="Tópicos" items={analysis.result.topics} />
                <BulletList title="Riscos" items={analysis.result.risks} />
                <BulletList title="Objeções" items={analysis.result.objections} />
                <BulletList title="Perguntas em aberto" items={analysis.result.openQuestions} />
              </>
            ) : null}
          </Card>
        ) : null}
        {section === "participants" ? (
          <Card className="p-0">
            {meeting.participants.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhum participante registrado.</p> : null}
            <ul className="divide-y divide-border/60">
              {meeting.participants.map((participant) => (
                <li key={participant.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{participant.name ?? participant.email}</p>
                    {participant.name && participant.email ? <p className="truncate text-xs text-muted-foreground">{participant.email}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{participant.role === "organizer" ? "Organizador" : "Participante"}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {section === "actions" ? (
          <Card className="space-y-4 p-5">
            {!analysis?.result ? <p className="text-sm text-muted-foreground">Decisões, tarefas e próximos passos aparecem aqui depois do resumo por IA — só o que foi dito na reunião.</p> : null}
            {analysis?.result ? (
              <>
                <BulletList title="Decisões" items={analysis.result.decisions} />
                <BulletList title="Tarefas" items={analysis.result.actionItems.map((item) => [item.description, item.owner ? `(${item.owner})` : "", item.dueDate ? `até ${item.dueDate}` : ""].filter(Boolean).join(" "))} />
                <BulletList title="Próximos passos" items={analysis.result.nextSteps} />
              </>
            ) : null}
          </Card>
        ) : null}
        {section === "technical" ? <Technical meeting={meeting} /> : null}
      </PageSubnav>

      <ConfirmDialog
        open={confirmDelete}
        title={`Excluir "${meeting.title}"?`}
        description="A reunião sai da Central. A gravação e a transcrição ficam preservadas para auditoria até a política de retenção do plano."
        confirmLabel="Excluir"
        variant="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </main>
  );
}

/** Player real: URL assinada curta pedida na hora (e renovada antes de expirar). */
function RecordingPlayer({ workspaceId, meetingId, recording, playerRef }: { workspaceId: string; meetingId: string; recording: MeetingRecording; playerRef: React.MutableRefObject<HTMLMediaElement | null> }) {
  const [source, setSource] = useState<{ url: string; mimeType: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const playback = await getRecordingPlayback(workspaceId, meetingId, recording.id);
        if (cancelled) return;
        setSource((current) => {
          // Renovação: mantém a posição do player ao trocar a URL.
          const position = playerRef.current?.currentTime ?? 0;
          if (current && playerRef.current) queueMicrotask(() => { if (playerRef.current) playerRef.current.currentTime = position; });
          return { url: playback.url, mimeType: playback.mimeType };
        });
        timer = setTimeout(load, Math.max(60, playback.expiresInSeconds - 120) * 1000);
      } catch (cause) {
        if (!cancelled) setFailed(cause instanceof Error ? cause.message : "Não foi possível carregar a gravação.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, meetingId, recording.id, playerRef]);

  return (
    <Card className="p-3" data-testid="meeting-player">
      {failed ? <p className="p-2 text-sm text-destructive">{failed}</p> : null}
      {!source && !failed ? <Skeleton className="h-14 rounded-lg" /> : null}
      {source ? (
        source.mimeType.startsWith("video/") ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video ref={(element) => { playerRef.current = element; }} src={source.url} controls preload="metadata" className="max-h-[420px] w-full rounded-lg bg-black" />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio ref={(element) => { playerRef.current = element; }} src={source.url} controls preload="metadata" className="w-full" />
        )
      ) : null}
    </Card>
  );
}

function Overview({ meeting, myUserId }: { meeting: MeetingDetail; myUserId?: string }) {
  const recording = meeting.recordings.find((item) => item.status === "available");
  const rows: [string, React.ReactNode][] = [
    ["Data", formatDateTime(meetingWhen(meeting))],
    ["Duração", formatDuration(recording?.durationSeconds ?? meetingDurationSeconds({ ...meeting, recordingDurationSeconds: recording?.durationSeconds }))],
    ["Responsável", meeting.ownerUserId === myUserId ? "Você" : meeting.ownerName ?? "—"],
    ["Participantes", meeting.participants.length ? String(meeting.participants.length) : "—"],
    ["Origem", MEETING_SOURCE_LABEL[meeting.source]],
    ["Link da reunião", meeting.meetingUrl ? <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline dark:text-primary-glow">{meeting.meetingUrl.replace("https://", "")}</a> : "—"],
    ["Status", MEETING_STATUS_LABEL[meeting.status]],
    ["Gravação", recording ? `${formatBytes(recording.bytes)} · ${recording.mimeType}` : "—"],
    ["Transcrição", meeting.transcript ? TRANSCRIPT_STATUS_LABEL[meeting.transcript.status] : "—"],
    ["Resumo IA", meeting.latestAnalysis?.status === "completed" ? "Disponível" : "—"],
  ];
  return (
    <Card className="p-5">
      {meeting.description ? <p className="mb-4 whitespace-pre-line text-sm text-foreground">{meeting.description}</p> : null}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-2">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-right text-sm tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function RecordingSection({ meeting }: { meeting: MeetingDetail }) {
  if (meeting.recordings.length === 0) {
    return <Card className="p-5"><p className="text-sm text-muted-foreground">{meeting.status === "scheduled" ? "Ainda não há gravação. Grave a reunião pelo link do Meet ou envie o arquivo." : "Ainda não há gravação."}</p></Card>;
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border/60">
        {meeting.recordings.map((recording) => (
          <li key={recording.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-4">
            <span className="font-medium text-foreground">{recording.originalFileName ?? (recording.kind === "original" ? "Gravação original" : "Gravação processada")}</span>
            <span className="tabular-nums text-muted-foreground">{formatBytes(recording.bytes)}</span>
            <span className="tabular-nums text-muted-foreground">{formatDuration(recording.durationSeconds)}</span>
            <span className={cn("text-muted-foreground", recording.status !== "available" && "text-destructive")}>{recording.status === "available" ? recording.mimeType : recording.status === "purged" ? "Removida pela retenção" : "Falhou"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Technical({ meeting }: { meeting: MeetingDetail }) {
  const rows: [string, string | undefined][] = [
    ["ID da reunião", meeting.id],
    ["Evento de Agenda", meeting.calendarEventId],
    ["Gravador (bot)", meeting.botAccountId],
    ["Bot entrou em", meeting.botJoinedAt ? formatDateTime(meeting.botJoinedAt) : undefined],
    ["Status desde", formatDateTime(meeting.statusChangedAt)],
    ["Código de falha", meeting.failureCode],
    ["Transcrição — engine", [meeting.transcript?.engine, meeting.transcript?.model].filter(Boolean).join(" · ") || undefined],
    ["Transcrição — idioma", meeting.transcript?.language],
    ["Transcrição — tentativas", meeting.transcript ? String(meeting.transcript.attempts) : undefined],
    ["Transcrição — erro", meeting.transcript?.lastError],
    ["Análise — modelo / créditos", meeting.latestAnalysis ? `${meeting.latestAnalysis.model ?? "—"} · ${meeting.latestAnalysis.creditsCharged}` : undefined],
    ...meeting.recordings.map((recording): [string, string] => [`SHA-256 (${recording.kind})`, recording.checksumSha256]),
  ];
  return (
    <Card className="p-5">
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-6">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-foreground sm:text-right">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}
