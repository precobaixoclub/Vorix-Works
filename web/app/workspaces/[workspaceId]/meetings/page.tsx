"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, CircleDot, Clock3, FileText, Loader2, Video } from "lucide-react";
import { Button } from "@/components/Button";
import { KpiCard } from "@/components/DashboardKit";
import { ErrorState } from "@/components/ErrorState";
import { MeetingDialogs, type MeetingDialogKind } from "@/components/meetings/MeetingDialogs";
import { StatusPill } from "@/components/meetings/MeetingsCentral";
import { PageHeader } from "@/components/PageHeader";
import { StatsGrid } from "@/components/StatsGrid";
import { Card } from "@/components/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMeetings, useMeetingsDashboard, useRecordingCapacity } from "@/features/meetings/hooks";
import { formatHours, meetingWhen } from "@/features/meetings/presentation";
import { formatDateTime } from "@/lib/format";

const RECENT_FILTERS = {};

/** Home do Vorix Meetings: o que acontece hoje, o que está gravando/processando e os atalhos. */
export default function MeetingsHomePage() {
  const workspace = useCurrentWorkspace();
  const [dialog, setDialog] = useState<MeetingDialogKind | null>(null);
  const dashboard = useMeetingsDashboard(workspace.id);
  const recent = useMeetings(workspace.id, RECENT_FILTERS);
  const capacity = useRecordingCapacity(workspace.id);
  const data = dashboard.data;
  const base = `/workspaces/${workspace.id}/meetings`;

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Vorix Meetings"
        description="Reuniões gravadas, transcritas e resumidas — todas num só lugar."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("new")}>Nova reunião</Button>
            <Button variant="secondary" onClick={() => setDialog("upload")}>Enviar gravação</Button>
            <Button onClick={() => setDialog("record")}>Gravar agora</Button>
          </div>
        }
      />

      {dashboard.error ? <ErrorState error={dashboard.error} onRetry={() => dashboard.mutate()} /> : null}
      {!data && !dashboard.error ? <Skeleton className="h-28 rounded-xl" /> : null}
      {data ? (
        <>
          {!data.realRecordingEnabled ? (
            <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              A gravação automática por bot ainda não está habilitada neste ambiente. Você já pode enviar gravações e registrar reuniões.
            </Card>
          ) : null}
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

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            <p className="text-base font-medium text-foreground">Reuniões recentes</p>
            <p className="text-xs text-muted-foreground">De qualquer origem: agendadas, gravadas agora ou enviadas.</p>
          </div>
          <Link href={`${base}/central`} className="text-sm font-medium text-primary hover:underline dark:text-primary-glow">Ver todas</Link>
        </div>
        {recent.error ? <div className="p-5"><ErrorState error={recent.error} onRetry={() => recent.mutate()} /></div> : null}
        {!recent.data && !recent.error ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : null}
        {recent.data && recent.data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <Video className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma reunião ainda. Grave uma reunião agora ou envie uma gravação para começar.</p>
          </div>
        ) : null}
        {recent.data && recent.data.items.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {recent.data.items.slice(0, 6).map((meeting) => (
              <li key={meeting.id}>
                <Link href={`${base}/central/${meeting.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{meeting.title}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{formatDateTime(meetingWhen(meeting))}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {meeting.transcriptStatus === "completed" ? <FileText className="h-4 w-4 text-muted-foreground" aria-label="Com transcrição" /> : null}
                    <StatusPill status={meeting.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <MeetingDialogs workspaceId={workspace.id} open={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}
