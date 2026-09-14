"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { getApiBaseUrl } from "@/lib/api-error";
import { getInboxMediaToken } from "@/features/inbox/api";
import type { InboxMessage } from "@/features/inbox/types";
import { cn } from "@/lib/utils";
import { mediaIconFor, mediaLabelFor } from "./inbox-tab";

/**
 * Redesign operacional (mídia real) — renderizadores reais de imagem/áudio/vídeo/documento,
 * substituindo o antigo fallback estático ("Imagem recebida" etc.). `mediaLabelFor`/`mediaIconFor`
 * (de `inbox-tab.tsx`) continuam existindo só como o estado de erro/fallback abaixo — nunca mais
 * o caminho feliz.
 */

type MediaUrlState = { status: "idle" | "loading" | "ready" | "error"; url?: string };

function useMediaUrl(workspaceId: string, message: InboxMessage) {
  const [state, setState] = useState<MediaUrlState>({ status: "idle" });
  const requestIdRef = useRef(0);

  async function load() {
    if (!message.mediaStorageRef) return;
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    try {
      const { mediaToken } = await getInboxMediaToken(workspaceId, message.id);
      if (requestIdRef.current !== requestId) return;
      const query = new URLSearchParams({ media_token: mediaToken });
      setState({ status: "ready", url: `${getApiBaseUrl()}/v1/inbox/media/${encodeURIComponent(message.id)}?${query.toString()}` });
    } catch {
      if (requestIdRef.current === requestId) setState({ status: "error" });
    }
  }

  return { state, load };
}

function formatFileSize(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || Number.isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const MEDIA_ERROR_LABEL: Record<InboxMessage["type"], string> = {
  image: "Não foi possível carregar esta imagem.",
  video: "Não foi possível carregar este vídeo.",
  audio: "Não foi possível carregar este áudio.",
  document: "Não foi possível carregar este documento.",
  location: "Não foi possível carregar esta localização.",
  contact: "Não foi possível carregar este contato.",
  text: "Não foi possível carregar esta mensagem.",
  other: "Não foi possível carregar esta mídia.",
};

/** `retry` presente = falha real ao BUSCAR uma mídia que existe (seção 17/40 do pedido original:
 * mensagem específica de erro + botão, nunca o rótulo genérico de "ainda processando"). Sem
 * `retry` = a mídia nunca chegou a ser baixada (best-effort assíncrono, ver `downloadInboundMediaAndAttach`)
 * — não dá pra distinguir "ainda processando" de "nunca vai chegar" sem um campo de status
 * dedicado nesta rodada, então usa o rótulo neutro (nunca "erro" quando pode só estar em voo). */
function MediaFallback({ type, retry }: { type: InboxMessage["type"]; retry?: () => void }) {
  const Icon = mediaIconFor(type);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-xs">{retry ? MEDIA_ERROR_LABEL[type] : mediaLabelFor(type)}</span>
      {retry ? (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export function MessageMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  if (!message.mediaStorageRef) {
    // Mídia ainda não foi baixada (best-effort/assíncrono — pode chegar em instantes) ou nunca
    // será (download falhou/não configurado). Mesmo rótulo nos dois casos: não dá para o
    // frontend distinguir "ainda processando" de "nunca vai chegar" sem um campo de status
    // dedicado, e não vale a pena inventar um polling só para isso nesta rodada.
    return <MediaFallback type={message.type} />;
  }
  if (message.type === "image") return <ImageMedia workspaceId={workspaceId} message={message} />;
  if (message.type === "audio") return <AudioMedia workspaceId={workspaceId} message={message} />;
  if (message.type === "video") return <VideoMedia workspaceId={workspaceId} message={message} />;
  if (message.type === "document") return <DocumentMedia workspaceId={workspaceId} message={message} />;
  return <MediaFallback type={message.type} />;
}

function ImageMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  if (state.status === "error") return <MediaFallback type="image" retry={load} />;
  if (state.status !== "ready" || !state.url) {
    return (
      <div className="flex h-40 w-56 items-center justify-center rounded-lg bg-muted/70">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className="block max-w-[260px] overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia privada servida via proxy autenticado, nunca otimizável pelo loader padrão do Next */}
        <img src={state.url} alt="Imagem recebida" loading="lazy" className="max-h-72 w-full object-cover" />
      </button>
      {lightboxOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4" onClick={() => setLightboxOpen(false)}>
          <button type="button" aria-label="Fechar" className="absolute right-4 top-4 text-foreground/80 hover:text-foreground" onClick={() => setLightboxOpen(false)}>
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.url} alt="Imagem recebida (ampliada)" className="max-h-full max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

function AudioMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(message.metadata?.durationSeconds ?? 0);

  function togglePlay() {
    if (state.status === "idle") {
      void load();
      return;
    }
    if (state.status !== "ready") return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  }

  if (state.status === "error") return <MediaFallback type="audio" retry={load} />;

  return (
    <div className="flex w-64 items-center gap-2 rounded-lg bg-muted/70 px-3 py-2">
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={togglePlay} disabled={state.status === "loading"} aria-label={playing ? "Pausar" : "Reproduzir"}>
        {state.status === "loading" ? <Spinner className="h-4 w-4" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-label="Avançar para um ponto do áudio"
          disabled={!duration || state.status !== "ready"}
          onClick={(event) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            audio.currentTime = ratio * duration;
            setProgress(audio.currentTime);
          }}
          className="h-1.5 w-full overflow-hidden rounded-full bg-border disabled:cursor-default"
        >
          <div className="h-full bg-primary dark:bg-primary-glow" style={{ width: duration ? `${Math.min(100, (progress / duration) * 100)}%` : "0%" }} />
        </button>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatDuration(duration - progress > 0 ? duration - progress : duration)}</span>
      {state.status === "ready" && state.url ? (
        <audio
          ref={audioRef}
          src={state.url}
          preload="metadata"
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || duration)}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        />
      ) : null}
    </div>
  );
}

function VideoMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);
  const thumbnail = message.metadata?.thumbnailDataUrl;

  if (state.status === "error") return <MediaFallback type="video" retry={load} />;

  if (state.status !== "ready" || !state.url) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        aria-label="Reproduzir vídeo"
        className="relative flex h-40 w-64 items-center justify-center overflow-hidden rounded-lg bg-muted/70 bg-cover bg-center"
        style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined}
      >
        {state.status === "loading" ? (
          <Spinner className="h-6 w-6 text-foreground" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80">
            <Play className="h-5 w-5 translate-x-0.5" />
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="max-w-[280px]">
      <video src={state.url} poster={thumbnail} controls preload="metadata" className="max-h-72 w-full rounded-lg" />
    </div>
  );
}

function DocumentMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);
  const fileName = message.metadata?.fileName ?? "Documento";
  const fileSize = formatFileSize(message.metadata?.fileSizeBytes);

  useEffect(() => {
    if (state.status === "ready" && state.url) window.open(state.url, "_blank", "noopener,noreferrer");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  if (state.status === "error") return <MediaFallback type="document" retry={load} />;

  return (
    <div className={cn("flex w-64 items-center gap-3 rounded-lg bg-muted/70 px-3 py-2")}>
      <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
        <p className="text-xs text-muted-foreground">{[message.mimeType?.split("/")[1]?.toUpperCase(), fileSize].filter(Boolean).join(" · ") || "Documento"}</p>
      </div>
      <Button variant="secondary" size="sm" loading={state.status === "loading"} onClick={() => void load()}>
        Abrir
      </Button>
    </div>
  );
}
