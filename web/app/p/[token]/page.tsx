"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
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

export default function PublicProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<Proposal | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"accept" | "reject" | undefined>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setProposal(await getPublicProposal(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Não foi possível carregar a proposta."));
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
    try {
      setProposal(await acceptPublicProposal(token));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleReject() {
    setBusy("reject");
    try {
      setProposal(await rejectPublicProposal(token));
    } finally {
      setBusy(undefined);
    }
  }

  const canRespond = proposal && (proposal.status === "sent" || proposal.status === "viewed");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center px-4 py-10">
      <Logo className="h-10 w-auto text-foreground" />

      {loading ? <div className="mt-16 flex justify-center"><Spinner /></div> : null}
      {error ? <div className="mt-8 w-full"><ErrorState error={error} onRetry={load} /></div> : null}

      {proposal ? (
        <Card className="mt-8 w-full">
          <CardBody className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg font-semibold text-foreground">{proposal.title}</h1>
              <Badge variant={STATUS_VARIANT[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                    <th className="px-3 py-2 text-right font-medium">Preço</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.items.map((item, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-foreground">{item.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrencyCents(item.unitPriceCents, proposal.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrencyCents(item.subtotalCents, proposal.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

            {canRespond ? (
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <Button className="flex-1" onClick={handleAccept} loading={busy === "accept"} disabled={Boolean(busy)}>Aceitar proposta</Button>
                <Button className="flex-1" variant="secondary" onClick={handleReject} loading={busy === "reject"} disabled={Boolean(busy)}>Recusar</Button>
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
