"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/Spinner";
import { dismissAllNotifications, dismissNotification } from "@/features/notification/api";
import { useNotificationHistory, useNotifications, useNotificationsRealtime } from "@/features/notification/hooks";
import type { Notification } from "@/features/notification/types";
import { cn } from "@/lib/utils";

/**
 * Central de notificações in-app ("sino"), réplica adaptada do CMDesk (pedido explícito do
 * usuário, relatório "Agenda e Central de Notificações no CMDesk") — SUBSTITUI a versão anterior
 * (placeholder que só linkava pra Revisão via `useExecutionRuns`, "zero backend novo"). Agora tem
 * backend real (`/v1/notifications/*`), persistência, contagem de não lidas de verdade e tempo
 * real via SSE.
 */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [busyId, setBusyId] = useState<string | undefined>();

  const { data: activeData, mutate: mutateActive } = useNotifications(workspaceId);
  const { data: historyData, isLoading: historyLoading } = useNotificationHistory(workspaceId, open && tab === "history");
  useNotificationsRealtime(workspaceId);

  const active = activeData?.notifications ?? [];
  const history = historyData?.notifications ?? [];
  const unreadCount = active.length;

  async function handleDismiss(notification: Notification) {
    setBusyId(notification.id);
    try {
      await dismissNotification(workspaceId, notification.id);
      await mutateActive();
    } catch {
      // Best-effort — a próxima revalidação (SSE/polling) eventualmente corrige a UI.
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleDismissAll() {
    setBusyId("__all__");
    try {
      await dismissAllNotifications(workspaceId);
      await mutateActive();
    } catch {
      // Best-effort.
    } finally {
      setBusyId(undefined);
    }
  }

  function handleOpenNotification(notification: Notification) {
    setOpen(false);
    if (notification.sourceUrl) router.push(notification.sourceUrl);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-sunken hover:text-ink"
          aria-label={unreadCount > 0 ? `${unreadCount} notificação(ões) nova(s)` : "Nenhuma notificação nova"}
          title="Notificações"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={cn("rounded-md px-2 py-1 text-xs font-medium", tab === "active" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Novas
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={cn("rounded-md px-2 py-1 text-xs font-medium", tab === "history" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Anteriores
            </button>
          </div>
          {tab === "active" && active.length > 0 ? (
            <Button variant="ghost" size="sm" disabled={busyId === "__all__"} onClick={handleDismissAll} className="h-7 gap-1 px-2 text-xs">
              <CheckCheck className="h-3.5 w-3.5" /> Marcar todas
            </Button>
          ) : null}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tab === "active" ? (
            active.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação nova.</p>
            ) : (
              active.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  busy={busyId === notification.id}
                  onOpen={() => handleOpenNotification(notification)}
                  onDismiss={() => handleDismiss(notification)}
                />
              ))
            )
          ) : historyLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5 text-primary" />
            </div>
          ) : history.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação no histórico.</p>
          ) : (
            history.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} busy={false} onOpen={() => handleOpenNotification(notification)} />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  notification,
  busy,
  onOpen,
  onDismiss,
}: {
  notification: Notification;
  busy: boolean;
  onOpen: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 last:border-b-0",
        !notification.dismissedAt && "bg-primary/5",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{notification.title}</p>
        {notification.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.body}</p> : null}
        <p className="mt-1 text-[11px] text-muted-foreground">{relativeTimeLabel(notification.createdAt)}</p>
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Marcar como lida"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function relativeTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return "agora";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `há ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `há ${diffDays}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
