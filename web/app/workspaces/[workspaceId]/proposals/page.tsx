"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createProposal, sendProposal } from "@/features/crm/api";
import { useProducts, useProposals } from "@/features/crm/hooks";
import type { Proposal, ProposalStatus } from "@/features/crm/types";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Visualizada",
  accepted: "Aceita",
  rejected: "Recusada",
  expired: "Expirada",
};

const STATUS_VARIANT: Record<ProposalStatus, "outline" | "secondary" | "default" | "destructive"> = {
  draft: "outline",
  sent: "secondary",
  viewed: "secondary",
  accepted: "default",
  rejected: "destructive",
  expired: "outline",
};

type DraftItem = { productId?: string; name: string; quantity: number; unitPriceCents: number };

export default function ProposalsPage() {
  const workspace = useCurrentWorkspace();
  const { data: proposals, error, isLoading, mutate } = useProposals(workspace.id);
  const { data: products } = useProducts(workspace.id, { activeOnly: true });

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = proposals?.find((proposal) => proposal.id === selectedId);
  const [sendingId, setSendingId] = useState<string | undefined>();

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [discountReais, setDiscountReais] = useState("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [newLink, setNewLink] = useState<string | undefined>();

  function addProductItem(productId: string) {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    setItems((current) => [...current, { productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents }]);
  }

  function addCustomItem() {
    setItems((current) => [...current, { name: "", quantity: 1, unitPriceCents: 0 }]);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const discountCents = Math.round(Number(discountReais.replace(",", ".")) * 100) || 0;
  const totalCents = Math.max(0, subtotalCents - discountCents);

  async function handleCreate() {
    setBusy(true);
    try {
      const { publicToken } = await createProposal({
        workspaceId: workspace.id,
        title: title.trim(),
        items: items.filter((item) => item.name.trim()).map((item) => ({ productId: item.productId, name: item.name.trim(), quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
        discountCents,
        conditions: conditions.trim() || undefined,
      });
      setCreateOpen(false);
      setNewLink(`${window.location.origin}/p/${publicToken}`);
      setTitle("");
      setItems([]);
      setDiscountReais("");
      setConditions("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(proposal: Proposal) {
    setSendingId(proposal.id);
    try {
      await sendProposal(proposal.id, workspace.id);
      await mutate();
    } finally {
      setSendingId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Propostas"
        description="Monte, envie e acompanhe propostas comerciais — cada uma tem um link público de aceite."
        actions={<Button onClick={() => setCreateOpen(true)}>Nova proposta</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardBody className="p-0">
            {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
            {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
            {!isLoading && !error && proposals && proposals.length === 0 ? (
              <div className="p-5"><EmptyState title="Nenhuma proposta ainda" description="Crie a primeira proposta para começar a fechar negócios." /></div>
            ) : null}
            {proposals && proposals.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((proposal) => (
                    <TableRow key={proposal.id} className={selectedId === proposal.id ? "bg-primary/5" : undefined} onClick={() => setSelectedId(proposal.id)} style={{ cursor: "pointer" }}>
                      <TableCell className="font-medium text-foreground">{proposal.title}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        {proposal.status === "draft" ? (
                          <Button variant="ghost" onClick={(event) => { event.stopPropagation(); void handleSend(proposal); }} loading={sendingId === proposal.id}>Enviar</Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">{selected ? selected.title : "Detalhes"}</p></CardHeader>
          <CardBody>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Selecione uma proposta pra ver os itens.</p>
            ) : (
              <div className="space-y-2">
                {selected.items.map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.quantity}x {item.name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrencyCents(item.subtotalCents, selected.currency)}</span>
                  </div>
                ))}
                {selected.discountCents > 0 ? (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Desconto</span>
                    <span className="tabular-nums">- {formatCurrencyCents(selected.discountCents, selected.currency)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold text-foreground">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrencyCents(selected.totalCents, selected.currency)}</span>
                </div>
                {selected.sentAt ? <p className="pt-2 text-xs text-muted-foreground">Enviada em {formatDateTime(selected.sentAt)}</p> : null}
                {selected.respondedAt ? <p className="text-xs text-muted-foreground">Respondida em {formatDateTime(selected.respondedAt)}</p> : null}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {createOpen ? (
        <Modal title="Nova proposta" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="proposal-title">Título</Label>
              <Input id="proposal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Proposta — Plano Anual" />
            </div>

            <div className="space-y-2">
              <Label>Itens</Label>
              {items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
                  <Input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} placeholder="Item" className="min-w-[140px] flex-1" />
                  <Input type="number" min={1} value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) || 1 })} className="w-16" />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={(item.unitPriceCents / 100).toFixed(2)}
                    onChange={(event) => updateItem(index, { unitPriceCents: Math.round(Number(event.target.value) * 100) || 0 })}
                    className="w-24"
                  />
                  <Button variant="ghost" onClick={() => removeItem(index)}>Remover</Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {products && products.length > 0 ? (
                  <Select value="" onValueChange={addProductItem}>
                    <SelectTrigger className="w-52"><SelectValue placeholder="Adicionar do catálogo" /></SelectTrigger>
                    <SelectContent>
                      {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button variant="secondary" onClick={addCustomItem}>+ Item avulso</Button>
              </div>
            </div>

            <div>
              <Label htmlFor="proposal-discount">Desconto (R$)</Label>
              <Input id="proposal-discount" value={discountReais} onChange={(event) => setDiscountReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label htmlFor="proposal-conditions">Condições (opcional)</Label>
              <Textarea id="proposal-conditions" value={conditions} onChange={(event) => setConditions(event.target.value)} rows={3} />
            </div>

            <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold text-foreground">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrencyCents(totalCents)}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || items.length === 0 || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {newLink ? (
        <Modal title="Proposta criada" onClose={() => setNewLink(undefined)}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Guarde este link — ele não será mostrado novamente. Compartilhe com o cliente quando enviar a proposta.</p>
            <Input readOnly value={newLink} onFocus={(event) => event.target.select()} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(newLink); }}>Copiar link</Button>
              <Button onClick={() => setNewLink(undefined)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
