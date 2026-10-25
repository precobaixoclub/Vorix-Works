"use client";

import { useState } from "react";
import useSWR from "swr";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { previewProposalWhatsapp, remindProposalWhatsapp, sendProposalWhatsapp } from "@/features/sales/api";

/** The draft comes from the same server renderer used by delivery, including workspace templates. */
export function ProposalWhatsappDialog({ workspaceId, proposalId, conversationId, reminder = false, onClose, onSent }: {
  workspaceId: string;
  proposalId: string;
  conversationId: string;
  reminder?: boolean;
  onClose: () => void;
  onSent: () => void | Promise<void>;
}) {
  const kind = reminder ? "reminder" : "send";
  const { data, error, isLoading, mutate } = useSWR(["proposal-whatsapp-preview", workspaceId, proposalId, kind], () => previewProposalWhatsapp(proposalId, workspaceId, kind));
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string>();
  // Keep the same key on a retry: a delayed response must not produce two WhatsApp messages.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const message = draft ?? data?.message ?? "";

  async function send() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setSendError(undefined);
    try {
      const sendMessage = reminder ? remindProposalWhatsapp : sendProposalWhatsapp;
      await sendMessage(proposalId, { workspaceId, conversationId, message, idempotencyKey });
      toast.success(reminder ? "Lembrete enviado pelo WhatsApp" : "Proposta enviada pelo WhatsApp");
      await onSent();
      onClose();
    } catch (cause) { setSendError(cause instanceof Error ? cause.message : "Não foi possível enviar. Tente novamente."); }
    finally { setBusy(false); }
  }

  return <Modal title={reminder ? "Enviar lembrete pelo WhatsApp" : "Enviar proposta pelo WhatsApp"} onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-3xl">
    <p className="text-sm text-muted-foreground">Revise a mensagem que será enviada ao cliente. Você pode ajustar o texto antes do envio.</p>
    {error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>Não foi possível carregar a mensagem.</p><Button variant="secondary" onClick={() => void mutate()}>Tentar novamente</Button></div> : null}
    {isLoading ? <p className="py-6 text-sm text-muted-foreground">Preparando mensagem...</p> : data ? <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="proposal-whatsapp-draft">Mensagem do WhatsApp</Label>
        <Textarea id="proposal-whatsapp-draft" value={message} maxLength={4000} rows={14} disabled={busy} onChange={(event) => setDraft(event.target.value)} className="text-sm" />
        <p className="text-xs text-muted-foreground">O link da proposta será incluído automaticamente. Use *texto* para destacar em negrito.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Prévia da mensagem</p>
        <div className="rounded-xl bg-[#efeae2] p-3 sm:p-4" aria-label="Prévia da mensagem no WhatsApp">
          <div className="ml-2 rounded-lg rounded-tr-none bg-[#d9fdd3] p-3 text-[13px] leading-relaxed text-[#17251d] shadow-sm">
            <div className="whitespace-pre-wrap break-words">{message.split(/(\{\{proposal_link\}\}|\{\{proposalUrl\}\}|\*[^*\n]+\*)/g).map((part, index) => part === "{{proposal_link}}" || part === "{{proposalUrl}}" ? <span key={index} className="text-[#087f8c] underline">Link da proposta</span> : part.startsWith("*") && part.endsWith("*") ? <strong key={index}>{part.slice(1, -1)}</strong> : part)}</div>
            {!/\{\{proposal_link\}\}|\{\{proposalUrl\}\}/.test(message) ? <p className="mt-3 text-[#087f8c] underline">Link da proposta</p> : null}
            <div className="mt-3 overflow-hidden rounded-lg border border-black/5 bg-white/70">
              <div className="flex items-center gap-3 bg-[#eaf4ee] px-3 py-5"><FileText className="h-8 w-8 shrink-0 text-[#236847]" /><p className="font-semibold text-[#163829]">Uma proposta para você.</p></div>
              <div className="space-y-1 p-3"><p className="font-semibold">Sua proposta comercial</p><p className="text-xs text-[#65766c]">Confira os itens, valores e condições da sua proposta.</p></div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Prévia ilustrativa. A aparência do cartão do link depende do WhatsApp.</p>
      </div>
    </div> : null}
    {sendError ? <p role="alert" className="text-sm text-destructive">{sendError}</p> : null}
    <div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="secondary" disabled={busy} onClick={onClose}>Voltar</Button><Button disabled={busy || !data || !!error || !message.trim()} loading={busy} onClick={() => void send()}><Send className="mr-2 h-4 w-4" />{reminder ? "Enviar lembrete" : "Enviar proposta"}</Button></div>
  </Modal>;
}
