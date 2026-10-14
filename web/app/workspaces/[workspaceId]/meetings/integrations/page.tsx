"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  GOOGLE_CALENDAR_RETURN_KEY,
  syncGoogleCalendar,
  useGoogleCalendarStatus,
  useGoogleSyncLog,
} from "@/features/meetings/agenda";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_LABEL = { not_connected: "Não conectado", connected: "Conectado", reconnect_required: "Precisa reconectar", disconnected: "Desconectado" } as const;
const ACTION_LABEL: Record<string, string> = {
  connect: "Conexão", disconnect: "Desconexão", token_refresh: "Renovação de acesso", create: "Criação", update: "Atualização", delete: "Remoção",
  cancel: "Cancelamento", conflict: "Conflito", sync_token_expired: "Recarga completa", full_sync: "Sincronização completa", incremental_sync: "Sincronização",
  relink_own_event: "Evento reconhecido", cancel_ignored_terminal: "Cancelamento ignorado (concluído)", sync: "Sincronização", push: "Envio",
};

/** Integrações do Vorix Meetings: Google Calendar por pessoa (cada um conecta a própria agenda). */
export default function MeetingsIntegrationsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const status = useGoogleCalendarStatus(workspace.id);
  const connected = status.data?.status === "connected" || status.data?.status === "reconnect_required";
  const log = useGoogleSyncLog(workspace.id, Boolean(connected));
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const canWrite = state.status === "authenticated" && state.role !== "viewer";

  async function connect() {
    setBusy(true);
    try {
      const { authorizationUrl } = await connectGoogleCalendar(workspace.id);
      window.sessionStorage.setItem(GOOGLE_CALENDAR_RETURN_KEY, `/workspaces/${workspace.id}/meetings/integrations`);
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error("Não foi possível iniciar a conexão", { description: error instanceof ApiError || error instanceof Error ? error.message : undefined });
      setBusy(false);
    }
  }

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await Promise.all([status.mutate(), log.mutate()]);
    } catch (error) {
      toast.error("Não foi possível concluir", { description: error instanceof ApiError || error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
    }
  }

  const data = status.data;
  return (
    <main className="mx-auto max-w-[1100px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Integrações" description="Conecte a sua agenda para as reuniões aparecerem aqui e no Google ao mesmo tempo." />
      {status.error ? <ErrorState error={status.error} onRetry={() => status.mutate()} /> : null}
      {!data && !status.error ? <Skeleton className="h-36 rounded-xl" /> : null}
      {data ? (
        <Card className="p-5" data-testid="google-calendar-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-primary-glow"><CalendarDays className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">Google Calendar</h2>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", data.status === "connected" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : data.status === "reconnect_required" ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : "bg-muted text-muted-foreground")} data-testid="google-calendar-status">{STATUS_LABEL[data.status]}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{data.googleEmail ?? "Sua agenda pessoal do Google, nos dois sentidos."}</p>
                {data.status === "reconnect_required" ? <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">Google Calendar precisa ser reconectado.</p> : null}
                {data.lastSyncedAt ? <p className="mt-2 text-xs text-muted-foreground">Última sincronização: {formatDateTime(data.lastSyncedAt)}</p> : null}
                {data.lastErrorMessage && data.status !== "reconnect_required" ? <p className="mt-1 text-xs text-destructive">Último erro: {data.lastErrorMessage}</p> : null}
                {!data.configured ? <p className="mt-2 text-xs text-muted-foreground">A integração com o Google ainda não está configurada neste servidor.</p> : null}
              </div>
            </div>
            {canWrite ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {data.status === "connected" ? (
                  <>
                    <Button variant="secondary" disabled={busy} onClick={() => act(() => syncGoogleCalendar(workspace.id), "Sincronização pedida — acontece em instantes.")}>Sincronizar agora</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
                  </>
                ) : (
                  <Button disabled={busy || !data.configured} onClick={connect}>{data.status === "reconnect_required" ? "Reconectar" : "Conectar"}</Button>
                )}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {connected && log.data && log.data.length > 0 ? (
        <Card className="p-0">
          <p className="border-b border-border/60 px-5 py-3 text-sm font-medium text-foreground">Atividade da sincronização</p>
          <ul className="divide-y divide-border/50 text-sm">
            {log.data.slice(0, 20).map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                <span className="text-foreground">{entry.direction === "pull" ? "Google → Vorix" : entry.direction === "push" ? "Vorix → Google" : "Conta"} · {ACTION_LABEL[entry.action] ?? entry.action}</span>
                <span className={cn("text-xs", entry.status === "error" || entry.status === "conflict" ? "text-destructive" : "text-muted-foreground")}>{entry.status === "ok" ? "" : `${entry.status} · `}{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Desconectar o Google Calendar?"
        description="Os eventos já trazidos continuam na Agenda; nada novo é sincronizado até você conectar de novo."
        confirmLabel="Desconectar"
        variant="danger"
        busy={busy}
        onConfirm={() => act(() => disconnectGoogleCalendar(workspace.id), "Google Calendar desconectado")}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </main>
  );
}
