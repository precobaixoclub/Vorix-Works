"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Download, FileText, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Label, Textarea } from "@/components/Field";
import { ProposalDocument, proposalStyles } from "@/components/proposals/ProposalDocument";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import {
  acceptPublicProposal,
  getPublicProposal,
  rejectPublicProposal,
  sendProposalDownload,
  sendProposalEngagement,
  type PublicProposal,
} from "@/features/crm/public-proposal-api";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Remove o prefixo técnico (`CODIGO: mensagem`) — o cliente final só vê a frase em português. */
function cleanPublicErrorMessage(message: string, fallback: string): string {
  return message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "").trim() || fallback;
}

function daysUntil(date?: string): number | undefined {
  if (!date) return undefined;
  return Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000);
}

const HEARTBEAT_SECONDS = 30;

/**
 * Proposta comercial — página PÚBLICA aberta pelo cliente (normalmente no celular, pelo link do
 * WhatsApp). Sem login. Aceitar mostra o resumo antes de confirmar; o aceite é comercial (não é
 * assinatura eletrônica). Tempo de leitura enviado por heartbeat aproximado; "Salvar PDF" usa a
 * impressão do navegador e registra o evento.
 */
export default function PublicProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<PublicProposal | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"accept" | "reject" | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectComment, setRejectComment] = useState("");
  const [actionError, setActionError] = useState<string>();
  const loaded = useRef(false);

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setProposal(await getPublicProposal(token));
    } catch (cause) {
      setError(new Error(cause instanceof Error ? cleanPublicErrorMessage(cause.message, "Não foi possível carregar a proposta.") : "Não foi possível carregar a proposta."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const canRespond = Boolean(proposal && (proposal.status === "sent" || proposal.status === "viewed") && !proposal.superseded);

  // Tempo de leitura aproximado: só conta com a aba visível e a proposta em análise.
  useEffect(() => {
    if (!canRespond) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") sendProposalEngagement(token, HEARTBEAT_SECONDS);
    }, HEARTBEAT_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [canRespond, token]);

  async function handleAccept() {
    if (busy) return;
    setBusy("accept");
    setActionError(undefined);
    try {
      setProposal(await acceptPublicProposal(token));
      setConfirming(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cleanPublicErrorMessage(cause.message, "Não foi possível aceitar a proposta.") : "Não foi possível aceitar a proposta.");
    } finally {
      setBusy(undefined);
    }
  }

  async function handleReject() {
    if (busy) return;
    setBusy("reject");
    setActionError(undefined);
    try {
      setProposal(await rejectPublicProposal(token, { reason: rejectReason || undefined, comment: rejectComment.trim() || undefined }));
      setRejecting(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cleanPublicErrorMessage(cause.message, "Não foi possível recusar a proposta.") : "Não foi possível recusar a proposta.");
    } finally {
      setBusy(undefined);
    }
  }

  const remaining = daysUntil(proposal?.validUntil);

  return (
    <div className={proposalStyles.page}>
      <header className={proposalStyles.pageHeader}>
        <span><ShieldCheck className="h-4 w-4" />Uma proposta preparada especialmente para você</span>
        {proposal ? <Button variant="ghost" size="sm" onClick={() => { sendProposalDownload(token); window.print(); }}><Download className="h-4 w-4" />Salvar PDF</Button> : null}
      </header>

      <main className={proposalStyles.pageMain}>
        {loading ? <div className="mt-16 flex justify-center"><Spinner /></div> : null}
        {error ? <ErrorState error={error} onRetry={load} /> : null}

        {proposal ? <>
          <div className="mb-4 overflow-hidden rounded-xl" role="status"><StatusBanner proposal={proposal} /></div>
          {canRespond && remaining !== undefined && remaining >= 0 && remaining <= 2 ? <p className="mb-4 text-sm text-amber-200">{remaining === 0 ? "Sua proposta vence hoje." : `Sua proposta vence em ${remaining} dia${remaining === 1 ? "" : "s"}.`}</p> : null}
          <ProposalDocument proposal={proposal} actions={canRespond && !rejecting ? <>
            <Button className={proposalStyles.acceptButton} onClick={() => { setActionError(undefined); setConfirming(true); }} disabled={Boolean(busy)}><CheckCircle2 className="h-4 w-4" />Aceitar proposta</Button>
            <Button className={proposalStyles.rejectButton} variant="secondary" onClick={() => { setActionError(undefined); setRejecting(true); }} disabled={Boolean(busy)}>Recusar proposta</Button>
          </> : undefined} />
        </> : null}

        {actionError && !confirming && !rejecting ? <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

        {canRespond && rejecting ? (
          <div className={cn(proposalStyles.responsePanel, "space-y-3 print:hidden")}>
            <p className="text-sm font-medium">Pode nos contar o motivo? (opcional)</p>
            <div className="flex flex-wrap gap-2">
              {(proposal?.declineReasons ?? []).map((reason) => (
                <button key={reason} type="button" aria-pressed={reason === rejectReason} onClick={() => setRejectReason(reason === rejectReason ? "" : reason)} className={cn(proposalStyles.reason, reason === rejectReason && proposalStyles.selectedReason)}>{reason}</button>
              ))}
            </div>
            <div><Label htmlFor="reject-comment">Comentário (opcional)</Label><Textarea id="reject-comment" autoFocus value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} rows={3} maxLength={1000} /></div>
            {actionError ? <p role="alert" className="text-sm text-rose-300">{actionError}</p> : null}
            <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>Voltar</Button><Button variant="danger" className="flex-1" onClick={handleReject} loading={busy === "reject"} disabled={Boolean(busy)}>Confirmar recusa</Button></div>
          </div>
        ) : null}
      </main>

      {confirming && proposal ? (
        <Modal title="Confirmar aceite" onClose={() => setConfirming(false)}>
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {proposal.items.map((item, index) => <li key={index} className="flex justify-between gap-3"><span className="min-w-0 truncate">{String(item.quantity).replace(".", ",")} × {item.name}</span><span className="shrink-0 tabular-nums">{formatCurrencyCents(item.subtotalCents, proposal.currency)}</span></li>)}
            </ul>
            <div className="flex justify-between border-t border-border/60 pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</span></div>
            {proposal.conditions ? <p className="whitespace-pre-wrap text-muted-foreground">{proposal.conditions}</p> : null}
            {proposal.validUntil ? <p className="text-muted-foreground">Válida até {formatDate(proposal.validUntil)}.</p> : null}
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Ao confirmar, você registra o aceite comercial desta proposta ({proposal.number ?? "proposta"}{proposal.version > 1 ? ` v${proposal.version}` : ""}). Isto não é uma assinatura eletrônica.</p>
            {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)} disabled={busy === "accept"}>Voltar</Button>
              <Button className="flex-1" onClick={handleAccept} loading={busy === "accept"}>Confirmar aceite</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StatusBanner({ proposal }: { proposal: PublicProposal }) {
  const banner = proposal.superseded
    ? { icon: FileText, text: "Esta versão foi substituída por uma proposta mais recente. Use o link da versão nova.", tone: "bg-muted text-muted-foreground" }
    : proposal.status === "accepted"
      ? { icon: CheckCircle2, text: `Proposta aceita${proposal.respondedAt ? ` em ${formatDate(proposal.respondedAt)}` : ""}. Obrigado!`, tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" }
      : proposal.status === "rejected"
        ? { icon: XCircle, text: "Você recusou esta proposta. Se mudar de ideia, fale com o vendedor.", tone: "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200" }
        : proposal.status === "expired"
          ? { icon: CalendarClock, text: "Esta proposta expirou. Peça uma nova versão ao vendedor.", tone: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" }
          : proposal.status === "cancelled"
            ? { icon: XCircle, text: "Esta proposta foi cancelada.", tone: "bg-muted text-muted-foreground" }
            : undefined;
  if (!banner) return null;
  const Icon = banner.icon;
  return <div className={cn("flex items-center gap-2 px-5 py-3 text-sm sm:px-8", banner.tone)}><Icon className="h-4 w-4 shrink-0" />{banner.text}</div>;
}
