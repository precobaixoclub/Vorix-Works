"use client";

import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { previewLidCleanup, runLidCleanup, type LidCleanupPreview } from "@/features/crm/api";

/**
 * Limpeza dos contatos que só têm o LID do WhatsApp (sem número de celular). Mostra antes o que
 * será removido; contatos com oportunidade ou proposta ficam (para revisar à mão). A conversa do
 * WhatsApp nunca é apagada — volta a virar contato quando o número real chegar.
 */
export function LidCleanupDialog({ workspaceId, onClose, onDone }: { workspaceId: string; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [preview, setPreview] = useState<LidCleanupPreview>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    previewLidCleanup(workspaceId).then(setPreview).catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível analisar os contatos."));
  }, [workspaceId]);

  async function run() {
    setRunning(true);
    try {
      const result = await runLidCleanup(workspaceId);
      toast.success(result.removed === 1 ? "1 contato sem número foi removido." : `${result.removed} contatos sem número foram removidos.`, {
        description: result.protected ? `${result.protected} ficaram porque têm oportunidade ou proposta.` : undefined,
      });
      await onDone();
    } catch (cause) {
      toast.error("Não foi possível remover os contatos", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal title="Remover contatos sem número de celular" onClose={onClose} maxWidthClass="sm:max-w-xl">
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Às vezes o WhatsApp envia só um código técnico (LID) no lugar do número. Esses contatos não têm celular e atrapalham a busca e o atendimento. A conversa continua no Inbox e o contato volta quando o número real aparecer.
        </p>
        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p> : null}
        {!preview && !error ? <div className="flex justify-center py-6"><Spinner /></div> : null}
        {preview ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"><p className="text-2xl font-semibold tabular-nums text-destructive">{preview.removable.length}</p><p className="text-xs text-muted-foreground">serão removidos</p></div>
              <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3"><p className="text-2xl font-semibold tabular-nums text-orange-600 dark:text-orange-300">{preview.protected.length}</p><p className="text-xs text-muted-foreground">ficam (têm venda/proposta)</p></div>
              <div className="rounded-lg border border-border/70 p-3"><p className="text-2xl font-semibold tabular-nums text-foreground">{preview.withPhone}</p><p className="text-xs text-muted-foreground">com celular (ficam)</p></div>
            </div>
            {preview.removable.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Serão removidos</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-2">
                  {preview.removable.slice(0, 100).map((item) => <li key={item.contactId} className="flex items-center gap-2 truncate"><PhoneOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{item.name}</li>)}
                  {preview.removable.length > 100 ? <li className="text-xs text-muted-foreground">… e mais {preview.removable.length - 100}</li> : null}
                </ul>
              </div>
            ) : <p className="rounded-lg bg-muted/50 px-3 py-2 text-muted-foreground">Nenhum contato sem número para remover.</p>}
            {preview.protected.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Ficam para você revisar</p>
                <ul className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-2">
                  {preview.protected.map((item) => <li key={item.contactId} className="truncate">{item.name} <span className="text-xs text-muted-foreground">— {item.reason}</span></li>)}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={running}>Cancelar</Button>
          <Button variant="danger" onClick={run} loading={running} disabled={!preview || preview.removable.length === 0 || running}>
            {preview?.removable.length ? `Remover ${preview.removable.length} contato${preview.removable.length === 1 ? "" : "s"}` : "Remover"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
