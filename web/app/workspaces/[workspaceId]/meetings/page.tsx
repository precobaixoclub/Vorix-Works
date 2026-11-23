"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CircleDot, Clock3, FileUp, Loader2, Mic, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/Button";
import { KpiCard } from "@/components/DashboardKit";
import { ErrorState } from "@/components/ErrorState";
import { MeetingDialogs, type MeetingDialogKind } from "@/components/meetings/MeetingDialogs";
import { AvailabilityBadges, StatusPill } from "@/components/meetings/MeetingsCentral";
import { PageHeader } from "@/components/PageHeader";
import { StatsGrid } from "@/components/StatsGrid";
import { Card } from "@/components/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useGoogleCalendarStatus } from "@/features/meetings/agenda";
import { useMeetings, useMeetingsDashboard, useRecordingCapacity } from "@/features/meetings/hooks";
import { browserMicrophoneSupport, meetingsOverview, type MicSupport } from "@/features/meetings/organization";
import { formatHours, meetingWhen, participantsSummary } from "@/features/meetings/presentation";
import { MEETING_SOURCE_LABEL, type MeetingListItem } from "@/features/meetings/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const RECENT_FILTERS = {};

/**
 * Visão geral de Reuniões (Fase 9): responde de cara qual é a próxima reunião, o que está gravando ou
 * processando, o que já tem análise e como gravar. Usa as MESMAS consultas de antes (painel + lista
 * recente + capacidade) e o status da agenda Google já usado pela Agenda — nenhuma consulta nova
 * de transcrição.
 */
