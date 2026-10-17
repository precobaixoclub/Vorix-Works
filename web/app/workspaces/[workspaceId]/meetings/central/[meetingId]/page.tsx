"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BarChart3, ClipboardList, FileText, Handshake, Info, ListChecks, MessageSquareText, Scissors, Search, Send, Share2, Sparkles, Square, UsersRound, Video } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { StatusPill } from "@/components/meetings/MeetingsCentral";
import { HumanIdentityDialog, RecorderIdentityPanel, announceRecordingRefusal } from "@/components/meetings/RecorderIdentity";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/Field";
import { AskMeetingPanel, ClipsAndCommentsPanel, CreateCrmTaskButton, CrmPanel, FollowUpPanel, KeywordHitsPanel, PurgeMeetingDialog, SharePanel, SpeakersPanel, SummaryTemplateControl, TemplateSections } from "@/components/meetings/MeetingIntelligence";
import { importGoogleMeetTranscript, useMeetingInsights, type MeetingInsights } from "@/features/meetings/intelligence";
import { PageSubnav } from "@/components/PageSubnav";
import { AIInsightCard } from "@/components/vorix/ai";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { decideActionItem, deleteMeeting, getRecordingPlayback, reanalyzeMeeting, requestMeetingRecording, retranscribeMeeting, stopMeetingRecording } from "@/features/meetings/api";
import { useMeeting, useMeetingTranscript, useRecordingCapacity } from "@/features/meetings/hooks";
import { formatBytes, formatDuration, formatTimestamp, meetingDurationSeconds, meetingWhen } from "@/features/meetings/presentation";
import { MEETING_SOURCE_LABEL, MEETING_STATUS_LABEL, TRANSCRIPT_STATUS_LABEL, type MeetingActionItem, type MeetingAnalysisView, type MeetingDetail, type MeetingRecording } from "@/features/meetings/types";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Section = "overview" | "recording" | "transcript" | "summary" | "ask" | "speakers" | "actions" | "followup" | "crm" | "clips" | "share" | "participants" | "technical";

