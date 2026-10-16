"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMeeting, useMeetingTranscript } from "@/features/meetings/hooks";
import { useMeetingInsights } from "@/features/meetings/intelligence";
import { formatTimestamp, meetingWhen } from "@/features/meetings/presentation";
import { formatDateTime } from "@/lib/format";

/** Versão para imprimir / salvar em PDF (o navegador gera o PDF). Abre o diálogo de impressão sozinho. */
export default function MeetingPrintPage() {
  const params = useParams<{ meetingId: string }>();
  const workspace = useCurrentWorkspace();
  const { data: meeting, error: meetingError } = useMeeting(workspace.id, params.meetingId);
  const transcript = useMeetingTranscript(workspace.id, params.meetingId, meeting?.transcript?.status === "completed");
  const insights = useMeetingInsights(workspace.id, params.meetingId);
  // Sem transcrição ou sem painel (erro) imprime o que tiver — nunca fica "Preparando…" para sempre.
  const ready = meeting && (meeting.transcript?.status !== "completed" || transcript.data || transcript.error) && (insights.data || insights.error);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [ready]);
  if (meetingError) return <p className="p-8 text-sm text-destructive">Não foi possível carregar a reunião para impressão.</p>;
  if (!meeting) return <p className="p-8 text-sm text-muted-foreground">Preparando…</p>;
  const analysis = meeting.lastCompletedAnalysis?.result ?? meeting.latestAnalysis?.result;
  const names = new Map((insights.data?.speakers ?? []).map((speaker) => [speaker.key, speaker.displayName]));
  const list = (title: string, items: string[]) => (items.length ? <section className="mt-5"><h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2><ul className="mt-1 list-disc pl-5 text-sm">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null);
  return (
    <article id="meeting-print" className="mx-auto max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-black print:p-0">
      <style>{"@media print { body * { visibility: hidden !important; } #meeting-print, #meeting-print * { visibility: visible !important; } #meeting-print { position: absolute; inset: 0; } @page { margin: 18mm; } }"}</style>
      <h1 className="text-2xl font-semibold">{meeting.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">{formatDateTime(meetingWhen(meeting))}{meeting.participants.length ? ` · ${meeting.participants.map((participant) => participant.name ?? participant.email).join(", ")}` : ""}</p>
      {analysis ? (
        <>
          <section className="mt-6"><h2 className="text-sm font-semibold uppercase tracking-wide">Resumo</h2><p className="mt-1 whitespace-pre-line">{analysis.executiveSummary}</p></section>
          {(analysis.templateSections ?? []).map((section) => <section key={section.title} className="mt-5"><h2 className="text-sm font-semibold uppercase tracking-wide">{section.title}</h2><p className="mt-1 whitespace-pre-line">{section.content}</p></section>)}
          {list("Decisões", analysis.decisions)}
          {list("Tarefas", analysis.actionItems.map((item) => `${item.description}${item.owner ? ` — ${item.owner}` : ""}${item.dueDate ? ` (prazo: ${item.dueDate})` : ""}`))}
          {list("Próximos passos", analysis.nextSteps)}
          {list("Perguntas em aberto", analysis.openQuestions)}
        </>
      ) : null}
      {transcript.data?.segments.length ? (
        <section className="mt-8 break-before-page">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Transcrição</h2>
          <ol className="mt-2 space-y-1">
            {transcript.data.segments.map((segment) => <li key={segment.seq}><span className="tabular-nums text-neutral-500">[{formatTimestamp(segment.startMs)}]</span> {segment.speaker ? <strong>{names.get(segment.speaker) ?? segment.speaker}: </strong> : null}{segment.text}</li>)}
          </ol>
        </section>
      ) : null}
      <p className="mt-10 text-[11px] text-neutral-500">Gerado pelo Vorix Meetings.</p>
    </article>
  );
}
