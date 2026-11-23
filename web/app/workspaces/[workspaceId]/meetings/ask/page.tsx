"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Sparkles } from "lucide-react";
import { AskMeetingPanel } from "@/components/meetings/MeetingIntelligence";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useMeetings } from "@/features/meetings/hooks";
import { listAllMeetingQuestions, type MeetingQuestion } from "@/features/meetings/intelligence";
import { meetingWhen } from "@/features/meetings/presentation";
import { formatDateTime } from "@/lib/format";

const NO_QUESTIONS: MeetingQuestion[] = [];
const TRANSCRIBED = { hasTranscript: true } as const;

/**
 * Análises (Fase 9): os resultados da IA num lugar — as reuniões que já têm resumo, decisões e
 * próximos passos (cada uma abre direto no resumo) e as perguntas sobre TODAS as reuniões. A lista
 * vem da MESMA consulta que a página já fazia para os títulos (reuniões com transcrição); nenhuma
 * transcrição é baixada aqui.
 */
export default function MeetingsAskPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  // Perguntar usa crédito de IA: quem só visualiza (viewer) não pergunta.
  const canAsk = state.status === "authenticated" && state.role !== "viewer";
  const history = useSWR(["meeting-questions-all", workspace.id], () => listAllMeetingQuestions(workspace.id));
  const meetings = useMeetings(workspace.id, TRANSCRIBED);
  const titles = Object.fromEntries((meetings.data?.items ?? []).map((meeting) => [meeting.id, meeting.title]));
  const base = `/workspaces/${workspace.id}/meetings`;
  const analyzed = useMemo(() => (meetings.data?.items ?? []).filter((meeting) => meeting.hasAnalysis).sort((a, b) => Date.parse(meetingWhen(b)) - Date.parse(meetingWhen(a))), [meetings.data]);
  const waiting = (meetings.data?.items ?? []).filter((meeting) => !meeting.hasAnalysis && meeting.status !== "failed").length;

  return (
    <main className="mx-auto max-w-[960px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Análises" description="Resumos, decisões e próximos passos que a IA encontrou nas suas reuniões — e perguntas sobre todas elas." />

      <Card className="p-0" data-testid="analyzed-meetings">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="text-base font-medium text-foreground">Reuniões analisadas</h2>
            <p className="text-xs text-muted-foreground">Gerado pela IA a partir da transcrição — confira na gravação antes de decidir.{waiting ? ` ${waiting === 1 ? "1 reunião aguarda" : `${waiting} reuniões aguardam`} análise.` : ""}</p>
          </div>
          <Link href={`${base}/central?visao=analisadas`} className="text-sm font-medium text-primary hover:underline dark:text-primary-glow">Ver todas</Link>
        </div>
        {meetings.error ? <div className="p-5"><ErrorState error={meetings.error} onRetry={() => meetings.mutate()} /></div> : null}
        {!meetings.data && !meetings.error ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : null}
        {meetings.data && analyzed.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma análise pronta ainda. A IA resume cada reunião alguns minutos depois da transcrição.</p> : null}
        <ul className="divide-y divide-border/60">
          {analyzed.slice(0, 8).map((meeting) => (
            <li key={meeting.id}>
              <Link href={`${base}/central/${meeting.id}?secao=summary`} className="flex min-h-[48px] items-center gap-3 px-5 py-3 hover:bg-muted/40" data-testid="analyzed-row">
                <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-primary dark:text-primary-glow" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{meeting.title}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">{formatDateTime(meetingWhen(meeting))}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Ver resumo</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <section className="space-y-3" aria-labelledby="ask-title">
        <div>
          <h2 id="ask-title" className="text-base font-medium text-foreground">Pergunte às reuniões</h2>
          <p className="text-xs text-muted-foreground">A IA procura a resposta nas transcrições de {meetings.data ? `${meetings.data.total} ${meetings.data.total === 1 ? "reunião" : "reuniões"}` : "todas as suas reuniões"} e mostra de onde tirou.</p>
        </div>
        {history.error ? <ErrorState error={history.error} onRetry={() => history.mutate()} /> : null}
        {!history.data && !history.error ? <Skeleton className="h-40 rounded-xl" /> : null}
        {history.data || history.error ? <AskMeetingPanel workspaceId={workspace.id} initial={history.data ?? NO_QUESTIONS} aiAvailable={canAsk} meetingTitles={titles} /> : null}
        {!canAsk ? <p className="text-sm text-muted-foreground">Seu papel permite ver as reuniões, mas não fazer perguntas à IA.</p> : null}
      </section>
    </main>
  );
}
