"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { Label, Textarea } from "@/components/Field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acceptPublicProposal, getPublicProposal, rejectPublicProposal } from "@/features/crm/public-proposal-api";
import type { Proposal, ProposalStatus } from "@/features/crm/types";
import { formatCurrencyCents, formatDate } from "@/lib/format";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Aguardando resposta",
  viewed: "Aguardando resposta",
  accepted: "Aceita",
  rejected: "Recusada",
  expired: "Expirada",
};

const STATUS_VARIANT: Record<ProposalStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  sent: "secondary",
  viewed: "secondary",
  accepted: "default",
  rejected: "destructive",
  expired: "outline",
};

/** Item 48 do pedido — erros do backend vêm como `"PROPOSAL_LINK_REVOKED: este link foi
 * revogado."` (código + frase já em português, ver `public-proposals.route.ts`); num cliente
 * final que abriu o link pelo WhatsApp, o prefixo técnico não deveria aparecer. Só remove o
 * prefixo, nunca troca o texto (que já é a mensagem certa pro usuário). */
function cleanPublicErrorMessage(message: string, fallback: string): string {
  const cleaned = message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "").trim();
  return cleaned || fallback;
}

export default function PublicProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<Proposal | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"accept" | "reject" | undefined>();
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("other");
  const [rejectComment, setRejectComment] = useState("");
  const [actionError, setActionError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setProposal(await getPublicProposal(token));
    } catch (cause) {
      const message = cause instanceof Error ? cleanPublicErrorMessage(cause.message, "Não foi possível carregar a proposta.") : "Não foi possível carregar a proposta.";
      setError(new Error(message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleAccept() {
    setBusy("accept");
    setActionError(undefined);
    try {
      setProposal(await acceptPublicProposal(token));
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
      setProposal(await rejectPublicProposal(token, { reason: rejectReason, comment: rejectComment.trim() || undefined }));
      setRejecting(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cleanPublicErrorMessage(cause.message, "Não foi possível recusar a proposta.") : "Não foi possível recusar a proposta.");
    } finally {
      setBusy(undefined);
    }
  }

  const canRespond = proposal && (proposal.status === "sent" || proposal.status === "viewed");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center px-4 py-10">
      <Logo className="h-10 w-auto text-foreground" />
      {proposal?.issuerName ? <p className="mt-2 text-sm font-medium text-muted-foreground">{proposal.issuerName}</p> : null}

      {loading ? <div className="mt-16 flex justify-center"><Spinner /></div> : null}
      {error ? <div className="mt-8 w-full"><ErrorState error={error} onRetry={load} /></div> : null}

      {proposal ? (
        <Card className="mt-8 w-full">
          <CardBody className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg font-semibold text-foreground">{proposal.title}</h1>
              <Badge variant={STATUS_VARIANT[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
            </div>
            {proposal.customerName ? <p className="text-sm text-muted-foreground">Cliente: {proposal.customerName}{proposal.customerCompany ? ` · ${proposal.customerCompany}` : ""}</p> : null}

            <div className="space-y-2">
              {proposal.items.map((item, index) => (
                <div key={index} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex justify-between gap-3"><p className="font-medium text-foreground">{item.name}</p><p className="shrink-0 font-semibold tabular-nums">{formatCurrencyCents(item.subtotalCents, proposal.currency)}</p></div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.quantity} x {formatCurrencyCents(item.unitPriceCents, proposal.currency)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1 text-sm">
              {proposal.discountCents > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Desconto</span>
                  <span className="tabular-nums">- {formatCurrencyCents(proposal.discountCents, proposal.currency)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-base font-semibold text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</span>
              </div>
            </div>

            {proposal.validUntil ? <p className="text-xs text-muted-foreground">Válida até {formatDate(proposal.validUntil)}</p> : null}
            {proposal.conditions ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.conditions}</p> : null}

            {actionError ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
            {canRespond && rejecting ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div><Label htmlFor="reject-reason">Motivo</Label><Select value={rejectReason} onValueChange={setRejectReason}><SelectTrigger id="reject-reason"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="price">Preço</SelectItem><SelectItem value="deadline">Prazo</SelectItem><SelectItem value="scope">Escopo</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select></div>
                <div><Label htmlFor="reject-comment">Comentário (opcional)</Label><Textarea id="reject-comment" value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} rows={3} /></div>
                <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>Voltar</Button><Button className="flex-1" onClick={handleReject} loading={busy === "reject"} disabled={Boolean(busy)}>Confirmar recusa</Button></div>
              </div>
            ) : canRespond ? (
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <Button className="flex-1" onClick={handleAccept} loading={busy === "accept"} disabled={Boolean(busy)}>Aceitar proposta</Button>
                <Button className="flex-1" variant="secondary" onClick={() => setRejecting(true)} disabled={Boolean(busy)}>Recusar</Button>
              </div>
            ) : (
              <p className="pt-2 text-sm text-muted-foreground">
                {proposal.status === "accepted" ? "Você aceitou esta proposta." : proposal.status === "rejected" ? "Você recusou esta proposta." : proposal.status === "expired" ? "Esta proposta expirou." : null}
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}
    </main>
  );
}
