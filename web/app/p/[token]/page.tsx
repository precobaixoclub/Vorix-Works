"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Download, FileText, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Label, Textarea } from "@/components/Field";
import { Logo } from "@/components/Logo";
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
import { BILLING_SUFFIX } from "@/features/sales/presentation";
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
    <div className="min-h-screen bg-muted/30 pb-28 print:bg-white print:pb-0 sm:pb-10">
      <header className="border-b border-border/60 bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">{proposal?.issuerName ?? "Proposta comercial"}</p>
            <p className="text-xs text-muted-foreground">Proposta comercial</p>
          </div>
          <Logo className="h-7 w-auto shrink-0 text-foreground opacity-80" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {loading ? <div className="mt-16 flex justify-center"><Spinner /></div> : null}
        {error ? <ErrorState error={error} onRetry={load} /> : null}

        {proposal ? (
          <article className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm print:border-0 print:shadow-none">
            <div className="bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-5 py-6 sm:px-8">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {proposal.number ?? "Proposta"}{proposal.version > 1 ? ` · versão ${proposal.version}` : ""}
              </p>
              <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{proposal.title}</h1>
              {proposal.customerName ? <p className="mt-1 text-sm text-muted-foreground">Para {proposal.customerName}{proposal.customerCompany ? ` · ${proposal.customerCompany}` : ""}</p> : null}
              <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Investimento</p>
                  <p className="text-3xl font-semibold tabular-nums text-foreground">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</p>
                </div>
                {proposal.validUntil ? (
                  <p className={cn("flex items-center gap-1.5 text-sm", remaining !== undefined && remaining <= 2 && canRespond ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    <CalendarClock className="h-4 w-4" />
                    Válida até {formatDate(proposal.validUntil)}{canRespond && remaining !== undefined && remaining >= 0 ? ` · ${remaining === 0 ? "vence hoje" : `${remaining} dia${remaining === 1 ? "" : "s"}`}` : ""}
                  </p>
                ) : null}
              </div>
            </div>

            <StatusBanner proposal={proposal} />

            <div className="space-y-6 px-5 py-6 sm:px-8">
              {proposal.introduction ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{proposal.introduction}</p> : null}

              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Itens</h2>
                <div className="divide-y divide-border/60 rounded-xl border border-border/60">
                  {proposal.items.map((item, index) => (
                    <div key={index} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{item.name}</p>
                        {item.description ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{item.description}</p> : null}
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{String(item.quantity).replace(".", ",")} × {formatCurrencyCents(item.unitPriceCents, proposal.currency)}{item.billingType ? BILLING_SUFFIX[item.billingType] ?? "" : ""}</p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums">{formatCurrencyCents(item.subtotalCents, proposal.currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {proposal.discountCents > 0 ? (
                    <>
                      <Row label="Subtotal" value={formatCurrencyCents(proposal.subtotalCents, proposal.currency)} />
                      <Row label="Desconto" value={`- ${formatCurrencyCents(proposal.discountCents, proposal.currency)}`} />
                    </>
                  ) : null}
                  <div className="flex justify-between border-t border-border/60 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</span></div>
                </div>
              </section>

              {proposal.conditions ? <TextSection title="Condições comerciais" text={proposal.conditions} /> : null}
              {proposal.notes ? <TextSection title="Observações" text={proposal.notes} /> : null}
              {proposal.terms ? <TextSection title="Termos" text={proposal.terms} small /> : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 print:hidden">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Link seguro e pessoal para esta proposta.</p>
                <Button variant="ghost" size="sm" onClick={() => { sendProposalDownload(token); window.print(); }}><Download className="mr-1.5 h-4 w-4" />Salvar PDF</Button>
              </div>
            </div>
          </article>
        ) : null}

        {actionError ? <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

        {canRespond && rejecting ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-border/60 bg-background p-4 print:hidden">
            <p className="text-sm font-medium">Pode nos contar o motivo? (opcional)</p>
            <div className="flex flex-wrap gap-2">
              {(proposal?.declineReasons ?? []).map((reason) => (
                <button key={reason} type="button" onClick={() => setRejectReason(reason === rejectReason ? "" : reason)} className={cn("rounded-full border px-3 py-1.5 text-sm", reason === rejectReason ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>{reason}</button>
              ))}
            </div>
            <div><Label htmlFor="reject-comment">Comentário (opcional)</Label><Textarea id="reject-comment" value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} rows={3} /></div>
            <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>Voltar</Button><Button variant="danger" className="flex-1" onClick={handleReject} loading={busy === "reject"} disabled={Boolean(busy)}>Confirmar recusa</Button></div>
          </div>
        ) : null}
      </main>

      {canRespond && !rejecting ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur print:hidden sm:static sm:mx-auto sm:mt-2 sm:max-w-3xl sm:border-0 sm:bg-transparent sm:px-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row">
            <Button className="h-11 flex-1 text-base" onClick={() => setConfirming(true)} disabled={Boolean(busy)}><CheckCircle2 className="mr-2 h-5 w-5" />Aceitar proposta</Button>
            <Button className="h-11 flex-1 sm:flex-none" variant="secondary" onClick={() => setRejecting(true)} disabled={Boolean(busy)}>Recusar proposta</Button>
          </div>
        </div>
      ) : null}

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

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-muted-foreground"><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function TextSection({ title, text, small }: { title: string; text: string; small?: boolean }) {
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      <p className={cn("whitespace-pre-wrap leading-relaxed text-foreground", small ? "text-xs text-muted-foreground" : "text-sm")}>{text}</p>
    </section>
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
