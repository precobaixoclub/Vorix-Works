"use client";

import { useState } from "react";
import { Sticker as StickerIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/Spinner";
import { deleteSavedSticker, sendSavedSticker, useSavedStickers, useStickerImage, type SavedSticker } from "@/features/inbox/stickers";
import { ApiError } from "@/lib/api-client";

/** Botão de figurinhas no campo de mensagem: as salvas da equipe, um clique envia. */
export function StickerPickerButton({ workspaceId, conversationId, disabled, onSent }: { workspaceId: string; conversationId: string; disabled?: boolean; onSent: () => Promise<unknown> | void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, mutate } = useSavedStickers(workspaceId, open);
  const [sending, setSending] = useState<string | null>(null);

  async function send(sticker: SavedSticker) {
    setSending(sticker.id);
    try {
      await sendSavedSticker(workspaceId, conversationId, sticker.id);
      setOpen(false);
      await onSent();
    } catch (cause) {
      toast.error("Não foi possível enviar a figurinha", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setSending(null);
    }
  }

  async function remove(sticker: SavedSticker) {
    try {
      await deleteSavedSticker(workspaceId, sticker.id);
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível remover", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="inline-flex">
          <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Figurinhas salvas">
            <StickerIcon className="h-4 w-4" />
          </Button>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">Figurinhas salvas</p>
        {isLoading ? <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-muted-foreground" /></div> : null}
        {!isLoading && (data?.length ?? 0) === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-muted-foreground">Nenhuma figurinha salva ainda. Passe o mouse numa figurinha recebida e clique em "Salvar figurinha".</p>
        ) : null}
        <div className="grid max-h-72 grid-cols-4 gap-1 overflow-y-auto">
          {(data ?? []).map((sticker) => (
            <SavedStickerTile key={sticker.id} workspaceId={workspaceId} sticker={sticker} busy={sending === sticker.id} disabled={!!sending} onSend={() => void send(sticker)} onRemove={() => void remove(sticker)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SavedStickerTile({ workspaceId, sticker, busy, disabled, onSend, onRemove }: { workspaceId: string; sticker: SavedSticker; busy: boolean; disabled: boolean; onSend: () => void; onRemove: () => void }) {
  const url = useStickerImage(workspaceId, sticker.id);
  return (
    <div className="group/tile relative">
      <button type="button" onClick={onSend} disabled={disabled} aria-label="Enviar figurinha" className="flex h-16 w-full items-center justify-center rounded-md hover:bg-muted disabled:opacity-60">
        {busy || !url ? <Spinner className="h-4 w-4 text-muted-foreground" /> : (
          // eslint-disable-next-line @next/next/no-img-element -- figurinha privada servida pela API autenticada
          <img src={url} alt="" className="h-14 w-14 object-contain" />
        )}
      </button>
      <button type="button" onClick={onRemove} aria-label="Remover figurinha salva" className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/55 p-0.5 text-white group-hover/tile:block">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
