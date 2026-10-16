"use client";

import useSWR from "swr";
import { AskMeetingPanel } from "@/components/meetings/MeetingIntelligence";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useMeetings } from "@/features/meetings/hooks";
import { listAllMeetingQuestions, type MeetingQuestion } from "@/features/meetings/intelligence";

const NO_QUESTIONS: MeetingQuestion[] = [];

/** "Pergunte às reuniões": uma pergunta sobre TODAS as reuniões que a pessoa pode ver. */
export default function MeetingsAskPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  // Perguntar usa crédito de IA: quem só visualiza (viewer) não pergunta.
  const canAsk = state.status === "authenticated" && state.role !== "viewer";
  const history = useSWR(["meeting-questions-all", workspace.id], () => listAllMeetingQuestions(workspace.id));
  const meetings = useMeetings(workspace.id, { hasTranscript: true });
  const titles = Object.fromEntries((meetings.data?.items ?? []).map((meeting) => [meeting.id, meeting.title]));
  return (
    <main className="mx-auto max-w-[960px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Pergunte às reuniões" description={`A IA procura a resposta nas transcrições de ${meetings.data ? `${meetings.data.total} ${meetings.data.total === 1 ? "reunião" : "reuniões"}` : "todas as suas reuniões"} e mostra de onde tirou.`} />
      {history.error ? <ErrorState error={history.error} onRetry={() => history.mutate()} /> : null}
      {!history.data && !history.error ? <Skeleton className="h-40 rounded-xl" /> : null}
      {history.data || history.error ? <AskMeetingPanel workspaceId={workspace.id} initial={history.data ?? NO_QUESTIONS} aiAvailable={canAsk} meetingTitles={titles} /> : null}
      {!canAsk ? <p className="text-sm text-muted-foreground">Seu papel permite ver as reuniões, mas não fazer perguntas à IA.</p> : null}
    </main>
  );
}
