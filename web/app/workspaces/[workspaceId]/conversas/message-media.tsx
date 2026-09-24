"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { ChevronLeft, ChevronRight, FileText, Pause, Play, UserRound, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { getApiBaseUrl } from "@/lib/api-error";
import { getInboxMediaToken } from "@/features/inbox/api";
import type { InboxMessage } from "@/features/inbox/types";
import { cn } from "@/lib/utils";
import { mediaIconFor, mediaLabelFor, messageSenderLabel } from "./inbox-tab";

/**
 * Redesign operacional (mídia real) — renderizadores reais de imagem/áudio/vídeo/documento,
 * substituindo o antigo fallback estático ("Imagem recebida" etc.). `mediaLabelFor`/`mediaIconFor`
 * (de `inbox-tab.tsx`) continuam existindo só como o estado de erro/fallback abaixo — nunca mais
 * o caminho feliz.
 */

type MediaUrlState = { status: "idle" | "loading" | "ready" | "error"; url?: string };

/** Nunca expõe token principal, URL privada da WuzAPI nem path interno do storage no frontend
 * (seção 14 do pedido de mídia) — só um `media_token` de curtíssima duração, escopado a ESTA
 * mensagem, trocado por um proxy do próprio backend (`/v1/inbox/media/:messageId`). Mesmo mecanismo
 * usado pela bolha inline e pelo `ConversationMediaViewer` — nunca dois caminhos de acesso a mídia.
 * `message` pode ser `undefined` (usado pelo preload de vizinhas no viewer, que precisa chamar o
 * hook incondicionalmente mesmo quando não há uma mídia anterior/próxima). */
export function useMediaUrl(workspaceId: string, message: InboxMessage | undefined) {
  const [state, setState] = useState<MediaUrlState>({ status: "idle" });
  const requestIdRef = useRef(0);

  async function load() {
    if (!message?.mediaStorageRef) return;
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
function MediaFallback({ type, retry, isOutbound }: { type: InboxMessage["type"]; retry?: () => void; isOutbound?: boolean }) {
  const Icon = mediaIconFor(type);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-xs">{retry ? MEDIA_ERROR_LABEL[type] : mediaLabelFor(type, isOutbound)}</span>
      {retry ? (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

/** Bloco "enviar/receber contato" (pedido explícito do usuário: "quando eu receber ou enviar um
 * contato carregar corretamente"). Nunca tem `mediaStorageRef` (um contato não é mídia baixada) —
 * o nome/telefone já vêm prontos em `message.metadata` (ver `extractContactFields`,
 * `sendInboxContactCardMessage`), então renderiza direto, sem token/proxy nenhum. Achado real
 * corrigido: antes desta correção `MessageMedia` caía sempre no ramo `!mediaStorageRef` pra
 * qualquer contato (inbound ou outbound), mostrando permanentemente "Não foi possível carregar
 * este contato." mesmo com o nome/telefone já salvos. */
function ContactCardMedia({ message }: { message: InboxMessage }) {
  const name = message.metadata?.contactName;
  const phone = message.metadata?.contactPhone;
  if (!name && !phone) return <MediaFallback type="contact" isOutbound={message.direction === "outbound"} />;
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10">
        <UserRound className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name || phone}</span>
        {name && phone ? <span className="block truncate text-xs opacity-70">{phone}</span> : null}
      </span>
    </div>
  );
}

export function MessageMedia({ workspaceId, message, onOpen }: { workspaceId: string; message: InboxMessage; onOpen: () => void }) {
  if (message.type === "contact") return <ContactCardMedia message={message} />;
  if (!message.mediaStorageRef) {
    // Mídia ainda não foi baixada (best-effort/assíncrono — pode chegar em instantes) ou nunca
    // será (download falhou/não configurado). Mesmo rótulo nos dois casos: não dá para o
    // frontend distinguir "ainda processando" de "nunca vai chegar" sem um campo de status
    // dedicado, e não vale a pena inventar um polling só para isso nesta rodada.
    return <MediaFallback type={message.type} isOutbound={message.direction === "outbound"} />;
  }
  if (message.type === "image") return <ImageMedia workspaceId={workspaceId} message={message} onOpen={onOpen} />;
  if (message.type === "audio") return <AudioMedia workspaceId={workspaceId} message={message} />;
  if (message.type === "video") return <VideoMedia message={message} onOpen={onOpen} />;
  if (message.type === "document") return <DocumentMedia workspaceId={workspaceId} message={message} />;
  return <MediaFallback type={message.type} isOutbound={message.direction === "outbound"} />;
}

/** Clique abre o `ConversationMediaViewer` compartilhado (seção 1 do pedido de mídia) — nunca mais
 * um lightbox próprio e básico aqui. A miniatura inline continua carregando a imagem de verdade
 * (leve o bastante pra valer a pena mostrar já na bolha, ao contrário do vídeo — ver `VideoMedia`). */
function ImageMedia({ workspaceId, message, onOpen }: { workspaceId: string; message: InboxMessage; onOpen: () => void }) {
  const { state, load } = useMediaUrl(workspaceId, message);

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
    <button type="button" onClick={onOpen} className="block max-w-[260px] overflow-hidden rounded-lg">
      {/* eslint-disable-next-line @next/next/no-img-element -- mídia privada servida via proxy autenticado, nunca otimizável pelo loader padrão do Next */}
      <img src={state.url} alt="Imagem recebida" loading="lazy" className="max-h-72 w-full object-cover" />
    </button>
  );
}

/** Ciclo de velocidade — mesmo conjunto/ordem do player nativo do WhatsApp (1x → 1,5x → 2x → 1x). */
const AUDIO_PLAYBACK_RATES = [1, 1.5, 2] as const;

function AudioMedia({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(message.metadata?.durationSeconds ?? 0);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);
  const playbackRate = AUDIO_PLAYBACK_RATES[playbackRateIndex];

  // Reaplica sempre que a taxa muda OU quando o elemento <audio> só agora existe (`state.status`
  // vira "ready") — setar `playbackRate` num elemento ainda não montado seria um no-op silencioso.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, state.status]);

  function cyclePlaybackRate() {
    setPlaybackRateIndex((current) => (current + 1) % AUDIO_PLAYBACK_RATES.length);
  }

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
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5 text-[11px] font-semibold tabular-nums"
        disabled={state.status !== "ready"}
        onClick={cyclePlaybackRate}
        aria-label="Velocidade de reprodução"
      >
        {playbackRate}x
      </Button>
      {state.status === "ready" && state.url ? (
        <audio
          ref={audioRef}
          src={state.url}
          preload="metadata"
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || duration);
            event.currentTarget.playbackRate = playbackRate;
          }}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        />
      ) : null}
    </div>
  );
}

