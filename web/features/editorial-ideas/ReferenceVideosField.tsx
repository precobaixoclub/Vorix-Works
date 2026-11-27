"use client";

import { Clapperboard, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/Field";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { cn } from "@/lib/utils";
import { REFERENCE_VIDEO_ROLE_OPTIONS, type ReferenceVideo, type ReferenceVideoRole } from "./api";

export const MAX_REFERENCE_VIDEOS = 3;

/**
 * Vídeos profissionais de referência da pauta (até 3). Cada um ganha um PAPEL — estrutura e ritmo,
 * estética e acabamento, ou os dois — e uma nota. O motor mede a linguagem do vídeo (cortes, ritmo,
 * movimento, cor, composição, áudio) e cria uma peça original: nada da referência entra no vídeo.
 */
export function ReferenceVideosField({ workspaceId, value, onChange, onUploading }: {
  workspaceId: string;
  value: ReferenceVideo[];
  onChange: (next: ReferenceVideo[]) => void;
  onUploading?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    const videos = Array.from(files ?? []).filter((file) => file.type === "video/mp4");
    if (!videos.length) { toast.error("Envie vídeos MP4."); return; }
    const room = MAX_REFERENCE_VIDEOS - value.length;
    if (room <= 0) { toast.error(`No máximo ${MAX_REFERENCE_VIDEOS} vídeos de referência.`); return; }
    setBusy(true);
    onUploading?.(true);
    try {
      const uploaded = await Promise.all(videos.slice(0, room).map((file) => uploadPublicationMedia(workspaceId, file)));
      // Primeiro vídeo = estrutura, segundo = estética (o caso mais comum); dá para trocar na hora.
      onChange([...value, ...uploaded.map((item, index): ReferenceVideo => ({ url: item.url, role: value.length + index === 0 ? "structure" : value.length + index === 1 ? "aesthetic" : "both" }))]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar o vídeo.");
    } finally {
      setBusy(false);
      onUploading?.(false);
      if (input.current) input.current.value = "";
    }
  }

  const update = (index: number, patch: Partial<ReferenceVideo>) => onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Vídeos de referência</p>
        <span className="text-xs tabular-nums text-muted-foreground">{value.length}/{MAX_REFERENCE_VIDEOS}</span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Anúncios que você admira. Diga o que cada um deve inspirar: o vídeo é criado do zero com a sua marca, sem copiar trechos.</p>
      <div className="flex flex-col gap-2">
        {value.map((video, index) => (
          <div key={video.url} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
            <video src={video.url} muted playsInline preload="metadata" className="h-20 w-12 shrink-0 rounded bg-muted object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Papel do vídeo ${index + 1}`}>
                {REFERENCE_VIDEO_ROLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={video.role === option.value}
                    onClick={() => update(index, { role: option.value as ReferenceVideoRole })}
                    className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", video.role === option.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Input value={video.note ?? ""} maxLength={600} placeholder="O que aproveitar (ex.: gancho nos 2 primeiros segundos, cortes rápidos)" onChange={(event) => update(index, { note: event.target.value })} />
            </div>
            <button type="button" aria-label={`Remover vídeo ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))} className="self-end rounded-full p-1 text-muted-foreground hover:text-destructive sm:self-center">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        {value.length < MAX_REFERENCE_VIDEOS ? (
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">
            <Clapperboard className="h-4 w-4" aria-hidden="true" />
            {busy ? "Enviando…" : "Adicionar vídeo de referência (MP4)"}
          </button>
        ) : null}
      </div>
      <input ref={input} type="file" accept="video/mp4" multiple className="hidden" onChange={(event) => void add(event.target.files)} />
    </section>
  );
}
