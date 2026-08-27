"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

/** Só texto — Conversation (Sprint 06) ainda não lida com anexo nenhum; a estrutura de upload do
 * Chat mock (Sprint 04) não se aplica ao domínio novo. */
export function ConversationComposer({ onSend, disabled }: { onSend: (content: string) => void; disabled?: boolean }) {
  const [content, setContent] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || disabled) return;
    onSend(content.trim());
    setContent("");
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface-raised p-3">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          placeholder="Converse com o Vorix…"
          rows={1}
          disabled={disabled}
          className="max-h-32 min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-primary focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
        />
        <Button type="submit" disabled={disabled}>
          Enviar
        </Button>
      </div>
    </form>
  );
}