/** Miniatura clicável, nunca um player inline (pedido explícito do usuário: "ao clicar em uma foto
 * ou vídeo, abrir um visualizador completo") — o player DE VERDADE (controles nativos completos:
 * play/pause, barra de progresso, volume, fullscreen) só existe dentro do
 * `ConversationMediaViewer`. Isso também é o que evita baixar o vídeo inteiro só por ele aparecer
 * na timeline (seção 10 do pedido): `thumbnailDataUrl` já vem local no `metadata` da mensagem — o
 * token/URL de mídia real só é buscado quando o visualizador abre de verdade. */
function VideoMedia({ message, onOpen }: { message: InboxMessage; onOpen: () => void }) {
  const thumbnail = message.metadata?.thumbnailDataUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Abrir vídeo"
      className="relative flex h-40 w-64 items-center justify-center overflow-hidden rounded-lg bg-muted/70 bg-cover bg-center"
      style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80">
        <Play className="h-5 w-5 translate-x-0.5" />
      </span>
    </button>
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

function mediaViewerTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const timePart = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${datePart} · ${timePart}`;
}

/**
 * Visualizador de mídia (pedido explícito do usuário: "experiência semelhante ao WhatsApp Web") —
 * componente ÚNICO reusado pra imagem E vídeo (seção 15: "não implementar uma versão pra imagem e
 * outra totalmente diferente pra vídeo"). Renderizado UMA vez em `ConversationTimelinePane`, nunca
 * dentro da área de scroll da timeline — é um overlay `fixed`, então abrir/fechar nunca desmonta a
 * conversa nem mexe no scroll dela (seção 11 do pedido).
 */
export function ConversationMediaViewer({
  workspaceId,
  media,
  initialMessageId,
  isGroup,
  onClose,
}: {
  workspaceId: string;
  /** Mídias (imagem/vídeo) da conversa, já em ordem cronológica — o viewer só FILTRA/NAVEGA essa
   * lista, nunca busca uma lista própria (a Inbox não é refeita só por abrir uma mídia). */
  media: readonly InboxMessage[];
  initialMessageId: string;
  isGroup: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, media.findIndex((item) => item.id === initialMessageId)));
  const current = media[index];
  const hasPrev = index > 0;
  const hasNext = index < media.length - 1;

  const goPrev = useCallback(() => setIndex((value) => Math.max(0, value - 1)), []);
  const goNext = useCallback(() => setIndex((value) => Math.min(media.length - 1, value + 1)), [media.length]);

  // Teclado (seção 4 do pedido): ArrowLeft/ArrowRight navegam, Escape fecha.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, goNext, goPrev]);

  // Trava só o scroll do <body> (a página por trás) enquanto o viewer está aberto — nunca o scroll
  // da timeline em si, que nem existe dentro deste componente (seção 11: "não alterar scroll da
  // timeline").
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Swipe simples (seção 5, mobile: "se for simples e seguro, pode implementar") — só um delta
  // horizontal mínimo entre toque inicial e final, sem biblioteca nova.
  const touchStartXRef = useRef<number | undefined>(undefined);
  function handleTouchStart(event: React.TouchEvent) {
    touchStartXRef.current = event.touches[0]?.clientX;
  }
  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartXRef.current;
    touchStartXRef.current = undefined;
    const endX = event.changedTouches[0]?.clientX;
    if (startX === undefined || endX === undefined) return;
    const delta = endX - startX;
    if (Math.abs(delta) < 50) return; // limiar mínimo — nunca confunde um toque comum com swipe
    if (delta < 0) goNext();
    else goPrev();
  }

  if (!current) return null;

  const senderLabel = messageSenderLabel(current, isGroup);
  const caption = current.body?.trim();
  const timestamp = mediaViewerTimestamp(current.sentAt ?? current.createdAt);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de mídia"
      className="fixed inset-0 z-[70] flex flex-col bg-black/95"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 p-3" onClick={(event) => event.stopPropagation()}>
        <span className="text-xs tabular-nums text-white/70">{index + 1} de {media.length}</span>
        <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-1.5 text-white/90 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-1 sm:px-4">
        {hasPrev ? (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); goPrev(); }}
            aria-label="Mídia anterior"
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 sm:left-3"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}

        <div className="flex h-full w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
          <ViewerSlide key={current.id} workspaceId={workspaceId} message={current} />
        </div>

        {hasNext ? (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); goNext(); }}
            aria-label="Próxima mídia"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 sm:right-3"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>

      {/* Preload só da vizinha (anterior/próxima), nunca a galeria inteira (seção 10 do pedido) —
         e só imagem: vídeo fica pro clique de verdade, nunca baixa por antecipação. */}
      <ViewerPreload workspaceId={workspaceId} message={hasPrev ? media[index - 1] : undefined} />
      <ViewerPreload workspaceId={workspaceId} message={hasNext ? media[index + 1] : undefined} />

      {senderLabel || caption ? (
        <div className="shrink-0 px-4 pb-4 pt-1 text-center" onClick={(event) => event.stopPropagation()}>
          {/* Discreto (seção 8: "não poluir o viewer") — só nome/hora pequenos, caption um pouco
             maior, tudo em tom claro sobre o fundo escuro, nunca um cartão/caixa própria. */}
          {senderLabel || timestamp ? (
            <p className="text-xs text-white/60">{[senderLabel, timestamp].filter(Boolean).join(" · ")}</p>
          ) : null}
          {caption ? <p className="mt-1 text-sm text-white/90">{caption}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Conteúdo real de UM slide — imagem/vídeo/carregando/erro. Vídeo aqui É o player de verdade
 * (controles nativos: play/pause, progresso, volume, fullscreen — seção 7 do pedido), nunca o
 * player inline enxuto da bolha. Trocar de slide desmonta este componente (a `key={current.id}` no
 * componente pai) — é isso que PARA o vídeo anterior sozinho, sem código extra (seção 7: "quando
 * trocar de mídia, parar o vídeo anterior"). */
function ViewerSlide({ workspaceId, message }: { workspaceId: string; message: InboxMessage }) {
  const { state, load } = useMediaUrl(workspaceId, message);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  if (!message.mediaStorageRef) {
    return <p className="px-6 text-center text-sm text-white/70">Esta mídia ainda não está disponível.</p>;
  }

  if (state.status === "error") {
    // Texto exato pedido (seção 13) — nunca spinner infinito, tela preta ou modal vazio.
    return (
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <p className="text-sm text-white/85">Não foi possível carregar esta mídia.</p>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (state.status !== "ready" || !state.url) {
    return <Spinner className="h-8 w-8 text-white/80" />;
  }

  if (message.type === "video") {
    return (
      <video
        key={state.url}
        src={state.url}
        poster={message.metadata?.thumbnailDataUrl}
        controls
        autoPlay={false}
        className="max-h-full max-w-full"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- mídia privada servida via proxy autenticado
    <img src={state.url} alt={message.body?.trim() || "Imagem"} className="max-h-full max-w-full object-contain" />
  );
}

/** Preload discreto de UMA mídia vizinha (seção 10: "pode fazer preload só da anterior/atual/
 * próxima") — só resolve o token/URL e, se for IMAGEM, deixa um `<img>` escondido puxar os bytes
 * pro cache do navegador. Vídeo nunca preloada aqui (seção 10 também pede "não baixar 200 arquivos
 * de uma vez" — um vídeo inteiro adiantado por navegação que talvez nem aconteça é exatamente o
 * desperdício que a seção quer evitar). `message` pode ser `undefined` (sem vizinha nessa ponta). */
function ViewerPreload({ workspaceId, message }: { workspaceId: string; message: InboxMessage | undefined }) {
  const { state, load } = useMediaUrl(workspaceId, message);

  useEffect(() => {
    if (message?.type === "image" && message.mediaStorageRef) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  if (!message || message.type !== "image" || state.status !== "ready" || !state.url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt="" aria-hidden="true" className="hidden" />;
}
