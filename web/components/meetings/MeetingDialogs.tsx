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

export type MeetingDialogKind = "record" | "upload" | "new";

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
  return null;
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
