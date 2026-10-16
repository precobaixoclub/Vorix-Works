"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { getSharedMeeting, type SharedMeeting } from "@/features/meetings/intelligence";
import { formatDuration, formatTimestamp } from "@/features/meetings/presentation";

/** Link compartilhado de uma reunião do Vorix Meetings — sem login (o token é a autorização). */
export default function SharedMeetingPage() {
  const params = useParams<{ token: string }>();
  const [meeting, setMeeting] = useState<SharedMeeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSharedMeeting(params.token).then(setMeeting).catch(() => setError("Este link não existe mais ou expirou. Peça um novo link a quem compartilhou."));
  }, [params.token]);
  // O endereço da gravação vale por pouco tempo: ao falhar (expirou), busca um novo e volta ao ponto.
  async function renewRecording(element: HTMLMediaElement) {
    const position = element.currentTime;
    try {
      const fresh = await getSharedMeeting(params.token);
      if (!fresh.recording) return;
      setMeeting((current) => (current ? { ...current, recording: fresh.recording } : current));
      requestAnimationFrame(() => { element.currentTime = position; });
    } catch {
      setError("Este link não existe mais ou expirou. Peça um novo link a quem compartilhou.");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <span className="text-xs text-muted-foreground">Reunião compartilhada pelo Vorix Meetings</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {error ? <p className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">{error}</p> : null}
        {!meeting && !error ? <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div> : null}
        {meeting ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{meeting.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {meeting.date ? new Date(meeting.date).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : ""}
                {meeting.durationSeconds ? ` · ${formatDuration(meeting.durationSeconds)}` : ""}
                {meeting.expiresAt ? ` · link válido até ${new Date(meeting.expiresAt).toLocaleDateString("pt-BR")}` : ""}
              </p>
            </div>
            {meeting.recording ? (
              meeting.recording.mimeType.startsWith("video/")
                // eslint-disable-next-line jsx-a11y/media-has-caption
                ? <video key={meeting.recording.url} src={meeting.recording.url} controls preload="metadata" className="w-full rounded-xl bg-black" onError={(event) => void renewRecording(event.currentTarget)} />
                // eslint-disable-next-line jsx-a11y/media-has-caption
                : <audio key={meeting.recording.url} src={meeting.recording.url} controls preload="metadata" className="w-full" onError={(event) => void renewRecording(event.currentTarget)} />
            ) : null}
            {meeting.summary ? (
              <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
                <div><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo</h2><p className="mt-1 whitespace-pre-line text-sm text-foreground">{meeting.summary.executiveSummary}</p></div>
                {(meeting.summary.templateSections ?? []).map((section) => <div key={section.title}><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h2><p className="mt-1 whitespace-pre-line text-sm text-foreground">{section.content}</p></div>)}
                <List title="Decisões" items={meeting.summary.decisions} />
                <List title="Tarefas" items={meeting.summary.actionItems.map((item) => `${item.description}${item.owner ? ` — ${item.owner}` : ""}${item.dueDate ? ` (prazo: ${item.dueDate})` : ""}`)} />
                <List title="Próximos passos" items={meeting.summary.nextSteps} />
              </section>
            ) : <p className="text-sm text-muted-foreground">O resumo desta reunião ainda não está pronto.</p>}
            {meeting.transcript?.length ? (
              <section className="rounded-xl border border-border/60 bg-card p-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcrição</h2>
                <ol className="space-y-1 text-sm">
                  {meeting.transcript.map((segment, index) => <li key={index} className="flex gap-3"><span className="w-12 shrink-0 tabular-nums text-xs text-primary dark:text-primary-glow">{formatTimestamp(segment.startMs)}</span><span>{segment.speaker ? <strong className="text-foreground">{segment.speaker}: </strong> : null}<span className="text-foreground/90">{segment.text}</span></span></li>)}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>;
}