const SECTIONS = [
  { value: "overview", label: "Visão geral", icon: Info },
  { value: "summary", label: "Resumo IA", icon: Sparkles },
  { value: "transcript", label: "Transcrição", icon: FileText },
  { value: "ask", label: "Pergunte à reunião", icon: MessageSquareText },
  { value: "actions", label: "Tarefas e decisões", icon: ListChecks },
  { value: "followup", label: "Follow-up", icon: Send },
  { value: "crm", label: "CRM", icon: Handshake },
  { value: "speakers", label: "Falantes e análise", icon: BarChart3 },
  { value: "clips", label: "Trechos e comentários", icon: Scissors },
  { value: "share", label: "Compartilhar e exportar", icon: Share2 },
  { value: "recording", label: "Gravação", icon: Video },
  { value: "participants", label: "Participantes", icon: UsersRound },
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
  const [askIdentity, setAskIdentity] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const insights = useMeetingInsights(workspace.id, params.meetingId);
  const myUserId = state.status === "authenticated" ? state.user.id : undefined;
  const capacity = useRecordingCapacity(workspace.id);
  const playerRef = useRef<HTMLMediaElement | null>(null);
  const transcriptReady = meeting?.transcript?.status === "completed";
  const transcript = useMeetingTranscript(workspace.id, params.meetingId, Boolean(transcriptReady));
  const canManage = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const canRecord = state.status === "authenticated" && state.role !== "viewer";
  const canAnalyze = state.status === "authenticated" && state.role !== "viewer";

  const seek = useCallback((ms: number) => {
    const player = playerRef.current;
    if (!player) {
      setSection("transcript");
      return;
    }
    player.scrollIntoView({ behavior: "smooth", block: "center" });
    player.currentTime = ms / 1000;
    void player.play().catch(() => undefined);
  }, []);

  async function record(humanJoinAccountEmail?: string) {
    if (!meeting) return;
    // Sem a conta com que a pessoa entra, pergunta antes (nunca adivinha a identidade).
    if (!humanJoinAccountEmail && !["explicit", "connected_account_confirmed"].includes(meeting.humanJoinIdentitySource ?? "")) {
      setAskIdentity(true);
      return;
    }
    setBusy(true);
    try {
      const result = await requestMeetingRecording(workspace.id, meeting.id, humanJoinAccountEmail);
      if (result.ok) {
        toast.success("Gravação na fila", { description: "O gravador vai pedir para entrar na reunião." });
        setAskIdentity(false);
      } else if (result.reason === "HUMAN_IDENTITY_REQUIRED") setAskIdentity(true);
      else announceRecordingRefusal(result, workspace.id, (href) => router.push(href));
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

  async function stopRecording() {
    if (!meeting) return;
    setBusy(true);
    try {
      await stopMeetingRecording(workspace.id, meeting.id);
      toast.success("Encerramento solicitado", { description: "O gravador vai finalizar o arquivo antes de iniciar o processamento." });
      await mutate();
    } catch (cause) {
      toast.error("Nao foi possivel parar a gravacao", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function retranscribe() {
    if (!meeting) return;
    setBusy(true);
    try {
      const result = await retranscribeMeeting(workspace.id, meeting.id);
      toast.success(result.alreadyQueued ? "Transcrição já estava na fila" : "Transcrição reenfileirada");
      await Promise.all([mutate(), transcript.mutate()]);
    } catch (cause) {
      toast.error("Não foi possível retranscrever", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  /** Sem robô: lê a transcrição que o próprio Google Meet gerou (Google Workspace com transcrição ligada). */
  async function importFromGoogleMeet() {
    if (!meeting) return;
    setBusy(true);
    try {
      const result = await importGoogleMeetTranscript(workspace.id, meeting.id);
      if (result.status === "imported") toast.success("Transcrição do Google Meet importada", { description: "O resumo por IA está sendo gerado." });
      else toast.info("Ainda não foi possível importar", { description: result.message });
      await refreshAll();
    } catch (cause) {
      toast.error("Não foi possível importar", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze() {
    if (!meeting) return;
    setBusy(true);
    try {
      const result = await reanalyzeMeeting(workspace.id, meeting.id);
      toast.success(result.alreadyQueued ? "Análise já estava na fila" : "Análise reenfileirada", { description: result.alreadyQueued ? undefined : "Uma nova execução consome crédito quando o worker processar." });
      await Promise.all([mutate(), insights.mutate()]);
    } catch (cause) {
      toast.error("Não foi possível reanalisar", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
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
  const latestAnalysis = meeting.latestAnalysis;
  const analysis = latestAnalysis?.result ? latestAnalysis : meeting.lastCompletedAnalysis?.result ? meeting.lastCompletedAnalysis : latestAnalysis;
  const view = insights.data;
  const speakerNames = new Map((view?.speakers ?? []).map((speaker) => [speaker.key, speaker.displayName]));
  const refreshAll = async () => { await Promise.all([mutate(), insights.mutate()]); };
  const insightsFallback = <Card className="p-5">{insights.error ? <ErrorState error={insights.error} onRetry={() => insights.mutate()} /> : <Skeleton className="h-24 rounded-lg" />}</Card>;
  const query = transcriptQuery.trim().toLowerCase();
  const visibleSegments = (transcript.data?.segments ?? []).filter((segment) => !query || segment.text.toLowerCase().includes(query) || (speakerNames.get(segment.speaker ?? "") ?? segment.speaker ?? "").toLowerCase().includes(query));

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={meeting.title}
        description={`${formatDateTime(meetingWhen(meeting))} · ${MEETING_SOURCE_LABEL[meeting.source]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={meeting.status} />
            {canRecord && meeting.status === "scheduled" && meeting.meetingUrl ? <Button onClick={() => void record()} loading={busy} disabled={busy}>Gravar reunião</Button> : null}
            {canRecord && ["queued", "starting", "waiting_admission", "recording"].includes(meeting.status) ? <Button variant="secondary" onClick={stopRecording} loading={busy} disabled={busy}><Square className="h-4 w-4" aria-hidden="true" />Parar gravação</Button> : null}
            {canRecord && meeting.meetingUrl && !meeting.transcript && !recording && meeting.status === "scheduled" ? <Button variant="secondary" onClick={() => void importFromGoogleMeet()} loading={busy} disabled={busy}>Importar transcrição do Meet</Button> : null}
            {canAnalyze && recording ? <Button variant="secondary" onClick={retranscribe} loading={busy} disabled={busy}>Retranscrever</Button> : null}
            {canAnalyze && transcriptReady ? <Button variant="secondary" onClick={reanalyze} loading={busy} disabled={busy}>Reanalisar IA</Button> : null}
            {canManage ? <Button variant="secondary" onClick={() => setConfirmDelete(true)} disabled={busy}>Excluir</Button> : null}
            {canManage ? <Button variant="ghost" onClick={() => setPurgeOpen(true)} disabled={busy}>Excluir definitivamente</Button> : null}
          </div>
        }
      />

      {meeting.failureMessage && meeting.status === "failed" ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{meeting.failureMessage}</Card>
      ) : null}

      <RecorderIdentityPanel meeting={meeting} workspaceId={workspace.id} canEdit={canRecord} onChanged={async () => { await mutate(); }} />

      {askIdentity ? <HumanIdentityDialog initial={meeting.humanJoinAccountEmail} suggestions={capacity.data?.knownHumanEmails ?? []} busy={busy} onSubmit={(email) => void record(email)} onClose={() => setAskIdentity(false)} /> : null}

      {["queued", "starting", "waiting_admission", "recording"].includes(meeting.status) ? <LiveRecordingPanel meeting={meeting} /> : null}

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
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Buscar na transcrição…" value={transcriptQuery} onChange={(event) => setTranscriptQuery(event.target.value)} aria-label="Buscar na transcrição" />
                {query ? <p className="mt-1 text-xs text-muted-foreground">{visibleSegments.length} {visibleSegments.length === 1 ? "trecho encontrado" : "trechos encontrados"}</p> : null}
              </div>
            ) : null}
            {transcriptReady && transcript.data ? (
              <ol className="space-y-1" data-testid="transcript-segments">
                {visibleSegments.map((segment) => (
                  <li key={segment.seq}>
                    <button
                      type="button"
                      onClick={() => seek(segment.startMs)}
                      disabled={!recording}
                      className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="w-14 shrink-0 tabular-nums text-xs text-primary dark:text-primary-glow">{formatTimestamp(segment.startMs)}</span>
                      <span className="min-w-0">
                        {segment.speaker ? <span className="mr-1 font-medium text-foreground">{speakerNames.get(segment.speaker) ?? segment.speaker}:</span> : null}
                        <span className="text-foreground/90"><Highlight text={segment.text} query={query} /></span>
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
            {latestAnalysis?.status === "blocked_no_credits" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-foreground">
                <span>Sem créditos de IA para uma nova análise. A gravação e a transcrição continuam disponíveis.</span>
                <Link href={`/workspaces/${workspace.id}/settings/plano`} className="font-medium underline">Ver créditos</Link>
              </div>
            ) : null}
            {latestAnalysis?.status === "failed" ? <p className="text-sm text-destructive">A análise falhou{latestAnalysis.error ? `: ${latestAnalysis.error}` : "."}</p> : null}
            {analysis?.id !== latestAnalysis?.id && analysis?.result ? <p className="text-xs text-muted-foreground">Mostrando a última análise concluída.</p> : null}
            {view ? <SummaryTemplateControl workspaceId={workspace.id} meetingId={meeting.id} insights={view} canAnalyze={canAnalyze} transcriptReady={Boolean(transcriptReady)} onChanged={refreshAll} /> : null}
            {analysis?.result ? (
              <AIInsightCard title="Resumo da reunião" meta={formatDateTime(analysis.createdAt)} footnote="Gerado pela IA a partir da transcrição — revise antes de compartilhar.">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo executivo</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-foreground">{analysis.result.executiveSummary}</p>
                  </div>
                  <TemplateSections sections={analysis.result.templateSections} />
                  <BulletList title="Tópicos" items={analysis.result.topics} />
                  <BulletList title="Riscos" items={analysis.result.risks} />
                  <BulletList title="Objeções" items={analysis.result.objections} />
                  <BulletList title="Perguntas em aberto" items={analysis.result.openQuestions} />
                </div>
              </AIInsightCard>
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
        {section === "actions" ? <ActionItemsSection workspaceId={workspace.id} meetingId={meeting.id} analysis={analysis} canDecide={canAnalyze} onChanged={refreshAll} insights={view} /> : null}
        {section === "ask" ? (view ? <AskMeetingPanel workspaceId={workspace.id} meetingId={meeting.id} initial={view.questions} aiAvailable={view.aiAvailable && Boolean(transcriptReady)} onSeek={seek} /> : insightsFallback) : null}
        {section === "speakers" ? (view ? <div className="space-y-4"><SpeakersPanel workspaceId={workspace.id} meetingId={meeting.id} insights={view} canEdit={canRecord} participantNames={meeting.participants.map((participant) => participant.name ?? participant.email ?? "").filter(Boolean)} onChanged={refreshAll} onSeek={seek} /><KeywordHitsPanel workspaceId={workspace.id} insights={view} onSeek={seek} /></div> : insightsFallback) : null}
        {section === "followup" ? (view ? <FollowUpPanel workspaceId={workspace.id} meetingId={meeting.id} insights={view} hasAnalysis={Boolean(analysis?.result)} canAct={canAnalyze} onChanged={refreshAll} /> : insightsFallback) : null}
        {section === "crm" ? (view ? <CrmPanel workspaceId={workspace.id} meetingId={meeting.id} insights={view} canAct={canRecord} onChanged={refreshAll} /> : insightsFallback) : null}
        {section === "clips" ? (view ? <ClipsAndCommentsPanel workspaceId={workspace.id} meetingId={meeting.id} insights={view} currentTimeMs={() => Math.floor((playerRef.current?.currentTime ?? 0) * 1000)} onSeek={seek} onChanged={refreshAll} memberName={(userId) => (userId === myUserId ? "Você" : "Equipe")} myUserId={myUserId} canManageAll={canManage} /> : insightsFallback) : null}
        {section === "share" ? (view ? <SharePanel workspaceId={workspace.id} meetingId={meeting.id} insights={view} hasRecording={Boolean(recording)} canAct={canRecord} onChanged={refreshAll} /> : insightsFallback) : null}
        {section === "technical" ? <Technical meeting={meeting} /> : null}
      </PageSubnav>

      {purgeOpen ? (
        <PurgeMeetingDialog
          workspaceId={workspace.id}
          meetingId={meeting.id}
          title={meeting.title}
          onClose={() => setPurgeOpen(false)}
          onPurged={() => {
            void globalMutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("meeting"));
            router.push(`/workspaces/${workspace.id}/meetings/central`);
          }}
        />
      ) : null}

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
          <li key={recording.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-5">
            <span className="font-medium text-foreground">{recording.originalFileName ?? (recording.kind === "original" ? "Gravação original" : "Gravação processada")}</span>
            <span className="tabular-nums text-muted-foreground">{formatBytes(recording.bytes)}</span>
            <span className="tabular-nums text-muted-foreground">{formatDuration(recording.durationSeconds)}</span>
            <span className={cn("text-muted-foreground", recording.status !== "available" && "text-destructive")}>{recording.status === "available" ? recording.mimeType : recording.status === "purged" ? "Removida pela retenção" : "Falhou"}</span>
            <span className="text-muted-foreground">{recording.videoCodec && recording.audioCodec ? `${recording.videoCodec} + ${recording.audioCodec}${recording.width && recording.height ? ` · ${recording.width}x${recording.height}` : ""}` : "—"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const ACTION_ITEM_TYPE_LABEL: Record<MeetingActionItem["type"], string> = {
  decision: "Decisão",
  task: "Tarefa",
  next_step: "Próximo passo",
};

const ACTION_ITEM_STATUS_LABEL: Record<MeetingActionItem["status"], string> = {
  suggested: "Sugerido",
  confirmed: "Confirmado",
  dismissed: "Dispensado",
};

function ActionItemsSection({
  workspaceId,
  meetingId,
  analysis,
  canDecide,
  onChanged,
  insights,
}: {
  workspaceId: string;
  meetingId: string;
  analysis?: MeetingAnalysisView;
  canDecide: boolean;
  onChanged: () => Promise<unknown>;
  insights?: MeetingInsights;
}) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const items = analysis?.actionItems ?? [];

  async function decide(item: MeetingActionItem, status: "confirmed" | "dismissed") {
    setBusyItemId(item.id);
    try {
      await decideActionItem(workspaceId, meetingId, item.id, status);
      toast.success(status === "confirmed" ? "Item confirmado" : "Item dispensado");
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível atualizar o item", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusyItemId(null);
    }
  }

  if (!analysis?.result) {
    return <Card className="p-5"><p className="text-sm text-muted-foreground">Decisões, tarefas e próximos passos aparecem aqui depois do resumo por IA — só o que foi dito na reunião.</p></Card>;
  }

  if (items.length === 0) {
    return (
      <Card className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">A análise não encontrou tarefas, decisões ou próximos passos estruturados.</p>
        <BulletList title="Decisões" items={analysis.result.decisions} />
        <BulletList title="Tarefas" items={analysis.result.actionItems.map((item) => [item.description, item.owner ? `(${item.owner})` : "", item.dueDate ? `até ${item.dueDate}` : ""].filter(Boolean).join(" "))} />
        <BulletList title="Próximos passos" items={analysis.result.nextSteps} />
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <ul className="divide-y divide-border/60" data-testid="meeting-action-items">
        {items.map((item) => (
          <li key={item.id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{ACTION_ITEM_TYPE_LABEL[item.type]}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", item.status === "confirmed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : item.status === "dismissed" ? "bg-muted text-muted-foreground line-through" : "bg-primary/10 text-primary dark:text-primary-glow")}>{ACTION_ITEM_STATUS_LABEL[item.status]}</span>
                {item.sourceTimestampMs !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{formatTimestamp(item.sourceTimestampMs)}</span> : null}
              </div>
              <p className={cn("text-foreground", item.status === "dismissed" && "text-muted-foreground line-through")}>{item.description}</p>
              <p className="text-xs text-muted-foreground">
                {[item.assigneeName ? `Responsável: ${item.assigneeName}` : "", item.dueDate ? `Prazo: ${item.dueDate}` : "", item.confidence !== undefined ? `Confiança: ${Math.round(item.confidence * 100)}%` : ""].filter(Boolean).join(" · ") || "Aguardando decisão humana."}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-2 lg:justify-end">
              {canDecide && insights?.crm.available && item.type !== "decision" && item.status !== "dismissed" ? <CreateCrmTaskButton workspaceId={workspaceId} meetingId={meetingId} itemId={item.id} taskId={insights.crmTasks[item.id]} onCreated={onChanged} /> : null}
              {canDecide && item.status === "suggested" ? (
                <>
                  <Button variant="secondary" size="sm" loading={busyItemId === item.id} disabled={Boolean(busyItemId)} onClick={() => decide(item, "confirmed")}>Confirmar</Button>
                  <Button variant="ghost" size="sm" disabled={Boolean(busyItemId)} onClick={() => decide(item, "dismissed")}>Dispensar</Button>
                </>
              ) : null}
            </div>
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

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
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

const LIVE_LABEL: Record<string, string> = {
  queued: "Na fila — reservando um gravador",
  starting: "Preparando o gravador",
  waiting_admission: "Aguardando o organizador admitir o gravador na reunião",
  recording: "Gravando",
};

/** Gravação em andamento: estado real do gravador, bot, entrada efetiva e tempo gravado. O player só
 * aparece depois que o arquivo final for validado. */
function LiveRecordingPanel({ meeting }: { meeting: MeetingDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const since = meeting.recordingStartedAt ?? meeting.botJoinedAt;
  const elapsed = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : undefined;
  const joined = meeting.botJoinedAt ? ` Entrou às ${new Date(meeting.botJoinedAt).toLocaleTimeString("pt-BR")}.` : "";
  const bot = meeting.botAccountId ? ` Gravador: ${meeting.botAccountId}.` : "";
  return (
    <Card className="border-rose-200 bg-rose-50/60 p-4 text-sm dark:border-rose-500/30 dark:bg-rose-500/10" data-testid="live-recording-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", meeting.status === "recording" ? "animate-pulse bg-rose-600" : "bg-amber-500")} aria-hidden="true" />
          <span className="font-medium text-foreground">{LIVE_LABEL[meeting.status]}</span>
        </div>
        {meeting.status === "recording" && elapsed !== undefined ? <span className="font-mono tabular-nums text-foreground" data-testid="live-elapsed">{formatDuration(elapsed)}</span> : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">O gravador do Vorix participa como um participante visível e a reunião está sendo gravada.{joined}{bot}</p>
    </Card>
  );
}
