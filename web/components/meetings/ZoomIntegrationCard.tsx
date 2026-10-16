"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { apiClient, ApiError } from "@/lib/api-client";

export const ZOOM_RETURN_KEY = "vorix.meetings.zoom.return";
type ZoomStatus = { configured: boolean; connected: boolean; email?: string };
type ZoomRecording = { uuid: string; topic: string; startTime?: string; durationMinutes?: number; hasAudio: boolean; hasTranscript: boolean; importedMeetingId?: string };
const q = encodeURIComponent;
const errorText = (cause: unknown) => (cause instanceof ApiError || cause instanceof Error ? cause.message : undefined);

export const completeZoom = (state: string, code: string) => apiClient.post<{ connected: true; workspaceId: string; email?: string }>("/v1/meetings/zoom/callback", { state, code });

/** Zoom: conectar a conta e importar gravações em nuvem (com a transcrição do Zoom, quando existir). */
export function ZoomIntegrationCard({ workspaceId, canWrite }: { workspaceId: string; canWrite: boolean }) {
  const status = useSWR(["meetings-zoom-status", workspaceId], () => apiClient.get<ZoomStatus>(`/v1/meetings/zoom/status?workspaceId=${q(workspaceId)}`));
  const connected = status.data?.connected === true;
  const recordings = useSWR(connected ? ["meetings-zoom-recordings", workspaceId] : null, () => apiClient.get<ZoomRecording[]>(`/v1/meetings/zoom/recordings?workspaceId=${q(workspaceId)}&days=30`));
  const [busy, setBusy] = useState<string | null>(null);

  async function connect() {
    setBusy("connect");
    try {
      const { authorizationUrl } = await apiClient.post<{ authorizationUrl: string }>("/v1/meetings/zoom/connect", { workspaceId });
      window.sessionStorage.setItem(ZOOM_RETURN_KEY, `/workspaces/${workspaceId}/meetings/integrations`);
      window.location.assign(authorizationUrl);
    } catch (cause) {
      toast.error("Não foi possível conectar o Zoom", { description: errorText(cause) });
      setBusy(null);
    }
  }
  async function disconnect() {
    setBusy("disconnect");
    try {
      await apiClient.post("/v1/meetings/zoom/disconnect", { workspaceId });
      await status.mutate();
      toast.success("Zoom desconectado");
    } catch (cause) {
      toast.error("Não foi possível desconectar", { description: errorText(cause) });
    } finally {
      setBusy(null);
    }
  }
  async function importRecording(uuid: string) {
    setBusy(uuid);
    try {
      const meeting = await apiClient.post<{ id: string }>("/v1/meetings/zoom/import", { workspaceId, meetingUuid: uuid });
      toast.success("Gravação importada", { description: "O resumo aparece na reunião em alguns minutos.", action: { label: "Abrir", onClick: () => { window.location.href = `/workspaces/${workspaceId}/meetings/central/${meeting.id}`; } } });
      await recordings.mutate();
    } catch (cause) {
      toast.error("Não foi possível importar", { description: errorText(cause) });
    } finally {
      setBusy(null);
    }
  }

  if (!status.data) return null;
  return (
    <Card className="space-y-4 p-5" data-testid="zoom-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300"><Video className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-medium text-foreground">Zoom</h2>
            <p className="text-sm text-muted-foreground">Importe as gravações em nuvem do Zoom: o Vorix usa a transcrição do próprio Zoom (com os nomes) ou transcreve o áudio, e gera o resumo.</p>
            {connected ? <p className="mt-1 text-xs text-muted-foreground">Conectado{status.data.email ? ` como ${status.data.email}` : ""}.</p> : null}
            {!status.data.configured ? <p className="mt-1 text-xs text-muted-foreground">A integração com o Zoom ainda não foi configurada neste servidor.</p> : null}
          </div>
        </div>
        {status.data.configured ? (
          connected
            ? <Button variant="secondary" onClick={() => void disconnect()} loading={busy === "disconnect"} disabled={!!busy}>Desconectar</Button>
            : <Button onClick={() => void connect()} loading={busy === "connect"} disabled={!!busy || !canWrite}>Conectar Zoom</Button>
        ) : null}
      </div>
      {connected ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gravações em nuvem dos últimos 30 dias</p>
          {recordings.error ? <p className="text-sm text-destructive">{errorText(recordings.error)}</p> : null}
          {recordings.data?.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma gravação em nuvem no período. Grave a reunião "na nuvem" no Zoom para ela aparecer aqui.</p> : null}
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {(recordings.data ?? []).map((recording) => (
              <li key={recording.uuid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{recording.topic}</p>
                  <p className="text-xs text-muted-foreground">{recording.startTime ? new Date(recording.startTime).toLocaleString("pt-BR") : ""}{recording.durationMinutes ? ` · ${recording.durationMinutes} min` : ""}{recording.hasTranscript ? " · com transcrição do Zoom" : ""}</p>
                </div>
                {recording.importedMeetingId ? (
                  <Button size="sm" variant="ghost" asChild><Link href={`/workspaces/${workspaceId}/meetings/central/${recording.importedMeetingId}`}>Ver reunião</Link></Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void importRecording(recording.uuid)} loading={busy === recording.uuid} disabled={!!busy || !recording.hasAudio || !canWrite}>{recording.hasAudio ? "Importar" : "Processando no Zoom"}</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
