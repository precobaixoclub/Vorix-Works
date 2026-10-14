"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createAgendaEvent, updateAgendaEvent, type CalendarEvent } from "@/features/meetings/agenda";
import { ApiError } from "@/lib/api-client";

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "America/Noronha", "UTC", "America/New_York", "Europe/Lisbon"];

/** Data/hora de parede de um instante no fuso escolhido (para preencher o formulário). */
function zoned(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export function AgendaEventDialog({
  workspaceId,
  event,
  defaultDate,
  googleConnected,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  event?: CalendarEvent;
  defaultDate?: string;
  googleConnected: boolean;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
}) {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initialTz = event?.timezone ?? (TIMEZONES.includes(browserTz) ? browserTz : "America/Sao_Paulo");
  const start = event ? zoned(event.startAt, initialTz) : { date: defaultDate ?? new Date().toISOString().slice(0, 10), time: "09:00" };
  const end = event ? zoned(event.endAt, initialTz) : { date: start.date, time: "10:00" };
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [date, setDate] = useState(start.date);
  const [endDate, setEndDate] = useState(event?.allDay ? previousDay(end.date) : end.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [timezone, setTimezone] = useState(initialTz);
  const [participants, setParticipants] = useState((event?.attendees ?? []).join(", "));
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [syncToGoogle, setSyncToGoogle] = useState(event?.syncToGoogle ?? googleConnected);
  const [createMeet, setCreateMeet] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  const [joinBefore, setJoinBefore] = useState("2");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const times = allDay ? { allDay: true, start: date, end: endDate || date, timezone } : { allDay: false, start: `${date}T${startTime}`, end: `${allDay ? endDate : date}T${endTime}`, timezone };
    const attendees = participants.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
    try {
      const saved = event
        ? await updateAgendaEvent(event.id, { workspaceId, title, description: description || null, location: location || null, attendees, ...times })
        : await createAgendaEvent({
            workspaceId,
            title,
            ...(description ? { description } : {}),
            ...(location ? { location } : {}),
            attendees,
            ...times,
            syncToGoogle: googleConnected && syncToGoogle,
            createMeetLink: googleConnected && syncToGoogle && createMeet,
            autoRecord,
            ...(autoRecord ? { joinBeforeMinutes: Number(joinBefore) || 0 } : {}),
          });
      toast.success(event ? "Evento atualizado" : "Evento criado", googleConnected && saved.syncToGoogle ? { description: "Vai para o Google Calendar na próxima sincronização." } : undefined);
      if (saved.recordingCapacityWarning) toast.warning("Limite de gravações simultâneas", { description: saved.recordingCapacityWarning });
      onSaved(saved);
    } catch (error) {
      toast.error("Não foi possível salvar", { description: error instanceof ApiError || error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={event ? "Editar evento" : "Nova reunião"} onClose={onClose} maxWidthClass="sm:max-w-xl">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label htmlFor="agenda-title">Título</Label>
          <Input id="agenda-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="Dia inteiro" /> Dia inteiro
        </label>
        <div>
          <Label htmlFor="agenda-date">{allDay ? "Primeiro dia" : "Data"}</Label>
          <Input id="agenda-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {allDay ? (
          <div>
            <Label htmlFor="agenda-end-date">Último dia</Label>
            <Input id="agenda-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="agenda-start">Início</Label>
              <Input id="agenda-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="agenda-end">Fim</Label>
              <Input id="agenda-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </>
        )}
        <div className={allDay ? "sm:col-span-1" : "sm:col-span-3"}>
          <Label htmlFor="agenda-tz">Fuso horário</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="agenda-tz"><SelectValue /></SelectTrigger>
            <SelectContent>{TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="agenda-participants">Participantes (e-mails)</Label>
          <Input id="agenda-participants" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="ana@empresa.com, bruno@cliente.com" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="agenda-location">Local ou link</Label>
          <Input id="agenda-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala 2 ou https://meet.google.com/abc-defg-hij" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="agenda-description">Descrição</Label>
          <Textarea id="agenda-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
        </div>
        {!event ? (
          <div className="space-y-2 rounded-lg border border-border/60 p-3 text-sm sm:col-span-3">
            <label className="flex items-center justify-between gap-3">
              <span>Google Calendar {googleConnected ? "" : <span className="text-xs text-muted-foreground">(conecte em Integrações)</span>}</span>
              <Switch checked={googleConnected && syncToGoogle} onCheckedChange={setSyncToGoogle} disabled={!googleConnected} aria-label="Enviar ao Google Calendar" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Gerar Google Meet</span>
              <Switch checked={googleConnected && syncToGoogle && createMeet} onCheckedChange={setCreateMeet} disabled={!googleConnected || !syncToGoogle} aria-label="Gerar Google Meet" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Gravar automaticamente</span>
              <Switch checked={autoRecord} onCheckedChange={setAutoRecord} aria-label="Gravar automaticamente" />
            </label>
            {autoRecord ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Entrar</span>
                <Input type="number" min={0} max={30} value={joinBefore} onChange={(e) => setJoinBefore(e.target.value)} className="h-8 w-16" aria-label="Minutos antes" />
                <span>minuto(s) antes. O bot visível Vorix Recorder solicitará entrada; confirme o consentimento dos participantes.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} loading={busy} disabled={busy || !title.trim() || !date}>{event ? "Salvar" : "Criar"}</Button>
      </div>
    </Modal>
  );
}