export default function MeetingsHomePage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const [dialog, setDialog] = useState<MeetingDialogKind | null>(null);
  const dashboard = useMeetingsDashboard(workspace.id);
  const recent = useMeetings(workspace.id, RECENT_FILTERS);
  const capacity = useRecordingCapacity(workspace.id);
  const google = useGoogleCalendarStatus(workspace.id);
  const [mic, setMic] = useState<MicSupport>({ supported: false, reason: "" });
  useEffect(() => setMic(browserMicrophoneSupport()), []);
  const data = dashboard.data;
  const base = `/workspaces/${workspace.id}/meetings`;
  const canRecord = state.status === "authenticated" && state.role !== "viewer";
  const overview = useMemo(() => meetingsOverview(recent.data?.items, new Date()), [recent.data]);
  const inProgress = [...overview.recordingNow, ...overview.processing];

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Reuniões"
        description="Sua agenda, as gravações, as transcrições e as análises da IA num só lugar."
        actions={canRecord ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("new")}>Nova reunião</Button>
            <Button onClick={() => document.getElementById("como-gravar")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Gravar reunião</Button>
          </div>
        ) : undefined}
      />

      {dashboard.error ? <ErrorState error={dashboard.error} onRetry={() => dashboard.mutate()} /> : null}
      {!data && !dashboard.error ? <Skeleton className="h-28 rounded-xl" /> : null}
      {data ? (
        <>
          {data.realRecordingEnabled && capacity.data && (capacity.data.connectedAccounts === 0 || capacity.data.missingAccountsForPlan > 0) ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-testid="recorder-onboarding">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">{capacity.data.connectedAccounts === 0 ? "Conecte suas contas de gravação" : "Conecte mais contas de gravação"}</p>
                <p className="text-muted-foreground">
                  Você possui {capacity.data.healthyAccounts} conta(s) de gravação saudáveis. Sua capacidade efetiva continua limitada
                  pelo plano de {capacity.data.planCapacity} gravação(ões) simultânea(s) e pela disponibilidade dessas contas.
                </p>
              </div>
              {capacity.data.canManage ? <Link href={`${base}/recorder-accounts`}><Button>Conectar conta de gravação</Button></Link> : <p className="text-xs text-muted-foreground">Peça a um administrador da empresa.</p>}
            </Card>
          ) : null}
          <StatsGrid>
            <KpiCard label="Reuniões hoje" value={String(data.meetingsToday)} hint={`${data.meetingsThisWeek} nesta semana`} icon={<CalendarDays className="h-4 w-4" />} />
            <KpiCard label="Gravando agora" value={String(data.recordingNow)} hint={`Limite do plano: ${data.limits.maxConcurrentRecordings} simultânea(s)`} accent={data.recordingNow > 0 ? "positive" : "default"} icon={<CircleDot className="h-4 w-4" />} />
            <KpiCard label="Processando" value={String(data.processing)} hint="Transcrição e resumo em andamento" icon={<Loader2 className="h-4 w-4" />} />
            <KpiCard label="Horas gravadas" value={formatHours(data.recordedSeconds)} hint={`${data.transcriptsAvailable} transcrições disponíveis`} icon={<Clock3 className="h-4 w-4" />} />
          </StatsGrid>
        </>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-0" data-testid="upcoming-meetings">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-medium text-foreground">Próximas reuniões</h2>
                <CalendarLine status={google.data?.status} email={google.data?.googleEmail} error={google.data?.lastErrorMessage} failed={Boolean(google.error)} base={base} />
              </div>
              <Link href={`${base}/agenda`} className="text-sm font-medium text-primary hover:underline dark:text-primary-glow">Abrir agenda</Link>
            </div>
            {recent.error ? <div className="p-5"><ErrorState error={recent.error} onRetry={() => recent.mutate()} /></div> : null}
            {!recent.data && !recent.error ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : null}
            {recent.data && overview.upcoming.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma reunião agendada daqui para frente. Agende pela Agenda ou crie uma nova reunião.</p>
            ) : null}
            {overview.upcoming.length > 0 ? (
              <>
                {overview.todayCount > 0 ? <p className="px-5 pt-3 text-xs font-medium text-primary dark:text-primary-glow" data-testid="today-count">{overview.todayCount === 1 ? "1 reunião ainda hoje" : `${overview.todayCount} reuniões ainda hoje`}</p> : null}
                <ul className="divide-y divide-border/60">
                  {overview.upcoming.map((meeting) => <UpcomingRow key={meeting.id} meeting={meeting} base={base} />)}
                </ul>
              </>
            ) : null}
          </Card>

          {inProgress.length || overview.awaitingAnalysis.length ? (
            <Card className="p-0" data-testid="in-progress">
              <div className="border-b border-border/60 px-5 py-4">
                <h2 className="text-base font-medium text-foreground">Em andamento</h2>
                <p className="text-xs text-muted-foreground">Gravações e processamentos — esta tela atualiza sozinha.</p>
              </div>
              <ul className="divide-y divide-border/60">
                {inProgress.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} base={base} />)}
                {overview.awaitingAnalysis.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} base={base} note="Transcrição pronta — aguardando análise" />)}
              </ul>
            </Card>
          ) : null}

          <Card className="p-0" data-testid="recent-activity">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-foreground">Atividade recente</h2>
                <p className="text-xs text-muted-foreground">Reuniões concluídas e processamentos que falharam.</p>
              </div>
              <Link href={`${base}/central`} className="text-sm font-medium text-primary hover:underline dark:text-primary-glow">Ver gravações</Link>
            </div>
            {recent.data && overview.recent.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <Video className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nenhuma reunião concluída ainda. Grave uma reunião ou envie uma gravação para começar.</p>
              </div>
            ) : null}
            <ul className="divide-y divide-border/60">
              {overview.recent.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} base={base} />)}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {canRecord ? (
            <Card className="space-y-3 p-5" id="como-gravar" data-testid="how-to-record">
              <h2 className="text-base font-medium text-foreground">Como você quer gravar?</h2>
              <RecordOption
                icon={<Video className="h-4 w-4" />}
                title="Reunião no Google Meet"
                text="O gravador da Vorix entra na reunião como participante visível. Quem organiza precisa admitir a entrada."
                action={data && !data.realRecordingEnabled ? <p className="text-xs text-muted-foreground">Ainda não habilitada neste ambiente.</p> : <Button size="sm" onClick={() => setDialog("record")}>Gravar reunião do Meet</Button>}
              />
              <RecordOption
                icon={<Mic className="h-4 w-4" />}
                title="Reunião presencial"
                text="Grava pelo microfone deste computador ou celular, com pausa. O áudio só é enviado quando você encerrar."
                action={mic.supported ? <Button size="sm" variant="secondary" onClick={() => setDialog("in_person")}>Gravar pelo microfone</Button> : <p className="text-xs text-muted-foreground" data-testid="mic-unsupported">{mic.reason || "Verificando o navegador…"}</p>}
              />
              <RecordOption
                icon={<FileUp className="h-4 w-4" />}
                title="Já tenho o arquivo"
                text="Envie o áudio ou vídeo (MP3, M4A, WAV, WEBM, OGG, MP4 ou MOV)."
                action={<Button size="sm" variant="secondary" onClick={() => setDialog("upload")}>Enviar gravação</Button>}
              />
              <p className="text-xs text-muted-foreground">Depois de gravar: a Vorix transcreve e a IA resume. Tudo fica em <Link className="font-medium text-primary hover:underline dark:text-primary-glow" href={`${base}/central`}>Gravações</Link>.</p>
            </Card>
          ) : (
            <Card className="p-5 text-sm text-muted-foreground">Seu perfil permite consultar as reuniões, mas não gravar.</Card>
          )}

          <Card className="space-y-1 p-3" data-testid="meetings-shortcuts">
            {[
              { href: `${base}/agenda`, label: "Agenda", hint: "Reuniões programadas e Google Agenda", icon: <CalendarDays className="h-4 w-4" /> },
              { href: `${base}/central`, label: "Gravações", hint: "Histórico, transcrições e status", icon: <Video className="h-4 w-4" /> },
              { href: `${base}/ask`, label: "Análises", hint: "Resumos da IA e perguntas às reuniões", icon: <Sparkles className="h-4 w-4" /> },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </Link>
            ))}
          </Card>
        </div>
      </div>

      <MeetingDialogs workspaceId={workspace.id} open={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}

