"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { HumanIdentityField, announceRecordingRefusal, recorderAccountsHref } from "@/components/meetings/RecorderIdentity";
import { createMeeting, uploadMeetingRecording } from "@/features/meetings/api";
import { useRecordingCapacity } from "@/features/meetings/hooks";
import { MEETING_UPLOAD_ACCEPT, type RecordingRequestResult } from "@/features/meetings/types";
import { ApiError } from "@/lib/api-client";

export type MeetingDialogKind = "record" | "upload" | "new" | "in_person";

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : "Tente novamente.";
}

/** Revalida tudo do Meetings (Central, home, detalhe) depois de uma ação. */
function useRefreshMeetings() {
  const { mutate } = useSWRConfig();
  return () => mutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("meeting"));
}

function announceRecording(result: RecordingRequestResult | undefined, workspaceId: string, navigate: (href: string) => void) {
  if (!result) return;
  if (result.ok) toast.success("Gravação na fila", { description: "O gravador vai entrar na reunião. Acompanhe o status na Central." });
  else announceRecordingRefusal(result, workspaceId, navigate, "A reunião foi salva, mas a gravação não começou");
}

export function MeetingDialogs({ workspaceId, open, onClose }: { workspaceId: string; open: MeetingDialogKind | null; onClose: () => void }) {
  if (open === "record") return <RecordNowDialog workspaceId={workspaceId} onClose={onClose} />;
  if (open === "upload") return <UploadDialog workspaceId={workspaceId} onClose={onClose} />;
  if (open === "new") return <NewMeetingDialog workspaceId={workspaceId} onClose={onClose} />;
  if (open === "in_person") return <InPersonRecordingDialog workspaceId={workspaceId} onClose={onClose} />;
  return null;
}

/** Formato que o navegador grava + extensão aceita pelo upload (Chrome/Firefox: webm/ogg; Safari: mp4). */
function pickRecorderFormat(): { mimeType: string; extension: string; uploadType: string } | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const options = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm", uploadType: "audio/webm" },
    { mimeType: "audio/webm", extension: "webm", uploadType: "audio/webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg", uploadType: "audio/ogg" },
    { mimeType: "audio/mp4", extension: "m4a", uploadType: "audio/mp4" },
  ];
  return options.find((option) => MediaRecorder.isTypeSupported(option.mimeType));
}

/**
 * "Gravar reunião presencial": grava pelo microfone do computador ou do celular, direto no
 * navegador, e envia para a mesma esteira do upload (transcrição + resumo). Nada sai do aparelho
 * antes de a pessoa clicar em "Parar e enviar".
 */
function InPersonRecordingDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();
  const refresh = useRefreshMeetings();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "recording" | "paused" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const format = typeof window === "undefined" ? undefined : pickRecorderFormat();

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => undefined);
  };
  useEffect(() => cleanup, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (!format) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, audioBitsPerSecond: 64_000 });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start(10_000);
      recorderRef.current = recorder;
      // Medidor de volume: a pessoa vê que o microfone está captando.
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      timerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(data);
        setLevel(Math.min(1, data.reduce((sum, value) => sum + value, 0) / data.length / 90));
        if (recorderRef.current?.state === "recording") setElapsed((value) => value + 0.25);
      }, 250);
      setState("recording");
    } catch {
      toast.error("Não foi possível usar o microfone", { description: "Permita o acesso ao microfone no navegador e tente de novo." });
    }
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setState("paused"); } else { recorder.resume(); setState("recording"); }
  }

  async function stopAndUpload() {
    const recorder = recorderRef.current;
    if (!recorder || !format) return;
    setState("uploading");
    await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); });
    cleanup();
    const blob = new Blob(chunksRef.current, { type: format.uploadType });
    const when = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const fileToSend = new File([blob], `reuniao-presencial-${Date.now()}.${format.extension}`, { type: format.uploadType });
    try {
      const meeting = await uploadMeetingRecording(workspaceId, fileToSend, title.trim() || `Reunião presencial ${when}`);
      toast.success("Gravação enviada", { description: "A transcrição e o resumo saem em alguns minutos." });
      await refresh();
      onClose();
      router.push(`/workspaces/${workspaceId}/meetings/central/${meeting.id}`);
    } catch (error) {
      // Nada se perde: a pessoa pode baixar o áudio e enviar depois.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileToSend.name;
      link.click();
      toast.error("Não foi possível enviar — o áudio foi baixado no seu aparelho", { description: errorMessage(error) });
      setState("idle");
    }
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  return (
    <Modal title="Gravar reunião presencial" onClose={() => { if (state === "idle") onClose(); }}>
      <div className="space-y-4">
        {!format ? <p className="text-sm text-destructive">Este navegador não consegue gravar áudio. Use o Chrome, o Edge, o Firefox ou o Safari atualizado.</p> : null}
        <p className="text-sm text-muted-foreground">Grava pelo microfone deste computador ou celular. Deixe o aparelho perto de quem fala e avise os participantes que a reunião está sendo gravada.</p>
        <div>
          <Label htmlFor="in-person-title">Título (opcional)</Label>
          <Input id="in-person-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Visita ao cliente" disabled={state === "uploading"} />
        </div>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-6">
          <span className="font-mono text-3xl tabular-nums text-foreground" aria-live="polite">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-rose-500 transition-[width] duration-200" style={{ width: `${state === "recording" ? Math.max(4, level * 100) : 0}%` }} /></div>
          <span className="text-xs text-muted-foreground">{state === "recording" ? "Gravando…" : state === "paused" ? "Pausado" : state === "uploading" ? "Enviando…" : "Pronto para gravar"}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {state === "idle" ? (
            <>
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => void start()} disabled={!format}>Começar a gravar</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={togglePause} disabled={state === "uploading"}>{state === "paused" ? "Continuar" : "Pausar"}</Button>
              <Button onClick={() => void stopAndUpload()} loading={state === "uploading"} disabled={state === "uploading" || elapsed < 1}>Parar e enviar</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** "Gravar agora": link do Meet + título opcional. A reunião existe na hora, sem evento de Agenda. */
function RecordNowDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();
  const refresh = useRefreshMeetings();
  const capacity = useRecordingCapacity(workspaceId);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [humanEmail, setHumanEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = capacity.data?.knownHumanEmails ?? [];
  useEffect(() => {
    if (!humanEmail && suggestions.length === 1) setHumanEmail(suggestions[0]!);
  }, [suggestions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true);
    try {
      const result = await createMeeting({ workspaceId, source: "instant", meetingUrl, title: title || undefined, recordNow: true, humanJoinAccountEmail: humanEmail.trim() || undefined });
      announceRecording(result.recording, workspaceId, (href) => router.push(href));
      await refresh();
      onClose();
      router.push(`/workspaces/${workspaceId}/meetings/central/${result.meeting.id}`);
    } catch (error) {
      toast.error("Não foi possível criar a reunião", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Gravar reunião agora" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="record-url">Link do Google Meet</Label>
          <Input id="record-url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/abc-defg-hij" autoFocus />
        </div>
        <div>
          <Label htmlFor="record-title">Título (opcional)</Label>
          <Input id="record-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Ex.: Reunião com cliente" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Qual conta Google você utilizará para participar desta reunião?</p>
          <HumanIdentityField id="record-human" value={humanEmail} onChange={setHumanEmail} suggestions={suggestions} />
        </div>
        <p className="text-xs text-muted-foreground">Conta usada para gravação: o Vorix escolhe automaticamente uma das contas de gravação conectadas, sempre diferente da sua. Quem organiza o Meet precisa admitir a entrada.</p>
        {capacity.data && capacity.data.connectedAccounts === 0 ? (
          <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Nenhuma conta de gravação conectada ainda.{" "}
            {capacity.data.canManage ? <Link className="font-medium underline" href={recorderAccountsHref(workspaceId)}>Conectar conta de gravação</Link> : "Peça a um administrador para conectar uma."}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !meetingUrl.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(humanEmail.trim())}>Gravar agora</Button>
        </div>
      </div>
    </Modal>
  );
}

function UploadDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();
  const refresh = useRefreshMeetings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const meeting = await uploadMeetingRecording(workspaceId, file, title);
      toast.success("Gravação enviada", { description: "Ela já aparece na Central; a transcrição foi colocada na fila." });
      await refresh();
      onClose();
      router.push(`/workspaces/${workspaceId}/meetings/central/${meeting.id}`);
    } catch (error) {
      toast.error("Não foi possível enviar a gravação", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Enviar gravação" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="upload-file">Arquivo de áudio ou vídeo</Label>
          <input
            ref={inputRef}
            id="upload-file"
            type="file"
            accept={MEETING_UPLOAD_ACCEPT}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:h-9 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:text-sm file:font-medium file:text-foreground"
          />
          <p className="mt-1 text-xs text-muted-foreground">MP3, M4A, WAV, WEBM, OGG, MP4 ou MOV.</p>
        </div>
        <div>
          <Label htmlFor="upload-title">Título (opcional)</Label>
          <Input id="upload-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Ex.: Call de alinhamento" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !file}>Enviar</Button>
        </div>
      </div>
    </Modal>
  );
}

function toIso(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Reunião registrada à mão (com ou sem link). A Agenda com Google Calendar é uma etapa seguinte. */
function NewMeetingDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();
  const refresh = useRefreshMeetings();
  const [title, setTitle] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [participants, setParticipants] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await createMeeting({
        workspaceId,
        source: meetingUrl.trim() ? "external_link" : "manual",
        title,
        description: description || undefined,
        meetingUrl: meetingUrl.trim() || undefined,
        scheduledStartAt: toIso(date, start),
        scheduledEndAt: toIso(date, end),
        participants: participants
          .split(/[,;\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => (item.includes("@") ? { email: item } : { name: item })),
      });
      toast.success("Reunião criada");
      await refresh();
      onClose();
      router.push(`/workspaces/${workspaceId}/meetings/central/${result.meeting.id}`);
    } catch (error) {
      toast.error("Não foi possível criar a reunião", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova reunião" onClose={onClose} maxWidthClass="sm:max-w-xl">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label htmlFor="new-title">Título</Label>
          <Input id="new-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus />
        </div>
        <div>
          <Label htmlFor="new-date">Data</Label>
          <Input id="new-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-start">Início</Label>
          <Input id="new-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-end">Fim</Label>
          <Input id="new-end" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="new-url">Link do Google Meet (opcional)</Label>
          <Input id="new-url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/abc-defg-hij" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="new-participants">Participantes (nomes ou e-mails, separados por vírgula)</Label>
          <Input id="new-participants" value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder="ana@empresa.com, Bruno" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="new-description">Descrição</Label>
          <Textarea id="new-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} loading={busy} disabled={busy || !title.trim()}>Criar reunião</Button>
      </div>
    </Modal>
  );
}