function CalendarLine({ status, email, error, failed, base }: { status?: string; email?: string; error?: string; failed: boolean; base: string }) {
  if (failed) return <p className="text-xs text-muted-foreground">Não foi possível consultar a agenda Google agora.</p>;
  if (!status) return <p className="text-xs text-muted-foreground">Agendadas na Vorix e na agenda conectada.</p>;
  if (status === "connected") return <p className="text-xs text-muted-foreground" data-calendar="connected">Google Agenda conectada{email ? ` (${email})` : ""}{error ? " — última sincronização com falha" : ""}.</p>;
  if (status === "reconnect_required") return <p className="text-xs text-amber-700 dark:text-amber-300" data-calendar="reconnect">Google Agenda precisa ser reconectada. <Link className="font-medium underline" href={`${base}/integrations`}>Reconectar</Link></p>;
  return <p className="text-xs text-muted-foreground" data-calendar="disconnected">Google Agenda não conectada. <Link className="font-medium text-primary hover:underline dark:text-primary-glow" href={`${base}/integrations`}>Conectar</Link></p>;
}

function UpcomingRow({ meeting, base }: { meeting: MeetingListItem; base: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="upcoming-row">
      <Link href={`${base}/central/${meeting.id}`} className="min-w-0 flex-1 hover:underline">
        <p className="truncate text-sm font-medium text-foreground">{meeting.title}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{formatDateTime(meetingWhen(meeting))} · {MEETING_SOURCE_LABEL[meeting.source]}{meeting.participantCount ? ` · ${participantsSummary(meeting)}` : ""}</p>
      </Link>
      {meeting.meetingUrl ? (
        <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted/50">
          <Video className="h-3.5 w-3.5" aria-hidden="true" /> Entrar
        </a>
      ) : null}
    </li>
  );
}

function MeetingRow({ meeting, base, note }: { meeting: MeetingListItem; base: string; note?: string }) {
  return (
    <li>
      <Link href={`${base}/central/${meeting.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-muted/40" data-testid="activity-row">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{meeting.title}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{note ?? formatDateTime(meetingWhen(meeting))}</p>
          {meeting.status === "completed" || meeting.status === "failed" ? <AvailabilityBadges item={meeting} /> : null}
        </div>
        <StatusPill status={meeting.status} />
      </Link>
    </li>
  );
}

function RecordOption({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) {
  return (
    <div className={cn("space-y-2 rounded-xl border border-border/60 p-3")}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><span className="text-muted-foreground">{icon}</span>{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
